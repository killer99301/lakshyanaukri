// ═══════════════════════════════════════════════════════════
// Phase 9C: Scheduled Intake Pipeline
// ═══════════════════════════════════════════════════════════
//
// Connects multi-source discovery → intake → Trust Gate → PR creation.
// Called by the scheduler for each newly discovered candidate.
//
// ARCHITECTURE RULE: No business logic is duplicated here.
//   - Intake logic lives in runIntake() (intake.ts)
//   - PR creation lives in createPr() / dryRunPr() (pr-creator.ts)
//   - Trust Gate lives in trust-gate.ts
//   This module is orchestration only.
//
// DECISION GATE (evaluateAutoPrEligibility):
//   AUTO_PR only when ALL of these hold:
//     1. clusterStatus === "MERGED"  (never POSSIBLE_MATCH)
//     2. confidence >= 0.6
//     3. official source confirmed (classification.kind === "OFFICIAL")
//     4. notificationNumber present
//     5. title present
//     6. applicationCloseDate present and not "TBA"
//     7. officialSource.found === true
//     8. source is not discovery-lead-only
//     9. every populated critical field has OFFICIAL_PDF or OFFICIAL_SPECIFIC evidence
//    10. Trust Gate passed
//    11. not a duplicate
//    12. PDF text was not OCR_REQUIRED (if PDF was attempted)
//   Otherwise → PENDING_REVIEW for human resolution.
//
// OBSERVABILITY: Every call produces one JSONL record in
//   intelligence-runs/scheduled-intake-audit.jsonl

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Opportunity } from "@/types";
import type { CandidateNewRecruitment } from "./types";
import type { IntakeResult, FetchFn } from "./intake";
import type { FetchPdfFn } from "./pdf-extractor";
import { runIntake } from "./intake";
import { dryRunPr, createPr, type PrCreationResult, type PrCreationOptions } from "./pr-creator";

// ─── Evaluation-candidate merge ───────────────────────────────
//
// Discovery candidates are "thin" — they contain only what the
// discovery adapter could scrape (title, URL, maybe a date).
// Structured fields like notificationNumber and applicationCloseDate
// are extracted by intake from the official source / PDF.
//
// evaluateAutoPrEligibility MUST check these intake-enriched values,
// not the original discovery values, or conditions 4 and 6 will always
// fail for HTML-scraped candidates regardless of what intake found.
//
// Rules for the merge:
//   1. Only fields backed by OFFICIAL_PDF or OFFICIAL_SPECIFIC evidence
//      (from intakeResult.fieldSources) are trusted.
//   2. OFFICIAL_GENERIC, THIRD_PARTY, and UNKNOWN evidence is never
//      merged — it could be from a generic homepage or aggregator.
//   3. The original discovery candidate is never mutated.
//   4. Intake-enriched authoritative values win over discovery values
//      (OFFICIAL_PDF is the highest authority; discovery is lowest).

const MERGEABLE_FIELDS = [
  "title",
  "notificationNumber",
  "applicationCloseDate",
  "applicationOpenDate",
  "notifPdfUrl",
  "totalVacancies",
  "postDate",
] as const;

type MergeableField = typeof MERGEABLE_FIELDS[number];

/**
 * Build an evaluation candidate by overlaying authoritative intake-extracted
 * fields onto the original discovery candidate.
 *
 * Exported so tests can verify the merge rules directly.
 */
export function buildEvaluationCandidate(
  discoveryCandidate: CandidateNewRecruitment,
  intakeResult: IntakeResult
): CandidateNewRecruitment {
  const intake = intakeResult.candidate;
  if (!intake) return { ...discoveryCandidate };

  const merged: CandidateNewRecruitment = { ...discoveryCandidate };

  for (const field of MERGEABLE_FIELDS) {
    const evidenceKind = intakeResult.fieldSources[field];
    const intakeValue = intake[field as keyof CandidateNewRecruitment];
    // Skip if intake didn't extract this field
    if (intakeValue === undefined || intakeValue === null) continue;
    // Skip if evidence is not authoritative (THIRD_PARTY, OFFICIAL_GENERIC, UNKNOWN, absent)
    if (!evidenceKind || !AUTHORITATIVE.has(evidenceKind)) continue;
    // Authoritative intake value overrides discovery value
    (merged as unknown as Record<string, unknown>)[field] = intakeValue;
  }

  return merged;
}

