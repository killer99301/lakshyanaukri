// ═══════════════════════════════════════════════════════════
// Fees and pay on the public page; eligibility typed as lines
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP. Fee and pay cases run through the same projector
// and adapter the preview and the published page use.
//
//  FP01  pay scale reaches the public job, whether or not any fee is entered
//  FP02  a fee marked "not specified" is shown as such, not dropped
//  FP03  each fee row stands by itself: one filled, one never touched
//  FP04  nothing entered at all → no fee, no pay, section has nothing to show
//  FP05  a pending value is shown like any other value (the page badge marks the job unverified)
//  FP06  a snapshot published before this change still reads correctly
//  EL01  lines are read into posts with their qualifications; spacing is tidied
//  EL02  a line with no "|", no post, or no qualification is reported with its line number
//  EL03  blank lines are skipped and line numbers still match what was typed
//  EL04  a post typed twice is a warning, not an error
//  EL05  details already on a post are kept while its name is unchanged
//  EL06  more than 80 posts is refused
//  CI09  a pasted file missing one heading says which one
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { RecruitmentRecord, ProvenanceField, FinancialInformation } from "@/types/recruitment-record";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { readEligibilityLines } from "@/lib/cms/eligibility-lines";
import { parseContentFile } from "@/lib/cms/content-import";

const pending = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
const verified = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: ["evid-001"], conflict: false, manuallyEdited: false });
const notSpecified = <T,>(): ProvenanceField<T | null> => ({ value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true });

function record(financial: FinancialInformation): RecruitmentRecord {
  return {
    id: "rec-1",
    slug: "rrb-ntpc-ug-2026",
    draftState: "DRAFT",
    recordRevision: "abc",
    identity: { organizationId: "rrb", organizationName: "Railway Recruitment Boards", recruitmentYear: 2026, title: pending("RRB NTPC Undergraduate 2026") },
    dates: {},
    vacancies: {},
    financial,
    links: [],
    documents: [],
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [],
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
}
const publicJob = (financial: FinancialInformation) => snapshotToGovernmentRecruitment(projectForPreview(record(financial)));

suite("Fees and pay on the public page");

test("FP01 pay scale reaches the public job, whether or not any fee is entered", () => {
  const onlyPay = publicJob({ payScale: pending("Pay Matrix Level 2 and Pay Matrix Level 3") });
  assert.equal(onlyPay.payScale, "Pay Matrix Level 2 and Pay Matrix Level 3");
  assert.equal(onlyPay.fee, undefined);
  const both = publicJob({ feeGeneral: verified(500), feeSCST: verified(250), payScale: verified("Level 5") });
  assert.equal(both.payScale, "Level 5");
  assert.equal(both.fee?.rows.length, 2);
});

test("FP02 a fee marked \"not specified\" is shown as such, not dropped", () => {
  // The case from the RRB NTPC entry: fee not specified, pay scale pending.
  const job = publicJob({ feeGeneral: notSpecified<number>(), payScale: pending("Pay Matrix Level 2 and Pay Matrix Level 3") });
  assert.deepEqual(job.fee?.rows, [{ category: "General / OBC", amount: null, note: "Not specified in the notice" }]);
  assert.equal(job.payScale, "Pay Matrix Level 2 and Pay Matrix Level 3");
  const bothGroups = publicJob({ feeGeneral: notSpecified<number>(), feeSCST: notSpecified<number>() });
  assert.deepEqual(bothGroups.fee?.rows.map((r) => r.note), ["Not specified in the notice", "Not specified in the notice"]);
});

test("FP03 each fee row stands by itself: one filled, one never touched", () => {
  const job = publicJob({ feeGeneral: pending(550) });
  assert.deepEqual(job.fee?.rows, [{ category: "General / OBC", amount: 550 }]);
  const mixed = publicJob({ feeGeneral: notSpecified<number>(), feeSCST: pending(0) });
  assert.deepEqual(mixed.fee?.rows, [
    { category: "General / OBC", amount: null, note: "Not specified in the notice" },
    { category: "SC / ST / PwBD", amount: 0 },
  ]);
});

test("FP04 nothing entered at all → no fee, no pay, section has nothing to show", () => {
  const job = publicJob({});
  assert.equal(job.fee, undefined);
  assert.equal(job.payScale, undefined);
  assert.equal(publicJob({ payScale: pending("   ") }).payScale, undefined);
});

test("FP05 a pending value is shown like any other value (the page badge marks the job unverified)", () => {
  assert.deepEqual(publicJob({ feeGeneral: pending(100) }).fee?.rows, publicJob({ feeGeneral: verified(100) }).fee?.rows);
});

test("FP06 a snapshot published before this change still reads correctly", () => {
  const old = projectForPreview(record({ feeGeneral: pending(100), payScale: pending("Level 4") }));
  delete old.financial.feeGeneralNotSpecified;
  delete old.financial.feeSCSTNotSpecified;
  const job = snapshotToGovernmentRecruitment(old);
  assert.deepEqual(job.fee?.rows, [{ category: "General / OBC", amount: 100 }]);
  assert.equal(job.payScale, "Level 4");
});

suite("Eligibility typed as “Post | qualification” lines");

test("EL01 lines are read into posts with their qualifications; spacing is tidied", () => {
  const read = readEligibilityLines("Goods Train Manager |  Bachelor’s Degree in any discipline \n  Senior  Clerk Cum Typist|Bachelor’s Degree; Typing proficiency on computer");
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.posts, [
    { post: "Goods Train Manager", qualification: ["Bachelor’s Degree in any discipline"] },
    { post: "Senior Clerk Cum Typist", qualification: ["Bachelor’s Degree", "Typing proficiency on computer"] },
  ]);
});

