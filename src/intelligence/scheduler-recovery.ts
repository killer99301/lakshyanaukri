// ═══════════════════════════════════════════════════════════
// Phase 9C: Scheduler Recovery Helpers
// ═══════════════════════════════════════════════════════════
//
// Gap 1 — FAILED PR RETRY:
//   retryFailedPrCandidate() handles PR_FAILED and PR_BRANCH_ORPHANED
//   candidates. Routes to API-only recovery when the branch already exists
//   on remote (orphaned), otherwise retries from scratch. Bounded by
//   MAX_PR_RETRIES. Returns the input candidate unchanged when exhausted.
//
// Gap 2 — TOKEN / CONFIGURATION SAFETY:
//   processNewCandidateForPr() detects when canAutoPr is false but intake
//   says AUTO_PR, and marks the candidate AUTO_PR_SKIPPED_CONFIGURATION
//   instead of consuming it via dry-run. Config-restored candidates are
//   re-processed by the same function when config becomes available.
//
// Gap 3 — OBSERVABILITY:
//   buildTickObservabilityReport() surfaces failed/orphaned/skipped
//   candidates and missing config at the start of each scheduler tick.
//
// INVARIANTS:
//   - No input candidate is ever mutated — all functions return new objects.
//   - Trust Gate runs on every real PR creation attempt.
//   - No duplicate branches — createPrForOrphanedBranch skips git push.

import {
  runScheduledIntake,
  type ScheduledIntakeOptions,
  type ScheduledIntakeResult,
} from "./scheduled-intake";
import {
  createPr,
  createPrForOrphanedBranch,
  branchExists as branchExistsFn,
  type PrCreationOptions,
  type PrCreationResult,
} from "./pr-creator";
import type { CandidateNewRecruitment } from "./types";
import type { Opportunity } from "@/types";
import type { FetchFn } from "./intake";
import type { FetchPdfFn } from "./pdf-extractor";

export const MAX_PR_RETRIES = 3;

export interface RecoveryIntakeOptions {
  allOpportunities: Opportunity[];
  existingSlugs: string[];
  fetchFn?: FetchFn;
  fetchPdfFn?: FetchPdfFn;
}

// Injectable hooks — for testing only. Never use in production callers.
export interface _RecoveryHooks {
  runScheduledIntake?: (
    candidate: CandidateNewRecruitment,
    opts: ScheduledIntakeOptions
  ) => Promise<ScheduledIntakeResult>;
  createPr?: (
    candidate: CandidateNewRecruitment,
    allOpportunities: Opportunity[],
    existingSlugs: string[],
    options: PrCreationOptions
  ) => Promise<PrCreationResult>;
  createPrForOrphanedBranch?: (
    candidate: CandidateNewRecruitment,
    allOpportunities: Opportunity[],
    existingSlugs: string[],
    options: PrCreationOptions
  ) => Promise<PrCreationResult>;
  branchExists?: (name: string) => boolean;
}

/**
 * Process a newly-discovered or AUTO_PR_SKIPPED_CONFIGURATION candidate.
 *
 * canAutoPr=true:
 *   Runs intake and creates PR if eligible. Returns updated candidate
 *   with status PR_CREATED, PR_FAILED, PR_BRANCH_ORPHANED, or unchanged.
 *
 * canAutoPr=false:
 *   Runs intake in dry-run. If intake says AUTO_PR, marks the candidate
 *   AUTO_PR_SKIPPED_CONFIGURATION (preserving it for config restoration).
 *   If intake says PENDING_REVIEW, returns the candidate unchanged.
 *
 * Never mutates the input candidate.
 */
export async function processNewCandidateForPr(
  candidate: CandidateNewRecruitment,
  canAutoPr: boolean,
  opts: RecoveryIntakeOptions,
  prOptions?: PrCreationOptions,
  _hooks?: _RecoveryHooks
): Promise<CandidateNewRecruitment> {
  const si = _hooks?.runScheduledIntake ?? runScheduledIntake;
  const bExists = _hooks?.branchExists ?? branchExistsFn;

  const intakeResult = await si(candidate, {
    isDryRun: !canAutoPr,
    allOpportunities: opts.allOpportunities,
    existingSlugs: opts.existingSlugs,
    fetchFn: opts.fetchFn,
    fetchPdfFn: opts.fetchPdfFn,
    prOptions: canAutoPr ? prOptions : undefined,
  });

  if (intakeResult.decision !== "AUTO_PR") {
    return candidate;
  }

  const now = new Date().toISOString();
  const prOutcome = intakeResult.prResult?.outcome;

  if (prOutcome === "PR_CREATED" && intakeResult.prResult?.prNumber) {
    return {
      ...candidate,
      status: "PR_CREATED",
      prNumber: intakeResult.prResult.prNumber,
      prUrl: intakeResult.prResult.prUrl,
    };
  }

  if (prOutcome === "DRY_RUN") {
    return {
      ...candidate,
      status: "AUTO_PR_SKIPPED_CONFIGURATION",
      prLastAttemptAt: now,
      prLastError: "GITHUB_TOKEN or GITHUB_REPOSITORY not available",
    };
  }

  if (prOutcome === "FAILED") {
    const branchName = `intelligence/new-${candidate.candidateId}`;
    const isOrphaned = bExists(branchName);
    return {
      ...candidate,
      status: isOrphaned ? "PR_BRANCH_ORPHANED" : "PR_FAILED",
      prRetryCount: 1,
      prLastAttemptAt: now,
      prLastError: intakeResult.prResult?.error ?? "PR creation failed",
    };
  }

  // TRUST_GATE_FAILED, WRITE_REFUSED, SKIPPED_BRANCH_EXISTS — leave unchanged
  return candidate;
}

