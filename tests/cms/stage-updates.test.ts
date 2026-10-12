// ═══════════════════════════════════════════════════════════
// One stage change, shown everywhere
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  SU01  postponed with no new date; postponed to a new date
//  SU02  admit card released, held, result declared
//  SU03  a date announced, a date moved, a date withdrawn
//  SU04  no status or date change → no entry (rename, reorder, note, certainty)
//  SU05  a new stage with something known is news; an empty one is not
//  SU06  several stages changed at once, in stage order, capped at five
//  SU07  each entry records what it was and what it is now
//  LS01  a stage marked "result declared" or "admit card released" is listed on those pages
//  LS02  not when a real link of that kind exists, and not without an official website
//  LS03  the job page's own document list never shows a stage-derived entry
//  NW01  an update is marked new on its day and for three days after, never before or beyond
//  NW02  a job is marked by its newest update only, and only while that one is recent
//  SR01  search finds a job by where it stands: postponed, admit card, result
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { ExamStage, GovernmentRecruitment } from "@/types";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import { stageChangeEntries } from "@/lib/cms/stage-updates";
import { lifecycleLinksOf } from "@/lib/cms/lifecycle-links";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { textSearch } from "@/lib/filters";
import { getFreshUpdate, isFreshUpdate } from "@/lib/lifecycle";

const TODAY = "2026-10-12";
const stage = (over: Partial<ExamStage>): ExamStage => ({ name: "Preliminary Examination", order: 1, status: "SCHEDULED", ...over });
const one = (before: ExamStage | undefined, after: ExamStage) => stageChangeEntries(before ? [before] : [], [after], TODAY);

suite("Update entries written from a stage change");

test("SU01 postponed with no new date; postponed to a new date", () => {
  const was = stage({ dateIso: "2026-10-25", certainty: "TENTATIVE" });
  const [gone] = one(was, stage({ status: "POSTPONED", certainty: "POSTPONED" }));
  assert.equal(gone.type, "POSTPONEMENT");
  assert.equal(gone.title, "Preliminary Examination postponed");
  assert.equal(gone.description, "Preliminary Examination, earlier set for 25 Oct 2026, has been postponed. A new date has not been announced.");
  assert.equal(gone.date, TODAY);
  // The old date left in place while the status changes means the same thing.
  assert.equal(one(was, stage({ status: "POSTPONED", dateIso: "2026-10-25", certainty: "TENTATIVE" }))[0].description, gone.description);
  const [moved] = one(was, stage({ status: "POSTPONED", dateIso: "2026-11-22", certainty: "TENTATIVE" }));
  assert.equal(moved.description, "Preliminary Examination has been postponed from 25 Oct 2026 to 22 Nov 2026 (tentative).");
});

test("SU02 admit card released, held, result declared", () => {
  const was = stage({ dateIso: "2026-10-04", certainty: "CONFIRMED" });
  const [admit] = one(was, { ...was, status: "ADMIT_CARD_OUT" });
  assert.deepEqual([admit.type, admit.title, admit.description], ["EXAM_NOTICE", "Preliminary Examination: admit card released", "The admit card for Preliminary Examination has been released. The exam is on 4 Oct 2026."]);
  const [held] = one(was, { ...was, status: "CONDUCTED" });
  assert.deepEqual([held.title, held.description], ["Preliminary Examination held", "Preliminary Examination has been held on 4 Oct 2026."]);
  const [result] = one({ ...was, status: "CONDUCTED" }, { ...was, status: "RESULT_DECLARED" });
  assert.deepEqual([result.title, result.description], ["Preliminary Examination: result declared", "The result of Preliminary Examination has been declared."]);
});

test("SU03 a date announced, a date moved, a date withdrawn", () => {
  const undated = stage({ status: "NOT_DECLARED", certainty: "TBA" });
  const [announced] = one(undated, stage({ dateIso: "2026-12-06", certainty: "CONFIRMED" }));
  assert.deepEqual([announced.type, announced.title, announced.description], ["EXAM_NOTICE", "Preliminary Examination date announced", "Preliminary Examination is set for 6 Dec 2026."]);
  const [moved] = one(stage({ dateIso: "2026-12-06", certainty: "CONFIRMED" }), stage({ dateIso: "2026-12-13", certainty: "TENTATIVE" }));
  assert.deepEqual([moved.type, moved.title, moved.description], ["RESCHEDULE", "Preliminary Examination rescheduled", "Preliminary Examination has moved from 6 Dec 2026 to 13 Dec 2026 (tentative)."]);
  const [typed] = one(undated, stage({ status: "NOT_DECLARED", dateDisplay: "Nov–Dec 2026", certainty: "TENTATIVE" }));
  assert.equal(typed.description, "Preliminary Examination is set for Nov–Dec 2026 (tentative).");
  const [withdrawn] = one(stage({ status: "NOT_DECLARED", dateDisplay: "Nov–Dec 2026", certainty: "TENTATIVE" }), undated);
  assert.equal(withdrawn.title, "Preliminary Examination: date withdrawn");
});

