// Maintenance batch (Nov 2026): announcement supersession, tentative in the Exam Schedule box, multi-date badges,
// the downloads list in the editor preview, and stage-note example text. Synthetic jobs only (public repository).
//   npx tsx --tsconfig tsconfig.json tests/cms/maintenance-batch.test.tsx
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { ExamStage, UpdateRecord, Opportunity } from "@/types";
import { supersede, restore, currentUpdates, supersededUpdates, updatesFingerprint } from "@/lib/cms/announcements";
import { getLatestUpdate, getFreshUpdate, getUpdatesSortedByDate, getSupersededUpdates, getCurrentExamSummary, deriveStatusBadge, badgeSchedule, currentExamStage } from "@/lib/lifecycle";
import { newsLine } from "@/lib/cms/channel-post";
import { likelyDuplicates } from "@/lib/cms/announcement-duplicates";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { liveChanges } from "@/lib/cms/live-changes";
import { assembleReview } from "@/lib/cms/publication-review";
import { isStageExampleText, exampleTextIn, STAGE_PLACEHOLDERS } from "@/lib/cms/stage-examples";
import { updateExamStages } from "@/lib/cms/record-ops";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";
import { JobDetailHeader } from "@/components/jobs/JobDetailHeader";
import { JobDownloads } from "@/components/lifecycle/LifecycleLinkList";

const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: [], conflict: false, manuallyEdited: true });
const upd = (id: string, date: string, title: string, description = "Details.", extra: Partial<UpdateRecord> = {}): UpdateRecord =>
  ({ id, date, type: "EXAM_NOTICE", title, description, ...extra });
function job(over: Partial<RecruitmentRecord> = {}): RecruitmentRecord {
  return {
    id: "00000000-0000-4000-8000-0000000000aa", slug: "test-job", draftState: "PUBLISHED", recordRevision: "aaaa0001", publishedAt: "2026-10-01T00:00:00Z",
    identity: { organizationId: "ssc", organizationName: "Staff Selection Commission", recruitmentYear: 2026, title: pf("Test Exam 2026") },
    dates: { applicationOpenDate: pf("2026-05-21"), applicationCloseDate: pf("2026-06-25") }, vacancies: { total: pf(100) },
    financial: { feeGeneral: pf(100), feeSCST: pf(0) }, lifecycle: { status: "UPCOMING", conflicts: [], events: [] },
    provenance: { status: "VERIFIED" } as RecruitmentRecord["provenance"], links: [], documents: [], updates: [],
    classification: { qualification: "Graduate" }, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z", ...over,
  };
}
const asJob = (r: RecruitmentRecord) => snapshotToGovernmentRecruitment(projectForPreview(r)) as unknown as Opportunity;
const NOW = new Date("2026-11-13T06:30:00Z");

// The SSC-like case: two wrong 12 Oct announcements, the verified 4 Nov notice.
const A = upd("a", "2026-10-12", "Tier-I admit card released", "The exam is on 30 Sep 2026.");
const B = upd("b", "2026-10-12", "Tier-I exam window: 30 Sep – 30 Oct 2026", "Held from 30 September to 30 October 2026.");
const N = upd("n", "2026-11-04", "Tier-I held 30 Sep – 28 Oct 2026; answer-key window closed", "Per SSC notice of 4 Nov.", { sourceUrl: "https://ssc.gov.in/notice.pdf" });
const sscList = [A, B, N];
const by = { on: "2026-11-13", by: "admin-1" };

suite("Supersession: rules");

test("MB-01 SSC: two announcements superseded by the 4 Nov notice in one save; text, dates and ids untouched", () => {
  const r = supersede(sscList, { ids: ["a", "b"], reason: "Wrong end date; SSC notice of 4 Nov gives 28 Oct", replacedBy: "n", ...by });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(currentUpdates(r.list).map((u) => u.id).join(), "n");
  assert.equal(supersededUpdates(r.list).map((u) => u.id).join(), "a,b");
  for (const id of ["a", "b"]) {
    const was = sscList.find((u) => u.id === id)!; const now = r.list.find((u) => u.id === id)!;
    assert.equal(now.title, was.title); assert.equal(now.description, was.description); assert.equal(now.date, was.date);
    assert.deepEqual(now.superseded, { on: "2026-11-13", by: "admin-1", reason: "Wrong end date; SSC notice of 4 Nov gives 28 Oct", replacedBy: "n" });
  }
  assert.equal(r.list.length, 3, "nothing removed, nothing added");
  assert.ok(!sscList[0].superseded, "the input list is not changed in place");
});

