// Phase 6A: Review CLI tests (R1–R10)
//
// All tests use temp queue files (never touch the real queue).
// productionWrites = 0 verified in R10.

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { ChangeReviewQueue, ReviewItem } from "@/intelligence/types";
import {
  listItems,
  showItem,
  approveReviewItem,
  rejectReviewItem,
} from "@/intelligence/review-cli";

// ─── Helpers ─────────────────────────────────────────────────

const TMP_DIR = join(process.cwd(), "intelligence-runs");

function tmpQueue(): string {
  return join(TMP_DIR, `test-cli-${randomUUID()}.json`);
}

function writeQueue(path: string, items: ReviewItem[]): void {
  const q: ChangeReviewQueue = {
    version: "1",
    lastUpdatedAt: new Date().toISOString(),
    items,
  };
  writeFileSync(path, JSON.stringify(q, null, 2), "utf-8");
}

let ITEM_COUNTER = 1;

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  const id = randomUUID();
  const n = ITEM_COUNTER++;
  return {
    id,
    dedupKey: `opp-${n}::EXAM_DATE_CHANGE::advt-${n}`,
    queuedAt: new Date().toISOString(),
    status: "PENDING",
    opportunityId: `test-opp-${n}`,
    opportunityTitle: `Test Recruitment ${n}`,
    changeType: "EXAM_DATE_CHANGE",
    matchedIdentifier: `Advt No. ${n}/2026`,
    secondarySource: "sarkari-result",
    secondarySourceUrl: "https://www.sarkariresult.com/example",
    officialConfirmationSource: "official-site",
    officialConfirmationUrl: "https://example.gov.in/notice.pdf",
    officialEvidence: "The examination scheduled for 15 September 2026 has been rescheduled to 20 October 2026.",
    confidence: 0.91,
    fieldDiffs: [],
    runId: randomUUID(),
    detectedAt: new Date().toISOString(),
    eventId: randomUUID(),
    ...overrides,
  };
}

// Track created temp files for cleanup
const tempFiles: string[] = [];
function track(p: string): string { tempFiles.push(p); return p; }

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

// ─── R1: listItems on empty / non-existent queue ─────────────

console.log("\nR1: listItems — non-existent queue file");
{
  const q = track(tmpQueue());
  // don't write the file → should get "empty" message
  const r = listItems(q);
  check("success=true", r.success);
  check('message contains "empty"', r.message.toLowerCase().includes("empty"));
}

// ─── R2: listItems with PENDING items shows them ─────────────

console.log("\nR2: listItems — queue with 2 PENDING items");
{
  const q = track(tmpQueue());
  const items = [makeItem(), makeItem()];
  writeQueue(q, items);
  const r = listItems(q);
  check("success=true", r.success);
  check("message contains 'PENDING'", r.message.includes("PENDING"));
  check("shows first item shortId", r.message.includes(items[0].id.slice(0, 8)));
  check("shows second item shortId", r.message.includes(items[1].id.slice(0, 8)));
}

// ─── R2b: listItems with all-non-PENDING items ───────────────

console.log("\nR2b: listItems — queue with no PENDING items (only REJECTED)");
{
  const q = track(tmpQueue());
  const item = makeItem({ status: "REJECTED" });
  writeQueue(q, [item]);
  const r = listItems(q);
  check("success=true", r.success);
  check("message mentions non-pending state", r.message.toLowerCase().includes("pending") || r.message.toLowerCase().includes("no pending"));
}

// ─── R3: showItem with valid full ID ─────────────────────────

console.log("\nR3: showItem — valid full UUID");
{
  const q = track(tmpQueue());
  const item = makeItem({
    opportunityTitle: "Bihar BPSC 72nd CCE",
    changeType: "EXAM_DATE_CHANGE",
    officialEvidence: "New date announced by the commission.",
  });
  writeQueue(q, [item]);
  const r = showItem(item.id, q);
  check("success=true", r.success);
  check("item returned", !!r.item);
  check("shows full ID", r.message.includes(item.id));
  check("shows opportunity title", r.message.includes("Bihar BPSC 72nd CCE"));
  check("shows EXAM_DATE_CHANGE", r.message.includes("EXAM_DATE_CHANGE"));
  check("shows official URL", r.message.includes("example.gov.in"));
}

// ─── R4: showItem with unknown ID prefix → failure ───────────

console.log("\nR4: showItem — unknown ID prefix");
{
  const q = track(tmpQueue());
  const item = makeItem();
  writeQueue(q, [item]);
  const r = showItem("00000000", q);
  check("success=false", !r.success);
  check("message mentions the unknown prefix", r.message.includes("00000000"));
}

// ─── R5: approveReviewItem on PENDING → APPROVED ─────────────

