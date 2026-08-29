// Phase 7B: Warning classification and acknowledgement policy tests (Q1–Q8)
//
// The driving contract:
//   classifyWarning(msg) → WarningTier
//   checkWarningPolicy(warnings, acknowledged) → { blocked, refuseReason? }
//
// INFORMATIONAL: never blocks a commit
// ACKNOWLEDGE:   blocked without exact matching string in acknowledged[]
// BLOCKING:      always blocked, even with acknowledgement
//
// Q1/Q2: classifyWarning
// Q3–Q5: checkWarningPolicy
// Q6:    showItem renders tier labels
// Q7:    multiple warnings classified independently (mixed tiers)
// Q8:    BLOCKING tier refuses even when acknowledged

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { GovernmentRecruitment, ExamStageStatus, Opportunity } from "@/types";
import type { ChangeReviewQueue, ReviewItem, FieldDiff, ProposedChange } from "@/intelligence/types";
import { classifyWarning, checkWarningPolicy } from "@/intelligence/warning-policy";
import { showItem, approveReviewItem } from "@/intelligence/review-cli";

// ─── Fixtures ────────────────────────────────────────────────

const TMP_DIR = join(process.cwd(), "intelligence-runs");
const tempFiles: string[] = [];
function tmpQueue(): string {
  const p = join(TMP_DIR, `test-7b-${randomUUID()}.json`);
  tempFiles.push(p);
  return p;
}

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

function makeGov(id = "7b-gov-001"): GovernmentRecruitment {
  return {
    id,
    slug: id,
    type: "government",
    title: "Warning Policy Test Recruitment",
    organizationId: "bpsc",
    organizationName: "Bihar Public Service Commission (BPSC)",
    notificationNumber: `7B-Test/${id}`,
    govType: "State Govt",
    shortDescription: "Test record for warning-policy.test.ts.",
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
    ],
    examStages: [
      { name: "Preliminary", order: 1, status: "SCHEDULED" as ExamStageStatus, dateIso: "2026-09-15", dateDisplay: "15 Sep 2026" },
    ],
    application: { notificationDate: "2026-01-01", openDate: "2026-01-15", closeDate: "2026-03-31" },
    links: { apply: "https://bpsc.bih.nic.in/apply", website: "https://bpsc.bih.nic.in" },
    provenance: {
      status: "VERIFIED",
      lastVerifiedAt: "2026-08-01",
      primarySourceType: "OFFICIAL_NOTIFICATION",
      primarySourceUrl: "https://bpsc.bih.nic.in/notice/7b-test",
    },
  };
}

function fd(field: string, canonical: string, observed: string): FieldDiff {
  return { field, canonicalValue: canonical, observedValue: observed, confidence: 0.95, extractionMethod: "REGEX" };
}

function makePendingItem(govId: string, diffs: FieldDiff[]): ReviewItem {
  return {
    id: randomUUID(),
    dedupKey: `${govId}::VACANCY_CHANGE::7b-test`,
    queuedAt: new Date().toISOString(),
    status: "PENDING",
    opportunityId: govId,
    opportunityTitle: "Warning Policy Test Recruitment",
    changeType: "VACANCY_CHANGE",
    oldValue: diffs[0]?.canonicalValue,
    newValue: diffs[0]?.observedValue,
    matchedIdentifier: "7B-Test/7b-gov-001",
    secondarySource: "7b-test",
    secondarySourceUrl: "https://sarkariresult.com/bpsc/",
    officialConfirmationSource: "bpsc-portal",
    officialConfirmationUrl: "https://bpsc.bih.nic.in/notice/7b-test.pdf",
    officialEvidence: "Vacancy count revised per official corrigendum.",
    confidence: 0.95,
    fieldDiffs: diffs,
    runId: randomUUID(),
    detectedAt: new Date().toISOString(),
    eventId: randomUUID(),
    preRunSnapshotRef: "sha256:7btest",
    humanReviewRequired: true,
  };
}

function makeApprovedItem(gov: GovernmentRecruitment, diffs: FieldDiff[], warnings: string[], acknowledged: string[] = []): ReviewItem {
  const base = makePendingItem(gov.id, diffs);
  const approvedChange: ProposedChange = {
    reviewItemId: base.id,
    opportunityId: gov.id,
    approvedAt: new Date().toISOString(),
    appliedFieldDiffs: diffs,
    skippedPaths: [],
    trustGatePassed: true,
    trustGateErrors: [],
    trustGateWarnings: warnings,
    acknowledgedWarnings: acknowledged,
    productionWriteAttempted: false,
  };
  return { ...base, status: "APPROVED", approvedChange };
}

function writeQueue(q: string, items: ReviewItem[]): void {
  writeFileSync(q, JSON.stringify({
    version: "1",
    lastUpdatedAt: new Date().toISOString(),
    items,
  } as ChangeReviewQueue, null, 2));
}

