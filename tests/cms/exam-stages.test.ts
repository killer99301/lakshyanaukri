// ═══════════════════════════════════════════════════════════
// Exam stages: the write path, the timeline and "What's next"
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  ES01  stages saved in order with a revision; blanks dropped; nothing else changes
//  ES02  a date must say confirmed or tentative; no date cannot claim either
//  ES03  bad status, date, link, lengths and counts are rejected
//  ES04  router: "examStages" is routable
//  TL01  timeline: application dates then stages, with done / next / upcoming
//  TL02  a stage whose date has passed is "awaiting", never assumed held
//  TL03  What's next picks the nearest dated event, and says so when tentative
//  TL04  What's next with no dates, postponed stages, all done, or nothing known
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { Opportunity } from "@/types";
import { updateExamStages } from "@/lib/cms/record-ops";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { buildTimeline, whatsNext } from "@/lib/timeline";

const ADMIN = randomUUID();
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: ["e1"], conflict: false, manuallyEdited: false });

function makeRecord(): RecruitmentRecord {
  return {
    id: randomUUID(),
    slug: "test-2026",
    draftState: "DRAFT",
    recordRevision: "abc",
    identity: { organizationId: "ssc", organizationName: "SSC", recruitmentYear: 2026, title: pf("Test 2026") },
    dates: { applicationCloseDate: pf<string | null>("2026-10-07") },
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

const TIER1 = { name: "  Tier-I  Exam ", status: "SCHEDULED", certainty: "TENTATIVE", dateIso: "2026-12-12", notes: "", noticeUrl: " https://ssc.gov.in/notice.pdf " };
const TIER2 = { name: "Tier-II Exam", status: "NOT_DECLARED" };

suite("Exam stages write path");

test("ES01 stages saved in order with a revision; blanks dropped; nothing else changes", () => {
  const record = makeRecord();
  const { record: updated, revision } = updateExamStages(record, [TIER1, TIER2], ADMIN, "Added stages");
  assert.deepEqual(updated.examStages, [
    { name: "Tier-I Exam", order: 1, status: "SCHEDULED", certainty: "TENTATIVE", dateIso: "2026-12-12", noticeUrl: "https://ssc.gov.in/notice.pdf" },
    { name: "Tier-II Exam", order: 2, status: "NOT_DECLARED", certainty: "TBA" },
  ]);
  assert.equal(revision.fieldPath, "examStages");
  assert.deepEqual(revision.oldValue, []);
  assert.equal(updated.draftState, "DRAFT");
  assert.deepEqual(updated.dates, record.dates);
  assert.equal(record.examStages, undefined); // original untouched
  // Order always follows the list, whatever was sent.
  const swapped = updateExamStages(record, [{ ...TIER2, order: 9 }, { ...TIER1, order: 1 }], ADMIN).record.examStages!;
  assert.deepEqual(swapped.map((s) => [s.order, s.name]), [[1, "Tier-II Exam"], [2, "Tier-I Exam"]]);
});

test("ES02 a date must say confirmed or tentative; no date cannot claim either", () => {
  const record = makeRecord();
  assert.throws(() => updateExamStages(record, [{ name: "Tier-I", status: "SCHEDULED", dateIso: "2026-12-12" }], ADMIN), /confirmed or tentative/);
  assert.throws(() => updateExamStages(record, [{ name: "Tier-I", status: "SCHEDULED", dateIso: "2026-12-12", certainty: "TBA" }], ADMIN), /confirmed or tentative/);
  assert.throws(() => updateExamStages(record, [{ name: "Tier-I", status: "NOT_DECLARED", certainty: "CONFIRMED" }], ADMIN), /has no date/);
  assert.throws(() => updateExamStages(record, [{ name: "Tier-I", status: "SCHEDULED" }], ADMIN), /needs a date/);
  // A month with no exact day is a date too.
  const approx = updateExamStages(record, [{ name: "Tier-I", status: "SCHEDULED", dateDisplay: "December 2026", certainty: "TENTATIVE" }], ADMIN).record.examStages![0];
  assert.equal(approx.dateDisplay, "December 2026");
  assert.equal(approx.dateIso, undefined);
});

test("ES03 bad status, date, link, lengths and counts are rejected", () => {
  const record = makeRecord();
  const ok = { name: "Tier-I", status: "SCHEDULED", certainty: "CONFIRMED", dateIso: "2026-12-12" };
  assert.throws(() => updateExamStages(record, "stages", ADMIN), /must be an array/);
  assert.throws(() => updateExamStages(record, [{ ...ok, name: "  " }], ADMIN), /needs a name/);
  assert.throws(() => updateExamStages(record, [{ ...ok, status: "DONE" }], ADMIN), /unknown status/);
  assert.throws(() => updateExamStages(record, [{ ...ok, certainty: "MAYBE" }], ADMIN), /unknown date certainty/);
  assert.throws(() => updateExamStages(record, [{ ...ok, dateIso: "12/12/2026" }], ADMIN), /real date/);
  assert.throws(() => updateExamStages(record, [{ ...ok, dateIso: "2026-02-30" }], ADMIN), /real date/);
  assert.throws(() => updateExamStages(record, [{ ...ok, noticeUrl: "javascript:alert(1)" }], ADMIN), /valid http/);
  assert.throws(() => updateExamStages(record, [{ ...ok, notes: "x".repeat(201) }], ADMIN), /200 characters/);
  assert.throws(() => updateExamStages(record, Array(13).fill(ok), ADMIN), /at most 12/);
  assert.equal(updateExamStages(record, [], ADMIN).record.examStages!.length, 0);
});

test("ES04 router: examStages is routable", () => {
  const record = makeRecord();
  const wrap = { value: [TIER2], status: "PENDING" as const, evidenceIds: [], conflict: false, manuallyEdited: true };
  assert.equal(routeFieldUpdate(record, "examStages", wrap, ADMIN).record.examStages?.[0].name, "Tier-II Exam");
});

// ─── Timeline ───────────────────────────────────────────────

const NOW = new Date("2026-10-06T08:00:00Z");
const job = (o: Record<string, unknown>): Opportunity =>
  ({ type: "government", application: { openDate: "2026-09-07", closeDate: "2026-10-07" }, examStages: [], ...o }) as unknown as Opportunity;
const stage = (order: number, o: Record<string, unknown>) => ({ name: `Stage ${order}`, order, status: "NOT_DECLARED", ...o });

suite("Recruitment timeline");

test("TL01 application dates then stages, with done / next / upcoming", () => {
  const tl = buildTimeline(job({
    application: { openDate: "2026-09-07", closeDate: "2026-10-07", feeDeadline: "2026-10-08", correctionWindowEnd: "2026-10-16" },
    examStages: [
      stage(1, { name: "Tier-I", status: "SCHEDULED", certainty: "TENTATIVE", dateIso: "2026-12-12" }),
      stage(2, { name: "Tier-II" }),
    ],
  }), NOW);
  assert.deepEqual(tl.map((e) => [e.label, e.state, e.dateText]), [
    ["Applications open", "done", "7 Sept 2026"],
    ["Last date to apply", "next", "7 Oct 2026"],
    ["Last date for fee payment", "upcoming", "8 Oct 2026"],
    ["Correction window closes", "upcoming", "16 Oct 2026"],
    ["Tier-I", "upcoming", "12 Dec 2026"],
    ["Tier-II", "unknown", "To be announced"],
  ].map(([l, s, d]) => [l, s, (d as string).replace("Sept", tl[0].dateText.includes("Sept") ? "Sept" : "Sep")]));
  assert.equal(tl[4].tentative, true);
  // The last date itself still counts as upcoming on that day.
  assert.equal(buildTimeline(job({}), new Date("2026-10-07T20:00:00Z"))[1].state, "next");
  // An extension replaces the last date and is labelled.
  const ext = buildTimeline(job({ application: { openDate: "2026-09-07", closeDate: "2026-10-07", extendedCloseDate: "2026-10-14" } }), NOW);
  assert.deepEqual([ext[1].label, ext[1].dateIso], ["Last date to apply (extended)", "2026-10-14"]);
});

test("TL02 a stage whose date has passed is awaiting, never assumed held", () => {
  const tl = buildTimeline(job({
    application: { openDate: "2026-07-01", closeDate: "2026-08-01" },
    examStages: [
      stage(1, { name: "Prelims", status: "SCHEDULED", certainty: "CONFIRMED", dateIso: "2026-09-20" }),
      stage(2, { name: "Mains", status: "CONDUCTED", certainty: "CONFIRMED", dateIso: "2026-09-25" }),
      stage(3, { name: "Interview", status: "POSTPONED", certainty: "POSTPONED", dateIso: "2026-11-01" }),
    ],
  }), NOW);
  assert.deepEqual(tl.slice(2).map((e) => [e.label, e.state]), [["Prelims", "awaiting"], ["Mains", "done"], ["Interview", "unknown"]]);
  assert.equal(tl[4].dateText, "Postponed — new date awaited");
  assert.equal(tl[4].dateIso, undefined);
  assert.equal(tl[3].note, "Held");
});

suite("What's next");

test("TL03 picks the nearest dated event, and says so when tentative", () => {
  const open = whatsNext(job({ examStages: [stage(1, { name: "Tier-I", status: "SCHEDULED", certainty: "TENTATIVE", dateIso: "2026-12-12" })] }), NOW);
  assert.deepEqual(open, { title: "Last date to apply", detail: "7 Oct 2026" });
  const closed = whatsNext(job({
    application: { openDate: "2026-08-01", closeDate: "2026-09-01" },
    examStages: [stage(1, { name: "Tier-I", status: "SCHEDULED", certainty: "TENTATIVE", dateIso: "2026-12-12" }), stage(2, { name: "Tier-II" })],
  }), NOW);
  assert.deepEqual(closed, { title: "Tier-I", detail: "12 Dec 2026 (tentative)" });
  const approx = whatsNext(job({
    application: { openDate: "2026-08-01", closeDate: "2026-09-01" },
    examStages: [stage(1, { name: "Tier-I", status: "SCHEDULED", certainty: "TENTATIVE", dateDisplay: "December 2026" })],
  }), NOW);
  assert.deepEqual(approx, { title: "Tier-I", detail: "December 2026 (tentative)" });
});

test("TL04 no dates, postponed, passed, all done, or nothing known", () => {
  const closedWindow = { openDate: "2026-08-01", closeDate: "2026-09-01" };
  assert.deepEqual(whatsNext(job({ application: closedWindow, examStages: [stage(1, { name: "Tier-I" })] }), NOW), { title: "Tier-I", detail: "Date to be announced" });
  assert.deepEqual(
    whatsNext(job({ application: closedWindow, examStages: [stage(1, { name: "Tier-I", status: "POSTPONED", certainty: "POSTPONED" })] }), NOW),
    { title: "Tier-I", detail: "Postponed — new date awaited" },
  );
  const passed = whatsNext(job({ application: closedWindow, examStages: [stage(1, { name: "Tier-I", status: "SCHEDULED", certainty: "CONFIRMED", dateIso: "2026-09-20" })] }), NOW);
  assert.equal(passed?.title, "Tier-I");
  assert.match(passed?.detail ?? "", /Was scheduled for 20 Sept? 2026/);
  assert.deepEqual(
    whatsNext(job({ application: closedWindow, examStages: [stage(1, { name: "Tier-I", status: "CONDUCTED" }), stage(2, { name: "Final", status: "RESULT_DECLARED" })] }), NOW),
    { title: "Final", detail: "Result declared. Watch for the next official notice." },
  );
  assert.deepEqual(whatsNext(job({ application: closedWindow }), NOW), { title: "Exam schedule", detail: "To be announced" });
  // Applications still open and nothing else known: the last date is what's next.
  assert.equal(whatsNext(job({}), NOW)?.title, "Last date to apply");
});
