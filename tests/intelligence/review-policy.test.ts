// Phase 7A: Reviewer-facing consistency warning tests (P1–P8)
//
// These tests verify that Trust Gate warnings are visible to the reviewer
// at every stage of the pipeline — before approval, during approval,
// and after writing — and that they are never silently suppressed.
//
// The driving scenario:
//   - A GovernmentRecruitment has vacancyBreakdown summing to 1000
//   - A field diff proposes totalVacancies: 1000 → 1100
//   - After applying the diff, totalVacancies ≠ vacancyBreakdown total
//   - Trust Gate emits a WARNING (not error) — write is not blocked
//   - But the reviewer must see the warning before committing

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { GovernmentRecruitment, ExamStageStatus, Opportunity } from "@/types";
import type { ChangeReviewQueue, ReviewItem, FieldDiff, ProposedChange } from "@/intelligence/types";
import {
  showItem,
  approveReviewItem,
} from "@/intelligence/review-cli";
import { appendToReviewQueue, loadReviewQueue, approveItem } from "@/intelligence/review-queue";
import { commitApprovedChange } from "@/intelligence/writer";

// ─── Fixtures ────────────────────────────────────────────────

const TMP_DIR = join(process.cwd(), "intelligence-runs");
const tempFiles: string[] = [];
function tmpQueue(): string { const p = join(TMP_DIR, `test-policy-${randomUUID()}.json`); tempFiles.push(p); return p; }
function tmpData(): string  { const p = join(TMP_DIR, `test-policy-${randomUUID()}.ts`); tempFiles.push(p); return p; }

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

/**
 * GovernmentRecruitment with a vacancyBreakdown that sums to 1000,
 * while totalVacancies is also 1000 in the canonical record.
 * A totalVacancies diff to 1100 will make them diverge → TG warning.
 */
function makeGovWithBreakdown(id = "policy-gov-001"): GovernmentRecruitment {
  return {
    id,
    slug: id,
    type: "government",
    title: "Policy Test Recruitment",
    organizationId: "bpsc",
    organizationName: "Bihar Public Service Commission (BPSC)",
    notificationNumber: `Policy-Test/${id}`,
    govType: "State Govt",
    shortDescription: "Test record for review-policy.test.ts.",
    category: "state-psc",
    state: "Bihar",
    qualification: "Graduate",
    postDate: "2026-01-01",
    totalVacancies: 1000,
    vacanciesDisplay: "1,000 Vacancies",
    vacancyBreakdown: [
      { category: "General", count: 600 },
      { category: "OBC", count: 250 },
      { category: "SC", count: 150 },
    ], // sums to 1000 — matches totalVacancies
    examStages: [
      { name: "Preliminary", order: 1, status: "SCHEDULED" as ExamStageStatus, dateIso: "2026-09-15", dateDisplay: "15 Sep 2026" },
    ],
    application: { notificationDate: "2026-01-01", openDate: "2026-01-15", closeDate: "2026-03-31" },
    links: { apply: "https://bpsc.bih.nic.in/apply", website: "https://bpsc.bih.nic.in" },
    provenance: {
      status: "VERIFIED",
      lastVerifiedAt: "2026-08-01",
      primarySourceType: "OFFICIAL_NOTIFICATION",
      primarySourceUrl: "https://bpsc.bih.nic.in/notice/policy-test",
    },
  };
}

function fd(field: string, canonical: string, observed: string): FieldDiff {
  return { field, canonicalValue: canonical, observedValue: observed, confidence: 0.95, extractionMethod: "REGEX" };
}

function makePendingItem(govId: string, diffs: FieldDiff[]): ReviewItem {
  const id = randomUUID();
  return {
    id,
    dedupKey: `${govId}::VACANCY_CHANGE::policy-test`,
    queuedAt: new Date().toISOString(),
    status: "PENDING",
    opportunityId: govId,
    opportunityTitle: "Policy Test Recruitment",
    changeType: "VACANCY_CHANGE",
    oldValue: diffs[0]?.canonicalValue,
    newValue: diffs[0]?.observedValue,
    matchedIdentifier: "Policy-Test/policy-gov-001",
    secondarySource: "policy-test",
    secondarySourceUrl: "https://sarkariresult.com/bpsc/",
    officialConfirmationSource: "bpsc-application-portal",
    officialConfirmationUrl: "https://bpsc.bih.nic.in/notice/policy-test.pdf",
    officialEvidence: "Vacancy count revised from 1000 to 1100 per official corrigendum.",
    confidence: 0.95,
    fieldDiffs: diffs,
    runId: randomUUID(),
    detectedAt: new Date().toISOString(),
    eventId: randomUUID(),
    preRunSnapshotRef: "sha256:test",
    humanReviewRequired: true,
  };
}

