// Phase 9C: PR creator tests (PRC-01–PRC-08)
//
// Covers dryRunPr() — ensures dry-run NEVER mutates candidate status.
// This is the regression test for the "dry-run artifact bug" where
// create-pr-for-new-recruit.ts was setting PR_CREATED in dry-run mode.
//
// No network I/O. No git operations. productionWrites remains 0.

import assert from "node:assert";
import type { CandidateNewRecruitment } from "@/intelligence/types";
import type { Opportunity } from "@/types";
import { dryRunPr } from "@/intelligence/pr-creator";
import { normalizeNotificationNumber, buildCandidateId, buildTitleSimilarityKey, normalizeSourceUrl } from "@/intelligence/dedup";

// ─── Helpers ─────────────────────────────────────────────────

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

function makeCandidate(overrides: Partial<CandidateNewRecruitment> = {}): CandidateNewRecruitment {
  const notif = normalizeNotificationNumber("CSE 2026");
  return {
    candidateId: buildCandidateId("upsc", notif),
    discoverySourceId: "freejobalert-rss",
    discoverySourceUrl: "https://www.freejobalert.com/test",
    discoverySourceTier: 5,
    discoveredAt: "2026-09-08T10:00:00.000Z",
    organizationId: "upsc",
    organizationName: "Union Public Service Commission",
    title: "UPSC Civil Services Examination 2026",
    notificationNumber: "CSE 2026",
    applicationOpenDate: "2026-10-01",
    applicationCloseDate: "2026-10-31",
    normalizedNotifNumber: notif,
    sourceUrlFingerprint: normalizeSourceUrl("https://upsc.gov.in/notifications/cse-2026.pdf"),
    titleSimilarityKey: buildTitleSimilarityKey("UPSC Civil Services Examination 2026"),
    rawExcerpt: "UPSC Civil Services 2026 recruitment notice",
    confidence: 0.85,
    status: "PENDING_REVIEW",
    ...overrides,
  };
}

const NO_OPPORTUNITIES: Opportunity[] = [];
const NO_SLUGS: string[] = [];

// ─── PRC-01: DRY_RUN outcome ─────────────────────────────────

console.log("\n=== dryRunPr outcome ===");

const candidate1 = makeCandidate();
const result1 = dryRunPr(candidate1, NO_OPPORTUNITIES, NO_SLUGS);
check("PRC-01: outcome is DRY_RUN", result1.outcome === "DRY_RUN");

// ─── PRC-02: candidate status not mutated ─────────────────────
//
//   REGRESSION TEST: the old create-pr-for-new-recruit.ts set
//   candidate.status = "PR_CREATED" inside the --dry-run branch,
//   which left candidates with PR_CREATED but no prNumber/prUrl.
//   dryRunPr() must NEVER touch candidate fields.

console.log("\n=== dryRunPr must not mutate candidate (regression: dry-run artifact bug) ===");

const candidate2 = makeCandidate({ status: "PENDING_REVIEW" });
dryRunPr(candidate2, NO_OPPORTUNITIES, NO_SLUGS);
check("PRC-02: candidate.status unchanged after dryRunPr", candidate2.status === "PENDING_REVIEW");
check("PRC-03: candidate.prNumber still undefined after dryRunPr", candidate2.prNumber === undefined);
check("PRC-04: candidate.prUrl still undefined after dryRunPr", candidate2.prUrl === undefined);

// ─── PRC-05: result structure ─────────────────────────────────

console.log("\n=== dryRunPr result structure ===");

const result2 = dryRunPr(makeCandidate(), NO_OPPORTUNITIES, NO_SLUGS);
check("PRC-05: result.slug is a non-empty string", typeof result2.slug === "string" && result2.slug.length > 0);
check("PRC-06: result.branchName contains candidateId", result2.branchName.includes(makeCandidate().candidateId));
check("PRC-07: result.prTitle contains org name", (result2.prTitle ?? "").includes("Union Public Service Commission"));
check("PRC-08: result.prBodyLength > 0", (result2.prBodyLength ?? 0) > 0);
check("PRC-09: result.trustGatePassed is boolean", typeof result2.trustGatePassed === "boolean");
check("PRC-10: result.trustGateErrors is array", Array.isArray(result2.trustGateErrors));
check("PRC-11: result.missingFields is array", Array.isArray(result2.missingFields));

console.log("\nDone.");