test("MB-02 SAIL: superseded with the official notice and no replacing announcement; the correct entry stays current", () => {
  const ok = upd("s1", "2026-10-12", "Walk-in Document Verification set for 27 Oct – 21 Nov 2026");
  const bad1 = upd("s2", "2026-10-24", "Walk-in Document Verification rescheduled");
  const bad2 = upd("s3", "2026-10-29", "Walk-in Document Verification rescheduled");
  const r = supersede([ok, bad1, bad2], { ids: ["s2", "s3"], reason: "No official reschedule", sourceUrl: "https://sailcareers.com/notice.pdf", ...by });
  assert.ok(r.ok);
  if (!r.ok) return;
  const j = asJob(job({ updates: r.list }));
  assert.equal(getLatestUpdate(j)?.id, "s1", "the banner is the correct schedule");
  assert.equal(getUpdatesSortedByDate(j).length, 1);
});

test("MB-03 a correct older announcement stays visible when another is superseded", () => {
  const list = [upd("x", "2026-09-01", "Notification out"), upd("y", "2026-10-01", "Wrong date"), upd("z", "2026-10-20", "Right date")];
  const r = supersede(list, { ids: ["y"], reason: "Wrong", replacedBy: "z", ...by });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(getUpdatesSortedByDate(asJob(job({ updates: r.list }))).map((u) => u.id), ["z", "x"]);
});

test("MB-04 validation refuses: no reason, unknown id, self-replacement, superseded replacement, already superseded, no replacement or source, bad address", () => {
  const bad = (input: Partial<Parameters<typeof supersede>[1]>, list = sscList) => supersede(list, { ids: ["a"], reason: "r", replacedBy: "n", ...by, ...input });
  assert.ok(!bad({ reason: " " }).ok);
  assert.ok(!bad({ ids: ["nope"] }).ok);
  assert.ok(!bad({ ids: ["a", "n"] }).ok, "cannot supersede the replacement in the same save");
  assert.ok(!bad({ replacedBy: undefined, sourceUrl: undefined }).ok);
  assert.ok(!bad({ replacedBy: undefined, sourceUrl: "not a url" }).ok);
  assert.ok(!bad({ ids: [] }).ok);
  assert.ok(!bad({ reason: "x".repeat(201) }).ok);
  const once = supersede(sscList, { ids: ["a"], reason: "r", replacedBy: "n", ...by });
  assert.ok(once.ok);
  if (!once.ok) return;
  assert.ok(!supersede(once.list, { ids: ["a"], reason: "r", replacedBy: "n", ...by }).ok, "already superseded");
  assert.ok(!supersede(once.list, { ids: ["b"], reason: "r", replacedBy: "a", ...by }).ok, "a superseded entry cannot be the replacement");
});

test("MB-05 restore makes it current again; restoring a current one is refused; a reason is required", () => {
  const s = supersede(sscList, { ids: ["a", "b"], reason: "r", replacedBy: "n", ...by });
  assert.ok(s.ok);
  if (!s.ok) return;
  const r = restore(s.list, ["a"], "Superseded by mistake");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(!r.list.find((u) => u.id === "a")!.superseded);
  assert.ok(r.list.find((u) => u.id === "b")!.superseded);
  assert.deepEqual(r.list.find((u) => u.id === "a"), A, "exactly the original entry");
  assert.ok(!restore(r.list, ["a"], "again").ok);
  assert.ok(!restore(s.list, ["b"], " ").ok);
});

test("MB-06 duplicates and the Telegram news line ignore superseded announcements", () => {
  const s = supersede(sscList, { ids: ["a", "b"], reason: "r", replacedBy: "n", ...by });
  assert.ok(s.ok);
  if (!s.ok) return;
  assert.equal(likelyDuplicates({ date: "2026-10-13", title: "Tier-I admit card released" }, s.list).length, 0);
  assert.equal(likelyDuplicates({ date: "2026-10-13", title: "Tier-I admit card released" }, sscList).length > 0, true, "but a current one still warns");
  const late = [upd("p", "2026-11-12", "Old wrong news", "x", { superseded: { on: "2026-11-13", by: "a", reason: "r", replacedBy: "q" } }), upd("q", "2026-11-11", "Right news")];
  assert.equal(newsLine(late, "2026-11-13"), "Right news");
});

