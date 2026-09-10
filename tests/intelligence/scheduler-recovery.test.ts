// Phase 9C: Scheduler Recovery — regression tests (SR-01–SR-12)
//
// Tests processNewCandidateForPr, retryFailedPrCandidate,
// and buildTickObservabilityReport from scheduler-recovery.ts.
//
// All git operations and network calls are injected via _RecoveryHooks.
// productionWrites: 0. Scheduler NOT enabled. No canonical data writes.

import assert from "node:assert";
import type { CandidateNewRecruitment } from "@/intelligence/types";
import type { ScheduledIntakeResult } from "@/intelligence/scheduled-intake";
import type { PrCreationResult } from "@/intelligence/pr-creator";
import {
  processNewCandidateForPr,
  retryFailedPrCandidate,
  buildTickObservabilityReport,
  MAX_PR_RETRIES,
} from "@/intelligence/scheduler-recovery";
import {
  normalizeNotificationNumber,
  buildCandidateId,
  buildTitleSimilarityKey,
  normalizeSourceUrl,
} from "@/intelligence/dedup";

// ─── Helpers ─────────────────────────────────────────────────

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

function makeCandidate(
  overrides: Partial<CandidateNewRecruitment> = {}
): CandidateNewRecruitment {
  const notif = normalizeNotificationNumber("TEST/2026");
  return {
    candidateId: buildCandidateId("test-org", notif),
    discoverySourceId: "test-source",
    discoverySourceUrl: "https://test.gov.in/notifications",
    discoverySourceTier: 2,
    discoveredAt: "2026-09-08T10:00:00.000Z",
    organizationId: "test-org",
    organizationName: "Test Organisation",
    title: "Test Notification 2026",
    notificationNumber: "TEST/2026",
    applicationOpenDate: "2026-10-01",
    applicationCloseDate: "2026-10-31",
    normalizedNotifNumber: notif,
    sourceUrlFingerprint: normalizeSourceUrl("https://test.gov.in/notifications"),
    titleSimilarityKey: buildTitleSimilarityKey("Test Notification 2026"),
    rawExcerpt: "Test Notification 2026",
    confidence: 0.85,
    clusterStatus: "MERGED",
    status: "PENDING_REVIEW",
    ...overrides,
  };
}

function makePrOptions() {
  return {
    githubToken: "ghp_fake_token",
    githubRepository: "owner/repo",
  };
}

function makeIntakeAutopr(prResult?: Partial<PrCreationResult>): ScheduledIntakeResult {
  return {
    candidateId: "test",
    auditedAt: "2026-09-08T10:00:00.000Z",
    decision: "AUTO_PR",
    decisionReason: "all AUTO_PR conditions met",
    trustGatePassed: true,
    trustGateErrors: [],
    trustGateWarnings: [],
    evidenceSummary: [],
    prResult: {
      candidateId: "test",
      slug: "test-notification-2026",
      branchName: "intelligence/new-test",
      outcome: "DRY_RUN",
      trustGatePassed: true,
      trustGateErrors: [],
      trustGateWarnings: [],
      missingFields: [],
      ...prResult,
    },
  };
}

function makeIntakePendingReview(): ScheduledIntakeResult {
  return {
    candidateId: "test",
    auditedAt: "2026-09-08T10:00:00.000Z",
    decision: "PENDING_REVIEW",
    decisionReason: "notificationNumber missing",
    trustGatePassed: false,
    trustGateErrors: [],
    trustGateWarnings: [],
    evidenceSummary: [],
  };
}

const EMPTY_INTAKE_OPTS = {
  allOpportunities: [] as never[],
  existingSlugs: [] as string[],
};

// ─── Main (all async tests wrapped to avoid top-level await) ─────────────────