// ─── Q1: classifyWarning — known patterns ─────────────────────

console.log("\nQ1: classifyWarning returns correct tier for known patterns");
{
  check(
    "vacancy breakdown pattern → INFORMATIONAL",
    classifyWarning("Vacancy breakdown total (1000) does not match totalVacancies (1100).") === "INFORMATIONAL"
  );
  check(
    "[ACKNOWLEDGE-REQUIRED] sentinel → ACKNOWLEDGE",
    classifyWarning("[ACKNOWLEDGE-REQUIRED] exam stage dates overlap") === "ACKNOWLEDGE"
  );
  check(
    "[COMMIT-BLOCKED] sentinel → BLOCKING",
    classifyWarning("[COMMIT-BLOCKED] totalVacancies is zero") === "BLOCKING"
  );
}

// ─── Q2: classifyWarning — unknown warning defaults to INFORMATIONAL ──

console.log("\nQ2: Unknown warning message defaults to INFORMATIONAL");
{
  check(
    "completely unknown message → INFORMATIONAL",
    classifyWarning("Some future warning that has no policy entry yet") === "INFORMATIONAL"
  );
  check(
    "empty string → INFORMATIONAL",
    classifyWarning("") === "INFORMATIONAL"
  );
  check(
    "partial match not enough — [ACKNOWLEDGE-REQ] (truncated) → INFORMATIONAL",
    classifyWarning("[ACKNOWLEDGE-REQ] partial text") === "INFORMATIONAL"
  );
}

// ─── Q3: ACKNOWLEDGE without acknowledgement → blocked ────────

console.log("\nQ3: ACKNOWLEDGE-tier warning without acknowledgement → commit blocked");
{
  const warning = "[ACKNOWLEDGE-REQUIRED] exam conflict detected";
  const result = checkWarningPolicy([warning], []);
  check("blocked=true", result.blocked === true);
  check("refuseReason present", !!result.refuseReason);
  check("refuseReason contains the warning text", result.refuseReason!.includes(warning));
  check("refuseReason mentions re-approve with --acknowledge", result.refuseReason!.includes("--acknowledge"));
}

// ─── Q4: ACKNOWLEDGE with exact acknowledgement → not blocked ─

console.log("\nQ4: ACKNOWLEDGE-tier warning with exact acknowledgement → commit allowed");
{
  const warning = "[ACKNOWLEDGE-REQUIRED] exam conflict detected";
  const result = checkWarningPolicy([warning], [warning]);
  check("blocked=false", result.blocked === false);
  check("no refuseReason", result.refuseReason === undefined);
}

// ─── Q5: INFORMATIONAL never blocks ───────────────────────────

console.log("\nQ5: INFORMATIONAL-tier warning never blocks commit");
{
  const warning = "Vacancy breakdown total (1000) does not match totalVacancies (1100).";
  const withoutAck = checkWarningPolicy([warning], []);
  check("blocked=false without acknowledgement", withoutAck.blocked === false);
  check("no refuseReason without acknowledgement", withoutAck.refuseReason === undefined);

  const withAck = checkWarningPolicy([warning], [warning]);
  check("blocked=false even with unnecessary acknowledgement", withAck.blocked === false);
}

// ─── Q6: showItem renders tier labels ─────────────────────────

console.log("\nQ6: showItem renders tier labels in CONSISTENCY WARNINGS section");
{
  // PENDING item: TG preview emits vacancy breakdown warning → should show [INFORMATIONAL]
  const gov = makeGov();
  const item = makePendingItem(gov.id, [fd("totalVacancies", "1000", "1100")]);
  const q = tmpQueue();
  writeQueue(q, [item]);

  const r = showItem(item.id, q, [gov] as Opportunity[]);
  check("success=true (PENDING, TG preview)", r.success);
  check("CONSISTENCY WARNINGS section present", r.message.includes("CONSISTENCY WARNINGS"));
  check("tier label [INFORMATIONAL] present", r.message.includes("[INFORMATIONAL]"));

  // APPROVED item with injected ACKNOWLEDGE-tier stored warning
  const approvedItem = makeApprovedItem(
    gov,
    [fd("totalVacancies", "1000", "1100")],
    ["[ACKNOWLEDGE-REQUIRED] future exam stage conflict"]
  );
  const q2 = tmpQueue();
  writeQueue(q2, [approvedItem]);

  const r2 = showItem(approvedItem.id, q2);
  check("success=true (APPROVED item)", r2.success);
  check("CONSISTENCY WARNINGS section present for APPROVED item", r2.message.includes("CONSISTENCY WARNINGS"));
  check("tier label [REQUIRES ACKNOWLEDGEMENT] present", r2.message.includes("[REQUIRES ACKNOWLEDGEMENT]"));
}

// ─── Q7: Multiple warnings classified independently ────────────