// ─── Types ───────────────────────────────────────────────────

export type ScheduledDecision = "AUTO_PR" | "PENDING_REVIEW";

export interface ScheduledIntakeResult {
  candidateId: string;
  auditedAt: string;
  decision: ScheduledDecision;
  decisionReason: string;
  officialSourceUrl?: string;
  evidenceSummary: string[];
  trustGatePassed: boolean;
  trustGateErrors: string[];
  trustGateWarnings: string[];
  prResult?: PrCreationResult;
  intakeError?: string;
}

export interface ScheduledIntakeOptions {
  isDryRun: boolean;
  allOpportunities: Opportunity[];
  existingSlugs: string[];
  /** Injected in tests to avoid real network calls */
  fetchFn?: FetchFn;
  fetchPdfFn?: FetchPdfFn;
  /** Required for live (non-dry-run) PR creation */
  prOptions?: PrCreationOptions;
}

// ─── Authoritative evidence kinds ────────────────────────────

const AUTHORITATIVE: ReadonlySet<string> = new Set(["OFFICIAL_PDF", "OFFICIAL_SPECIFIC"]);

const CRITICAL_FIELDS = ["title", "notificationNumber", "applicationCloseDate"] as const;

// ─── Decision gate ────────────────────────────────────────────

/**
 * Returns { eligible: true } when all AUTO_PR conditions are met,
 * or { eligible: false, reason } identifying the first failing condition.
 *
 * The caller must pass `candidate` as it exists BEFORE intake
 * (cluster-level fields) and `intakeResult` from the intake run.
 */
export function evaluateAutoPrEligibility(
  candidate: CandidateNewRecruitment,
  intakeResult: IntakeResult
): { eligible: boolean; reason: string } {
  const no = (reason: string) => ({ eligible: false, reason });

  // 1. Cluster must be MERGED — POSSIBLE_MATCH requires human disambiguation
  if (candidate.clusterStatus === "POSSIBLE_MATCH") {
    return no("clusterStatus is POSSIBLE_MATCH — human verification required");
  }

  // 2. Confidence threshold
  if (candidate.confidence < 0.6) {
    return no(`confidence ${candidate.confidence.toFixed(2)} below 0.6 threshold`);
  }

  // 3. Source must be official
  if (intakeResult.classification.kind !== "OFFICIAL") {
    return no(`source is not OFFICIAL (kind: ${intakeResult.classification.kind})`);
  }

  // 4. Notification number present
  if (!candidate.notificationNumber) {
    return no("notificationNumber missing");
  }

  // 5. Title present
  if (!candidate.title) {
    return no("title missing");
  }

  // 6. Application close date present and not TBA
  if (!candidate.applicationCloseDate || candidate.applicationCloseDate === "TBA") {
    return no("applicationCloseDate missing or TBA");
  }

  // 7. Official source found during intake
  if (!intakeResult.officialSource.found) {
    return no(`official source not found: ${intakeResult.officialSource.note ?? "no official URL resolved"}`);
  }

  // 8. Source not discovery-lead-only (must be a fully usable official URL)
  if (intakeResult.classification.isDiscoveryLeadOnly) {
    return no("primarySourceUrl is discovery-lead-only — not a directly parseable official source");
  }

  // 9. Every populated critical field has authoritative evidence
  for (const field of CRITICAL_FIELDS) {
    const kind = intakeResult.fieldSources[field];
    if (kind === undefined) continue;  // field not populated — no evidence requirement
    if (!AUTHORITATIVE.has(kind)) {
      return no(`field "${field}" has non-authoritative evidence (${kind}) — requires OFFICIAL_PDF or OFFICIAL_SPECIFIC`);
    }
  }

  // 10. Trust Gate passed
  if (!intakeResult.trustGatePassed) {
    const msgs = intakeResult.trustGateErrors.map((e) => e.message).join("; ");
    return no(`Trust Gate failed: ${msgs}`);
  }

  // 11. Not a duplicate of canonical records
  if (intakeResult.isDuplicate) {
    return no(`duplicate of canonical record: ${intakeResult.duplicateReason ?? intakeResult.duplicateMatchId ?? "unknown"}`);
  }

  // 12. PDF text must not require OCR (unextractable PDF means unverifiable fields)
  const pdfQuality = intakeResult.pdfExtraction?.pdfTextQuality;
  if (pdfQuality === "OCR_REQUIRED") {
    return no("PDF text quality is OCR_REQUIRED — fields cannot be verified from text");
  }

  return { eligible: true, reason: "all AUTO_PR conditions met" };
}