test("MB-07 the fingerprint changes when the list or a note changes, so a stale page is refused", () => {
  const s = supersede(sscList, { ids: ["a"], reason: "r", replacedBy: "n", ...by });
  assert.ok(s.ok);
  if (!s.ok) return;
  assert.notEqual(updatesFingerprint(sscList), updatesFingerprint(s.list));
  assert.notEqual(updatesFingerprint(sscList), updatesFingerprint([...sscList, upd("new", "2026-11-13", "x")]));
  assert.equal(updatesFingerprint(sscList), updatesFingerprint(JSON.parse(JSON.stringify(sscList))));
});

suite("Supersession: what visitors see");

const supersededJob = () => {
  const s = supersede(sscList, { ids: ["a", "b"], reason: "INTERNAL-REASON-TEXT", replacedBy: "n", ...by });
  if (!s.ok) throw new Error(s.error);
  return job({ updates: s.list });
};

test("MB-08 banner, count and history: only the 4 Nov notice is current; the two old ones are in a collapsed list without their wrong text; the internal reason never appears", () => {
  const j = asJob(supersededJob());
  assert.equal(getLatestUpdate(j)?.id, "n");
  assert.equal(getSupersededUpdates(j).length, 2);
  const html = renderToStaticMarkup(<JobDetailSections job={j as never} />);
  assert.match(html, /1 Update</);
  assert.match(html, /data-superseded-updates/);
  assert.match(html, /Earlier notices, since corrected \(2\)/);
  assert.match(html, /Corrected by the notice of 4 Nov 2026/);
  assert.ok(!html.includes("The exam is on 30 Sep 2026"), "the wrong body text is not repeated");
  assert.ok(!html.includes("INTERNAL-REASON-TEXT"));
  const header = renderToStaticMarkup(<JobDetailHeader job={j as never} now={NOW} />);
  assert.ok(header.includes("answer-key window closed"), "banner = the 4 Nov notice");
  assert.ok(!header.includes("Tier-I admit card released"));
  assert.ok(!header.includes("INTERNAL-REASON-TEXT"));
});

test("MB-09 NEW badge: a superseded announcement is never fresh news", () => {
  const fresh = [upd("p", "2026-11-12", "Wrong", "x", { superseded: { on: "2026-11-13", by: "a", reason: "r", replacedBy: "q" } }), upd("q", "2026-10-01", "Old but right")];
  assert.equal(getFreshUpdate(asJob(job({ updates: fresh })), NOW), null);
});

test("MB-10 jobs without notes look exactly as before: no correction list, count = all announcements", () => {
  const j = asJob(job({ updates: sscList }));
  assert.equal(getUpdatesSortedByDate(j).length, 3);
  assert.equal(getSupersededUpdates(j).length, 0);
  assert.equal(getLatestUpdate(j)?.id, "n");
  const html = renderToStaticMarkup(<JobDetailSections job={j as never} />);
  assert.match(html, /3 Updates</);
  assert.ok(!html.includes("data-superseded-updates"));
  const none = renderToStaticMarkup(<JobDetailSections job={asJob(job({ updates: [] })) as never} />);
  assert.ok(!none.includes("updates-history"), "no announcements: no history section, as before");
});

test("MB-11 'Publishing will change' and the publication review name the supersessions; a job with none has no new review field", () => {
  const live = projectForPreview(job({ updates: sscList }));
  const next = projectForPreview(supersededJob());
  const lines = liveChanges(live, next).filter((c) => c.section === "Updates");
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.after.startsWith("Superseded")));
  const base = { today: "2026-11-13", imported: false, freshness: { revision: "x", latestClaimAt: null, latestCheckAt: null } as never, standings: {} as never, conflictValues: {}, conflictKinds: {}, officialDocuments: 0, duplicates: [], filled: [], publishedUpdateIds: ["a", "b", "n"] } as never;
  const review = assembleReview({ ...(base as object), record: supersededJob(), publishedSupersededIds: [] } as never);
  assert.deepEqual((review.supersessions ?? []).map((s) => `${s.id}:${s.change}`), ["a:SUPERSEDED", "b:SUPERSEDED"]);
  assert.equal(review.announcements.length, 0, "no new announcement is created");
  const plain = assembleReview({ ...(base as object), record: job({ updates: sscList }), publishedSupersededIds: [] } as never);
  assert.ok(!("supersessions" in plain), "unchanged review for every other job");
});

suite("Exam Schedule box and badge");