async function main() {

  // ── SR-01: canAutoPr=false + AUTO_PR decision → AUTO_PR_SKIPPED_CONFIGURATION ──

  console.log("\n=== SR-01: canAutoPr=false + AUTO_PR → AUTO_PR_SKIPPED_CONFIGURATION ===");

  {
    const candidate = makeCandidate();
    const updated = await processNewCandidateForPr(
      candidate,
      false,
      EMPTY_INTAKE_OPTS,
      undefined,
      {
        runScheduledIntake: async () => makeIntakeAutopr({ outcome: "DRY_RUN" }),
        branchExists: () => false,
      }
    );
    check("SR-01: status → AUTO_PR_SKIPPED_CONFIGURATION", updated.status === "AUTO_PR_SKIPPED_CONFIGURATION");
    check("SR-01b: original candidate NOT mutated", candidate.status === "PENDING_REVIEW");
    check("SR-01c: prLastError records config absence", Boolean(updated.prLastError?.includes("GITHUB_TOKEN")));
    check("SR-01d: prLastAttemptAt set", Boolean(updated.prLastAttemptAt));
  }

  // ── SR-02: canAutoPr=false + PENDING_REVIEW decision → no change ─────────────

  console.log("\n=== SR-02: canAutoPr=false + PENDING_REVIEW → no change ===");

  {
    const candidate = makeCandidate();
    const updated = await processNewCandidateForPr(
      candidate,
      false,
      EMPTY_INTAKE_OPTS,
      undefined,
      {
        runScheduledIntake: async () => makeIntakePendingReview(),
        branchExists: () => false,
      }
    );
    check("SR-02: status unchanged (PENDING_REVIEW)", updated.status === "PENDING_REVIEW");
    check("SR-02b: returned same candidateId", updated.candidateId === candidate.candidateId);
  }

  // ── SR-03: PR_FAILED with retryCount=0 → retried, retryCount becomes 1 ───────

  console.log("\n=== SR-03: PR_FAILED retry increments count ===");

  {
    let createPrCalled = false;
    const candidate = makeCandidate({ status: "PR_FAILED", prRetryCount: 0 });
    const updated = await retryFailedPrCandidate(
      candidate,
      makePrOptions(),
      EMPTY_INTAKE_OPTS,
      {
        branchExists: () => false,
        createPr: async () => {
          createPrCalled = true;
          return {
            candidateId: candidate.candidateId,
            slug: "test",
            branchName: `intelligence/new-${candidate.candidateId}`,
            outcome: "FAILED",
            trustGatePassed: true,
            trustGateErrors: [],
            trustGateWarnings: [],
            missingFields: [],
            error: "GitHub API timeout",
          };
        },
        createPrForOrphanedBranch: async () => { throw new Error("should not be called"); },
      }
    );
    check("SR-03: createPr was called", createPrCalled);
    check("SR-03b: status is PR_FAILED (still failed)", updated.status === "PR_FAILED");
    check("SR-03c: prRetryCount incremented to 1", updated.prRetryCount === 1);
    check("SR-03d: prLastError recorded", Boolean(updated.prLastError));
    check("SR-03e: original candidate NOT mutated", candidate.prRetryCount === 0);
  }

  // ── SR-04: PR_FAILED with retryCount=MAX_PR_RETRIES → no retry, unchanged ────

  console.log("\n=== SR-04: exhausted retries → no retry ===");

  {
    let createPrCalled = false;
    const candidate = makeCandidate({ status: "PR_FAILED", prRetryCount: MAX_PR_RETRIES });
    const updated = await retryFailedPrCandidate(
      candidate,
      makePrOptions(),
      EMPTY_INTAKE_OPTS,
      {
        branchExists: () => false,
        createPr: async () => { createPrCalled = true; throw new Error("should not reach"); },
        createPrForOrphanedBranch: async () => { throw new Error("should not reach"); },
      }
    );
    check("SR-04: createPr NOT called when retries exhausted", !createPrCalled);
    check("SR-04b: returned same candidate object", updated === candidate);
    check("SR-04c: retryCount unchanged at MAX", updated.prRetryCount === MAX_PR_RETRIES);
  }

  // ── SR-05: PR_CREATED candidate is never in retry loop ────────────────────────

  console.log("\n=== SR-05: PR_CREATED → excluded from retry set ===");

  {
    const candidates: CandidateNewRecruitment[] = [
      makeCandidate({ status: "PR_CREATED", prRetryCount: 0, candidateId: "cand-created" }),
      makeCandidate({
        status: "PR_FAILED",
        prRetryCount: 0,
        candidateId: buildCandidateId("test-org", normalizeNotificationNumber("FAIL/2026")),
        normalizedNotifNumber: normalizeNotificationNumber("FAIL/2026"),
      }),
    ];
    const toRetry = candidates.filter(
      (c) =>
        (c.status === "PR_FAILED" || c.status === "PR_BRANCH_ORPHANED") &&
        (c.prRetryCount ?? 0) < MAX_PR_RETRIES
    );
    check("SR-05: PR_CREATED not in retry set", toRetry.every((c) => c.status !== "PR_CREATED"));
    check("SR-05b: retry set contains exactly the PR_FAILED candidate", toRetry.length === 1);
  }

  // ── SR-06: PR_BRANCH_ORPHANED + branchExists=true → createPrForOrphanedBranch ─

  console.log("\n=== SR-06: orphaned branch → API-only recovery path ===");

  {
    let orphanedCalled = false;
    let createPrCalled = false;
    const candidate = makeCandidate({ status: "PR_BRANCH_ORPHANED", prRetryCount: 0 });
    const updated = await retryFailedPrCandidate(
      candidate,
      makePrOptions(),
      EMPTY_INTAKE_OPTS,
      {
        branchExists: () => true,
        createPrForOrphanedBranch: async () => {
          orphanedCalled = true;
          return {
            candidateId: candidate.candidateId,
            slug: "test",
            branchName: `intelligence/new-${candidate.candidateId}`,
            outcome: "PR_CREATED",
            prNumber: 42,
            prUrl: "https://github.com/owner/repo/pull/42",
            trustGatePassed: true,
            trustGateErrors: [],
            trustGateWarnings: [],
            missingFields: [],
          };
        },
        createPr: async () => {
          createPrCalled = true;
          throw new Error("should not be called for orphaned branch");
        },
      }
    );
    check("SR-06: createPrForOrphanedBranch called (not createPr)", orphanedCalled && !createPrCalled);
    check("SR-06b: status → PR_CREATED", updated.status === "PR_CREATED");
    check("SR-06c: prNumber set to 42", updated.prNumber === 42);
    check("SR-06d: retryCount incremented to 1", updated.prRetryCount === 1);
  }

  // ── SR-07: PR_FAILED + branchExists=false → createPr (full path) ─────────────

  console.log("\n=== SR-07: no orphaned branch → full retry via createPr ===");

  {
    let createPrCalled = false;
    let orphanedCalled = false;
    const candidate = makeCandidate({ status: "PR_FAILED", prRetryCount: 1 });
    const updated = await retryFailedPrCandidate(
      candidate,
      makePrOptions(),
      EMPTY_INTAKE_OPTS,
      {
        branchExists: () => false,
        createPr: async () => {
          createPrCalled = true;
          return {
            candidateId: candidate.candidateId,
            slug: "test",
            branchName: `intelligence/new-${candidate.candidateId}`,
            outcome: "PR_CREATED",
            prNumber: 99,
            prUrl: "https://github.com/owner/repo/pull/99",
            trustGatePassed: true,
            trustGateErrors: [],
            trustGateWarnings: [],
            missingFields: [],
          };
        },
        createPrForOrphanedBranch: async () => {
          orphanedCalled = true;
          throw new Error("should not be called when branch absent");
        },
      }
    );
    check("SR-07: createPr called (not createPrForOrphanedBranch)", createPrCalled && !orphanedCalled);
    check("SR-07b: status → PR_CREATED", updated.status === "PR_CREATED");
    check("SR-07c: prNumber set to 99", updated.prNumber === 99);
  }

  // ── SR-08: AUTO_PR_SKIPPED_CONFIGURATION + canAutoPr=true → reprocessable ────

  console.log("\n=== SR-08: config restored → AUTO_PR_SKIPPED_CONFIGURATION reprocessed ===");

  {
    const candidate = makeCandidate({
      status: "AUTO_PR_SKIPPED_CONFIGURATION",
      prLastError: "GITHUB_TOKEN or GITHUB_REPOSITORY not available",
    });
    const updated = await processNewCandidateForPr(
      candidate,
      true,
      EMPTY_INTAKE_OPTS,
      makePrOptions(),
      {
        runScheduledIntake: async () =>
          makeIntakeAutopr({ outcome: "PR_CREATED", prNumber: 77, prUrl: "https://github.com/owner/repo/pull/77" }),
        branchExists: () => false,
      }
    );
    check("SR-08: status → PR_CREATED when config restored", updated.status === "PR_CREATED");
    check("SR-08b: prNumber set from recovered run", updated.prNumber === 77);
  }

  // ── SR-09: idempotency — PR_CREATED never re-enters retry ────────────────────

  console.log("\n=== SR-09: PR_CREATED never re-enters retry ===");

  {
    const created = makeCandidate({ status: "PR_CREATED", prNumber: 55, prRetryCount: 0, candidateId: "cand-a" });
    const failed = makeCandidate({
      status: "PR_FAILED",
      prRetryCount: 0,
      candidateId: buildCandidateId("test-org", normalizeNotificationNumber("IDEM/2026")),
      normalizedNotifNumber: normalizeNotificationNumber("IDEM/2026"),
    });
    const retrySet = [created, failed].filter(
      (c) =>
        (c.status === "PR_FAILED" || c.status === "PR_BRANCH_ORPHANED") &&
        (c.prRetryCount ?? 0) < MAX_PR_RETRIES
    );
    check("SR-09: PR_CREATED not in retry set", !retrySet.some((c) => c.status === "PR_CREATED"));
    check("SR-09b: PR_FAILED is in retry set", retrySet.some((c) => c.status === "PR_FAILED"));
    check("SR-09c: retry set length = 1", retrySet.length === 1);
  }

  // ── SR-10: buildTickObservabilityReport ───────────────────────────────────────

  console.log("\n=== SR-10: buildTickObservabilityReport ===");

  {
    const candidates: CandidateNewRecruitment[] = [
      makeCandidate({ status: "PR_FAILED", prRetryCount: 1, candidateId: "cand-failed" }),
      makeCandidate({ status: "PR_BRANCH_ORPHANED", prRetryCount: 0, candidateId: "cand-orphaned" }),
      makeCandidate({ status: "AUTO_PR_SKIPPED_CONFIGURATION", candidateId: "cand-skipped" }),
      makeCandidate({ status: "PR_CREATED", prNumber: 1, candidateId: "cand-created" }),
      makeCandidate({ status: "PENDING_REVIEW", candidateId: "cand-pending" }),
    ];

    const linesNoConfig = buildTickObservabilityReport(candidates, false);
    check("SR-10: config warning present when canAutoPr=false", linesNoConfig.some((l) => l.includes("GITHUB_TOKEN")));
    check("SR-10b: PR_FAILED line present", linesNoConfig.some((l) => l.includes("PR_FAILED")));
    check("SR-10c: PR_BRANCH_ORPHANED line present", linesNoConfig.some((l) => l.includes("PR_BRANCH_ORPHANED")));
    check("SR-10d: AUTO_PR_SKIPPED_CONFIGURATION line present", linesNoConfig.some((l) => l.includes("AUTO_PR_SKIPPED_CONFIGURATION")));
    check("SR-10e: PR_CREATED not surfaced (not actionable)", !linesNoConfig.some((l) => l.includes("PR_CREATED (") || l.includes("PR_CREATED:")));

    const linesWithConfig = buildTickObservabilityReport(candidates, true);
    check("SR-10f: no config warning when canAutoPr=true", !linesWithConfig.some((l) => l.includes("GITHUB_TOKEN")));

    const emptyLines = buildTickObservabilityReport([], true);
    check("SR-10g: quiet report when no candidates need attention", emptyLines.some((l) => l.includes("No candidates")));
  }

  // ── SR-11: processNewCandidateForPr does not mutate input ────────────────────

  console.log("\n=== SR-11: no mutation — processNewCandidateForPr ===");

  {
    const candidate = makeCandidate();
    const originalStatus = candidate.status;
    const originalRef = candidate;
    await processNewCandidateForPr(
      candidate,
      false,
      EMPTY_INTAKE_OPTS,
      undefined,
      {
        runScheduledIntake: async () => makeIntakeAutopr({ outcome: "DRY_RUN" }),
        branchExists: () => false,
      }
    );
    check("SR-11: original object reference unchanged", candidate === originalRef);
    check("SR-11b: original.status not mutated", candidate.status === originalStatus);
  }

  // ── SR-12: retryFailedPrCandidate does not mutate input ──────────────────────

  console.log("\n=== SR-12: no mutation — retryFailedPrCandidate ===");

  {
    const candidate = makeCandidate({ status: "PR_FAILED", prRetryCount: 1 });
    const originalRetryCount = candidate.prRetryCount;
    const originalRef = candidate;
    await retryFailedPrCandidate(
      candidate,
      makePrOptions(),
      EMPTY_INTAKE_OPTS,
      {
        branchExists: () => false,
        createPr: async () => ({
          candidateId: candidate.candidateId,
          slug: "test",
          branchName: "test-branch",
          outcome: "FAILED",
          trustGatePassed: true,
          trustGateErrors: [],
          trustGateWarnings: [],
          missingFields: [],
          error: "network error",
        }),
        createPrForOrphanedBranch: async () => { throw new Error("should not call"); },
      }
    );
    check("SR-12: original object reference unchanged", candidate === originalRef);
    check("SR-12b: original.prRetryCount not mutated", candidate.prRetryCount === originalRetryCount);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
