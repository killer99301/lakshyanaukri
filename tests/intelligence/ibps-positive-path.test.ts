// Phase 9C — IBPS Positive-Path Fixture
// ══════════════════════════════════════════════════════════════
//
// Tests the complete AUTO_PR path with:
//   - An IBPS discovery candidate that has no notificationNumber or dates
//   - An official IBPS page returning a single unambiguous PDF link
//   - A PDF that provides notificationNumber, dates, and vacancies
//
// Verifies:
//   - buildEvaluationCandidate correctly bridges the data handoff
//   - All 12 AUTO_PR conditions pass
//   - Trust Gate passes
//   - dryRunPr() is invoked with outcome = "DRY_RUN"
//   - The original discovery candidate is NOT mutated
//
// INVARIANTS:
//   - isDryRun: true — no GitHub API, no git operations, no government.ts writes
//   - Scheduler NOT enabled
//   - No writes to canonical data

import assert from "node:assert";
import { runScheduledIntake } from "@/intelligence/scheduled-intake";
import { buildEvaluationCandidate } from "@/intelligence/scheduled-intake";
import type { CandidateNewRecruitment } from "@/intelligence/types";
import { normalizeNotificationNumber, buildCandidateId, buildTitleSimilarityKey, normalizeSourceUrl } from "@/intelligence/dedup";

// ─── Helpers ─────────────────────────────────────────────────

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

// ─── Candidate: discovery candidate (thin — no notification number or dates) ──

const DISCOVERY_URL = "https://www.ibps.in/index.php/rural-bank-xv/";
const PDF_URL = "https://www.ibps.in/wp-content/uploads/CRP-RRBs-XV-notification.pdf";

const notif = normalizeNotificationNumber(DISCOVERY_URL);
const discoveryCandidate: CandidateNewRecruitment = {
  candidateId: buildCandidateId("ibps", notif),
  discoverySourceId: "ibps-notifications-html",
  discoverySourceUrl: DISCOVERY_URL,
  discoverySourceTier: 3,
  discoveredAt: "2026-09-08T08:01:12.000Z",
  organizationId: "ibps",
  organizationName: "Institute of Banking Personnel Selection",
  title: "Notification for CRP-RRBs-XV",
  // ── INTENTIONALLY ABSENT — these must come from intake ──
  notificationNumber: undefined,
  applicationCloseDate: undefined,
  applicationOpenDate: undefined,
  // ── END INTENTIONALLY ABSENT ──
  notifPdfUrl: DISCOVERY_URL,
  totalVacancies: undefined,
  confidence: 0.65,
  clusterStatus: "MERGED",
  normalizedNotifNumber: notif,
  sourceUrlFingerprint: normalizeSourceUrl(DISCOVERY_URL),
  titleSimilarityKey: buildTitleSimilarityKey("Notification for CRP-RRBs-XV"),
  rawExcerpt: "Notification for CRP-RRBs-XV",
  status: "PENDING_REVIEW",
};

// ─── Injected fetchFn: returns IBPS official page with ONE PDF link ───────────

const OFFICIAL_HTML = `<!DOCTYPE html>
<html>
<head><title>IBPS CRP RRBs XV | Institute of Banking Personnel Selection</title></head>
<body>
  <h1>CRP RRBs XV - Common Recruitment Process for RRBs (CWE RRBs-XV)</h1>
  <p>Institute of Banking Personnel Selection</p>
  <p>Notification Number: CRP-RRBs-XV</p>
  <p>Total Vacancies: 9000</p>
  <ul>
    <li>Online Registration Starting Date: 01-09-2026</li>
    <li>Last Date for Online Registration: 31-10-2026</li>
  </ul>
  <a href="${PDF_URL}">Download Detailed Notification PDF</a>
  <a href="https://ibpsonline.ibps.in/crprrb15/">Apply Online</a>
  <a href="https://www.ibps.in/">IBPS Home</a>
</body>
</html>`;

// Only ONE PDF link — no ambiguity.
const fakeFetchFn = async (url: string): Promise<{ ok: boolean; html: string | null }> => {
  if (url === DISCOVERY_URL || url === "https://www.ibps.in/index.php/rural-bank-xv/") {
    return { ok: true, html: OFFICIAL_HTML };
  }
  // Any other URL (e.g., org homepage) — return empty
  return { ok: true, html: "<html><body></body></html>" };
};

// ─── Injected fetchPdfFn: returns rich PDF text ───────────────────────────────

const PDF_TEXT = `
INSTITUTE OF BANKING PERSONNEL SELECTION
CRP-RRBs-XV
Common Recruitment Process for RRBs (CWE RRBs-XV)

Notification No.: CRP-RRBs-XV
Total Vacancies: 9000

IMPORTANT DATES
Online Registration Starting Date: 01-09-2026
Last Date for Online Registration: 31-10-2026
Last Date for Online Fee Payment: 31-10-2026

Apply at: https://ibpsonline.ibps.in/crprrb15/
`;

