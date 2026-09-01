// ═══════════════════════════════════════════════════════════
// Phase 6B: Canonical Data Writer
// ═══════════════════════════════════════════════════════════
//
// This is the ONLY path that can write to src/data/government.ts.
// No other module, script, or scheduler can bypass this gate.
//
// Entry point: commitApprovedChange()
//
// Guards (all must pass):
//   1. item.status === "APPROVED"
//   2. item.approvedChange exists (ProposedChange generated)
//   3. item.approvedChange.trustGatePassed === true
//   4. Canonical opportunity exists and is type "government"
//   5. This review item has not already been committed
//   6. Post-mutation Trust Gate passes on the updated dataset
//
// Only after all 6 guards pass does the writer modify government.ts.
// ═══════════════════════════════════════════════════════════

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Opportunity, GovernmentRecruitment, UpdateType } from "@/types";
import { GOVERNMENT_RECRUITMENTS } from "@/data/government";
import { generateProposedRecord } from "./review-queue";
import { runTrustGateWithProposal, runTrustGateWithNewRecord } from "./trust-gate";
import { checkWarningPolicy } from "./warning-policy";
import type { ReviewItem } from "./types";

// ─── Paths ───────────────────────────────────────────────────

export const DEFAULT_DATA_PATH = join(
  process.cwd(),
  "src",
  "data",
  "government.ts"
);

// ─── Result type ─────────────────────────────────────────────

export interface CommitResult {
  committed: boolean;
  refuseReason?: string;
  opportunityId: string;
  changeType: string;
  fieldsWritten: string[];
  skippedFields: string[];
  consistencyWarnings: string[];   // all Trust Gate warnings on the written dataset
  acknowledgedWarnings: string[];  // subset the reviewer explicitly acknowledged
}

// ─── Change type → UpdateRecord.type mapping ─────────────────

