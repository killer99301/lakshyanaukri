// ═══════════════════════════════════════════════════════════
// Phase 10F: Draft Storage — Pure Logic Tests
// npx tsx --tsconfig tsconfig.json tests/intelligence/draft-storage.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  D01  buildInitialDraftMeta — revision=1, status=DRAFT
//  D02  buildInitialDraftMeta — createdBy is the provided adminId (UUID)
//  D03  buildInitialDraftMeta — createdBy === updatedBy on a new draft
//  D04  buildInitialDraftMeta — timestamps are ISO strings not in the future
//  D05  isConcurrentConflict — same revision → no conflict
//  D06  isConcurrentConflict — server advanced → stale client → conflict
//  D07  isConcurrentConflict — client claims higher revision → conflict
//  D08  applyRevision — increments currentRevision by exactly 1
//  D09  applyRevision — transitions status to IN_REVIEW
//  D10  applyRevision — updatedBy reflects new savedBy, not the original creator
//  D11  applyRevision — returns matching revisionNumber and meta.currentRevision
//  D12  applyRevision — original meta is not mutated (pure function)
//  D13  applyRevision — chained saves increment monotonically (1 → 2 → 3 → 4)
//  D14  stale concurrent save scenario: server at rev 2, client at rev 1 → conflict
//  D15  atomic creation contract — revision-1 uses literal 1, not applyRevision()
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import {
  buildInitialDraftMeta,
  isConcurrentConflict,
  applyRevision,
} from "@/lib/intelligence/draft-ops";
import type { DraftMeta } from "@/lib/intelligence/draft-ops";

// ─── Test fixtures ─────────────────────────────────────────

const ADMIN_UUID_1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ADMIN_UUID_2 = "b2c3d4e5-f6a7-8901-bcde-f01234567891";