function makeApprovedItem(gov: GovernmentRecruitment, diffs: FieldDiff[]): ReviewItem {
  const base = makePendingItem(gov.id, diffs);
  const approvedChange: ProposedChange = {
    reviewItemId: base.id,
    opportunityId: gov.id,
    approvedAt: new Date().toISOString(),
    appliedFieldDiffs: diffs,
    skippedPaths: [],
    trustGatePassed: true,
    trustGateErrors: [],
    // Store the warning that would arise: breakdown (1000) ≠ proposed totalVacancies (1100)
    trustGateWarnings: [
      "Vacancy breakdown total (1000) does not match totalVacancies (1100).",
    ],
    productionWriteAttempted: false,
  };
  return { ...base, status: "APPROVED", approvedChange };
}

// ─── P1: Warning appears in showItem for PENDING item ────────

console.log("\nP1: showItem — PENDING item with vacancy breakdown warning");
{
  const q = tmpQueue();
  const gov = makeGovWithBreakdown();
  const diffs = [fd("totalVacancies", "1000", "1100")];
  const item = makePendingItem(gov.id, diffs);
  writeFileSync(q, JSON.stringify({ version: "1", lastUpdatedAt: new Date().toISOString(), items: [item] } as ChangeReviewQueue, null, 2));

  const opps: Opportunity[] = [gov];
  const r = showItem(item.id, q, opps);

  check("success=true", r.success);
  check("output contains CONSISTENCY WARNINGS", r.message.includes("CONSISTENCY WARNINGS"));
  check("output contains vacancy breakdown warning", r.message.toLowerCase().includes("breakdown"));
  check("output shows proposed total 1,100", r.message.includes("1,100"));
  check("output shows breakdown total 1,000", r.message.includes("1,000"));
  check("output states proposal does NOT modify vacancyBreakdown",
    r.message.includes("does NOT modify vacancyBreakdown"));
}

// ─── P2: Warning survives approveItem() ──────────────────────

console.log("\nP2: Warning survives approveItem() — stored in ProposedChange");
{
  const q = tmpQueue();
  const gov = makeGovWithBreakdown();
  const diffs = [fd("totalVacancies", "1000", "1100")];
  const item = makePendingItem(gov.id, diffs);
  appendToReviewQueue(item, q);

  const opps: Opportunity[] = [gov];
  const proposal = approveItem(item.id, opps, "P2 test", q);

  check("Proposal generated", !!proposal);
  check("trustGatePassed=true despite warning", proposal?.trustGatePassed === true);
  check("trustGateWarnings is non-empty", (proposal?.trustGateWarnings.length ?? 0) > 0);
  check("warning mentions breakdown", proposal?.trustGateWarnings.some(w => w.toLowerCase().includes("breakdown")) ?? false);
}

// ─── P3: Warning is stored inside ProposedChange ─────────────

console.log("\nP3: Warning is stored inside ProposedChange on queue item");
{
  const q = tmpQueue();
  const gov = makeGovWithBreakdown();
  const diffs = [fd("totalVacancies", "1000", "1100")];
  const item = makePendingItem(gov.id, diffs);
  appendToReviewQueue(item, q);

  const opps: Opportunity[] = [gov];
  approveItem(item.id, opps, undefined, q);

  const updatedItem = loadReviewQueue(q).items.find(i => i.id === item.id)!;
  check("approvedChange is set", !!updatedItem.approvedChange);
  check("trustGateWarnings stored in ProposedChange",
    (updatedItem.approvedChange?.trustGateWarnings.length ?? 0) > 0);
  check("productionWriteAttempted remains false",
    updatedItem.approvedChange?.productionWriteAttempted === false);
}

// ─── P4: Approval does not convert warning → error ───────────

console.log("\nP4: Approval does not silently convert warning to error");
{
  const q = tmpQueue();
  const gov = makeGovWithBreakdown();
  const diffs = [fd("totalVacancies", "1000", "1100")];
  const item = makePendingItem(gov.id, diffs);
  appendToReviewQueue(item, q);

  const opps: Opportunity[] = [gov];
  const r = approveReviewItem(item.id, opps, undefined, q);

  check("approveReviewItem succeeds (success=true)", r.success);
  check("item status is APPROVED", r.item?.status === "APPROVED");
  check("trustGatePassed=true — warning is NOT an error", r.item?.approvedChange?.trustGatePassed === true);
  check("trustGateErrors is empty", (r.item?.approvedChange?.trustGateErrors.length ?? -1) === 0);
  check("consistency warnings visible in approve output", r.message.includes("CONSISTENCY WARNINGS"));
  check("approve output mentions breakdown", r.message.toLowerCase().includes("breakdown"));
}

