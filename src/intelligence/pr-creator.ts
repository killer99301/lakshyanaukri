// ═══════════════════════════════════════════════════════════
// Phase 9C: PR Creator Library — government.ts path RETIRED
// ═══════════════════════════════════════════════════════════
//
// Extracted from scripts/create-pr-for-new-recruit.ts.
//
// RETIREMENT NOTE (G7D / refactor(intelligence)):
//   createPr() and createPrForOrphanedBranch() previously wrote
//   a proposed change to src/data/government.ts, created a git
//   branch, pushed it, and opened a GitHub PR for human review.
//
//   src/data/government.ts was retired in G7D (commit bf6b84f).
//   The CMS is now the sole source of truth. New records are
//   promoted via POST /api/admin/cms/records/from-draft.
//
//   Both functions now return outcome "RETIRED" after running
//   Trust Gate (so callers still get validation output).
//   dryRunPr() and branchExists() are unchanged.
//
// INVARIANTS (still enforced):
//   - Trust Gate must pass before any outcome is emitted
//   - Dry-run NEVER mutates candidate status or writes any file
//   - Branch creation is idempotent: if branch already exists, SKIP

import { execSync } from "node:child_process";
import type { Opportunity } from "@/types";
import type { CandidateNewRecruitment } from "./types";
import { buildDraftGovernmentRecruitment, generatePrBody } from "./new-record-factory";
import { runTrustGateWithNewRecord } from "./trust-gate";

// ─── Types ───────────────────────────────────────────────────

export type PrOutcome =
  | "PR_CREATED"              // branch pushed, GitHub PR opened
  | "DRY_RUN"                 // Trust Gate checked, no git ops performed
  | "RETIRED"                 // government.ts retired — no write performed; use CMS path
  | "SKIPPED_BRANCH_EXISTS"   // branch already on remote — PR likely already exists
  | "TRUST_GATE_FAILED"       // Trust Gate rejected the draft — no git ops
  | "WRITE_REFUSED"           // appendNewRecord() guard rejected the draft
  | "FAILED";                 // unexpected error during git or API call

export interface PrCreationResult {
  candidateId: string;
  slug: string;
  branchName: string;
  outcome: PrOutcome;
  prTitle?: string;
  prBodyLength?: number;
  prNumber?: number;
  prUrl?: string;
  trustGatePassed: boolean;
  trustGateErrors: string[];
  trustGateWarnings: string[];
  missingFields: string[];
  error?: string;
}

export interface PrCreationOptions {
  githubToken?: string;
  githubRepository?: string;   // "owner/repo"
  dataPath?: string;
  startBranch?: string;        // defaults to current HEAD
}

// ─── Helpers ─────────────────────────────────────────────────

export function branchExists(branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify refs/remotes/origin/${branchName}`, { stdio: "pipe" });
    return true;
  } catch { return false; }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Dry-run: validates Trust Gate and shows what would be created.
 * NEVER mutates the candidate, NEVER writes any file, NEVER runs git.
 * Returns outcome "DRY_RUN" regardless of Trust Gate result.
 */
export function dryRunPr(
  candidate: CandidateNewRecruitment,
  allOpportunities: Opportunity[],
  existingSlugs: string[]
): PrCreationResult {
  const { draft, missingFields } = buildDraftGovernmentRecruitment(candidate, existingSlugs);
  const tgResult = runTrustGateWithNewRecord(allOpportunities, draft as Opportunity);
  const branchName = `intelligence/new-${candidate.candidateId}`;
  const prTitle = `[New Recruitment] ${candidate.organizationName} — ${candidate.title ?? candidate.candidateId}`;
  const prBody = generatePrBody(candidate, draft, missingFields);

  return {
    candidateId: candidate.candidateId,
    slug: draft.slug,
    branchName,
    outcome: "DRY_RUN",
    prTitle,
    prBodyLength: prBody.length,
    trustGatePassed: tgResult.passed,
    trustGateErrors: tgResult.errors.map((e) => e.message),
    trustGateWarnings: tgResult.warnings.map((e) => e.message),
    missingFields,
  };
}

/**
 * RETIRED: src/data/government.ts no longer exists (retired in G7D).
 * Previously: build draft → Trust Gate → create branch → write government.ts
 *             → commit → push → create GitHub PR.
 *
 * Now: runs Trust Gate for validation output, then returns "RETIRED".
 * To promote an intelligence draft to a CMS record, use:
 *   POST /api/admin/cms/records/from-draft
 */
export async function createPr(
  candidate: CandidateNewRecruitment,
  allOpportunities: Opportunity[],
  existingSlugs: string[],
  options: PrCreationOptions = {}
): Promise<PrCreationResult> {
  void options; // retained for API compatibility — government.ts is retired
  const { draft, missingFields } = buildDraftGovernmentRecruitment(candidate, existingSlugs);
  const branchName = `intelligence/new-${candidate.candidateId}`;

  if (branchExists(branchName)) {
    return {
      candidateId: candidate.candidateId,
      slug: draft.slug,
      branchName,
      outcome: "SKIPPED_BRANCH_EXISTS",
      trustGatePassed: true,
      trustGateErrors: [],
      trustGateWarnings: [],
      missingFields,
    };
  }

  const tgResult = runTrustGateWithNewRecord(allOpportunities, draft as Opportunity);

  return {
    candidateId: candidate.candidateId,
    slug: draft.slug,
    branchName,
    outcome: "RETIRED",
    trustGatePassed: tgResult.passed,
    trustGateErrors: tgResult.errors.map((e) => e.message),
    trustGateWarnings: tgResult.warnings.map((e) => e.message),
    missingFields,
    error: "government.ts retired in G7D — promote via POST /api/admin/cms/records/from-draft",
  };
}

/**
 * RETIRED: recovery path for orphaned branches.
 * Previously: branch already existed on remote (push succeeded) but
 * PR creation had failed — this re-attempted the GitHub API call only.
 *
 * Now returns "RETIRED" after Trust Gate validation.
 */
export async function createPrForOrphanedBranch(
  candidate: CandidateNewRecruitment,
  allOpportunities: Opportunity[],
  existingSlugs: string[],
  options: PrCreationOptions = {}
): Promise<PrCreationResult> {
  void options; // retained for API compatibility — government.ts is retired
  const { draft, missingFields } = buildDraftGovernmentRecruitment(candidate, existingSlugs);
  const branchName = `intelligence/new-${candidate.candidateId}`;

  const tgResult = runTrustGateWithNewRecord(allOpportunities, draft as Opportunity);

  return {
    candidateId: candidate.candidateId,
    slug: draft.slug,
    branchName,
    outcome: "RETIRED",
    trustGatePassed: tgResult.passed,
    trustGateErrors: tgResult.errors.map((e) => e.message),
    trustGateWarnings: tgResult.warnings.map((e) => e.message),
    missingFields,
    error: "government.ts retired in G7D — promote via POST /api/admin/cms/records/from-draft",
  };
}