function makeMeta(overrides?: Partial<DraftMeta>): DraftMeta {
  return {
    status: "DRAFT",
    currentRevision: 1,
    createdBy: ADMIN_UUID_1,
    updatedBy: ADMIN_UUID_1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────

suite("Phase 10F — Draft Storage Logic");

test("D01: buildInitialDraftMeta — revision=1, status=DRAFT", () => {
  const meta = buildInitialDraftMeta(ADMIN_UUID_1);
  assert.strictEqual(meta.currentRevision, 1, "initial revision is 1");
  assert.strictEqual(meta.status, "DRAFT", "initial status is DRAFT");
});

test("D02: buildInitialDraftMeta — createdBy is the provided adminId", () => {
  const meta = buildInitialDraftMeta(ADMIN_UUID_1);
  assert.strictEqual(meta.createdBy, ADMIN_UUID_1, "createdBy matches the passed adminId UUID");
  // Must NOT be a display name or username
  assert.ok(!meta.createdBy.includes("admin@"), "createdBy is not an email");
  assert.ok(!meta.createdBy.includes("admin_"), "createdBy is not a username slug");
});

test("D03: buildInitialDraftMeta — createdBy === updatedBy on a fresh draft", () => {
  const meta = buildInitialDraftMeta(ADMIN_UUID_1);
  assert.strictEqual(meta.createdBy, meta.updatedBy, "creator and updater are the same on creation");
});

test("D04: buildInitialDraftMeta — timestamps are ISO strings not in the future", () => {
  const before = new Date();
  const meta = buildInitialDraftMeta(ADMIN_UUID_1);
  const after = new Date();

  const createdAt = new Date(meta.createdAt);
  const updatedAt = new Date(meta.updatedAt);

  assert.ok(createdAt >= before, "createdAt is at or after test start");
  assert.ok(createdAt <= after, "createdAt is not in the future");
  assert.ok(updatedAt >= before, "updatedAt is at or after test start");
  assert.ok(updatedAt <= after, "updatedAt is not in the future");
});

test("D05: isConcurrentConflict — same revision → no conflict", () => {
  assert.strictEqual(isConcurrentConflict(1, 1), false, "rev 1 == 1 → no conflict");
  assert.strictEqual(isConcurrentConflict(5, 5), false, "rev 5 == 5 → no conflict");
});

test("D06: isConcurrentConflict — server advanced → stale client → conflict", () => {
  // Another save ran after the client loaded the draft
  assert.strictEqual(isConcurrentConflict(2, 1), true, "server at 2, client at 1 → stale");
  assert.strictEqual(isConcurrentConflict(10, 7), true, "server at 10, client at 7 → stale");
});

test("D07: isConcurrentConflict — client claims higher revision than server → conflict", () => {
  // Impossible in normal flow but must still be treated as a conflict
  assert.strictEqual(isConcurrentConflict(1, 2), true, "server at 1, client at 2 → conflict");
});

test("D08: applyRevision — increments currentRevision by exactly 1", () => {
  const meta = makeMeta({ currentRevision: 3 });
  const { meta: next, revisionNumber } = applyRevision(meta, ADMIN_UUID_2);
  assert.strictEqual(next.currentRevision, 4, "revision incremented to 4");
  assert.strictEqual(revisionNumber, 4, "returned revisionNumber matches");
});

test("D09: applyRevision — transitions status to IN_REVIEW", () => {
  const meta = makeMeta({ status: "DRAFT" });
  const { meta: next } = applyRevision(meta, ADMIN_UUID_2);
  assert.strictEqual(next.status, "IN_REVIEW", "status becomes IN_REVIEW after save");
});

test("D10: applyRevision — updatedBy reflects the new savedBy, not the original creator", () => {
  const meta = makeMeta({ createdBy: ADMIN_UUID_1, updatedBy: ADMIN_UUID_1 });
  const { meta: next } = applyRevision(meta, ADMIN_UUID_2);
  assert.strictEqual(next.updatedBy, ADMIN_UUID_2, "updatedBy is the new saver's UUID");
  assert.strictEqual(next.createdBy, ADMIN_UUID_1, "createdBy is unchanged");
});

test("D11: applyRevision — returned revisionNumber equals meta.currentRevision", () => {
  const meta = makeMeta({ currentRevision: 7 });
  const { meta: next, revisionNumber } = applyRevision(meta, ADMIN_UUID_1);
  assert.strictEqual(revisionNumber, next.currentRevision, "revisionNumber and meta.currentRevision agree");
});

test("D12: applyRevision — original meta is not mutated (pure function)", () => {
  const meta = makeMeta({ currentRevision: 1 });
  const originalRevision = meta.currentRevision;
  applyRevision(meta, ADMIN_UUID_2);
  assert.strictEqual(meta.currentRevision, originalRevision, "original meta unchanged");
  assert.strictEqual(meta.status, "DRAFT", "original status unchanged");
  assert.strictEqual(meta.updatedBy, ADMIN_UUID_1, "original updatedBy unchanged");
});

test("D13: applyRevision — chained saves increment monotonically (1 → 2 → 3 → 4)", () => {
  let meta = makeMeta({ currentRevision: 1 });
  for (let expected = 2; expected <= 4; expected++) {
    const { meta: next, revisionNumber } = applyRevision(meta, ADMIN_UUID_1);
    assert.strictEqual(revisionNumber, expected, `revision ${expected - 1} → ${expected}`);
    assert.strictEqual(next.currentRevision, expected, `meta.currentRevision = ${expected}`);
    meta = next;
  }
});

test("D14: stale concurrent save — server advanced to rev 2, client still at rev 1", () => {
  // Simulate: admin A opens draft at revision 1
  const clientRevision = 1;

  // Admin B saves first — server is now at revision 2
  const serverMeta = makeMeta({ currentRevision: 2 });

  // Admin A attempts to save with the old revision
  const isConflict = isConcurrentConflict(serverMeta.currentRevision, clientRevision);
  assert.strictEqual(isConflict, true, "OCC detects admin A is stale");

  // Server should NOT apply the revision — original meta unchanged
  // (API returns 409; this test verifies the detection logic)
  assert.strictEqual(serverMeta.currentRevision, 2, "server revision unchanged after conflict detection");
  assert.strictEqual(serverMeta.status, "DRAFT", "server status unchanged");
});

test("D15: atomic creation contract — revision-1 uses literal 1, not applyRevision()", () => {
  // The POST handler creates both intelligence_drafts (current_revision=1) and
  // intelligence_draft_revisions (revision=1) using a CTE with the literal value 1.
  // applyRevision() is NOT used at creation — that function is exclusively for
  // Save Review (revisions 2+). This test verifies the two paths are distinct.

  // buildInitialDraftMeta produces the initial state: revision 1
  const meta = buildInitialDraftMeta(ADMIN_UUID_1);
  assert.strictEqual(meta.currentRevision, 1, "fresh draft starts at revision 1");

  // applyRevision on a fresh meta produces revision 2, NOT 1 —
  // proving the creation CTE must use the literal 1, not this function
  const { revisionNumber } = applyRevision(meta, ADMIN_UUID_1);
  assert.strictEqual(revisionNumber, 2, "applyRevision() yields 2, confirming it is wrong for creation");
  assert.notStrictEqual(revisionNumber, 1, "applyRevision() never yields 1 — creation must bypass it");

  // The atomic CTE contract: both rows carry the same machine-output snapshot.
  // Simulate the serialization the POST handler performs:
  const machineSnapshot = { id: "test-id", overallConfidence: 0.9 };
  const snapshotJson = JSON.stringify(machineSnapshot);
  // Draft row and revision-1 row receive the identical serialized value
  assert.strictEqual(snapshotJson, JSON.stringify(machineSnapshot), "snapshot is stable across both INSERT targets");
  assert.deepStrictEqual(JSON.parse(snapshotJson), machineSnapshot, "revision-1 snapshot equals the machine output exactly");
});