const stage = (s: Partial<ExamStage>): ExamStage => ({ name: "CBT", order: 1, status: "SCHEDULED", kind: "SELECTION", ...s });
const badgeOf = (stages: ExamStage[]) => deriveStatusBadge(asJob(job({ examStages: stages })), NOW).label;
const summaryOf = (stages: ExamStage[]) => getCurrentExamSummary(stages, NOW);

test("MB-12 RRB-like: two separate tentative days stay two days in the badge, and the box says tentative", () => {
  const s = [stage({ certainty: "TENTATIVE", dateIso: "2026-11-23", dateDisplay: "23 Nov 2026 & 25 Nov 2026" })];
  assert.equal(badgeOf(s), "Tentative Exam: 23 & 25 Nov 2026");
  assert.equal(summaryOf(s), "CBT: 23 Nov 2026 & 25 Nov 2026 (tentative)");
  assert.equal(badgeOf([stage({ certainty: "TENTATIVE", dateIso: "2026-11-23", dateDisplay: "23 & 25 Nov 2026" })]), "Tentative Exam: 23 & 25 Nov 2026");
});

test("MB-13 a continuous window stays a window (never one day, never a list of days)", () => {
  assert.equal(badgeOf([stage({ certainty: "TENTATIVE", dateIso: "2026-11-30", dateDisplay: "30 Nov – 31 Dec 2026" })]), "Tentative Exam: 30 Nov – 31 Dec 2026");
  assert.equal(badgeOf([stage({ certainty: "TENTATIVE", dateIso: "2026-11-30", dateDisplay: "30 Nov 2026 – 31 Dec 2026" })]), "Tentative Exam: 30 Nov – 31 Dec 2026");
  assert.equal(badgeOf([stage({ certainty: "TENTATIVE", dateIso: "2026-12-12", dateDisplay: "12 Dec 2026 to 20 Dec 2026" })]), "Tentative Exam: 12–20 Dec 2026");
});

test("MB-14 ambiguous or long wording is never mined for a date: shown as written, or a plain label", () => {
  assert.equal(badgeOf([stage({ certainty: "TENTATIVE", dateIso: "2026-11-23", dateDisplay: "Second half of November 2026" })]), "Tentative Exam: Second half of November 2026");
  assert.equal(badgeOf([stage({ certainty: "TENTATIVE", dateIso: "2026-11-23", dateDisplay: "23 Nov, 25 Nov, 27 Nov and 2 Dec 2026 in shifts" })]), "Tentative Exam Date");
  assert.equal(badgeSchedule("23 Nov 2026 & 25 Dec 2026"), "23 Nov 2026 & 25 Dec 2026", "different months: as written, not merged");
  assert.equal(badgeSchedule("30 Nov 2026 – 2 Jan 2027"), "30 Nov 2026 – 2 Jan 2027", "different years: as written");
});

test("MB-15 legacy and confirmed stages behave as before; sorting still uses the exact date", () => {
  assert.equal(badgeOf([stage({ certainty: "TENTATIVE", dateIso: "2026-11-23" })]), "Tentative Exam: 23 Nov 2026");
  assert.equal(badgeOf([stage({ certainty: "CONFIRMED", dateIso: "2026-11-23", dateDisplay: "23 Nov 2026" })]), "Exam: 23 Nov 2026");
  assert.equal(summaryOf([stage({ certainty: "CONFIRMED", dateIso: "2026-11-23", dateDisplay: "23 Nov 2026" })]), "CBT: 23 Nov 2026");
  assert.equal(summaryOf([stage({ dateIso: "2026-11-23", dateDisplay: "23 Nov 2026 (tentative)" })]), "CBT: 23 Nov 2026 (tentative)", "no second 'tentative'");
  const two = [stage({ name: "A", order: 1, certainty: "TENTATIVE", dateIso: "2026-11-23", dateDisplay: "23 Nov 2026 & 25 Nov 2026" }), stage({ name: "B", order: 2, certainty: "CONFIRMED", dateIso: "2026-12-20", dateDisplay: "20 Dec 2026" })];
  assert.equal(currentExamStage(two, NOW)?.name, "A");
});

suite("Editor preview and stage-note examples");