console.log("\nR5: approveReviewItem — PENDING item with no fieldDiffs");
{
  const q = track(tmpQueue());
  const item = makeItem({ fieldDiffs: [] });
  writeQueue(q, [item]);

  // With no fieldDiffs, approveItem takes the fast path (trustGatePassed=true)
  // so we can pass an empty opportunities array
  const r = approveReviewItem(item.id, [], undefined, q);
  check("success=true", r.success);
  check("item returned", !!r.item);
  check("item status is APPROVED", r.item?.status === "APPROVED");
  check("approvedChange is set", !!r.item?.approvedChange);
  check("trustGatePassed=true", r.item?.approvedChange?.trustGatePassed === true);
  check("productionWriteAttempted=false", r.item?.approvedChange?.productionWriteAttempted === false);
  check("message contains 'Approved'", r.message.toLowerCase().includes("approved"));
  check("message states productionWrites=0", r.message.includes("productionWrites: 0"));
}

// ─── R5b: approveReviewItem accepts 8-char prefix ────────────

console.log("\nR5b: approveReviewItem — by 8-char ID prefix");
{
  const q = track(tmpQueue());
  const item = makeItem();
  writeQueue(q, [item]);
  const r = approveReviewItem(item.id.slice(0, 8), [], undefined, q);
  check("success=true by prefix", r.success);
  check("item APPROVED by prefix", r.item?.status === "APPROVED");
}

// ─── R6: approveReviewItem on already-APPROVED → failure ─────

console.log("\nR6: approveReviewItem — already APPROVED item");
{
  const q = track(tmpQueue());
  const item = makeItem({ status: "APPROVED" });
  writeQueue(q, [item]);
  const r = approveReviewItem(item.id, [], undefined, q);
  check("success=false", !r.success);
  check("message mentions already APPROVED", r.message.includes("APPROVED"));
}

// ─── R7: approveReviewItem with unknown ID → failure ─────────

console.log("\nR7: approveReviewItem — unknown ID");
{
  const q = track(tmpQueue());
  writeQueue(q, []);
  const r = approveReviewItem("deadbeef", [], undefined, q);
  check("success=false", !r.success);
  check("message mentions the unknown ID", r.message.includes("deadbeef"));
}

// ─── R8: rejectReviewItem with reason → REJECTED ─────────────

console.log("\nR8: rejectReviewItem — valid PENDING item");
{
  const q = track(tmpQueue());
  const item = makeItem();
  writeQueue(q, [item]);
  const r = rejectReviewItem(item.id, "Evidence is outdated — verified by newer notice", q);
  check("success=true", r.success);
  check("item returned", !!r.item);
  check("item status is REJECTED", r.item?.status === "REJECTED");
  check("review notes stored", r.item?.reviewNotes?.includes("outdated"));
  check("message mentions Rejected", r.message.toLowerCase().includes("rejected"));
  check("message states productionWrites=0", r.message.includes("productionWrites: 0"));
}

// ─── R9: rejectReviewItem on non-PENDING → failure ───────────

console.log("\nR9: rejectReviewItem — already APPROVED item");
{
  const q = track(tmpQueue());
  const item = makeItem({ status: "APPROVED" });
  writeQueue(q, [item]);
  const r = rejectReviewItem(item.id, "Too late", q);
  check("success=false for APPROVED item", !r.success);
  check("message mentions already APPROVED", r.message.includes("APPROVED"));
}

// ─── R9b: rejectReviewItem with empty reason → failure ────────

console.log("\nR9b: rejectReviewItem — empty reason string");
{
  const q = track(tmpQueue());
  const item = makeItem();
  writeQueue(q, [item]);
  const r = rejectReviewItem(item.id, "   ", q);
  check("success=false for empty reason", !r.success);
  check("message mentions reason requirement", r.message.toLowerCase().includes("reason"));
}

// ─── R10: productionWrites = 0 — src/data/ not modified ──────

console.log("\nR10: productionWrites = 0 guard");
{
  const srcFiles = ["src/data/government.ts", "src/data/homepage.ts", "src/data/private.ts"];
  for (const f of srcFiles) {
    if (existsSync(f)) {
      const ageMs = Date.now() - statSync(f).mtimeMs;
      check(`${f} not modified in last 30s (age=${Math.round(ageMs/1000)}s)`, ageMs > 30_000);
    }
  }
  check("real queue file was not created during tests", !existsSync(join(TMP_DIR, "review-queue.json")) || statSync(join(TMP_DIR, "review-queue.json")).mtimeMs < Date.now() - 30_000);
}

// ─── Cleanup ─────────────────────────────────────────────────

for (const f of tempFiles) {
  if (existsSync(f)) unlinkSync(f);
}

console.log("\n✅ All R1–R10 review-cli tests passed\n");