// ─── P5: Writer preserves warning in CommitResult ────────────

console.log("\nP5: Writer surfaces consistencyWarnings in CommitResult");
{
  const gov = makeGovWithBreakdown();
  const diffs = [fd("totalVacancies", "1000", "1100")];
  const item = makeApprovedItem(gov, diffs);
  const opps: Opportunity[] = [gov];
  const dataPath = tmpData();

  const result = commitApprovedChange(item, opps, {
    dataPath,
    governmentRecords: [gov],
  });

  check("committed=true", result.committed);
  check("consistencyWarnings is non-empty", result.consistencyWarnings.length > 0);
  check("consistencyWarnings mentions breakdown",
    result.consistencyWarnings.some(w => w.toLowerCase().includes("breakdown")));
}

// ─── P6: Clean proposal produces no consistency warnings ──────

console.log("\nP6: Clean proposal — no vacancyBreakdown → no warnings");
{
  const gov: GovernmentRecruitment = {
    ...makeGovWithBreakdown("policy-clean-001"),
    vacancyBreakdown: undefined, // no breakdown defined
    totalVacancies: 1000,
  };
  const diffs = [fd("totalVacancies", "1000", "1100")];
  const item = makePendingItem(gov.id, diffs);
  const q = tmpQueue();
  writeFileSync(q, JSON.stringify({ version: "1", lastUpdatedAt: new Date().toISOString(), items: [item] } as ChangeReviewQueue, null, 2));

  const opps: Opportunity[] = [gov];
  const r = showItem(item.id, q, opps);

  check("success=true", r.success);
  check("no CONSISTENCY WARNINGS section", !r.message.includes("CONSISTENCY WARNINGS"));
}

// ─── P7: Multiple warnings displayed independently ────────────

console.log("\nP7: Multiple warnings are shown independently");
{
  const item = makeApprovedItem(makeGovWithBreakdown(), [fd("totalVacancies", "1000", "1100")]);
  // Inject two warnings
  item.approvedChange = {
    ...item.approvedChange!,
    trustGateWarnings: [
      "Vacancy breakdown total (1000) does not match totalVacancies (1100).",
      "Exam stage order numbers are not unique.",
    ],
  };
  const q = tmpQueue();
  writeFileSync(q, JSON.stringify({ version: "1", lastUpdatedAt: new Date().toISOString(), items: [item] } as ChangeReviewQueue, null, 2));

  const r = showItem(item.id, q);

  check("success=true", r.success);
  check("both warnings appear in output", r.message.includes("breakdown") && r.message.includes("unique"));
  check("CONSISTENCY WARNINGS section present", r.message.includes("CONSISTENCY WARNINGS"));

  // Each warning should appear on its own tier-labelled line
  const warningLines = r.message.split("\n").filter(
    l => l.includes("[INFORMATIONAL]") || l.includes("[REQUIRES ACKNOWLEDGEMENT]") || l.includes("[COMMIT-BLOCKED]")
  );
  check("two separate warning lines", warningLines.length >= 2);
}

// ─── P8: Skipped fields remain explicitly visible ────────────

console.log("\nP8: Skipped fields remain visible alongside consistency warnings");
{
  const gov = makeGovWithBreakdown();
  const diffs = [
    fd("totalVacancies", "1000", "1100"),
    fd("application.openDate", "2026-01-15", "2026-02-01"), // unsupported path → skipped
  ];
  const item = makeApprovedItem(gov, diffs);
  item.approvedChange = {
    ...item.approvedChange!,
    appliedFieldDiffs: [diffs[0]],                    // only totalVacancies applied
    skippedPaths: ["application.openDate: not currently emitted by confirmer.ts"],
  };
  const q = tmpQueue();
  writeFileSync(q, JSON.stringify({ version: "1", lastUpdatedAt: new Date().toISOString(), items: [item] } as ChangeReviewQueue, null, 2));

  const r = showItem(item.id, q);

  check("success=true", r.success);
  check("consistency warnings visible", r.message.includes("CONSISTENCY WARNINGS"));
  check("skipped paths section visible", r.message.includes("Skipped paths") || r.message.includes("openDate"));
  check("both sections present simultaneously",
    r.message.includes("CONSISTENCY WARNINGS") && (r.message.includes("Skipped") || r.message.includes("openDate")));
}

// ─── Cleanup ─────────────────────────────────────────────────

for (const f of tempFiles) {
  if (existsSync(f)) unlinkSync(f);
}

console.log("\n✅ All P1–P8 review policy tests passed\n");
