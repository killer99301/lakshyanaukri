// ═══════════════════════════════════════════════════════════
// "Which jobs can I apply for?" — one visitor against every open job
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  EF01  qualification on the school-and-degree ladder
//  EF02  ITI and Diploma are not on the ladder: never assumed to count, never assumed not to
//  EF03  age for a job with one range uses the job page's own check
//  EF04  ages set post by post: one fitting post is enough; none fitting rules the job out
//  EF05  no age limit, or no cut-off date, is "check", never "eligible"
//  EF06  eligible needs both parts; either part failing rules the job out
//  EF07  results are grouped eligible → check → not eligible, soonest closing first
//  EF08  category and disability change the answer only through relaxations on record
//  EF09  date of birth is checked before anything is worked out
//  EF10  private jobs and internships have no age rule, so only the qualification decides
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { AgeLimit, Qualification } from "@/types";
import {
  ageFor, assessJob, dobProblem, findEligibleJobs, qualificationFor,
  type FinderInput, type FinderJob,
} from "@/lib/eligibility-finder";

const me = (over: Partial<FinderInput> = {}): FinderInput => ({ dobIso: "2000-06-15", category: "GEN", pwbd: false, qualification: "Graduate", ...over });
const job = (over: Partial<FinderJob> = {}): FinderJob => ({
  kind: "government", slug: "job", title: "Job", organizationName: "Org", qualification: "Graduate", closeDate: "2026-11-30", openDate: "2026-10-01",
  ageLimit: { min: 18, max: 27, asOf: "2026-08-01", relaxation: [{ category: "SC/ST", years: 5 }, { category: "OBC", years: 3 }, { category: "PwBD", years: 10 }] },
  ...over,
});

suite("Eligibility finder: qualification");

test("EF01 qualification on the school-and-degree ladder", () => {
  const v = (needed: Qualification, held: Qualification) => qualificationFor(needed, held).verdict;
  assert.equal(v("10th Pass", "10th Pass"), "OK");
  assert.equal(v("10th Pass", "Post Graduate"), "OK");
  assert.equal(v("12th Pass", "10th Pass"), "NO");
  assert.equal(v("12th Pass", "Graduate"), "OK");
  assert.equal(v("Graduate", "12th Pass"), "NO");
  assert.equal(v("Graduate", "Post Graduate"), "OK");
  assert.equal(v("Post Graduate", "Graduate"), "NO");
  assert.match(qualificationFor("Graduate", "12th Pass").note, /asks for a degree/);
  assert.match(qualificationFor("12th Pass", "Graduate").note, /more than the 12th pass asked for/);
});

test("EF02 ITI and Diploma are not on the ladder: never assumed to count, never assumed not to", () => {
  const v = (needed: Qualification, held: Qualification) => qualificationFor(needed, held).verdict;
  // Holding one: both have passed 10th; neither is a degree.
  assert.equal(v("10th Pass", "ITI"), "OK");
  assert.equal(v("10th Pass", "Diploma"), "OK");
  assert.equal(v("12th Pass", "Diploma"), "CHECK");
  assert.equal(v("12th Pass", "ITI"), "CHECK");
  assert.equal(v("Graduate", "Diploma"), "NO");
  assert.equal(v("Post Graduate", "ITI"), "NO");
  // A job asking for one: only an exact match is a yes; anyone else may hold it too.
  assert.equal(v("ITI", "ITI"), "OK");
  assert.equal(v("Diploma", "Diploma"), "OK");
  assert.equal(v("ITI", "Graduate"), "CHECK");
  assert.equal(v("Diploma", "ITI"), "CHECK");
  assert.equal(v("ITI", "10th Pass"), "CHECK");
});

suite("Eligibility finder: age");

test("EF03 age for a job with one range uses the job page's own check", () => {
  const limit = job().ageLimit;
  assert.equal(ageFor(limit, me({ dobIso: "2000-06-15" })).verdict, "OK");           // 26
  assert.equal(ageFor(limit, me({ dobIso: "2009-01-01" })).verdict, "NO");           // 17
  assert.equal(ageFor(limit, me({ dobIso: "1995-01-01" })).verdict, "NO");           // 31
  // Turning 27 on the cut-off date: not "within".
  assert.equal(ageFor(limit, me({ dobIso: "1999-08-01" })).verdict, "CHECK");
  assert.match(ageFor(limit, me({ dobIso: "2009-01-01" })).note, /below the minimum age/);
});

const POSTS: AgeLimit = {
  asOf: "2027-01-01",
  relaxation: [{ category: "SC/ST", years: 5 }],
  postWise: [
    { post: "Nursing Superintendent", min: 20, max: 40 },
    { post: "Pharmacist", min: 20, max: 35 },
    { post: "Lab Assistant", min: 18, max: 33 },
  ],
};

test("EF04 ages set post by post: one fitting post is enough; none fitting rules the job out", () => {
  const some = ageFor(POSTS, me({ dobIso: "1990-01-02" }));   // 36 on the cut-off date
  assert.equal(some.verdict, "OK");
  assert.equal(some.note, "Your age is within the limit for 1 of 3 posts: Nursing Superintendent.");
  assert.equal(ageFor(POSTS, me({ dobIso: "2000-01-01" })).note, "Your age is within the limit for every post.");
  assert.equal(ageFor(POSTS, me({ dobIso: "1980-01-01" })).verdict, "NO");
  assert.match(ageFor(POSTS, me({ dobIso: "2010-01-01" })).note, /below the minimum age for every post/);
  // Date-of-birth windows per post work the same way.
  const windows: AgeLimit = { postWise: [{ post: "Navik (GD)", bornFrom: "2005-11-01", bornTo: "2009-05-01" }, { post: "Yantrik", bornFrom: "2002-11-01", bornTo: "2009-10-01" }] };
  assert.equal(ageFor(windows, me({ dobIso: "2004-01-01" })).note, "Your age is within the limit for 1 of 2 posts: Yantrik.");
  assert.equal(ageFor(windows, me({ dobIso: "2000-01-01" })).verdict, "NO");
});

