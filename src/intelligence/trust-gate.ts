// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine Trust Gate Integration
// ═══════════════════════════════════════════════════════════
// Thin wrapper over the existing src/lib/validation.ts.
//
// The intelligence engine does NOT define a second validation
// system. It imports and reuses the canonical Trust Gate.
//
// Phase 1: Trust Gate is defined here but not invoked
//           (no writes are proposed in Phase 1).
// Phase 2+: Before any proposed patch reaches the review queue,
//           this module builds the proposed record in memory
//           and runs validateAllRecords() against the full
//           dataset including the proposed change.
//           If the Trust Gate fails, the CandidateChangeEvent
//           is routed to human review — never silently discarded.
//
// INVARIANT: The Trust Gate runner has no write access to
//            any canonical data file. It is a pure validator.
// ═══════════════════════════════════════════════════════════

import type { Opportunity } from "@/types";
import {
  validateAllRecords,
  type ValidationError,
} from "@/lib/validation";

// ─── Types ───────────────────────────────────────────────────

export interface TrustGateResult {
  passed: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Run the Trust Gate against the full dataset, with one proposed
 * record replacing its canonical counterpart.
 *
 * Phase 2+ usage:
 *   Before a CandidateChangeEvent is approved or queued,
 *   call this with the full current dataset and the proposed
 *   updated version of the affected record.
 *
 * The Trust Gate reads the proposed state — it does NOT write.
 *
 * @param currentDataset  - All canonical opportunities (from getAllOpportunities())
 * @param proposedRecord  - The modified record to validate in place of its original
 */
export function runTrustGateWithProposal(
  currentDataset: Opportunity[],
  proposedRecord: Opportunity
): TrustGateResult {
  // Build a proposed dataset: replace the record being changed
  const proposed = currentDataset.map((opp) =>
    opp.id === proposedRecord.id ? proposedRecord : opp
  );

  const errors = validateAllRecords(proposed);

  return {
    passed: !errors.some((e) => e.severity === "error"),
    errors: errors.filter((e) => e.severity === "error"),
    warnings: errors.filter((e) => e.severity === "warning"),
  };
}

/**
 * Run the Trust Gate against the current dataset without any proposal.
 * Used at run start to confirm the canonical data is valid before
 * any monitoring work begins.
 */
export function runTrustGateBaseline(
  currentDataset: Opportunity[]
): TrustGateResult {
  const errors = validateAllRecords(currentDataset);

  return {
    passed: !errors.some((e) => e.severity === "error"),
    errors: errors.filter((e) => e.severity === "error"),
    warnings: errors.filter((e) => e.severity === "warning"),
  };
}

/**
 * Run the Trust Gate with a proposed NEW record appended to the dataset.
 *
 * Phase 7 usage: Before create-pr-for-new-recruit.ts creates a GitHub PR,
 * this validates the full dataset including the candidate draft record.
 * If the Trust Gate fails, no PR is created.
 *
 * @param currentDataset - All current canonical opportunities (read-only)
 * @param newRecord      - The new GovernmentRecruitment draft to validate
 */
export function runTrustGateWithNewRecord(
  currentDataset: Opportunity[],
  newRecord: Opportunity
): TrustGateResult {
  // Append the new record — do not replace any existing entry
  const proposed = [...currentDataset, newRecord];
  const errors = validateAllRecords(proposed);

  return {
    passed: !errors.some((e) => e.severity === "error"),
    errors: errors.filter((e) => e.severity === "error"),
    warnings: errors.filter((e) => e.severity === "warning"),
  };
}