test("SU04 no status or date change → no entry (rename, reorder, note, certainty)", () => {
  const was = stage({ dateIso: "2026-10-25", certainty: "TENTATIVE" });
  assert.deepEqual(one(was, { ...was }), []);
  assert.deepEqual(one(was, { ...was, notes: "City slip from 20 Oct", noticeUrl: "https://bpsc.bih.nic.in", dateProvenance: "Calendar" }), []);
  assert.deepEqual(one(was, { ...was, certainty: "CONFIRMED" }), []);
  assert.deepEqual(one(was, { ...was, order: 3 }), []);
  assert.deepEqual(one(was, { ...was, name: "preliminary  examination" }), []);
  assert.deepEqual(stageChangeEntries(undefined, undefined, TODAY), []);
  // A stage that was removed writes nothing.
  assert.deepEqual(stageChangeEntries([was], [], TODAY), []);
});

test("SU05 a new stage with something known is news; an empty one is not", () => {
  assert.deepEqual(one(undefined, stage({ name: "Interview", status: "NOT_DECLARED", certainty: "TBA" })), []);
  const [added] = one(undefined, stage({ name: "Interview", dateIso: "2027-01-20", certainty: "CONFIRMED" }));
  assert.deepEqual([added.title, added.previousValue, added.newValue], ["Interview date announced", "Not on record", "Scheduled, 20 Jan 2027"]);
});

test("SU06 several stages changed at once, in stage order, capped at five", () => {
  const before = [stage({ dateIso: "2026-08-22" }), stage({ name: "Mains Examination", order: 2, dateIso: "2026-10-04" }), stage({ name: "Interview", order: 3, status: "NOT_DECLARED" })];
  const after = [{ ...before[1], status: "CONDUCTED" as const }, { ...before[0], status: "RESULT_DECLARED" as const }, before[2]];
  assert.deepEqual(stageChangeEntries(before, after, TODAY).map((e) => e.title), ["Preliminary Examination: result declared", "Mains Examination held"]);
  const many = Array.from({ length: 8 }, (_, i) => stage({ name: `Stage ${i + 1}`, order: i + 1, dateIso: "2026-12-01" }));
  assert.equal(stageChangeEntries([], many, TODAY).length, 5);
});

test("SU07 each entry records what it was and what it is now", () => {
  const [e] = one(stage({ dateIso: "2026-10-25", certainty: "TENTATIVE" }), stage({ status: "POSTPONED", certainty: "POSTPONED" }));
  assert.deepEqual([e.field, e.previousValue, e.newValue], ["Preliminary Examination", "Scheduled, 25 Oct 2026", "Postponed"]);
  assert.equal(e.sourceUrl, undefined);
});

// ─── The listing pages ────────────────────────────────────

const pending = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
function record(stages: ExamStage[], links: RecruitmentRecord["links"]): RecruitmentRecord {
  return {
    id: "rec-1", slug: "ibps-po-2026", draftState: "DRAFT", recordRevision: "abc",
    identity: { organizationId: "ibps", organizationName: "IBPS", recruitmentYear: 2026, title: pending("IBPS PO 2026") },
    dates: {}, vacancies: {}, financial: {}, examStages: stages, links, documents: [],
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  };
}
const SITE = { type: "OFFICIAL_WEBSITE" as const, label: "IBPS", url: "https://www.ibps.in/", official: true };
const STAGES: ExamStage[] = [
  { name: "Preliminary Examination", order: 1, status: "RESULT_DECLARED", dateIso: "2026-08-22", certainty: "CONFIRMED" },
  { name: "Mains Examination", order: 2, status: "ADMIT_CARD_OUT", dateIso: "2026-10-04", certainty: "CONFIRMED" },
];
const listed = (r: RecruitmentRecord) => lifecycleLinksOf(projectForPreview(r)).map((l) => `${l.kind} | ${l.label} | ${l.url}${l.fromStage ? " | from stage" : ""}`);

suite("Results and admit card pages follow the stages");

test("LS01 a stage marked \"result declared\" or \"admit card released\" is listed on those pages", () => {
  assert.deepEqual(listed(record(STAGES, [SITE])), [
    "result | Preliminary Examination: result declared | https://www.ibps.in/ | from stage",
    "admitCard | Mains Examination: admit card released | https://www.ibps.in/ | from stage",
  ]);
  // The latest stage with that status is the one named.
  const both = [STAGES[0], { ...STAGES[1], status: "RESULT_DECLARED" as const }];
  assert.deepEqual(listed(record(both, [SITE])), ["result | Mains Examination: result declared | https://www.ibps.in/ | from stage"]);
  assert.deepEqual(listed(record([{ ...STAGES[0], status: "CONDUCTED" }], [SITE])), []);
});