// ─── Audit writer ─────────────────────────────────────────────

const AUDIT_DIR = join(process.cwd(), "intelligence-runs");
const AUDIT_PATH = join(AUDIT_DIR, "scheduled-intake-audit.jsonl");

function writeAuditRecord(record: ScheduledIntakeResult): void {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(AUDIT_PATH, JSON.stringify(record) + "\n", "utf-8");
  } catch {
    // Non-fatal — audit failure must not kill the pipeline
  }
}

// ─── Main ─────────────────────────────────────────────────────

/**
 * Runs the full scheduled intake pipeline for one candidate:
 *   1. Resolve the best available source URL (official PDF preferred)
 *   2. Run intake → evidence extraction → Trust Gate
 *   3. Evaluate AUTO_PR eligibility
 *   4. If eligible: create PR (or dry-run simulate)
 *   5. Write audit record
 *
 * Never throws — all errors are captured in the returned result.
 */
export async function runScheduledIntake(
  candidate: CandidateNewRecruitment,
  options: ScheduledIntakeOptions
): Promise<ScheduledIntakeResult> {
  const auditedAt = new Date().toISOString();
  const { isDryRun, allOpportunities, existingSlugs, fetchFn, fetchPdfFn } = options;

  // Prefer the official PDF URL; fall back to the discovery source URL
  const sourceUrl = candidate.notifPdfUrl ?? candidate.discoverySourceUrl;

  let intakeResult: IntakeResult;
  try {
    intakeResult = await runIntake(sourceUrl, {
      fetchFn,
      fetchPdfFn,
      canonicalRecords: allOpportunities,
      existingCandidates: [],
      existingSlugs,
    });
  } catch (err) {
    const record: ScheduledIntakeResult = {
      candidateId: candidate.candidateId,
      auditedAt,
      decision: "PENDING_REVIEW",
      decisionReason: `intake threw unexpectedly: ${String(err)}`,
      evidenceSummary: [],
      trustGatePassed: false,
      trustGateErrors: [],
      trustGateWarnings: [],
      intakeError: String(err),
    };
    writeAuditRecord(record);
    return record;
  }

  if (intakeResult.error) {
    const record: ScheduledIntakeResult = {
      candidateId: candidate.candidateId,
      auditedAt,
      decision: "PENDING_REVIEW",
      decisionReason: `intake error: ${intakeResult.error}`,
      officialSourceUrl: sourceUrl,
      evidenceSummary: intakeResult.analysisNotes,
      trustGatePassed: false,
      trustGateErrors: intakeResult.trustGateErrors.map((e) => e.message),
      trustGateWarnings: intakeResult.trustGateWarnings.map((e) => e.message),
      intakeError: intakeResult.error,
    };
    writeAuditRecord(record);
    return record;
  }

  // ── PDF ambiguity safety gate ─────────────────────────────────
  // If multiple equally-ranked official PDFs were found and the system
  // could not select one, the authoritative notification document is
  // ambiguous. Human review is required to pick the correct PDF before
  // the notification number and dates can be verified.
  // This check runs regardless of other conditions — ambiguous PDFs
  // block AUTO_PR even when all other eligibility conditions would pass.
  const ambiguousPdfs =
    intakeResult.extraction.ambiguousPdfCandidates ??
    intakeResult.officialPageExtraction?.ambiguousPdfCandidates;
  if (ambiguousPdfs && ambiguousPdfs.length > 0) {
    const listed = ambiguousPdfs.slice(0, 3).join(", ");
    const record: ScheduledIntakeResult = {
      candidateId: candidate.candidateId,
      auditedAt,
      decision: "PENDING_REVIEW",
      decisionReason: `PDF selection ambiguous — ${ambiguousPdfs.length} equally ranked official PDFs; human review required to identify the correct notification document. Candidates: ${listed}`,
      officialSourceUrl: intakeResult.officialSource.url ?? sourceUrl,
      evidenceSummary: intakeResult.analysisNotes,
      trustGatePassed: false,
      trustGateErrors: [`PDF ambiguous: ${listed}`],
      trustGateWarnings: [],
    };
    writeAuditRecord(record);
    return record;
  }

  // ── Data handoff: build evaluation candidate ──────────────────
  // The discovery candidate has only fields the discovery adapter scraped
  // (title, URL, maybe a post date). Structured fields such as
  // notificationNumber and applicationCloseDate can only come from intake.
  // Merge authoritative intake-extracted fields (OFFICIAL_PDF or
  // OFFICIAL_SPECIFIC evidence) into the evaluation candidate before
  // passing it to evaluateAutoPrEligibility.
  // The original candidate object is NEVER mutated here.
  const evaluationCandidate = buildEvaluationCandidate(candidate, intakeResult);

  const { eligible, reason } = evaluateAutoPrEligibility(evaluationCandidate, intakeResult);

  if (!eligible) {
    const record: ScheduledIntakeResult = {
      candidateId: candidate.candidateId,
      auditedAt,
      decision: "PENDING_REVIEW",
      decisionReason: reason,
      officialSourceUrl: intakeResult.officialSource.url ?? sourceUrl,
      evidenceSummary: intakeResult.analysisNotes,
      trustGatePassed: intakeResult.trustGatePassed,
      trustGateErrors: intakeResult.trustGateErrors.map((e) => e.message),
      trustGateWarnings: intakeResult.trustGateWarnings.map((e) => e.message),
    };
    writeAuditRecord(record);
    return record;
  }

  // Eligible for AUTO_PR — create or simulate PR using the enriched candidate
  // so the PR body contains the verified authoritative field values.
  let prResult: PrCreationResult;
  if (isDryRun) {
    prResult = dryRunPr(evaluationCandidate, allOpportunities, existingSlugs);
  } else {
    if (!options.prOptions) {
      const record: ScheduledIntakeResult = {
        candidateId: candidate.candidateId,
        auditedAt,
        decision: "PENDING_REVIEW",
        decisionReason: "prOptions not provided for live run — cannot create PR",
        officialSourceUrl: intakeResult.officialSource.url ?? sourceUrl,
        evidenceSummary: intakeResult.analysisNotes,
        trustGatePassed: intakeResult.trustGatePassed,
        trustGateErrors: intakeResult.trustGateErrors.map((e) => e.message),
        trustGateWarnings: intakeResult.trustGateWarnings.map((e) => e.message),
      };
      writeAuditRecord(record);
      return record;
    }
    prResult = await createPr(evaluationCandidate, allOpportunities, existingSlugs, options.prOptions);
  }

  const record: ScheduledIntakeResult = {
    candidateId: candidate.candidateId,
    auditedAt,
    decision: "AUTO_PR",
    decisionReason: reason,
    officialSourceUrl: intakeResult.officialSource.url ?? sourceUrl,
    evidenceSummary: intakeResult.analysisNotes,
    trustGatePassed: intakeResult.trustGatePassed,
    trustGateErrors: intakeResult.trustGateErrors.map((e) => e.message),
    trustGateWarnings: intakeResult.trustGateWarnings.map((e) => e.message),
    prResult,
  };
  writeAuditRecord(record);
  return record;
}