console.log("\nQ7: Mixed-tier warnings are classified and displayed independently");
{
  // checkWarningPolicy: INFORMATIONAL + ACKNOWLEDGE (un-acked) → blocked on the ACKNOWLEDGE
  const result = checkWarningPolicy(
    [
      "Vacancy breakdown total (1000) does not match totalVacancies (1100).", // INFORMATIONAL
      "[ACKNOWLEDGE-REQUIRED] another issue",                                  // ACKNOWLEDGE
    ],
    [] // no acknowledgements
  );
  check("blocked=true because of un-acked ACKNOWLEDGE warning", result.blocked === true);
  check("refuseReason refers to ACKNOWLEDGE warning", result.refuseReason!.includes("[ACKNOWLEDGE-REQUIRED]"));

  // checkWarningPolicy: INFORMATIONAL + ACKNOWLEDGE (acked) → not blocked
  const ackWarning = "[ACKNOWLEDGE-REQUIRED] another issue";
  const result2 = checkWarningPolicy(
    [
      "Vacancy breakdown total (1000) does not match totalVacancies (1100).",
      ackWarning,
    ],
    [ackWarning] // acknowledged
  );
  check("blocked=false when ACKNOWLEDGE warning is acknowledged", result2.blocked === false);

  // showItem: APPROVED item with two stored warnings (mixed tiers)
  const gov = makeGov("7b-gov-multi");
  const multiItem = makeApprovedItem(
    gov,
    [fd("totalVacancies", "1000", "1100")],
    [
      "Vacancy breakdown total (1000) does not match totalVacancies (1100).", // INFORMATIONAL
      "[ACKNOWLEDGE-REQUIRED] future issue",                                   // ACKNOWLEDGE
    ]
  );
  const q = tmpQueue();
  writeQueue(q, [multiItem]);

  const r = showItem(multiItem.id, q);
  check("success=true", r.success);
  check("[INFORMATIONAL] label in output", r.message.includes("[INFORMATIONAL]"));
  check("[REQUIRES ACKNOWLEDGEMENT] label in output", r.message.includes("[REQUIRES ACKNOWLEDGEMENT]"));

  // Both labelled lines should be present
  const labelledLines = r.message.split("\n").filter(
    l => l.includes("[INFORMATIONAL]") || l.includes("[REQUIRES ACKNOWLEDGEMENT]") || l.includes("[COMMIT-BLOCKED]")
  );
  check("two labelled warning lines", labelledLines.length >= 2);
}

// ─── Q8: BLOCKING always refuses, even with acknowledgement ────

console.log("\nQ8: BLOCKING-tier warning refuses commit even when acknowledged");
{
  const warning = "[COMMIT-BLOCKED] totalVacancies is zero — this record must be reviewed manually";

  // Without acknowledgement
  const r1 = checkWarningPolicy([warning], []);
  check("blocked=true without ack", r1.blocked === true);
  check("refuseReason present without ack", !!r1.refuseReason);

  // Even WITH acknowledgement — BLOCKING is unconditional
  const r2 = checkWarningPolicy([warning], [warning]);
  check("blocked=true EVEN WITH ack (BLOCKING is absolute)", r2.blocked === true);
  check("refuseReason present with ack", !!r2.refuseReason);
  check("refuseReason mentions permanent block", r2.refuseReason!.includes("permanent") || r2.refuseReason!.includes("block"));

  // approveReviewItem should succeed (acknowledge validation only checks ACKNOWLEDGE tier,
  // not BLOCKING — invalid ack strings are rejected, but BLOCKING warnings are a writer concern)
  const gov = makeGov("7b-gov-block");
  // For the CLI pre-validation test: supply an --acknowledge for a BLOCKING warning.
  // The pre-validation only rejects acks that don't match ACKNOWLEDGE-tier warnings.
  // A BLOCKING warning is not ACKNOWLEDGE-tier, so supplying it as an ack is an invalid ack string.
  const pendingItem = makePendingItem(gov.id, [fd("totalVacancies", "1000", "1100")]);
  const q = tmpQueue();
  writeQueue(q, [pendingItem]);

  // Supplying an ack for a non-ACKNOWLEDGE-tier warning should fail pre-validation
  const r3 = approveReviewItem(
    pendingItem.id,
    [gov] as Opportunity[],
    undefined,
    q,
    ["[COMMIT-BLOCKED] this string does not match any ACKNOWLEDGE-tier warning"]
  );
  check("approveReviewItem fails: ack does not match ACKNOWLEDGE-tier warning", r3.success === false);
  check("failure message explains mismatch", r3.message.includes("does not match any ACKNOWLEDGE-tier warning"));
}

// ─── Cleanup ─────────────────────────────────────────────────

for (const f of tempFiles) {
  if (existsSync(f)) unlinkSync(f);
}

console.log("\n✅ All Q1–Q8 warning policy tests passed\n");