test("LS02 not when a real link of that kind exists, and not without an official website", () => {
  const withResult = record(STAGES, [SITE, { type: "RESULT", label: "Prelims result", url: "https://www.ibps.in/result", official: true }]);
  assert.deepEqual(listed(withResult), [
    "result | Prelims result | https://www.ibps.in/result",
    "admitCard | Mains Examination: admit card released | https://www.ibps.in/ | from stage",
  ]);
  assert.deepEqual(listed(record(STAGES, [])), []);
  assert.deepEqual(listed(record(STAGES, [{ ...SITE, official: false }])), []);
  assert.deepEqual(listed(record(STAGES, [{ type: "OFFICIAL_WEBSITE", label: "Portal", url: "https://portal.example/", official: false }])), []);
});

test("LS03 the job page's own document list never shows a stage-derived entry", () => {
  const job = snapshotToGovernmentRecruitment(projectForPreview(record(STAGES, [SITE, { type: "RESULT", label: "Prelims result", url: "https://www.ibps.in/result", official: true }])));
  assert.deepEqual((job.downloads ?? []).map((d) => d.label), ["Prelims result"]);
});

suite("The red NEW marker");

test("NW01 an update is marked new on its day and for three days after, never before or beyond", () => {
  const now = new Date("2026-10-12T09:00:00+05:30");
  const fresh = (date: string) => isFreshUpdate({ date }, now);
  assert.equal(fresh("2026-10-12"), true);
  assert.equal(fresh("2026-10-09"), true);
  assert.equal(fresh("2026-10-08"), false);
  assert.equal(fresh("2026-10-13"), false);
  assert.equal(fresh("not a date"), false);
  assert.equal(fresh(""), false);
});

test("NW02 a job is marked by its newest update only, and only while that one is recent", () => {
  const now = new Date("2026-10-12T09:00:00+05:30");
  const job = (updates: Array<{ date: string; title: string }>) =>
    ({ ...snapshotToGovernmentRecruitment(projectForPreview(record([], [SITE]))), updates: updates.map((u, i) => ({ id: String(i), type: "EXAM_NOTICE" as const, description: "", ...u })) }) as GovernmentRecruitment;
  assert.equal(getFreshUpdate(job([{ date: "2026-08-14", title: "Tentative date" }, { date: "2026-10-12", title: "Prelims postponed" }]), now)?.title, "Prelims postponed");
  // Stored order does not matter; the newest by date is the one that counts.
  assert.equal(getFreshUpdate(job([{ date: "2026-10-11", title: "Admit card released" }, { date: "2026-06-01", title: "Corrigendum" }]), now)?.title, "Admit card released");
  assert.equal(getFreshUpdate(job([{ date: "2026-08-14", title: "Tentative date" }]), now), null);
  assert.equal(getFreshUpdate(job([]), now), null);
});

suite("Search follows the stages");

test("SR01 search finds a job by where it stands: postponed, admit card, result", () => {
  const job = (title: string, stages: ExamStage[]) =>
    ({ ...snapshotToGovernmentRecruitment(projectForPreview(record(stages, [SITE]))), title, id: title, slug: title.toLowerCase().replace(/\s+/g, "-") }) as GovernmentRecruitment;
  const jobs = [
    job("BPSC 72nd CCE", [{ name: "Preliminary Examination", order: 1, status: "POSTPONED", certainty: "POSTPONED" }]),
    job("IBPS PO XVI", STAGES),
    job("SSC CHSL 2026", [{ name: "Tier-I", order: 1, status: "SCHEDULED", dateIso: "2026-12-01", certainty: "CONFIRMED" }]),
  ];
  const found = (q: string) => textSearch(jobs, q).map((j) => j.title);
  assert.deepEqual(found("postponed"), ["BPSC 72nd CCE"]);
  assert.deepEqual(found("admit card"), ["IBPS PO XVI"]);
  assert.deepEqual(found("result declared"), ["IBPS PO XVI"]);
  assert.deepEqual(found("mains admit card"), ["IBPS PO XVI"]);
  assert.deepEqual(found("bpsc postponed"), ["BPSC 72nd CCE"]);
  assert.deepEqual(found("tier-i"), ["SSC CHSL 2026"]);
  // Titles still work as before.
  assert.deepEqual(found("chsl"), ["SSC CHSL 2026"]);
});
