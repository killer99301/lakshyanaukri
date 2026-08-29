// ═══════════════════════════════════════════════════════════
// Phase 4: Change Review Queue
// ═══════════════════════════════════════════════════════════
//
// For every CONFIRMED_CHANGE a ReviewItem is created and appended to
// intelligence-runs/review-queue.json.
//
// INVARIANTS:
//   - productionWrites = 0 always; this module never touches src/data/
//   - APPROVE sets status only — it does NOT write to canonical data
//   - Dedup key prevents the same logical change being queued twice
//   - Queue path is injectable so tests can use a temp file
// ═══════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Opportunity, GovernmentRecruitment, ExamStageStatus } from "@/types";
import type {
  CandidateChangeEvent,
  ConfirmationResult,
  FieldDiff,
  ReviewItem,
  ReviewItemStatus,
  ChangeReviewQueue,
  ProposedChange,
} from "./types";
import { runTrustGateWithProposal } from "./trust-gate";

// ─── Queue file path ──────────────────────────────────────────

export const DEFAULT_QUEUE_PATH = join(
  process.cwd(),
  "intelligence-runs",
  "review-queue.json"
);

// ─── Deduplication key ────────────────────────────────────────
// Same logical change arriving in two different runs is suppressed.

export function buildDedupKey(
  opportunityId: string,
  changeType: string,
  matchedIdentifier: string
): string {
  return `${opportunityId}::${changeType}::${matchedIdentifier}`;
}

// ─── Queue IO ─────────────────────────────────────────────────

function emptyQueue(): ChangeReviewQueue {
  return { version: "1", lastUpdatedAt: new Date().toISOString(), items: [] };
}

export function loadReviewQueue(queuePath = DEFAULT_QUEUE_PATH): ChangeReviewQueue {
  if (!existsSync(queuePath)) return emptyQueue();
  try {
    const raw = readFileSync(queuePath, "utf-8");
    const parsed = JSON.parse(raw) as ChangeReviewQueue;
    if (!Array.isArray(parsed.items)) return emptyQueue();
    return parsed;
  } catch {
    return emptyQueue();
  }
}

function saveQueue(queue: ChangeReviewQueue, queuePath: string): void {
  queue.lastUpdatedAt = new Date().toISOString();
  writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");
}

// ─── Core operations ──────────────────────────────────────────

export function isDuplicate(dedupKey: string, queuePath = DEFAULT_QUEUE_PATH): boolean {
  const queue = loadReviewQueue(queuePath);
  return queue.items.some((item) => item.dedupKey === dedupKey);
}

export function appendToReviewQueue(
  item: ReviewItem,
  queuePath = DEFAULT_QUEUE_PATH
): void {
  const queue = loadReviewQueue(queuePath);
  queue.items.push(item);
  saveQueue(queue, queuePath);
}

export function setItemStatus(
  id: string,
  status: ReviewItemStatus,
  notes?: string,
  queuePath = DEFAULT_QUEUE_PATH
): boolean {
  const queue = loadReviewQueue(queuePath);
  const item = queue.items.find((i) => i.id === id);
  if (!item) return false;
  item.status = status;
  item.statusUpdatedAt = new Date().toISOString();
  if (notes !== undefined) item.reviewNotes = notes;
  saveQueue(queue, queuePath);
  return true;
}

// ─── ReviewItem factory ───────────────────────────────────────

function extractEvidence(
  text: string,
  identifier: string,
  maxChars = 500
): string {
  if (!identifier) return text.slice(0, maxChars).trim();
  const lower = text.toLowerCase();
  const idx = lower.indexOf(identifier.toLowerCase());
  if (idx === -1) return text.slice(0, maxChars).trim();
  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, start + maxChars);
  return text.slice(start, end).trim();
}

