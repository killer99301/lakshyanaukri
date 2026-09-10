// ═══════════════════════════════════════════════════════════
// Phase 9C: PR Creator Library
// ═══════════════════════════════════════════════════════════
//
// Extracted from scripts/create-pr-for-new-recruit.ts.
// The CLI script is now a thin wrapper around these functions.
// The scheduled intake pipeline (scheduled-intake.ts) also uses
// them — ensuring the manual and automated paths stay identical.
//
// INVARIANTS:
//   - Trust Gate must pass before any git operation runs
//   - No PR is created unless appendNewRecord() succeeds
//   - Dry-run NEVER mutates candidate status or writes any file
//   - Branch creation is idempotent: if branch already exists, SKIP
//   - GITHUB_TOKEN must come from the caller — never hardcoded

import { execSync } from "node:child_process";
import { join } from "node:path";
import type { Opportunity } from "@/types";
import type { CandidateNewRecruitment } from "./types";
import { buildDraftGovernmentRecruitment, generatePrBody } from "./new-record-factory";
import { appendNewRecord } from "./writer";
import { runTrustGateWithNewRecord } from "./trust-gate";

// ─── Types ───────────────────────────────────────────────────

export type PrOutcome =
  | "PR_CREATED"              // branch pushed, GitHub PR opened
  | "DRY_RUN"                 // Trust Gate checked, no git ops performed
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
  githubToken: string;
  githubRepository: string;    // "owner/repo"
  dataPath?: string;
  startBranch?: string;        // defaults to current HEAD
}

// ─── Helpers ─────────────────────────────────────────────────

const DEFAULT_DATA_PATH = join(process.cwd(), "src", "data", "government.ts");

function exec(cmd: string, silent = false): string {
  try {
    const out = execSync(cmd, { encoding: "utf-8", stdio: silent ? "pipe" : "inherit" });
    return (out ?? "").trim();
  } catch (e) {
    throw new Error(`Command failed: ${cmd}\n${String(e)}`);
  }
}

export function branchExists(branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify refs/remotes/origin/${branchName}`, { stdio: "pipe" });
    return true;
  } catch { return false; }
}

async function callGitHubApi(params: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  token: string;
}): Promise<{ number: number; html_url: string }> {
  const url = `https://api.github.com/repos/${params.owner}/${params.repo}/pulls`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.token}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
      draft: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ number: number; html_url: string }>;
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
 * Live: builds draft → Trust Gate → creates branch → writes government.ts
 *       → commits → pushes → creates GitHub PR.
 *
 * Returns a PrCreationResult whose outcome accurately reflects what happened.
 * On any failure after branch creation, the function attempts to restore the
 * starting branch before returning.
 */
export async function createPr(
  candidate: CandidateNewRecruitment,
  allOpportunities: Opportunity[],
  existingSlugs: string[],
  options: PrCreationOptions
): Promise<PrCreationResult> {
  const { draft, missingFields } = buildDraftGovernmentRecruitment(candidate, existingSlugs);
  const branchName = `intelligence/new-${candidate.candidateId}`;
  const dataPath = options.dataPath ?? DEFAULT_DATA_PATH;

  // Idempotency guard — if the branch already exists, the PR was likely already created
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

  // Trust Gate — must pass before any git operation
  const tgResult = runTrustGateWithNewRecord(allOpportunities, draft as Opportunity);
  if (!tgResult.passed) {
    return {
      candidateId: candidate.candidateId,
      slug: draft.slug,
      branchName,
      outcome: "TRUST_GATE_FAILED",
      trustGatePassed: false,
      trustGateErrors: tgResult.errors.map((e) => e.message),
      trustGateWarnings: tgResult.warnings.map((e) => e.message),
      missingFields,
    };
  }

  const prTitle = `[New Recruitment] ${candidate.organizationName} — ${candidate.title ?? candidate.candidateId}`;
  const prBody = generatePrBody(candidate, draft, missingFields);
  const [owner, repo] = options.githubRepository.split("/");
  const startBranch = options.startBranch ?? exec("git rev-parse --abbrev-ref HEAD", true);

  try {
    exec(`git checkout -b ${branchName}`);

    const writeResult = appendNewRecord(draft, { dataPath });
    if (!writeResult.committed) {
      exec(`git checkout ${startBranch}`, true);
      return {
        candidateId: candidate.candidateId,
        slug: draft.slug,
        branchName,
        outcome: "WRITE_REFUSED",
        trustGatePassed: true,
        trustGateErrors: [],
        trustGateWarnings: tgResult.warnings.map((e) => e.message),
        missingFields,
        error: writeResult.refuseReason,
      };
    }

    exec(`git config user.email "intelligence@lakshyanaukri.in"`, true);
    exec(`git config user.name "LakshyaNaukri Intelligence Engine"`, true);
    exec(`git add src/data/government.ts`);
    exec(
      `git commit -m "feat: add ${candidate.organizationName} canonical record (${candidate.candidateId})"`,
      true
    );
    exec(`git push origin ${branchName}`);
    exec(`git checkout ${startBranch}`, true);

    const pr = await callGitHubApi({
      owner,
      repo,
      title: prTitle,
      body: prBody,
      head: branchName,
      base: startBranch,
      token: options.githubToken,
    });

    return {
      candidateId: candidate.candidateId,
      slug: draft.slug,
      branchName,
      outcome: "PR_CREATED",
      prTitle,
      prBodyLength: prBody.length,
      prNumber: pr.number,
      prUrl: pr.html_url,
      trustGatePassed: true,
      trustGateErrors: [],
      trustGateWarnings: tgResult.warnings.map((e) => e.message),
      missingFields,
    };
  } catch (e) {
    try { exec(`git checkout ${startBranch}`, true); } catch { /* best-effort */ }
    return {
      candidateId: candidate.candidateId,
      slug: draft.slug,
      branchName,
      outcome: "FAILED",
      trustGatePassed: true,
      trustGateErrors: [],
      trustGateWarnings: tgResult.warnings.map((e) => e.message),
      missingFields,
      error: String(e),
    };
  }
}

