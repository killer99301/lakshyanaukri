#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// Phase 7E: PR Creation for Newly Discovered Recruitments
// ═══════════════════════════════════════════════════════════
//
// Reads intelligence-runs/discovery-candidates.json and, for
// each PENDING_REVIEW candidate:
//   1. Builds a GovernmentRecruitment draft
//   2. Runs Trust Gate (must pass — no PR created on failure)
//   3. Checks branch intelligence/new-<candidateId> doesn't exist
//   4. Creates a git branch with the proposed government.ts change
//   5. Pushes the branch
//   6. Creates a GitHub PR via the GitHub API
//   7. Updates candidate status to PR_CREATED
//
// Required environment:
//   GITHUB_TOKEN     — provided automatically by GitHub Actions
//   GITHUB_REPOSITORY — "owner/repo", provided by GitHub Actions
//
// Safety rules enforced:
//   - Trust Gate must pass before any branch is created
//   - No force push
//   - No commits to main
//   - Dry-run mode available via --dry-run flag (no push, no PR)
//
// Usage:
//   npx tsx scripts/create-pr-for-new-recruit.ts
//   npx tsx scripts/create-pr-for-new-recruit.ts --dry-run
// ═══════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { getAllOpportunities } from "@/lib/repository";
import { buildDraftGovernmentRecruitment, generatePrBody } from "@/intelligence/new-record-factory";
import { appendNewRecord } from "@/intelligence/writer";
import { runTrustGateWithNewRecord } from "@/intelligence/trust-gate";
import type { CandidateNewRecruitment } from "@/intelligence/types";
import type { Opportunity } from "@/types";

// ─── Config ──────────────────────────────────────────────────

const CANDIDATES_PATH = join(process.cwd(), "intelligence-runs", "discovery-candidates.json");
const DATA_PATH = join(process.cwd(), "src", "data", "government.ts");
const DRY_RUN = process.argv.includes("--dry-run");

// ─── Helpers ─────────────────────────────────────────────────

function log(msg: string) { console.log(`[PR-SCRIPT] ${msg}`); }
function err(msg: string) { console.error(`[PR-SCRIPT][ERROR] ${msg}`); }

function exec(cmd: string, opts: { silent?: boolean } = {}): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: opts.silent ? "pipe" : "inherit" }).trim();
  } catch (e) {
    throw new Error(`Command failed: ${cmd}\n${String(e)}`);
  }
}