export function createReviewItem(params: {
  event: CandidateChangeEvent;
  opportunity: GovernmentRecruitment;
  confirmation: ConfirmationResult;
  preRunSnapshotRef: string;
  officialText: string;
}): ReviewItem {
  const { event, opportunity, confirmation, preRunSnapshotRef, officialText } =
    params;

  const matchedIdentifier = event.matchedIdentifier ?? "";
  const dedupKey = buildDedupKey(
    event.opportunityId,
    event.eventType,
    matchedIdentifier
  );

  // Use first field diff for top-level oldValue / newValue display.
  // The full list of diffs is preserved in fieldDiffs.
  const primaryDiff = confirmation.fieldDiffs[0];

  return {
    id: randomUUID(),
    dedupKey,
    queuedAt: new Date().toISOString(),
    status: "PENDING",

    opportunityId: opportunity.id,
    opportunityTitle: opportunity.title,
    changeType: event.eventType,
    oldValue: primaryDiff?.canonicalValue,
    newValue: primaryDiff?.observedValue,

    matchedIdentifier,
    secondarySource: event.sourceId,
    secondarySourceUrl: event.sourceUrl,
    officialConfirmationSource: confirmation.officialSourceId,
    officialConfirmationUrl: confirmation.officialSourceUrl,
    officialEvidence: extractEvidence(officialText, matchedIdentifier),

    confidence: event.confidence ?? 0,
    disambiguationScore: event.disambiguationScore,
    fieldDiffs: confirmation.fieldDiffs,

    runId: event.runId,
    detectedAt: event.detectedAt,
    eventId: event.id,
    preRunSnapshotRef,

    humanReviewRequired: true,
  };
}

// ─── Field path audit (Phase 4B) ─────────────────────────────
//
// Complete list of field paths produced by confirmer.ts (as of Phase 4B):
//
//   SUPPORTED — handled by applyDiffToRecord:
//     examStages[N].status   — EXAM_POSTPONED → "POSTPONED", EXAM_CANCELLED → "CANCELLED"
//     examStages[N].date     — any event type (except EXAM_CANCELLED) when date extracted
//                              NOTE: confirmer emits ".date"; canonical field is ".dateIso"
//     totalVacancies         — VACANCY_CHANGE only
//     application.closeDate  — APPLICATION_DEADLINE_CHANGE only
//
//   UNSUPPORTED — not currently emitted by confirmer.ts:
//     application.openDate        — never emitted; handler removed in Phase 4B
//     application.extendedCloseDate — used as canonical source in confirmer but never emitted
//     examStages[N].dateIso       — confirmer uses .date (without "Iso" suffix), not this
//     examStages[N].dateDisplay   — never emitted
//     examStages[N].name          — never emitted
//     Any other field path        — explicitly skipped with reason

// ─── Proposed record builder ──────────────────────────────────
//
// Applies FieldDiffs (from confirmer.ts) to a deep copy of the canonical record.
// Clone is created once; each diff is applied in-place on the copy.
// The original opportunity is never mutated.
//
// Returns { proposed, skippedPaths } — callers must check skippedPaths to know
// which diffs were not applied (unknown paths, invalid values, out-of-range stages).

interface DiffResult {
  applied: boolean;
  skipReason?: string;
}

// Stage-field regex patterns — match "examStages[N].status" / "examStages[N].date"
const STAGE_STATUS_RE = /^examStages\[(\d+)\]\.status$/;
const STAGE_DATE_RE   = /^examStages\[(\d+)\]\.date$/;

function applyDiffToRecord(copy: GovernmentRecruitment, diff: FieldDiff): DiffResult {
  // ── examStages[N].status ──────────────────────────────────
  const statusMatch = diff.field.match(STAGE_STATUS_RE);
  if (statusMatch) {
    const idx = parseInt(statusMatch[1], 10);
    if (!copy.examStages[idx]) {
      return { applied: false, skipReason: `examStages[${idx}] does not exist in canonical record (has ${copy.examStages.length} stage(s))` };
    }
    copy.examStages[idx].status = diff.observedValue as ExamStageStatus;
    return { applied: true };
  }

  // ── examStages[N].date → canonical field is dateIso ──────
  // confirmer.ts emits the field as "examStages[N].date" (not ".dateIso").
  // We map it to the canonical ExamStage.dateIso field here.
  const dateMatch = diff.field.match(STAGE_DATE_RE);
  if (dateMatch) {
    const idx = parseInt(dateMatch[1], 10);
    if (!copy.examStages[idx]) {
      return { applied: false, skipReason: `examStages[${idx}] does not exist in canonical record (has ${copy.examStages.length} stage(s))` };
    }
    copy.examStages[idx].dateIso = diff.observedValue;
    return { applied: true };
  }

  // ── totalVacancies ────────────────────────────────────────
  if (diff.field === "totalVacancies") {
    const n = parseInt(diff.observedValue, 10);
    if (isNaN(n)) {
      return { applied: false, skipReason: `observedValue "${diff.observedValue}" is not a valid integer` };
    }
    copy.totalVacancies = n;
    copy.vacanciesDisplay = `${n.toLocaleString()} Vacancies`;
    return { applied: true };
  }

  // ── application.closeDate ─────────────────────────────────
  if (diff.field === "application.closeDate") {
    copy.application.closeDate = diff.observedValue;
    return { applied: true };
  }

  // ── Explicitly unsupported paths ──────────────────────────
  // These are either never emitted by confirmer.ts, or are canonical fields
  // we have not yet wired up. Skipped — not applied, reason recorded.
  const unsupportedPaths: Record<string, string> = {
    "application.openDate":
      "not currently emitted by confirmer.ts",
    "application.extendedCloseDate":
      "confirmer.ts uses this as a canonical source but never emits it as a field path",
    "examStages[0].dateIso":
      "confirmer.ts emits examStages[N].date (without 'Iso' suffix) — check for naming mismatch",
  };
  if (diff.field in unsupportedPaths) {
    return { applied: false, skipReason: unsupportedPaths[diff.field] };
  }

  // ── All other paths: explicitly unsupported ───────────────
  return {
    applied: false,
    skipReason: `"${diff.field}" is not a supported field path — not produced by confirmer.ts or not yet wired in generateProposedRecord`,
  };
}

