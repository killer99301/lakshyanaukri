// ═══════════════════════════════════════════════════════════
// "Check your age": age on the cut-off date, and the verdict
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  AG01  age in completed years, months and days, across month and leap-year edges
//  AG02  bad or future dates of birth give no age
//  EL01  inside the limits; below the minimum; no upper limit
//  EL02  exactly the upper age on the cut-off date is within
//  EL03  completed the upper age but not the next birthday → check the notice
//  EL04  category relaxation is used only for that category, and only if printed
//  EL05  disability rows apply only when ticked; category-specific row preferred
//  EL06  ex-servicemen and similar rows are never applied
//  EL07  no age limit or no cut-off date → no answer, never "as of today"
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { AgeLimit } from "@/types";
import { ageOn, checkAge, describeAge, findRelaxation } from "@/lib/eligibility";

// DSSSB-style: 18 to 27 as on 1 June 2026.
const LIMIT: AgeLimit = {
  min: 18,
  max: 27,
  asOf: "2026-06-01",
  relaxation: [
    { category: "SC/ST", years: 5 },
    { category: "OBC (Non-Creamy Layer)", years: 3 },
    { category: "PwBD + UR/EWS", years: 10 },
    { category: "PwBD + SC/ST", years: 15 },
    { category: "Ex-servicemen", years: 10 },
    { category: "Departmental candidates", text: "as per rules" },
  ],
};

suite("Age on the cut-off date");

test("AG01 age in completed years, months and days, across month and leap-year edges", () => {
  assert.deepEqual(ageOn("2000-06-01", "2026-06-01"), { years: 26, months: 0, days: 0 });
  assert.deepEqual(ageOn("2000-06-02", "2026-06-01"), { years: 25, months: 11, days: 30 });
  assert.deepEqual(ageOn("2000-01-31", "2026-03-01"), { years: 26, months: 1, days: 1 });
  assert.deepEqual(ageOn("2004-02-29", "2026-02-28"), { years: 21, months: 11, days: 30 });
  assert.deepEqual(ageOn("2004-02-29", "2026-03-01"), { years: 22, months: 0, days: 1 });
  assert.equal(describeAge({ years: 26, months: 1, days: 0 }), "26 years, 1 month, 0 days");
});

test("AG02 bad or future dates of birth give no age", () => {
  assert.equal(ageOn("2027-01-01", "2026-06-01"), null);
  assert.equal(ageOn("2000-02-30", "2026-06-01"), null);
  assert.equal(ageOn("01-06-2000", "2026-06-01"), null);
  assert.equal(ageOn("2000-06-01", "June 2026"), null);
});

suite("Age verdict");

test("EL01 inside the limits; below the minimum; no upper limit", () => {
  assert.equal(checkAge(LIMIT, "2003-05-10", "GEN", false).verdict, "WITHIN");
  assert.equal(checkAge(LIMIT, "2008-06-02", "GEN", false).verdict, "TOO_YOUNG");
  assert.equal(checkAge({ min: 21, asOf: "2026-06-01" }, "1970-01-01", "GEN", false).verdict, "WITHIN");
});

test("EL02 exactly the upper age on the cut-off date is within", () => {
  const out = checkAge(LIMIT, "1999-06-01", "GEN", false);
  assert.equal(out.verdict, "WITHIN");
  assert.deepEqual(out.age, { years: 27, months: 0, days: 0 });
});

test("EL03 completed the upper age but not the next birthday → check the notice", () => {
  assert.equal(checkAge(LIMIT, "1999-01-15", "GEN", false).verdict, "CHECK_NOTICE");
  assert.equal(checkAge(LIMIT, "1998-05-31", "GEN", false).verdict, "TOO_OLD");
  // With relaxation the same edge moves to the relaxed limit.
  const sc = checkAge(LIMIT, "1994-01-15", "SC", false);
  assert.equal(sc.verdict, "CHECK_NOTICE");
  assert.equal(sc.effectiveMax, 32);
});

test("EL04 category relaxation is used only for that category, and only if printed", () => {
  const sc = checkAge(LIMIT, "1996-01-01", "SC", false);
  assert.equal(sc.verdict, "WITHIN_RELAXED");
  assert.equal(sc.relaxation?.category, "SC/ST");
  assert.equal(sc.effectiveMax, 32);
  assert.equal(checkAge(LIMIT, "1996-01-01", "ST", false).verdict, "WITHIN_RELAXED");
  assert.equal(checkAge(LIMIT, "1997-01-01", "OBC", false).effectiveMax, 30);
  assert.equal(checkAge(LIMIT, "1996-01-01", "OBC", false).verdict, "CHECK_NOTICE");
  assert.equal(checkAge(LIMIT, "1996-01-01", "GEN", false).verdict, "TOO_OLD");
  // EWS has no row here, so it gets nothing.
  assert.equal(checkAge(LIMIT, "1996-01-01", "EWS", false).verdict, "TOO_OLD");
  assert.equal(findRelaxation(LIMIT.relaxation, "EWS", false), undefined);
});

test("EL05 disability rows apply only when ticked; category-specific row preferred", () => {
  assert.equal(findRelaxation(LIMIT.relaxation, "GEN", true)?.years, 10);
  assert.equal(findRelaxation(LIMIT.relaxation, "EWS", true)?.years, 10);
  assert.equal(findRelaxation(LIMIT.relaxation, "SC", true)?.years, 15);
  // No "PwBD + OBC" row and no plain PwBD row here: nothing is guessed.
  assert.equal(findRelaxation(LIMIT.relaxation, "OBC", true), undefined);
  // A plain PwBD row applies to every category, and never without the tick.
  const plain = [{ category: "SC/ST", years: 5 }, { category: "Person with Benchmark Disability (PwBD)", years: 10 }];
  assert.equal(findRelaxation(plain, "OBC", true)?.years, 10);
  assert.equal(findRelaxation(plain, "SC", true)?.years, 10);
  assert.equal(findRelaxation(plain, "GEN", false), undefined);
  assert.equal(checkAge(LIMIT, "1990-01-01", "GEN", true).verdict, "WITHIN_RELAXED");
});

test("EL06 ex-servicemen and similar rows are never applied", () => {
  const rows = [{ category: "Ex-servicemen (General)", years: 10 }, { category: "Women (SC)", years: 8 }, { category: "OBC", text: "as per rules" }];
  assert.equal(findRelaxation(rows, "GEN", false), undefined);
  assert.equal(findRelaxation(rows, "SC", false), undefined);
  assert.equal(findRelaxation(rows, "OBC", false), undefined);
});

test("EL07 no age limit or no cut-off date → no answer, never \"as of today\"", () => {
  assert.equal(checkAge(undefined, "2000-01-01", "GEN", false).verdict, "UNKNOWN");
  assert.equal(checkAge({ relaxation: [] }, "2000-01-01", "GEN", false).verdict, "UNKNOWN");
  const noDate = checkAge({ min: 18, max: 27 }, "2000-01-01", "GEN", false);
  assert.equal(noDate.verdict, "UNKNOWN");
  assert.match(noDate.reason ?? "", /cut-off date/);
  assert.equal(checkAge(LIMIT, "2030-01-01", "GEN", false).verdict, "UNKNOWN");
});