/**
 * Retry a PR_FAILED or PR_BRANCH_ORPHANED candidate.
 *
 * Routes to createPrForOrphanedBranch when the branch already exists on
 * remote (avoids duplicate push). Otherwise retries via createPr (full path).
 *
 * Returns the input candidate unchanged when retryCount >= MAX_PR_RETRIES.
 * Never mutates the input candidate.
 */
export async function retryFailedPrCandidate(
  candidate: CandidateNewRecruitment,
  prOptions: PrCreationOptions,
  opts: RecoveryIntakeOptions,
  _hooks?: _RecoveryHooks
): Promise<CandidateNewRecruitment> {
  const bExists = _hooks?.branchExists ?? branchExistsFn;
  const cp = _hooks?.createPr ?? createPr;
  const cpOrphaned = _hooks?.createPrForOrphanedBranch ?? createPrForOrphanedBranch;

  const retryCount = candidate.prRetryCount ?? 0;
  if (retryCount >= MAX_PR_RETRIES) {
    return candidate;
  }

  const branchName = `intelligence/new-${candidate.candidateId}`;
  const now = new Date().toISOString();

  let prResult: PrCreationResult;
  if (bExists(branchName)) {
    prResult = await cpOrphaned(
      candidate,
      opts.allOpportunities,
      opts.existingSlugs,
      prOptions
    );
  } else {
    prResult = await cp(
      candidate,
      opts.allOpportunities,
      opts.existingSlugs,
      prOptions
    );
  }

  if (prResult.outcome === "PR_CREATED" && prResult.prNumber) {
    return {
      ...candidate,
      status: "PR_CREATED",
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
      prRetryCount: retryCount + 1,
      prLastAttemptAt: now,
    };
  }

  // Re-check: did push succeed during this attempt?
  const nowOrphaned = bExists(branchName);
  return {
    ...candidate,
    status: nowOrphaned ? "PR_BRANCH_ORPHANED" : "PR_FAILED",
    prRetryCount: retryCount + 1,
    prLastAttemptAt: now,
    prLastError: prResult.error ?? `PR retry failed: ${prResult.outcome}`,
  };
}

/**
 * Build observability log lines for the start of each scheduler tick.
 * Surfaces PR_FAILED, PR_BRANCH_ORPHANED, AUTO_PR_SKIPPED_CONFIGURATION
 * candidates and missing GitHub config. Never throws.
 */
export function buildTickObservabilityReport(
  allCandidates: CandidateNewRecruitment[],
  canAutoPr: boolean
): string[] {
  const lines: string[] = [];
  const failed = allCandidates.filter((c) => c.status === "PR_FAILED");
  const orphaned = allCandidates.filter((c) => c.status === "PR_BRANCH_ORPHANED");
  const configSkipped = allCandidates.filter(
    (c) => c.status === "AUTO_PR_SKIPPED_CONFIGURATION"
  );

  lines.push("[PHASE-9C][TICK-START] ─────────────────────────────────────");

  if (!canAutoPr) {
    lines.push(
      "[PHASE-9C][TICK-START] ⚠  GITHUB_TOKEN / GITHUB_REPOSITORY not configured — " +
        "AUTO_PR-eligible candidates will be preserved as AUTO_PR_SKIPPED_CONFIGURATION"
    );
  }

  if (failed.length > 0) {
    lines.push(
      `[PHASE-9C][TICK-START] PR_FAILED (${failed.length}): ` +
        failed
          .map((c) => `${c.candidateId}(retries=${c.prRetryCount ?? 0})`)
          .join(", ")
    );
  }

  if (orphaned.length > 0) {
    lines.push(
      `[PHASE-9C][TICK-START] PR_BRANCH_ORPHANED (${orphaned.length}): ` +
        orphaned
          .map((c) => `${c.candidateId}(retries=${c.prRetryCount ?? 0})`)
          .join(", ")
    );
  }

  if (configSkipped.length > 0) {
    lines.push(
      `[PHASE-9C][TICK-START] AUTO_PR_SKIPPED_CONFIGURATION (${configSkipped.length}): ` +
        configSkipped.map((c) => c.candidateId).join(", ")
    );
  }

  const total = failed.length + orphaned.length + configSkipped.length;
  if (total === 0 && canAutoPr) {
    lines.push("[PHASE-9C][TICK-START] No candidates awaiting retry or config restore.");
  }

  lines.push("[PHASE-9C][TICK-START] ─────────────────────────────────────");

  return lines;
}
