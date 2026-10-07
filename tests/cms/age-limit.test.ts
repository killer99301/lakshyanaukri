// ═══════════════════════════════════════════════════════════
// Age limit: the write path, including a range per post
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  AL01  an age limit is tidied and saved as Pending with a revision
//  AL02  post-wise ranges are kept; the overall range is never derived from them
//  AL03  bad ages, dates, relaxations and post rows are rejected with a plain reason
//  AL04  an age limit needs an overall range or post-wise rows
//  AL05  the age checker answers for the chosen post's own range
//  AL06  date-of-birth windows are kept as printed and no ages are worked out
//  AL07  the age checker compares the date of birth with the window, both ends included
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import { cleanAge } from "@/lib/cms/record-ops";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { checkAge } from "@/lib/eligibility";

const ADMIN = randomUUID();
const pending = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });

function makeRecord(): RecruitmentRecord {
  return {
    id: randomUUID(),
    slug: "test-2026",
    draftState: "DRAFT",
    recordRevision: "abc",
    identity: { organizationId: "rrb", organizationName: "RRB", recruitmentYear: 2026, title: pending("Test 2026") },
    dates: {},
    vacancies: {},
    financial: {},
    links: [],
    documents: [],
    lifecycle: { status: "DRAFT", conflicts: [], events: [] },
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// RRB Paramedical CEN 05/2026: a different range for each post, counted on 1 Jan 2027.
const PARAMEDICAL = {
  min: 18,
  max: 40,
  asOf: "2027-01-01",
  relaxations: [
    { category: "  SC/ST ", years: 5 },
    { category: "OBC (Non-Creamy Layer)", years: 3 },
    { category: "PwBD - UR/EWS", years: 10 },
    { category: "Ex-servicemen", text: "3 years after deduction of service" },
  ],
  postWise: [
    { post: "Nursing Superintendent", min: 20, max: 40 },
    { post: " Pharmacist  (Entry Grade) ", min: 20, max: 35 },
    { post: "Lab Assistant Gr. II", min: 18, max: 33 },
  ],
};

suite("Age limit write path");

test("AL01 an age limit is tidied and saved as Pending with a revision", () => {
  const { record, revision } = routeFieldUpdate(makeRecord(), "age", pending({ min: 18, max: 27, asOf: "2026-06-01", relaxations: [] }), ADMIN, "Edited age limit");
  assert.deepEqual(record.age?.value, { min: 18, max: 27, asOf: "2026-06-01", relaxations: [] });
  assert.equal(record.age?.status, "PENDING");
  assert.equal(revision.fieldPath, "age");
});

test("AL02 post-wise ranges are kept; the overall range is never derived from them", () => {
  const cleaned = cleanAge(PARAMEDICAL);
  assert.equal(cleaned.min, 18);
  assert.equal(cleaned.max, 40);
  assert.deepEqual(cleaned.postWise, [
    { post: "Nursing Superintendent", min: 20, max: 40 },
    { post: "Pharmacist (Entry Grade)", min: 20, max: 35 },
    { post: "Lab Assistant Gr. II", min: 18, max: 33 },
  ]);
  assert.equal(cleaned.relaxations[0].category, "SC/ST");
  assert.deepEqual(cleaned.relaxations[3], { category: "Ex-servicemen", text: "3 years after deduction of service" });
  // Post rows alone are a valid age limit, and no overall range is invented for them.
  const onlyPosts = cleanAge({ relaxations: [], postWise: [{ post: "Navik", min: 18, max: 22 }] });
  assert.equal(onlyPosts.min, undefined);
  assert.equal(onlyPosts.max, undefined);
});

test("AL03 bad ages, dates, relaxations and post rows are rejected with a plain reason", () => {
  assert.throws(() => cleanAge({ min: 5, max: 27, relaxations: [] }), /between 14 and 70/);
  assert.throws(() => cleanAge({ min: 18, max: 27.5, relaxations: [] }), /whole number/);
  assert.throws(() => cleanAge({ min: 30, max: 27, relaxations: [] }), /above the maximum/);
  assert.throws(() => cleanAge({ min: 18, max: 27, asOf: "01-06-2026", relaxations: [] }), /real date/);
  assert.throws(() => cleanAge({ min: 18, max: 27, asOf: "2026-02-30", relaxations: [] }), /real date/);
  assert.throws(() => cleanAge({ min: 18, max: 27, relaxations: [{ category: "", years: 5 }] }), /needs a category/);
  assert.throws(() => cleanAge({ min: 18, max: 27, relaxations: [{ category: "OBC" }] }), /number of years or a short note/);
  assert.throws(() => cleanAge({ min: 18, max: 27, relaxations: [], postWise: [{ post: "Clerk" }] }), /needs a minimum or maximum/);
  assert.throws(() => cleanAge({ min: 18, max: 27, relaxations: [], postWise: [{ post: "Clerk", min: 40, max: 30 }] }), /above the maximum/);
  assert.throws(() => cleanAge("18 to 27"), /must be an age limit/);
});

test("AL04 an age limit needs an overall range or post-wise rows", () => {
  assert.throws(() => cleanAge({ asOf: "2026-06-01", relaxations: [{ category: "SC/ST", years: 5 }] }), /minimum or maximum age, a date-of-birth range, or the ages post by post/);
});

test("AL05 the age checker answers for the chosen post's own range", () => {
  const age = cleanAge(PARAMEDICAL);
  const base = { asOf: age.asOf, relaxation: age.relaxations };
  // Born 1 Jan 1990: 37 on the cut-off date. Fine for Nursing Superintendent (20–40),
  // too old for Pharmacist (20–35), and the widest range must not hide that.
  const nursing = age.postWise![0];
  const pharmacist = age.postWise![1];
  assert.equal(checkAge({ ...base, min: nursing.min, max: nursing.max }, "1990-01-01", "GEN", false).verdict, "WITHIN");
  assert.equal(checkAge({ ...base, min: pharmacist.min, max: pharmacist.max }, "1990-01-01", "GEN", false).verdict, "TOO_OLD");
  assert.equal(checkAge({ ...base, min: pharmacist.min, max: pharmacist.max }, "1990-01-01", "SC", false).verdict, "WITHIN_RELAXED");
});

// Indian Coast Guard CGEPT 01/2027: the notice prints date-of-birth windows, not ages.
const COAST_GUARD = {
  relaxations: [{ category: "OBC", years: 3 }, { category: "SC/ST", years: 5 }],
  postWise: [
    { post: "Navik (GD)", bornFrom: "2005-11-01", bornTo: "2009-05-01" },
    { post: "Hygienist-I", bornFrom: "2002-11-01", bornTo: "2009-10-01" },
  ],
};

test("AL06 date-of-birth windows are kept as printed and no ages are worked out", () => {
  const cleaned = cleanAge(COAST_GUARD);
  assert.deepEqual(cleaned.postWise, COAST_GUARD.postWise);
  assert.equal(cleaned.min, undefined);
  assert.equal(cleaned.max, undefined);
  assert.equal(cleaned.asOf, undefined);
  const whole = cleanAge({ bornFrom: "2000-01-02", bornTo: "2008-01-01", relaxations: [] });
  assert.equal(whole.bornFrom, "2000-01-02");
  assert.throws(() => cleanAge({ bornFrom: "2009-01-01", bornTo: "2005-01-01", relaxations: [] }), /earliest date of birth is after the latest/);
  assert.throws(() => cleanAge({ relaxations: [], postWise: [{ post: "Navik", bornFrom: "01-11-2005" }] }), /real date/);
});

test("AL07 the age checker compares the date of birth with the window, both ends included", () => {
  const navik = { ...COAST_GUARD.postWise[0], relaxation: COAST_GUARD.relaxations };
  assert.equal(checkAge(navik, "2005-11-01", "GEN", false).verdict, "WITHIN");
  assert.equal(checkAge(navik, "2009-05-01", "GEN", false).verdict, "WITHIN");
  assert.equal(checkAge(navik, "2009-05-02", "GEN", false).verdict, "TOO_YOUNG");
  assert.equal(checkAge(navik, "2005-10-31", "GEN", false).verdict, "TOO_OLD");
  // A relaxation moves only the earliest date back: 3 years for OBC, 5 for SC/ST.
  assert.equal(checkAge(navik, "2002-11-01", "OBC", false).verdict, "WITHIN_RELAXED");
  assert.equal(checkAge(navik, "2002-10-31", "OBC", false).verdict, "TOO_OLD");
  assert.equal(checkAge(navik, "2000-11-01", "SC", false).verdict, "WITHIN_RELAXED");
  assert.equal(checkAge(navik, "2000-10-31", "ST", false).verdict, "TOO_OLD");
  // No "counted on" date is needed, and no age is reported without one.
  assert.equal(checkAge(navik, "2007-01-01", "GEN", false).age, undefined);
});