test("EF05 no age limit, or no cut-off date, is \"check\", never \"eligible\"", () => {
  assert.equal(ageFor(undefined, me()).verdict, "CHECK");
  assert.equal(ageFor({ min: 18, max: 37 }, me()).verdict, "CHECK");
  assert.match(ageFor({ min: 18, max: 37 }, me()).note, /cut-off date/);
  assert.equal(ageFor({ relaxation: [] }, me()).verdict, "CHECK");
  // Posts with ranges but no cut-off date: nothing can be confirmed.
  assert.equal(ageFor({ postWise: [{ post: "Clerk", min: 18, max: 27 }] }, me()).verdict, "CHECK");
});

suite("Eligibility finder: the answer");

test("EF06 eligible needs both parts; either part failing rules the job out", () => {
  assert.equal(assessJob(job(), me()).verdict, "ELIGIBLE");
  assert.equal(assessJob(job(), me({ qualification: "12th Pass" })).verdict, "NOT_ELIGIBLE");
  assert.equal(assessJob(job(), me({ dobIso: "1990-01-01" })).verdict, "NOT_ELIGIBLE");
  assert.equal(assessJob(job({ ageLimit: undefined }), me()).verdict, "CHECK");
  assert.equal(assessJob(job({ qualification: "ITI" }), me()).verdict, "CHECK");
  // A firm "no" on one part wins over a "check" on the other.
  assert.equal(assessJob(job({ ageLimit: undefined }), me({ qualification: "12th Pass" })).verdict, "NOT_ELIGIBLE");
});

test("EF07 results are grouped eligible → check → not eligible, soonest closing first", () => {
  const jobs = [
    job({ slug: "late", title: "Late", closeDate: "2026-12-20" }),
    job({ slug: "pg", title: "PG only", qualification: "Post Graduate" }),
    job({ slug: "unknown", title: "No age on record", ageLimit: undefined, closeDate: "2026-10-20" }),
    job({ slug: "soon", title: "Soon", closeDate: "2026-10-25" }),
    job({ slug: "undated", title: "No last date", closeDate: "" }),
  ];
  const out = findEligibleJobs(jobs, me());
  assert.deepEqual(out.map((r) => `${r.verdict}:${r.job.slug}`), ["ELIGIBLE:soon", "ELIGIBLE:late", "ELIGIBLE:undated", "CHECK:unknown", "NOT_ELIGIBLE:pg"]);
  assert.deepEqual(findEligibleJobs([], me()), []);
});

test("EF08 category and disability change the answer only through relaxations on record", () => {
  const older = { dobIso: "1996-01-01" };   // 30 on the cut-off date; limit is 27
  assert.equal(assessJob(job(), me(older)).verdict, "NOT_ELIGIBLE");
  // OBC: 27 + 3 = 30, and this visitor has turned 30. Not a yes; the notice decides.
  assert.equal(assessJob(job(), me({ ...older, category: "OBC" })).verdict, "CHECK");
  assert.equal(assessJob(job(), me({ dobIso: "1996-08-02", category: "OBC" })).verdict, "ELIGIBLE");   // still 29 on the cut-off date
  assert.equal(assessJob(job(), me({ ...older, category: "SC" })).verdict, "ELIGIBLE");
  assert.match(assessJob(job(), me({ ...older, category: "SC" })).age.note, /5-year relaxation/);
  assert.equal(assessJob(job(), me({ ...older, pwbd: true })).verdict, "ELIGIBLE");
  // EWS has no row on this record, so it gets nothing.
  assert.equal(assessJob(job(), me({ ...older, category: "EWS" })).verdict, "NOT_ELIGIBLE");
});

test("EF10 private jobs and internships have no age rule, so only the qualification decides", () => {
  const privateJob = job({ kind: "private", ageLimit: undefined, qualification: "Graduate" });
  const fit = assessJob(privateJob, me({ dobIso: "1975-01-01" }));
  assert.equal(fit.verdict, "ELIGIBLE");
  assert.equal(fit.age.note, "No age limit is stated for this job.");
  assert.equal(assessJob(privateJob, me({ qualification: "12th Pass" })).verdict, "NOT_ELIGIBLE");
  assert.equal(assessJob(job({ kind: "internship", ageLimit: undefined }), me()).age.note, "No age limit is stated for this internship.");
  // The same missing limit on a government recruitment is unfinished data, not "no rule".
  assert.equal(assessJob(job({ ageLimit: undefined }), me()).verdict, "CHECK");
});

test("EF09 date of birth is checked before anything is worked out", () => {
  const today = "2026-10-12";
  assert.equal(dobProblem("2000-06-15", today), null);
  assert.equal(dobProblem("", today), "Enter your date of birth.");
  assert.equal(dobProblem("15-06-2000", today), "Enter your date of birth.");
  assert.equal(dobProblem("2000-02-30", today), "That is not a real date.");
  assert.equal(dobProblem("2026-10-12", today), "Your date of birth must be in the past.");
  assert.equal(dobProblem("2027-01-01", today), "Your date of birth must be in the past.");
  assert.equal(dobProblem("2020-01-01", today), "Check the year of your date of birth.");
  assert.equal(dobProblem("1930-01-01", today), "Check the year of your date of birth.");
});