function deriveUpdateType(changeType: string): UpdateType {
  if (changeType === "EXAM_POSTPONED")               return "POSTPONEMENT";
  if (changeType === "EXAM_DATE_CHANGE")              return "RESCHEDULE";
  if (changeType === "VACANCY_CHANGE")                return "VACANCY_REVISION";
  if (changeType === "APPLICATION_DEADLINE_CHANGE")   return "DEADLINE_EXTENSION";
  if (changeType === "EXAM_CANCELLED")                return "CANCELLATION";
  if (changeType === "CORRIGENDUM")                   return "CORRIGENDUM";
  return "GENERAL_NOTICE";
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Commit an approved review item to canonical data (src/data/government.ts).
 *
 * INVARIANTS:
 *   - Only callable after approveItem() has run (ProposedChange must exist)
 *   - Never called from the scheduler or discovery pipeline
 *   - Never auto-approves — human approval is always the precondition
 *   - governmentRecords defaults to the live GOVERNMENT_RECRUITMENTS;
 *     inject a smaller array in tests to avoid touching the real file
 */
export function commitApprovedChange(
  item: ReviewItem,
  opportunities: Opportunity[],
  options: {
    dataPath?: string;
    governmentRecords?: GovernmentRecruitment[];
  } = {}
): CommitResult {
  const dataPath = options.dataPath ?? DEFAULT_DATA_PATH;
  const govRecords = options.governmentRecords ?? GOVERNMENT_RECRUITMENTS;

  const refuse = (reason: string): CommitResult => ({
    committed: false,
    refuseReason: reason,
    opportunityId: item.opportunityId,
    changeType: item.changeType,
    fieldsWritten: [],
    skippedFields: [],
    consistencyWarnings: [],
    acknowledgedWarnings: [],
  });

  // Guard 1: status must be APPROVED
  if (item.status !== "APPROVED") {
    return refuse(`status is ${item.status}, not APPROVED`);
  }

  // Guard 2: ProposedChange must exist
  const proposal = item.approvedChange;
  if (!proposal) {
    return refuse("no ProposedChange on item — run approve first");
  }

  // Guard 3: Trust Gate must have passed at approve time
  if (!proposal.trustGatePassed) {
    return refuse(
      `Trust Gate did not pass at approval time: ${proposal.trustGateErrors.join("; ")}`
    );
  }

  // Guard 4: canonical opportunity must exist and be a government record
  const opp = opportunities.find(
    (o) => o.id === item.opportunityId && o.type === "government"
  );
  if (!opp) {
    return refuse(
      `canonical opportunity "${item.opportunityId}" not found or is not a government record`
    );
  }
  const govOpp = opp as GovernmentRecruitment;

  // Guard 5: not already committed (UpdateRecord with our rie- id)
  const commitId = `rie-${item.id.slice(0, 8)}`;
  const alreadyCommitted = (govOpp.updates ?? []).some((u) => u.id === commitId);
  if (alreadyCommitted) {
    return refuse(`this change (${commitId}) has already been committed to canonical data`);
  }

  // Apply field diffs to produce the proposed record
  const { proposed, skippedPaths } = generateProposedRecord(item, govOpp);

  // Add an UpdateRecord so future runs can detect this commit via Guard 5
  const today = new Date().toISOString().slice(0, 10);
  const primaryDiff = item.fieldDiffs[0];
  proposed.updates = [
    ...(proposed.updates ?? []),
    {
      id: commitId,
      date: today,
      type: deriveUpdateType(item.changeType),
      title: `${item.changeType} — committed by intelligence engine (item ${item.id.slice(0, 8)})`,
      description: item.changeType,
      sourceUrl: item.officialConfirmationUrl,
      field: primaryDiff?.field,
      previousValue: primaryDiff?.canonicalValue,
      newValue: primaryDiff?.observedValue,
    },
  ];

  // Guard 6: post-mutation Trust Gate must also pass
  const postTg = runTrustGateWithProposal(opportunities, proposed);
  if (!postTg.passed) {
    return refuse(
      `post-mutation Trust Gate failed: ${postTg.errors.map((e) => e.message).join("; ")}`
    );
  }

  // Guard 7: warning policy — BLOCKING always refuses; ACKNOWLEDGE refuses without exact ack
  const postTgWarnings = postTg.warnings.map((w) => w.message);
  const policyCheck = checkWarningPolicy(
    postTgWarnings,
    proposal.acknowledgedWarnings ?? []
  );
  if (policyCheck.blocked) {
    return refuse(policyCheck.refuseReason!);
  }

  // All guards passed — write to canonical data
  const updatedRecords = govRecords.map((r) =>
    r.id === item.opportunityId ? proposed : r
  );
  writeGovernmentData(updatedRecords, dataPath);

  return {
    committed: true,
    opportunityId: item.opportunityId,
    changeType: item.changeType,
    fieldsWritten: proposal.appliedFieldDiffs.map((d) => d.field),
    skippedFields: skippedPaths,
    consistencyWarnings: postTgWarnings,
    acknowledgedWarnings: proposal.acknowledgedWarnings ?? [],
  };
}

// ─── Phase 7C: Append a new canonical record ─────────────────
//
// Used by scripts/create-pr-for-new-recruit.ts to write the proposed
// government.ts content to a PR branch. Never called from the scheduler.
//
// Guards (all must pass):
//   1. draft.type === "government"
//   2. draft.id is non-empty
//   3. draft.slug is non-empty
//   4. draft.id does not already exist in canonical records
//   5. draft.slug does not already exist in canonical records
//   6. Trust Gate passes with draft appended to full dataset
//
// After all guards pass: appends draft to governmentRecords and writes.

/**
 * Append a new GovernmentRecruitment draft to canonical data.
 *
 * INVARIANTS:
 *   - Never called from the scheduler or discovery pipeline
 *   - Only callable after a CandidateNewRecruitment has been built into a draft
 *   - The caller (create-pr-for-new-recruit.ts) is responsible for git operations
 *   - governmentRecords defaults to the live GOVERNMENT_RECRUITMENTS;
 *     inject a smaller array in tests to avoid touching the real file
 */
export function appendNewRecord(
  draft: GovernmentRecruitment,
  options: {
    dataPath?: string;
    governmentRecords?: GovernmentRecruitment[];
    opportunities?: Opportunity[];
  } = {}
): CommitResult {
  const dataPath = options.dataPath ?? DEFAULT_DATA_PATH;
  const govRecords = options.governmentRecords ?? GOVERNMENT_RECRUITMENTS;
  const allOpportunities = options.opportunities ?? (govRecords as Opportunity[]);

  const refuse = (reason: string): CommitResult => ({
    committed: false,
    refuseReason: reason,
    opportunityId: draft.id,
    changeType: "NEW_NOTICE",
    fieldsWritten: [],
    skippedFields: [],
    consistencyWarnings: [],
    acknowledgedWarnings: [],
  });

  // Guard 1: must be a government record
  if (draft.type !== "government") {
    return refuse(`draft.type is "${draft.type}", expected "government"`);
  }

  // Guard 2: id must be set and non-empty
  if (!draft.id || !draft.id.trim()) {
    return refuse("draft.id is empty or blank");
  }

  // Guard 3: slug must be set and non-empty
  if (!draft.slug || !draft.slug.trim()) {
    return refuse("draft.slug is empty or blank");
  }

  // Guard 4: id must not already exist
  if (govRecords.some((r) => r.id === draft.id)) {
    return refuse(`a canonical record with id "${draft.id}" already exists`);
  }

  // Guard 5: slug must not already exist
  if (govRecords.some((r) => r.slug === draft.slug)) {
    return refuse(`a canonical record with slug "${draft.slug}" already exists`);
  }

  // Guard 6: Trust Gate must pass with draft appended to full dataset
  const tgResult = runTrustGateWithNewRecord(allOpportunities, draft as Opportunity);
  if (!tgResult.passed) {
    return refuse(
      `Trust Gate failed: ${tgResult.errors.map((e) => e.message).join("; ")}`
    );
  }

  // All guards passed — append and write
  const updatedRecords = [...govRecords, draft];
  writeGovernmentData(updatedRecords, dataPath);

  const coreFields = ["id", "slug", "type", "title", "organizationId", "notificationNumber", "provenance"];

  return {
    committed: true,
    opportunityId: draft.id,
    changeType: "NEW_NOTICE",
    fieldsWritten: coreFields,
    skippedFields: [],
    consistencyWarnings: tgResult.warnings.map((w) => w.message),
    acknowledgedWarnings: [],
  };
}

// ─── Serialization ───────────────────────────────────────────
//
// Normalizes hand-written TypeScript to JSON-serializable form.
// Optional fields set to `undefined` are omitted (correct for `?: T`).
// String concatenation is joined into a single string (semantically identical).
// The result is valid TypeScript that the compiler accepts unchanged.

const FILE_HEADER =
  "// ═══════════════════════════════════════════════════════════\n" +
  "// Career Campus — Verified Government Recruitment Records\n" +
  "// ═══════════════════════════════════════════════════════════\n" +
  "// Every record here has been audited against official sources.\n" +
  "// See provenance.notes for verification details.\n" +
  "//\n" +
  "// Non-negotiable rules:\n" +
  "//   - VERIFIED requires official source URL + official source type\n" +
  '//   - Unknown data = "Not specified" / "Not verified" / "Not declared"\n' +
  "//   - Each CEN is a separate record\n" +
  "//   - Vacancy breakdown must match totalVacancies (or be omitted)\n" +
  "//\n" +
  "// Note: this file was last updated by the intelligence engine writer.\n" +
  "// Hand-written formatting normalized to JSON serialization.\n" +
  "// ═══════════════════════════════════════════════════════════\n" +
  "\n" +
  'import type { GovernmentRecruitment } from "@/types";\n' +
  "\n" +
  "export const GOVERNMENT_RECRUITMENTS: GovernmentRecruitment[] = ";

function writeGovernmentData(records: GovernmentRecruitment[], path: string): void {
  const body = JSON.stringify(records, null, 2);
  writeFileSync(path, FILE_HEADER + body + ";\n", "utf-8");
}
