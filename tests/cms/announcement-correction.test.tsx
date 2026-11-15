// Correcting an existing announcement's "relevant until" and kind (15 Nov 2026), pure rules and their public effect.
// SYNTHETIC data only (the repository is public): an invented board shaped like the SSC CGL case of Nov 2026 (a
// notice saying the answer-key window has closed, stored without a kind or "relevant until", and two older notices
// superseded by it). Jobs are built the way public pages get them: record → snapshot → page data.
//   npx tsx --tsconfig tsconfig.json tests/cms/announcement-correction.test.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import type { ExamStage, Opportunity, UpdateRecord } from "@/types";
import type { CmsRecruitmentLink, ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { classifyAnnouncements, kindOf, pickImportantUpdate } from "@/lib/important-update";
import { buildFeed, importantNow } from "@/lib/updates-feed";
import { toPublicUpdates } from "@/lib/cms/announcements";
import { correctAnnouncement, describeKind, metaChanges, metaOf, type AnnouncementMeta } from "@/lib/cms/announcement-correction";
import { UpdateList } from "@/components/updates/UpdateRow";

const NOW = new Date("2097-11-15T06:00:00Z"); // 15 Nov 2097, India
const ADMIN = "0a0a0a0a-1111-4222-8333-444455556666";
const SECRET = "INTERNAL-CORRECTION-REASON-never-public";
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
const STAGES: ExamStage[] = [
  { name: "Tier-I (Computer Based Test)", order: 1, status: "CONDUCTED", kind: "SELECTION", dateIso: "2097-09-30", dateEndIso: "2097-10-28", certainty: "CONFIRMED" } as ExamStage,
  { name: "Tier-II (Computer Based Test)", order: 2, status: "NOT_DECLARED", kind: "SELECTION", certainty: "TBA" } as ExamStage,
];
const LINKS: CmsRecruitmentLink[] = [{ type: "OFFICIAL_WEBSITE", label: "Board", url: "https://board.example.gov.in/", official: true }];
const N = {
  id: "b5000000-0000-4000-8000-000000000003", date: "2097-11-04", type: "EXAM_NOTICE" as const,
  title: "Tier-I held 30 Sep – 28 Oct 2097; answer-key window (4–7 Nov) has closed",
  description: "Tentative answer keys were open for challenges from 4 Nov 2097 (9 PM) to 7 Nov 2097 (9 PM).",
  sourceUrl: "https://board.example.gov.in/notice-04112097.pdf",
};
const OLD1: UpdateRecord = { id: "f8000000-0000-4000-8000-000000000001", date: "2097-10-12", type: "EXAM_NOTICE", title: "Tier-I (Computer Based Test): admit card released", description: "", superseded: { on: "2097-11-13", by: ADMIN, reason: "old", replacedBy: N.id } };
const OLD2: UpdateRecord = { id: "55000000-0000-4000-8000-000000000002", date: "2097-10-12", type: "EXAM_NOTICE", title: "Tier-I exam window: 30 Sep – 30 Oct 2097", description: "", superseded: { on: "2097-11-13", by: ADMIN, reason: "old", replacedBy: N.id } };
const OTHER: UpdateRecord = { id: "0e000000-0000-4000-8000-000000000004", date: "2097-06-01", type: "CORRIGENDUM", title: "Vacancies revised", description: "Total revised.", field: "totalVacancies", previousValue: "100", newValue: "90" };
const LIST: UpdateRecord[] = [OLD1, OLD2, N, OTHER];
const NAMES = STAGES.map((s) => s.name);
const NONE: AnnouncementMeta = { relevantUntil: "", eventKind: "", eventStage: "" };
const FIX: AnnouncementMeta = { relevantUntil: "2097-11-07", eventKind: "ANSWER_KEY", eventStage: "Tier-I (Computer Based Test)" };

function job(updates: UpdateRecord[]): Opportunity {
  return snapshotToGovernmentRecruitment(projectForPreview({
    id: "rec-corr", slug: "test-board-cgl-2097", draftState: "DRAFT", recordRevision: "r1",
    identity: { organizationId: "test-board", organizationName: "Test Board", recruitmentYear: 2097, title: pf("TEST Board CGL 2097") },
    dates: { applicationOpenDate: pf("2097-06-01"), applicationCloseDate: pf("2097-07-01") }, vacancies: {}, financial: {},
    links: LINKS, documents: [], updates, examStages: STAGES,
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2097-01-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    createdAt: "2097-01-01T00:00:00Z", updatedAt: "2097-11-01T00:00:00Z", createdBy: ADMIN, updatedBy: ADMIN,
  } as RecruitmentRecord)) as unknown as Opportunity;
}
const fixIt = (over: Partial<Parameters<typeof correctAnnouncement>[1]> = {}) =>
  correctAnnouncement(LIST, { id: N.id, set: FIX, was: NONE, reason: SECRET, stages: NAMES, ...over });

suite("Announcement correction: the SSC-like case");

test("C1 before: no kind, guessed 'Answer key out' from its words, Current, in Important now and the job banner", () => {
  assert.equal(kindOf(N as UpdateRecord).kind, "ANSWER_KEY");
  const j = job(LIST);
  const c = classifyAnnouncements(j, NOW).find((x) => x.u.id === N.id)!;
  assert.ok(c.current && c.inferred);
  assert.equal(pickImportantUpdate(j, NOW)?.update.id, N.id);
  const feed = buildFeed([j], NOW);
  assert.equal(feed.find((e) => e.key.endsWith(N.id))?.state, "CURRENT");
  assert.ok(importantNow([j], feed, NOW).some((e) => e.key.endsWith(N.id)));
});

test("C2 after: relevant until 7 Nov + recorded kind → Closed, out of Important now and the banner (the next current notice, if any, takes it)", () => {
  const r = fixIt();
  assert.ok(r.ok);
  if (!r.ok) return;
  const j = job(r.list);
  const c = classifyAnnouncements(j, NOW).find((x) => x.u.id === N.id)!;
  assert.ok(!c.current && c.ended === "DATE" && !c.inferred && c.kind === "ANSWER_KEY");
  assert.notEqual(pickImportantUpdate(j, NOW)?.update.id, N.id, "the banner moves to the next current notice, if any");
  const feed = buildFeed([j], NOW);
  assert.equal(feed.find((e) => e.key.endsWith(N.id))?.state, "CLOSED");
  assert.ok(!importantNow([j], feed, NOW).some((e) => e.key.endsWith(N.id)));
});

test("C3 the two older notices keep pointing at it: their 'Correct notice' still names it", () => {
  const r = fixIt();
  if (!r.ok) throw new Error(r.error);
  assert.ok(r.list[0].superseded?.replacedBy === N.id && r.list[1].superseded?.replacedBy === N.id);
  const feed = buildFeed([job(r.list)], NOW);
  for (const old of [OLD1, OLD2]) {
    const e = feed.find((x) => x.key.endsWith(old.id))!;
    assert.equal(e.state, "SUPERSEDED");
    assert.equal(e.correction?.replacementTitle, N.title);
  }
  const html = renderToStaticMarkup(<UpdateList entries={feed} />);
  assert.ok(html.includes("Correct notice") && html.includes("Closed"));
});

test("C4 nothing else changes: same ids, order, words, date, source; other announcements identical; no new one", () => {
  const r = fixIt();
  if (!r.ok) throw new Error(r.error);
  assert.equal(r.list.length, LIST.length);
  assert.deepEqual(r.list.map((u) => u.id), LIST.map((u) => u.id));
  assert.deepEqual(r.list[0], OLD1); assert.deepEqual(r.list[1], OLD2); assert.deepEqual(r.list[3], OTHER);
  const { relevantUntil, event, ...rest } = r.list[2];
  assert.deepEqual(rest, N);
  assert.equal(relevantUntil, "2097-11-07");
  assert.deepEqual(event, { kind: "ANSWER_KEY", stage: "Tier-I (Computer Based Test)" });
  assert.ok(!JSON.stringify(r.list).includes(SECRET), "the reason is not stored on the announcement");
});

test("C5 the change in words, for the history and the review", () => {
  const r = fixIt();
  if (!r.ok) throw new Error(r.error);
  assert.deepEqual(r.changes, [
    "Relevant until: not set → 7 Nov 2097",
    "Kind: not set (guessed from its words: Answer key out) → Answer key out · Tier-I (Computer Based Test)",
  ]);
  assert.deepEqual(metaChanges(r.list[2], r.list[2]), []);
  assert.equal(describeKind(N as UpdateRecord), "not set (guessed from its words: Answer key out)");
});

test("C6 the public copy carries the corrected details only, never a reason or admin id", () => {
  const r = fixIt();
  if (!r.ok) throw new Error(r.error);
  const pub = JSON.stringify(toPublicUpdates(r.list));
  assert.ok(pub.includes('"relevantUntil":"2097-11-07"') && pub.includes('"kind":"ANSWER_KEY"'));
  assert.ok(!pub.includes(SECRET) && !pub.includes(ADMIN) && !pub.includes('"reason"'));
});

suite("Announcement correction: set, correct, clear");

test("S1 only the date, keeping the guessed kind; then clear it again (the key is removed)", () => {
  const a = fixIt({ set: { ...NONE, relevantUntil: "2097-11-07" } });
  if (!a.ok) throw new Error(a.error);
  assert.ok(a.list[2].relevantUntil === "2097-11-07" && a.list[2].event === undefined);
  const b = correctAnnouncement(a.list, { id: N.id, set: NONE, was: metaOf(a.list[2]), reason: "set by mistake", stages: NAMES });
  if (!b.ok) throw new Error(b.error);
  assert.deepEqual(b.list[2], N);
  assert.ok(!("relevantUntil" in b.list[2]) && !("event" in b.list[2]));
});

test("S2 another kind with no stage (e.g. 'Update'), and back to 'not set'", () => {
  const a = fixIt({ set: { relevantUntil: "", eventKind: "OTHER", eventStage: "" } });
  if (!a.ok) throw new Error(a.error);
  assert.deepEqual(a.list[2].event, { kind: "OTHER" });
  const c = classifyAnnouncements(job(a.list), NOW).find((x) => x.u.id === N.id)!;
  assert.ok(c.kind === "OTHER" && !c.inferred);
  const b = correctAnnouncement(a.list, { id: N.id, set: NONE, was: metaOf(a.list[2]), reason: "undo", stages: NAMES });
  assert.ok(b.ok && b.list[2].event === undefined);
});

test("S3 a stage already stored but since renamed on the job is kept, not refused", () => {
  const stored = LIST.map((u) => (u.id === N.id ? { ...u, event: { kind: "ANSWER_KEY" as const, stage: "Tier 1 (old name)" } } : u));
  const r = correctAnnouncement(stored, { id: N.id, set: { relevantUntil: "2097-11-07", eventKind: "ANSWER_KEY", eventStage: "Tier 1 (old name)" }, was: { relevantUntil: "", eventKind: "ANSWER_KEY", eventStage: "Tier 1 (old name)" }, reason: "window ended", stages: NAMES });
  assert.ok(r.ok);
});

suite("Announcement correction: refusals");

const refuse = (over: Partial<Parameters<typeof correctAnnouncement>[1]>, code: string, words: RegExp) => {
  const r = fixIt(over);
  assert.ok(!r.ok, "should be refused");
  if (r.ok) return;
  assert.equal(r.code, code);
  assert.ok(words.test(r.error), r.error);
};

test("R1 invalid dates: not a real day, wrong format, before the notice, too far ahead", () => {
  refuse({ set: { ...FIX, relevantUntil: "2097-02-30" } }, "INVALID", /real date/);
  refuse({ set: { ...FIX, relevantUntil: "07/11/2097" } }, "INVALID", /real date/);
  refuse({ set: { ...FIX, relevantUntil: "2097-11" } }, "INVALID", /real date/);
  refuse({ set: { ...FIX, relevantUntil: "2097-11-03" } }, "INVALID", /before the notice/);
  refuse({ set: { ...FIX, relevantUntil: "2197-01-01" } }, "INVALID", /too far/);
});

test("R2 kinds and stages: unknown kind, stage without kind, a stage not on the job, an over-long stage", () => {
  refuse({ set: { ...FIX, eventKind: "RUMOUR" } }, "INVALID", /listed kinds/);
  refuse({ set: { ...FIX, eventKind: "" } }, "INVALID", /needs a kind/);
  refuse({ set: { ...FIX, eventStage: "Tier-IX" } }, "INVALID", /exam stages/);
  refuse({ set: { ...FIX, eventStage: "x".repeat(121) } }, "INVALID", /too long/);
});

test("R3 reason: required, at most 200 characters", () => {
  refuse({ reason: "   " }, "INVALID", /reason/);
  refuse({ reason: "x".repeat(201) }, "INVALID", /200/);
});

test("R4 a page that showed other details (stale) is refused; nothing changed is refused", () => {
  refuse({ was: { ...NONE, relevantUntil: "2097-11-09" } }, "STALE", /changed since the page was loaded/);
  refuse({ set: NONE }, "NO_CHANGE", /Nothing changed/);
});

test("R5 unknown or superseded announcement", () => {
  refuse({ id: "nope" }, "NOT_FOUND", /not in the job/);
  refuse({ id: OLD1.id }, "INVALID", /superseded/);
});

test("R6 a refusal returns no list: the input list is never modified", () => {
  const copy = JSON.stringify(LIST);
  fixIt({ set: { ...FIX, relevantUntil: "bad" } });
  fixIt();
  assert.equal(JSON.stringify(LIST), copy);
});