test("MB-16 the preview renders the same four applicant-facing parts as the public page, in the same order", () => {
  const pub = readFileSync("src/app/(main)/jobs/[slug]/page.tsx", "utf8");
  const editor = readFileSync("src/app/admin/cms/[id]/page.tsx", "utf8");
  const preview = editor.slice(editor.indexOf("{/* Preview content */}"));
  const order = (src: string) => ["JobDetailHeader", "OfficialNotificationCard", "JobDownloads", "JobDetailSections"].map((c) => src.indexOf(`<${c}`));
  const p = order(pub); const v = order(preview);
  assert.ok(p.every((i) => i >= 0) && v.every((i) => i >= 0), "all four on both");
  assert.deepEqual([...p].sort((a, b) => a - b), p, "public order");
  assert.deepEqual([...v].sort((a, b) => a - b), v, "preview order");
  assert.match(preview, /<JobDownloads items=\{previewJob\.downloads\} \/>/);
});

test("MB-17 NICL-like: the preview's downloads list equals the public one: absent, active, and the stage-only fallback (not a download)", () => {
  const render = (r: RecruitmentRecord) => renderToStaticMarkup(<JobDownloads items={(asJob(r) as unknown as { downloads: never }).downloads} />);
  assert.equal(render(job()), "", "no links: nothing shown");
  const withAdmit = job({ links: [{ type: "ADMIT_CARD", label: "Phase-I Call Letter", url: "https://ibps.in/test/login.php", official: true }] });
  assert.match(render(withAdmit), /Phase-I Call Letter/);
  const stageOnly = job({ links: [{ type: "OFFICIAL_WEBSITE", label: "Site", url: "https://insurer.example.in/", official: true }], examStages: [stage({ status: "ADMIT_CARD_OUT", certainty: "CONFIRMED", dateIso: "2026-11-17" })] });
  assert.equal(render(stageOnly), "", "a stage status with no link is not shown as a download");
  // The preview and the public page take the list from the same snapshot function, so they agree by construction.
  const pubSnap = { ...projectForPreview(withAdmit) };
  assert.equal(renderToStaticMarkup(<JobDownloads items={(snapshotToGovernmentRecruitment(pubSnap) as unknown as { downloads: never }).downloads} />), render(withAdmit));
});

test("MB-18 stage-note examples: the boxes show guidance only; an untouched or copied example is refused by the editor's check and by the server", () => {
  assert.ok(!/\d/.test(Object.values(STAGE_PLACEHOLDERS).join(" ")), "no dates or numbers in the guidance");
  const editorSrc = readFileSync("src/app/admin/cms/[id]/ExamStagesEditor.tsx", "utf8");
  assert.ok(!editorSrc.includes("City slip from 5 Dec"), "old example gone from the editor");
  assert.ok(!/value=\{?["']e\.g\./.test(editorSrc), "never a prefilled value");
  for (const t of ["City slip from 5 Dec", "e.g. City slip from 5 Dec", "  city slip from 5 dec ", "SSC exam calendar, 1 Oct 2026", STAGE_PLACEHOLDERS.notes]) assert.ok(isStageExampleText(t), t);
  for (const t of ["City slip from 13 Nov 2026", "Exam city slip about 10 days before the exam", "", undefined]) assert.ok(!isStageExampleText(t), String(t));
  assert.ok(exampleTextIn([{ name: "CBT", notes: "City slip from 5 Dec" }])?.includes("note of stage 1"));
  assert.throws(() => updateExamStages(job(), [{ name: "CBT", status: "SCHEDULED", dateIso: "2026-11-17", certainty: "CONFIRMED", notes: "City slip from 5 Dec" }], "admin-1", "x"), /example text/);
  const ok = updateExamStages(job(), [{ name: "CBT", status: "SCHEDULED", dateIso: "2026-11-17", certainty: "CONFIRMED", notes: "City slip about 10 days before the exam" }], "admin-1", "x");
  assert.equal(ok.record.examStages?.[0].notes, "City slip about 10 days before the exam");
});

suite("Rollback risk (documented, not hidden)");

test("MB-19 code that predates the note ignores it: after a rollback to e3707d5, superseded announcements would show as current again", () => {
  const s = supersede(sscList, { ids: ["a", "b"], reason: "r", replacedBy: "n", ...by });
  assert.ok(s.ok);
  if (!s.ok) return;
  // e3707d5's getUpdatesSortedByDate: every entry, newest first, no filter.
  const oldReader = (list: UpdateRecord[]) => [...list].sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
  assert.equal(oldReader(s.list).length, 3, "old code would show all three again: the risk is real");
  assert.ok(s.list.every((u) => typeof u.title === "string" && typeof u.date === "string"), "but nothing breaks and no data is lost");
  // Finding the affected jobs after a rollback (for the mitigation): any job whose announcements carry a note.
  assert.equal(s.list.filter((u) => u.superseded).length, 2);
});