test("EL02 a line with no \"|\", no post, or no qualification is reported with its line number", () => {
  const read = readEligibilityLines("Bachelor’s Degree in any discipline\n | Graduate\nClerk | \nPeon | Matriculation");
  assert.deepEqual(read.problems.map((p) => p.line), [1, 2, 3]);
  assert.match(read.problems[0].message, /Line 1 has no “\|”/);
  assert.match(read.problems[1].message, /Line 2 has no post name/);
  assert.match(read.problems[2].message, /Line 3 has no qualification/);
  assert.deepEqual(read.posts.map((p) => p.post), ["Peon"]);
});

test("EL03 blank lines are skipped and line numbers still match what was typed", () => {
  const read = readEligibilityLines("Clerk | Graduate\n\n\nno separator here");
  assert.equal(read.posts.length, 1);
  assert.equal(read.problems[0].line, 4);
  assert.deepEqual(readEligibilityLines("  \n ").posts, []);
});

test("EL04 a post typed twice is a warning, not an error", () => {
  const read = readEligibilityLines("Clerk | Graduate\nclerk | 12th Pass");
  assert.deepEqual(read.problems, []);
  assert.equal(read.posts.length, 2);
  assert.match(read.warnings[0], /on line 1 and again on line 2/);
});

test("EL05 details already on a post are kept while its name is unchanged", () => {
  const existing = [{ post: "Clerk", qualification: ["Old"], payScale: "Level 2" }] as unknown as Parameters<typeof readEligibilityLines>[1];
  const read = readEligibilityLines("Clerk | Graduate\nPeon | Matriculation", existing);
  assert.deepEqual(read.posts[0], { post: "Clerk", qualification: ["Graduate"], payScale: "Level 2" });
  assert.deepEqual(read.posts[1], { post: "Peon", qualification: ["Matriculation"] });
});

test("EL06 more than 80 posts is refused", () => {
  const many = Array.from({ length: 81 }, (_, i) => `Post ${i + 1} | Graduate`).join("\n");
  assert.match(readEligibilityLines(many).problems[0].message, /At most 80 posts/);
  assert.deepEqual(readEligibilityLines(many.split("\n").slice(0, 80).join("\n")).problems, []);
});

suite("Pasted content file: missing headings");

test("CI09 a pasted file missing one heading says which one", () => {
  const pattern = "EXAM PATTERN\n\nPaper: Tier-I\nSubjects:\nGeneral Awareness | 25 | 50\n";
  const syllabus = "SYLLABUS\n\nSubject: General Awareness\nTopics:\nHistory\n";
  assert.ok(parseContentFile(pattern).warnings.some((w) => /No “SYLLABUS” heading/.test(w)));
  assert.equal(parseContentFile(pattern).examPattern.length, 1);
  assert.ok(parseContentFile(syllabus).warnings.some((w) => /No “EXAM PATTERN” heading/.test(w)));
  assert.deepEqual(parseContentFile(`${pattern}\n${syllabus}`).warnings, []);
  assert.ok(parseContentFile("Tier-I has 100 questions").warnings.some((w) => /No “EXAM PATTERN” or “SYLLABUS” heading/.test(w)));
});