function branchExists(branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify refs/remotes/origin/${branchName}`, { stdio: "pipe" });
    return true;
  } catch { return false; }
}

// ─── GitHub API ───────────────────────────────────────────────

async function createGitHubPR(params: {
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

  const data = await res.json() as { number: number; html_url: string };
  return data;
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  log(`Starting PR creation script (${DRY_RUN ? "DRY RUN" : "LIVE"})`);

  // Validate environment
  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPOSITORY;

  if (!DRY_RUN) {
    if (!token) {
      err("GITHUB_TOKEN is not set — cannot create PRs");
      process.exit(1);
    }
    if (!repoFull || !repoFull.includes("/")) {
      err("GITHUB_REPOSITORY is not set or invalid (expected 'owner/repo')");
      process.exit(1);
    }
  }

  const [owner, repo] = (repoFull ?? "owner/repo").split("/");

  // Load candidates
  if (!existsSync(CANDIDATES_PATH)) {
    log("No discovery-candidates.json found — nothing to process");
    return;
  }

  const raw = JSON.parse(readFileSync(CANDIDATES_PATH, "utf-8")) as {
    generatedAt: string;
    candidates: CandidateNewRecruitment[];
  };

  const pending = raw.candidates.filter((c) => c.status === "PENDING_REVIEW");
  log(`Found ${raw.candidates.length} candidates total, ${pending.length} PENDING_REVIEW`);

  if (pending.length === 0) {
    log("No pending candidates — exiting");
    return;
  }

  // Load canonical dataset
  const allOpportunities: Opportunity[] = getAllOpportunities();
  const existingSlugs = allOpportunities.map((o) => o.slug);

  // Determine current branch (should be main in GitHub Actions)
  const startBranch = exec("git rev-parse --abbrev-ref HEAD", { silent: true });
  log(`Current branch: ${startBranch}`);

  let prCreated = 0;
  let skipped = 0;

  for (const candidate of pending) {
    log(`\nProcessing candidate: ${candidate.candidateId} (${candidate.organizationId})`);
    log(`  Title: ${candidate.title ?? "(no title)"}`);

    const branchName = `intelligence/new-${candidate.candidateId}`;

    // Skip if PR branch already exists
    if (branchExists(branchName)) {
      log(`  Branch ${branchName} already exists — skipping (PR likely already created)`);
      candidate.status = "PR_CREATED";
      skipped++;
      continue;
    }

    // Build draft record
    const { draft, missingFields } = buildDraftGovernmentRecruitment(candidate, existingSlugs);
    log(`  Draft ID: ${draft.id}, slug: ${draft.slug}`);
    if (missingFields.length > 0) {
      log(`  Missing fields: ${missingFields.join(", ")}`);
    }

    // Trust Gate — must pass before any git operation
    const tgResult = runTrustGateWithNewRecord(allOpportunities, draft as Opportunity);
    if (!tgResult.passed) {
      err(`  Trust Gate FAILED — no PR will be created`);
      for (const e of tgResult.errors) {
        err(`    [${e.field}] ${e.message}`);
      }
      candidate.status = "REJECTED";
      candidate.rejectionReason = `Trust Gate failed: ${tgResult.errors.map((e) => e.message).join("; ")}`;
      skipped++;
      continue;
    }

    if (tgResult.warnings.length > 0) {
      log(`  Trust Gate PASSED with ${tgResult.warnings.length} warning(s) — PR will be created`);
    } else {
      log(`  Trust Gate PASSED`);
    }

    // Generate PR content
    const prTitle = `[New Recruitment] ${candidate.organizationName} — ${candidate.title ?? candidate.candidateId}`;
    const prBody = generatePrBody(candidate, draft, missingFields);

    if (DRY_RUN) {
      log(`  [DRY RUN] Would create branch: ${branchName}`);
      log(`  [DRY RUN] PR title: ${prTitle}`);
      log(`  [DRY RUN] PR body length: ${prBody.length} chars`);
      candidate.status = "PR_CREATED";
      prCreated++;
      continue;
    }

    // Create branch and write proposed government.ts
    try {
      exec(`git checkout -b ${branchName}`);

      // Write the proposed change to government.ts
      const result = appendNewRecord(draft, { dataPath: DATA_PATH });
      if (!result.committed) {
        err(`  appendNewRecord refused: ${result.refuseReason}`);
        exec(`git checkout ${startBranch}`);
        candidate.status = "REJECTED";
        candidate.rejectionReason = result.refuseReason;
        skipped++;
        continue;
      }

      // Commit
      exec(`git config user.email "intelligence@lakshyanaukri.in"`);
      exec(`git config user.name "LakshyaNaukri Intelligence Engine"`);
      exec(`git add src/data/government.ts`);
      exec(`git commit -m "feat: add ${candidate.organizationName} canonical record (${candidate.candidateId})"`);

      // Push
      exec(`git push origin ${branchName}`);

      // Back to original branch before creating PR
      exec(`git checkout ${startBranch}`);

      // Create PR via GitHub API
      const pr = await createGitHubPR({
        owner,
        repo,
        title: prTitle,
        body: prBody,
        head: branchName,
        base: startBranch,
        token: token!,
      });

      log(`  PR #${pr.number} created: ${pr.html_url}`);
      candidate.status = "PR_CREATED";
      candidate.prNumber = pr.number;
      candidate.prUrl = pr.html_url;
      existingSlugs.push(draft.slug);  // prevent slug collision in subsequent candidates
      prCreated++;

    } catch (e) {
      err(`  Failed to create PR for ${candidate.candidateId}: ${String(e)}`);
      // Try to get back to the original branch
      try { exec(`git checkout ${startBranch}`, { silent: true }); } catch {}
      candidate.status = "REJECTED";
      candidate.rejectionReason = `PR creation failed: ${String(e)}`;
      skipped++;
    }
  }

  // Save updated candidates (status reflects PR_CREATED / REJECTED)
  writeFileSync(
    CANDIDATES_PATH,
    JSON.stringify({ generatedAt: raw.generatedAt, updatedAt: new Date().toISOString(), candidates: raw.candidates }, null, 2),
    "utf-8"
  );

  log(`\nDone. PRs created: ${prCreated}, skipped/rejected: ${skipped}`);
}

main().catch((e) => {
  console.error("[PR-SCRIPT][FATAL]", e);
  process.exit(1);
});