export interface GenerateProposedRecordResult {
  proposed: GovernmentRecruitment;
  skippedPaths: string[];  // entries are "fieldPath: reason"
}

export function generateProposedRecord(
  item: ReviewItem,
  opportunity: GovernmentRecruitment
): GenerateProposedRecordResult {
  const proposed = structuredClone(opportunity);
  const skippedPaths: string[] = [];

  for (const diff of item.fieldDiffs) {
    const result = applyDiffToRecord(proposed, diff);
    if (!result.applied) {
      skippedPaths.push(`${diff.field}: ${result.skipReason ?? "unsupported"}`);
    }
  }

  return { proposed, skippedPaths };
}

// ─── Approve with proposal generation ────────────────────────
//
// Sets status to APPROVED, builds the proposed record in memory,
// runs the Trust Gate, and stores the result on the queue item.
// NEVER writes to canonical data. productionWrites is not incremented.

export function approveItem(
  id: string,
  opportunities: Opportunity[],
  notes?: string,
  queuePath = DEFAULT_QUEUE_PATH,
  acknowledgedWarnings?: string[]
): ProposedChange | null {
  const queue = loadReviewQueue(queuePath);
  const item = queue.items.find((i) => i.id === id);
  if (!item) return null;

  const opp = opportunities.find(
    (o) => o.id === item.opportunityId && o.type === "government"
  ) as GovernmentRecruitment | undefined;

  let proposal: ProposedChange;

  if (opp && item.fieldDiffs.length > 0) {
    const { proposed: proposedRecord, skippedPaths } = generateProposedRecord(item, opp);
    const tgResult = runTrustGateWithProposal(opportunities, proposedRecord);
    proposal = {
      reviewItemId: item.id,
      opportunityId: item.opportunityId,
      approvedAt: new Date().toISOString(),
      appliedFieldDiffs: item.fieldDiffs.filter((d) =>
        !skippedPaths.some((s) => s.startsWith(d.field + ":"))
      ),
      skippedPaths,
      trustGatePassed: tgResult.passed,
      trustGateErrors: tgResult.errors.map((e) => e.message),
      trustGateWarnings: tgResult.warnings.map((w) => w.message),
      acknowledgedWarnings: acknowledgedWarnings ?? [],
      productionWriteAttempted: false,
    };
  } else {
    // No field diffs (e.g. NEW_NOTICE) or opportunity not in canonical dataset —
    // Trust Gate is not run; proposal records the approval as-is.
    proposal = {
      reviewItemId: item.id,
      opportunityId: item.opportunityId,
      approvedAt: new Date().toISOString(),
      appliedFieldDiffs: [],
      skippedPaths: [],
      trustGatePassed: true,
      trustGateErrors: [],
      trustGateWarnings: [],
      acknowledgedWarnings: [],
      productionWriteAttempted: false,
    };
  }

  item.status = "APPROVED";
  item.statusUpdatedAt = new Date().toISOString();
  item.approvedChange = proposal;
  if (notes !== undefined) item.reviewNotes = notes;
  saveQueue(queue, queuePath);
  return proposal;
}
