// Owner-controlled publication, Stage 1: the pure rules — who may publish, what a refusal keeps, which hosts are
// never an Apply link, the review's groups, hard rules and fingerprint, and whether an approval fits a review.
// No database, no network. The database side is tests/local-stack/owner-publication.test.ts.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/owner-publication.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { isPublisher, notAPublisherMessage, parsePublishers, refusalMetadata } from "@/lib/cms/publication-policy";
import { approvalProblem, assembleReview, eligibilityDisagreement, isAggregatorHost, MATERIAL_FIELDS, type ReviewInput } from "@/lib/cms/publication-review";
import type { RecruitmentRecord } from "@/types/recruitment-record";

const A = "11111111-2222-4333-8444-555555555555";
const B = "66666666-7777-4888-9999-aaaaaaaaaaaa";

suite("Who may publish (CMS_PUBLISHERS, admin IDs)");

test("P01 listed admin IDs only; usernames and junk are never matched", () => {
  assert.deepEqual([...parsePublishers(` ${A.toUpperCase()}, owner ;${B} not-a-uuid`)], [A, B]);
  assert.equal(isPublisher(A, { CMS_PUBLISHERS: A }), true);
  assert.equal(isPublisher(B, { CMS_PUBLISHERS: A }), false);
  assert.equal(isPublisher(A, { CMS_PUBLISHERS: "owner,test-admin" }), false, "a username in the list never counts");
});

test("P02 empty or unset: nobody (fail closed), with a message that says so", () => {
  assert.equal(isPublisher(A, {}), false);
  assert.equal(isPublisher(A, { CMS_PUBLISHERS: "  " }), false);
  assert.match(notAPublisherMessage(A, {}), /Publishing is closed/);
  assert.match(notAPublisherMessage(B, { CMS_PUBLISHERS: A }), new RegExp(`Your admin ID is ${B}`));
});

test("P03 a refusal keeps only codes and field paths, never values or URLs", () => {
  const m = refusalMetadata({ recruitmentId: A, adminId: B, action: "PUBLISH", reason: "CONFLICT_NOT_ACKNOWLEDGED", recordRevision: "abc123",
    fieldPaths: ["financial.payScale", "https://evil.example/x", "Rs. 7.85 lakh"], ruleCodes: ["APPLY_AGGREGATOR"] });
  assert.deepEqual(Object.keys(m).sort(), ["action", "fieldPaths", "reason", "recordRevision", "ruleCodes"]);
  assert.deepEqual(m.fieldPaths, ["financial.payScale"], "anything that is not a code or field path is dropped");
});

suite("Apply links on job-news sites (P2)");

test("P04 portals and listed aggregators are refused as Apply hosts; official and other hosts are not", () => {
  for (const h of ["adda247.com", "www.sarkariresult.com", "govtjobguru.in", "m.freejobalert.com"]) assert.ok(isAggregatorHost(h), h);
  for (const h of ["ibps.in", "ibpsreg.ibps.in", "nats.education.gov.in", "example.org", null]) assert.ok(!isAggregatorHost(h), String(h));
});

suite("Which part of eligibility the sources disagree on (D3)");

test("P05 qualification, experience, both, or neither", () => {
  const row = (q: string, e?: string) => [{ post: "Officer", qualification: [q], ...(e ? { experience: [e] } : {}) }];
  assert.equal(eligibilityDisagreement([row("Graduate", "2 years"), row("Post-graduate", "2 years")]), "qualification");
  assert.equal(eligibilityDisagreement([row("Graduate", "2 years"), row("Graduate", "3 years")]), "experience");
  assert.equal(eligibilityDisagreement([row("Graduate", "2 years"), row("Post-graduate", "3 years")]), "both");
  assert.equal(eligibilityDisagreement([row("Graduate")]), undefined);
});

suite("The review: groups, hard rules, fingerprint");

const record = (over: Record<string, unknown> = {}) => ({
  id: A, slug: "test-owner", draftState: "APPROVED", recordRevision: "r1",
  identity: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2099, govType: "PSU",
    title: { value: "IBPS TEST 2099", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } },
  dates: { applicationCloseDate: { value: "2099-07-26", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } },
  vacancies: {}, financial: {}, links: [], documents: [], updates: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "", primarySourceType: "NOT_VERIFIED" },
  createdAt: "2099-01-01T00:00:00Z", updatedAt: "2099-01-01T00:00:00Z", ...over,
} as unknown as RecruitmentRecord);
const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  record: record(), today: "2099-07-01", imported: true, freshness: { recordRevision: "r1", claimSeq: 10, retrievals: 1 },
  standings: Object.fromEntries(MATERIAL_FIELDS.map((p) => [p, "RESEARCH"])), conflictValues: {}, officialDocuments: 0, duplicates: [], filled: ["dates.applicationCloseDate"],
  ...over,
});

test("P06 a GPT-research-only job: no hard rule; warnings say what is unconfirmed and missing", () => {
  const r = assembleReview(input());
  assert.deepEqual(r.hardRules, []);
  const codes = r.warnings.map((w) => w.code);
  for (const c of ["NO_OFFICIAL_SOURCE", "NO_APPLY_LINK", "NOT_CONFIRMED"]) assert.ok(codes.includes(c), c);
  assert.equal(r.standing.research, MATERIAL_FIELDS.length);
});

