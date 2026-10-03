// ═══════════════════════════════════════════════════════════
// Phase E: Intake Duplicate Handling — unit tests
//
// All tests are pure (no DB, no network).
//
// Coverage:
//  E01  exact notification number match → notification_number
//  E02  different notification numbers, same org+year → no match
//  E03  draft missing notification number → org_year fallback
//  E04  CMS record missing notification number → org_year fallback
//  E05  different organization, same year → no match
//  E06  same org, different year → no match
//  E07  case-insensitive notification number comparison
//  E08  whitespace trimming in notification number
//  E09  empty / null normalizes to undefined
//  E10  notification number present on draft; CMS record also present (mismatch) → no match
//  E11  no org / no year on draft → no weak fallback fires
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { computeDuplicateMatch, normalizeNotifNum } from "@/lib/cms/duplicate-detector";

// ─── E01–E06: computeDuplicateMatch() core logic ──────────

suite("E01–E06: computeDuplicateMatch() core logic");

test("E01: same notification number → notification_number match", () => {
  const result = computeDuplicateMatch(
    { notifNum: "CEN-01/2026", orgId: "ssc", year: 2026 },
    { notifNum: "CEN-01/2026", orgId: "ssc", year: 2026 },
  );
  assert.strictEqual(result, "notification_number");
});

test("E02: different notification numbers, same org+year → no match (requirement 6)", () => {
  const result = computeDuplicateMatch(
    { notifNum: "CEN-01/2026", orgId: "ssc", year: 2026 },
    { notifNum: "CEN-02/2026", orgId: "ssc", year: 2026 },
  );
  assert.strictEqual(result, null);
});

test("E03: draft missing notification number → org_year fallback", () => {
  const result = computeDuplicateMatch(
    { notifNum: undefined, orgId: "rrb", year: 2026 },
    { notifNum: undefined, orgId: "rrb", year: 2026 },
  );
  assert.strictEqual(result, "org_year");
});

test("E04: CMS record missing notification number → org_year fallback", () => {
  const result = computeDuplicateMatch(
    { notifNum: "CEN-01/2026", orgId: "rrb", year: 2026 },
    { notifNum: undefined, orgId: "rrb", year: 2026 },
  );
  assert.strictEqual(result, "org_year");
});

test("E05: different organization, same year → no match", () => {
  const result = computeDuplicateMatch(
    { notifNum: undefined, orgId: "ssc", year: 2026 },
    { notifNum: undefined, orgId: "rrb", year: 2026 },
  );
  assert.strictEqual(result, null);
});

test("E06: same org, different year → no match", () => {
  const result = computeDuplicateMatch(
    { notifNum: undefined, orgId: "ssc", year: 2026 },
    { notifNum: undefined, orgId: "ssc", year: 2025 },
  );
  assert.strictEqual(result, null);
});

// ─── E07–E09: normalizeNotifNum() ────────────────────────

suite("E07–E09: normalizeNotifNum()");

test("E07: normalizes to uppercase", () => {
  assert.strictEqual(normalizeNotifNum("cen-01/2026"), "CEN-01/2026");
});

test("E08: trims leading/trailing whitespace", () => {
  assert.strictEqual(normalizeNotifNum("  CEN-01/2026  "), "CEN-01/2026");
});

test("E09: empty string and null/undefined return undefined", () => {
  assert.strictEqual(normalizeNotifNum(""), undefined);
  assert.strictEqual(normalizeNotifNum(null), undefined);
  assert.strictEqual(normalizeNotifNum(undefined), undefined);
  assert.strictEqual(normalizeNotifNum("   "), undefined);
});

// ─── E10: case-insensitive match ──────────────────────────

suite("E10: case-insensitive notification number match");

test("E10: lower-case draft matches upper-case record", () => {
  const result = computeDuplicateMatch(
    { notifNum: "cen-01/2026", orgId: "ssc", year: 2026 },
    { notifNum: "CEN-01/2026", orgId: "ssc", year: 2026 },
  );
  assert.strictEqual(result, "notification_number");
});

// ─── E11: missing org/year blocks weak fallback ───────────

suite("E11: missing org or year blocks weak fallback");

test("E11a: draft missing orgId → no fallback even for same year", () => {
  const result = computeDuplicateMatch(
    { notifNum: undefined, orgId: undefined, year: 2026 },
    { notifNum: undefined, orgId: "ssc", year: 2026 },
  );
  assert.strictEqual(result, null);
});

test("E11b: draft missing year → no fallback even for same org", () => {
  const result = computeDuplicateMatch(
    { notifNum: undefined, orgId: "ssc", year: undefined },
    { notifNum: undefined, orgId: "ssc", year: 2026 },
  );
  assert.strictEqual(result, null);
});