const fakeFetchPdfFn = async (_url: string): Promise<{ ok: boolean; text: string | null }> => ({
  ok: true,
  text: PDF_TEXT,
});

// ─── Run positive-path test ───────────────────────────────────

console.log("\n=== IBPS Positive-Path Fixture (Phase 9C) ===");
console.log("  Mode: DRY_RUN");
console.log("  Candidate: IBPS CRP-RRBs-XV (no notificationNumber, no applicationCloseDate)");
console.log("  Source: single unambiguous official PDF");
console.log();

async function main() {
  const statusBefore = discoveryCandidate.status;
  const notifBefore = discoveryCandidate.notificationNumber;
  const closeDateBefore = discoveryCandidate.applicationCloseDate;

  const result = await runScheduledIntake(discoveryCandidate, {
    isDryRun: true,
    allOpportunities: [],
    existingSlugs: [],
    fetchFn: fakeFetchFn,
    fetchPdfFn: fakeFetchPdfFn,
  });

  console.log(`  Decision:       ${result.decision}`);
  console.log(`  Reason:         ${result.decisionReason}`);
  console.log(`  Trust Gate:     ${result.trustGatePassed ? "PASSED" : "FAILED"}`);
  if (result.trustGateErrors.length > 0) {
    for (const e of result.trustGateErrors) console.log(`    TG error: ${e}`);
  }
  if (result.evidenceSummary.length > 0) {
    console.log("  Evidence:");
    for (const n of result.evidenceSummary.slice(0, 5)) console.log(`    • ${n}`);
  }
  if (result.prResult) {
    console.log(`  PR outcome:     ${result.prResult.outcome}`);
    console.log(`  PR slug:        ${result.prResult.slug}`);
    console.log(`  PR branch:      ${result.prResult.branchName}`);
    console.log(`  PR title:       ${result.prResult.prTitle}`);
    console.log(`  Trust Gate (PR):${result.prResult.trustGatePassed}`);
  }
  console.log();

  // ── Core assertions ──────────────────────────────────────

  check("PP-01: decision is AUTO_PR (all 12 conditions passed)", result.decision === "AUTO_PR");
  check("PP-02: prResult is present", result.prResult !== undefined);
  check("PP-03: PR outcome is DRY_RUN (not a real PR)", result.prResult?.outcome === "DRY_RUN");
  check("PP-04: Trust Gate passed", result.trustGatePassed === true);

  // ── Data handoff assertions ───────────────────────────────

  check("PP-05: discovery candidate.status NOT mutated", discoveryCandidate.status === statusBefore);
  check("PP-06: discovery candidate.notificationNumber NOT mutated", discoveryCandidate.notificationNumber === notifBefore);
  check("PP-07: discovery candidate.applicationCloseDate NOT mutated", discoveryCandidate.applicationCloseDate === closeDateBefore);
  check("PP-08: discovery candidate.status is still PENDING_REVIEW", discoveryCandidate.status === "PENDING_REVIEW");

  // ── No real PR created ────────────────────────────────────

  check("PP-09: discovery candidate.prNumber NOT set (dry-run only)", discoveryCandidate.prNumber === undefined);
  check("PP-10: discovery candidate.prUrl NOT set (dry-run only)", discoveryCandidate.prUrl === undefined);

  // ── Audit record ─────────────────────────────────────────

  check("PP-11: auditedAt is a valid ISO timestamp", /^\d{4}-\d{2}-\d{2}T/.test(result.auditedAt));
  check("PP-12: candidateId in result matches discovery candidate", result.candidateId === discoveryCandidate.candidateId);

  // ── Evidence / provenance ─────────────────────────────────
  // Verify that buildEvaluationCandidate actually bridged the handoff.
  // We can't inspect the internal evaluationCandidate from here, so we
  // confirm by testing that the decision was AUTO_PR (which requires
  // notificationNumber and applicationCloseDate to be present).

  if (result.decision === "AUTO_PR") {
    check("PP-13: PR branch name is set", Boolean(result.prResult?.branchName));
    check("PP-14: PR slug is set", Boolean(result.prResult?.slug));
  }

  console.log("\n=== Positive-Path Fixture Complete ===");

  if (result.decision !== "AUTO_PR") {
    console.log("  ⚠  Expected AUTO_PR but got PENDING_REVIEW.");
    console.log(`  Reason: ${result.decisionReason}`);
    console.log("  Trust Gate errors:", result.trustGateErrors);
    console.log("  Evidence:", result.evidenceSummary);
    // Fail the test
    assert.fail(`Expected AUTO_PR, got PENDING_REVIEW: ${result.decisionReason}`);
  }
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
