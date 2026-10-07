// ═══════════════════════════════════════════════════════════
// "Needs attention": what is due, overdue or going stale on a live job
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  AT01  never-published drafts and archived records are never listed
//  AT02  a quiet live job has nothing to say
//  AT03  saved changes that are not republished are flagged from the next day
//  AT04  closing in three days or fewer; not before, not after
//  AT05  closed with no next stage dated; silent once a stage is dated or has been held
//  AT06  exam within 14 days with no admit card link; silent once the link or status is there
//  AT07  a stage whose date has passed but is not marked as held
//  AT08  a tentative date coming up; a postponed stage with no new date
//  AT09  an exam held a month ago with no result; a result date that has passed
//  AT10  a running job nobody has touched for three weeks, only when nothing else is flagged
//  AT11  the list puts the most pressing job first
//  AT12  the morning message writes out pressing items, counts the rest, and reads as quiet on a quiet day
//  AT13  today's date is taken in Indian time
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import type { RecruitmentRecord, ProvenanceField, CmsRecruitmentLink } from "@/types/recruitment-record";
import type { ExamStage } from "@/types";
import { attentionFor, buildAttentionDigest, buildAttentionList, todayInIndia } from "@/lib/cms/attention";

const TODAY = "2026-10-08";
const pending = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });

function live(over: Partial<RecruitmentRecord> & { close?: string; stages?: ExamStage[]; links?: CmsRecruitmentLink[]; title?: string } = {}): RecruitmentRecord {
  const { close, stages, links, title, ...rest } = over;
  return {
    id: randomUUID(),
    slug: "test-2026",
    draftState: "PUBLISHED",
    recordRevision: "abc",
    publishedAt: "2026-09-01T00:00:00.000Z",
    identity: { organizationId: "ssc", organizationName: "SSC", recruitmentYear: 2026, title: pending(title ?? "Test Exam 2026") },
    dates: close ? { applicationCloseDate: pending<string | null>(close) } : {},
    vacancies: {},
    financial: {},
    examStages: stages,
    links: links ?? [],
    documents: [],
    lifecycle: { status: "DRAFT", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-10-07T10:00:00.000Z",
    ...rest,
  };
}

const stage = (over: Partial<ExamStage>): ExamStage => ({ name: "Tier-I", order: 1, status: "SCHEDULED", ...over });
const codes = (record: RecruitmentRecord, today = TODAY) => attentionFor(record, today).map((i) => i.code);
const admitCard: CmsRecruitmentLink = { type: "ADMIT_CARD", label: "Admit card", url: "https://ssc.gov.in/admit", official: true };
const resultLink: CmsRecruitmentLink = { type: "RESULT", label: "Result", url: "https://ssc.gov.in/result", official: true };

suite("Needs attention: which records");

test("AT01 never-published drafts and archived records are never listed", () => {
  assert.deepEqual(codes(live({ publishedAt: undefined, draftState: "DRAFT", close: "2026-10-09" })), []);
  assert.deepEqual(codes(live({ draftState: "ARCHIVED", close: "2026-10-09" })), []);
});

test("AT02 a quiet live job has nothing to say", () => {
  assert.deepEqual(codes(live({ close: "2026-11-15", stages: [stage({ dateIso: "2027-01-10" })] })), []);
  assert.deepEqual(codes(live()), []);
});

suite("Needs attention: the rules");

test("AT03 saved changes that are not republished are flagged from the next day", () => {
  const edited = live({ draftState: "DRAFT", close: "2026-11-15", updatedAt: "2026-10-06T09:00:00.000Z" });
  const items = attentionFor(edited, TODAY);
  assert.equal(items[0].code, "EDITS_NOT_LIVE");
  assert.equal(items[0].level, "NOW");
  assert.match(items[0].message, /2 days ago/);
  // Edited today: still being worked on.
  assert.deepEqual(codes(live({ draftState: "DRAFT", close: "2026-11-15", updatedAt: "2026-10-08T03:00:00.000Z" })), []);
});

test("AT04 closing in three days or fewer; not before, not after", () => {
  assert.deepEqual(codes(live({ close: "2026-10-12" })), []);
  assert.deepEqual(codes(live({ close: "2026-10-11" })), ["CLOSES_SOON"]);
  assert.match(attentionFor(live({ close: "2026-10-09" }), TODAY)[0].message, /close tomorrow \(9 Oct 2026\)/);
  assert.match(attentionFor(live({ close: "2026-10-08" }), TODAY)[0].message, /close today/);
});

test("AT05 closed with no next stage dated; silent once a stage is dated or has been held", () => {
  const closed = attentionFor(live({ close: "2026-10-01" }), TODAY);
  assert.equal(closed[0].code, "CLOSED_NO_NEXT_STAGE");
  assert.equal(closed[0].level, "CHECK");
  assert.deepEqual(codes(live({ close: "2026-10-01", stages: [stage({ dateIso: "2026-12-01" })] })), []);
  assert.deepEqual(codes(live({ close: "2026-10-01", stages: [stage({ status: "SCHEDULED", dateDisplay: "Dec 2026" })] })), []);
  assert.deepEqual(codes(live({ close: "2026-10-01", dates: { applicationCloseDate: pending<string | null>("2026-10-01"), examDate: pending<string | null>("2026-12-01") } })), []);
  assert.ok(!codes(live({ close: "2026-09-01", stages: [stage({ status: "CONDUCTED", dateIso: "2026-10-01" })] })).includes("CLOSED_NO_NEXT_STAGE"));
});

test("AT06 exam within 14 days with no admit card link; silent once the link or status is there", () => {
  const far = live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-10-23" })] });
  assert.deepEqual(codes(far), []);
  const near = attentionFor(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-10-22" })] }), TODAY);
  assert.equal(near[0].code, "EXAM_NEAR_NO_ADMIT_CARD");
  assert.equal(near[0].level, "SOON");
  const week = attentionFor(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-10-15" })] }), TODAY);
  assert.equal(week[0].level, "NOW");
  assert.match(week[0].message, /Tier-I is in 7 days \(15 Oct 2026\)/);
  assert.deepEqual(codes(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-10-15" })], links: [admitCard] })), []);
  assert.deepEqual(codes(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-10-15", status: "ADMIT_CARD_OUT" })] })), []);
});

test("AT07 a stage whose date has passed but is not marked as held", () => {
  const recent = attentionFor(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-10-05" })] }), TODAY);
  assert.equal(recent[0].code, "STAGE_DATE_PASSED");
  assert.equal(recent[0].level, "NOW");
  const old = attentionFor(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-09-20", status: "ADMIT_CARD_OUT" })], links: [admitCard] }), TODAY);
  assert.equal(old[0].code, "STAGE_DATE_PASSED");
  assert.equal(old[0].level, "SOON");
  // Marked as held: nothing to chase yet.
  assert.deepEqual(codes(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-10-05", status: "CONDUCTED" })] })), []);
});

test("AT08 a tentative date coming up; a postponed stage with no new date", () => {
  const tentative = codes(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-10-27", certainty: "TENTATIVE" })] }));
  assert.deepEqual(tentative, ["TENTATIVE_DATE_NEAR"]);
  assert.deepEqual(codes(live({ close: "2026-09-01", stages: [stage({ dateIso: "2026-11-27", certainty: "TENTATIVE" })] })), []);
  assert.deepEqual(codes(live({ close: "2026-09-01", stages: [stage({ status: "POSTPONED" })] })), ["POSTPONED_NO_DATE"]);
  // Postponed to a new date that is still ahead: nothing to chase.
  assert.ok(!codes(live({ close: "2026-09-01", stages: [stage({ status: "POSTPONED", dateIso: "2026-12-01" })] })).includes("POSTPONED_NO_DATE"));
});

test("AT09 an exam held a month ago with no result; a result date that has passed", () => {
  const held = live({ close: "2026-08-01", stages: [stage({ dateIso: "2026-09-05", status: "CONDUCTED" })] });
  assert.deepEqual(codes(held), ["RESULT_MAY_BE_OUT"]);
  assert.deepEqual(codes(live({ close: "2026-08-01", stages: [stage({ dateIso: "2026-09-20", status: "CONDUCTED" })] })), []);
  // The next stage is already dated, or the result is recorded: nothing to chase.
  assert.deepEqual(codes(live({ close: "2026-08-01", stages: [stage({ dateIso: "2026-09-05", status: "CONDUCTED" }), stage({ name: "Tier-II", order: 2, dateIso: "2026-12-01" })] })), []);
  assert.deepEqual(codes(live({ close: "2026-08-01", stages: [stage({ dateIso: "2026-09-05", status: "RESULT_DECLARED" })] })), []);

  const dated = live({ dates: { applicationCloseDate: pending<string | null>("2026-08-01"), resultDate: pending<string | null>("2026-10-06") }, stages: [stage({ dateIso: "2026-09-20", status: "CONDUCTED" })] });
  assert.deepEqual(codes(dated), ["RESULT_DATE_PASSED"]);
  assert.deepEqual(codes({ ...dated, links: [resultLink] }), []);
});

test("AT10 a running job nobody has touched for three weeks, only when nothing else is flagged", () => {
  const stale = live({ close: "2026-11-15", updatedAt: "2026-09-10T00:00:00.000Z" });
  assert.deepEqual(codes(stale), ["NOT_LOOKED_AT"]);
  assert.deepEqual(codes(live({ close: "2026-11-15", updatedAt: "2026-09-25T00:00:00.000Z" })), []);
  assert.deepEqual(codes(live({ close: "2026-10-09", updatedAt: "2026-09-10T00:00:00.000Z" })), ["CLOSES_SOON"]);
  // Nothing ahead at all: it is finished, not stale.
  assert.ok(!codes(live({ close: "2026-08-01", updatedAt: "2026-08-10T00:00:00.000Z", stages: [stage({ dateIso: "2026-09-20", status: "RESULT_DECLARED" })] })).includes("NOT_LOOKED_AT"));
});

suite("Needs attention: the list and the morning message");

const QUIET = live({ title: "Quiet Exam", close: "2026-11-15" });
const CLOSING = live({ title: "Closing Exam", close: "2026-10-09" });
const OVERDUE = live({ title: "Overdue <Exam>", close: "2026-09-01", stages: [stage({ dateIso: "2026-10-05" })] });
const CLOSED = live({ title: "Closed Exam", close: "2026-10-01" });

test("AT11 the list puts the most pressing job first", () => {
  const list = buildAttentionList([QUIET, CLOSED, CLOSING, OVERDUE], TODAY);
  assert.deepEqual(list.map((j) => j.title), ["Overdue <Exam>", "Closing Exam", "Closed Exam"]);
  assert.equal(list[0].organizationName, "SSC");
});

test("AT12 the morning message writes out pressing items, counts the rest, and reads as quiet on a quiet day", () => {
  const text = buildAttentionDigest(buildAttentionList([QUIET, CLOSED, CLOSING, OVERDUE], TODAY), TODAY, 4, "https://lakshyanaukri.in");
  assert.match(text, /LakshyaNaukri — 8 Oct 2026/);
  assert.match(text, /<b>Overdue &lt;Exam&gt;<\/b>\n🔴 Tier-I was dated 5 Oct 2026/);
  assert.match(text, /<b>Closing Exam<\/b>\n🟡 Applications close tomorrow/);
  assert.ok(!text.includes("Closed Exam"));
  assert.match(text, /1 more to check when free\./);
  assert.ok(text.endsWith("https://lakshyanaukri.in/admin/cms"));

  const quiet = buildAttentionDigest(buildAttentionList([QUIET], TODAY), TODAY, 1, "https://lakshyanaukri.in");
  assert.match(quiet, /Nothing pressing today across 1 live job\./);
  assert.ok(!quiet.includes("to check when free"));
});

test("AT13 today's date is taken in Indian time", () => {
  assert.equal(todayInIndia(new Date("2026-10-07T18:29:00.000Z")), "2026-10-07");
  assert.equal(todayInIndia(new Date("2026-10-07T18:30:00.000Z")), "2026-10-08");
});