test("P07 hard rules: aggregator as Apply, non-http link, unresolved lifecycle conflict, invalid record", () => {
  const links = [{ type: "APPLY_ONLINE", label: "Apply", url: "https://www.adda247.com/jobs/x", official: false }, { type: "OTHER", label: "x", url: "ftp://x.example/y", official: false }];
  const r = assembleReview(input({ record: record({ links, lifecycle: { status: "DRAFT", conflicts: [{ id: "c", fieldPath: "dates", detectedAt: "x" }], events: [] } }) }));
  const codes = r.hardRules.map((h) => h.code);
  for (const c of ["APPLY_AGGREGATOR", "NON_HTTP_LINK", "LIFECYCLE_CONFLICT"]) assert.ok(codes.includes(c), c);
  const bad = assembleReview(input({ record: record({ identity: { organizationId: "", organizationName: "x", recruitmentYear: 2099, title: { value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true } } }) }));
  assert.ok(bad.hardRules.some((h) => h.code === "VALIDATION"));
});

test("P08 an Apply link on an unlisted site is a warning, an official one is not; a passed deadline is warned", () => {
  const unlisted = assembleReview(input({ record: record({ links: [{ type: "APPLY_ONLINE", label: "Apply", url: "https://apply.example.org/x", official: false }] }), today: "2099-08-01" }));
  const codes = unlisted.warnings.map((w) => w.code);
  assert.ok(codes.includes("QUESTIONABLE_APPLY_URL") && codes.includes("PAST_DEADLINE") && !codes.includes("NO_APPLY_LINK"));
  const own = assembleReview(input({ record: record({ links: [{ type: "APPLY_ONLINE", label: "Apply", url: "https://ibpsreg.ibps.in/x/", official: true }] }) }));
  assert.ok(!own.warnings.some((w) => w.code === "QUESTIONABLE_APPLY_URL") && !own.warnings.some((w) => w.code === "NO_OFFICIAL_SOURCE"));
  assert.equal(own.links.applyOnline.standing, "AUTHORITY");
});

test("P09 the fingerprint: stable for the same job; changes with an edit, a new claim, a new document or a new day", () => {
  const base = assembleReview(input()).reviewHash;
  assert.equal(assembleReview(input()).reviewHash, base);
  assert.notEqual(assembleReview(input({ freshness: { recordRevision: "r2", claimSeq: 10, retrievals: 1 } })).reviewHash, base);
  assert.notEqual(assembleReview(input({ freshness: { recordRevision: "r1", claimSeq: 11, retrievals: 1 } })).reviewHash, base);
  assert.notEqual(assembleReview(input({ freshness: { recordRevision: "r1", claimSeq: 10, retrievals: 2 } })).reviewHash, base);
  assert.notEqual(assembleReview(input({ today: "2099-07-02" })).reviewHash, base);
});

suite("Does an approval fit the review?");

const withConflicts = () => assembleReview(input({ standings: { ...Object.fromEntries(MATERIAL_FIELDS.map((p) => [p, "RESEARCH"])), "financial.payScale": "CONFLICTING", eligibility: "CONFLICTING" },
  conflictValues: { "financial.payScale": ["Rs. 7.85 lakh", "Rs. 7.83 lakh"], eligibility: ["…", "…"] }, eligibilityPart: "experience" }));
const ok = (r: ReturnType<typeof assembleReview>, acks: string[]) => ({ acknowledged: true, reviewHash: r.reviewHash, ...r.freshness, conflictsAcknowledged: acks });

test("P10 no approval, or not acknowledged: OWNER_REVIEW_REQUIRED", () => {
  const r = assembleReview(input());
  assert.equal(approvalProblem(r, null)?.reason, "OWNER_REVIEW_REQUIRED");
  assert.equal(approvalProblem(r, { ...ok(r, []), acknowledged: false })?.reason, "OWNER_REVIEW_REQUIRED");
  assert.equal(approvalProblem(r, ok(r, [])), null);
});

test("P11 another fingerprint or freshness: REVIEW_CHANGED", () => {
  const r = assembleReview(input());
  assert.equal(approvalProblem(r, { ...ok(r, []), reviewHash: "x" })?.reason, "REVIEW_CHANGED");
  assert.equal(approvalProblem(r, { ...ok(r, []), claimSeq: 9 })?.reason, "REVIEW_CHANGED");
  assert.equal(approvalProblem(r, { ...ok(r, []), retrievals: 0 })?.reason, "REVIEW_CHANGED");
});

test("P12 conflicts: one acknowledgement each — never fewer, more, repeated or blanket", () => {
  const r = withConflicts();
  assert.equal(r.conflicts.find((c) => c.fieldPath === "eligibility")?.part, "experience");
  assert.equal(approvalProblem(r, ok(r, ["financial.payScale"]))?.reason, "CONFLICT_NOT_ACKNOWLEDGED");
  assert.deepEqual(approvalProblem(r, ok(r, ["financial.payScale"]))?.fieldPaths, ["eligibility"]);
  assert.equal(approvalProblem(r, ok(r, ["financial.payScale", "eligibility", "age"]))?.reason, "CONFLICT_NOT_ACKNOWLEDGED", "an extra one");
  assert.equal(approvalProblem(r, ok(r, ["financial.payScale", "financial.payScale"]))?.reason, "CONFLICT_NOT_ACKNOWLEDGED", "a repeat");
  assert.equal(approvalProblem(r, ok(r, ["*"]))?.reason, "CONFLICT_NOT_ACKNOWLEDGED", "no wildcard");
  assert.equal(approvalProblem(r, ok(r, ["eligibility", "financial.payScale"])), null);
});