/**
 * Recovery path for orphaned branches: branch already exists on remote
 * (push succeeded) but GitHub PR creation previously failed.
 *
 * Skips all git operations. Calls GitHub API only.
 * Trust Gate runs regardless — safety invariant must hold on every path.
 */
export async function createPrForOrphanedBranch(
  candidate: CandidateNewRecruitment,
  allOpportunities: Opportunity[],
  existingSlugs: string[],
  options: PrCreationOptions
): Promise<PrCreationResult> {
  const { draft, missingFields } = buildDraftGovernmentRecruitment(candidate, existingSlugs);
  const branchName = `intelligence/new-${candidate.candidateId}`;

  if (!branchExists(branchName)) {
    return {
      candidateId: candidate.candidateId,
      slug: draft.slug,
      branchName,
      outcome: "FAILED",
      trustGatePassed: false,
      trustGateErrors: [`Branch ${branchName} not found on remote — cannot recover orphaned PR`],
      trustGateWarnings: [],
      missingFields,
      error: `Branch not present on remote refs`,
    };
  }

  const tgResult = runTrustGateWithNewRecord(allOpportunities, draft as Opportunity);
  if (!tgResult.passed) {
    return {
      candidateId: candidate.candidateId,
      slug: draft.slug,
      branchName,
      outcome: "TRUST_GATE_FAILED",
      trustGatePassed: false,
      trustGateErrors: tgResult.errors.map((e) => e.message),
      trustGateWarnings: tgResult.warnings.map((e) => e.message),
      missingFields,
    };
  }

  const prTitle = `[New Recruitment] ${candidate.organizationName} — ${candidate.title ?? candidate.candidateId}`;
  const prBody = generatePrBody(candidate, draft, missingFields);
  const [owner, repo] = options.githubRepository.split("/");
  const startBranch = options.startBranch ?? exec("git rev-parse --abbrev-ref HEAD", true);

  try {
    const pr = await callGitHubApi({
      owner,
      repo,
      title: prTitle,
      body: prBody,
      head: branchName,
      base: startBranch,
      token: options.githubToken,
    });
    return {
      candidateId: candidate.candidateId,
      slug: draft.slug,
      branchName,
      outcome: "PR_CREATED",
      prTitle,
      prBodyLength: prBody.length,
      prNumber: pr.number,
      prUrl: pr.html_url,
      trustGatePassed: true,
      trustGateErrors: [],
      trustGateWarnings: tgResult.warnings.map((e) => e.message),
      missingFields,
    };
  } catch (e) {
    return {
      candidateId: candidate.candidateId,
      slug: draft.slug,
      branchName,
      outcome: "FAILED",
      trustGatePassed: true,
      trustGateErrors: [],
      trustGateWarnings: tgResult.warnings.map((e) => e.message),
      missingFields,
      error: String(e),
    };
  }
}
