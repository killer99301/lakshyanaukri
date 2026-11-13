// A stage that runs over several days (an optional last day, `dateEndIso`): SAIL-like trade-wise walk-in,
// 27 Oct to 21 Nov 2026. While today is inside the window it is under way, not "date passed". Synthetic data.
//   npx tsx --tsconfig tsconfig.json tests/cms/stage-window.test.ts
import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { ExamStage, Opportunity } from "@/types";
import { updateExamStages } from "@/lib/cms/record-ops";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { buildTimeline, whatsNext } from "@/lib/timeline";
import { deriveStatusBadge, getCurrentExamSummary, currentExamStage, isUnderWay, lastDayOf } from "@/lib/lifecycle";
import { attentionFor } from "@/lib/cms/attention";
import { liveChanges } from "@/lib/cms/live-changes";

const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: [], conflict: false, manuallyEdited: true });
const WALKIN: ExamStage = {
  name: "Walk-in Document Verification", order: 1, status: "SCHEDULED", certainty: "CONFIRMED", kind: "SELECTION",
  dateIso: "2026-10-27", dateEndIso: "2026-11-21", dateDisplay: "27 Oct – 21 Nov 2026 (trade-wise)",
  notes: "Held trade by trade. Each trade has its own days within this period; check the notice for yours.",
};
const record = (stages: ExamStage[]): RecruitmentRecord => ({
  id: "00000000-0000-4000-8000-0000000000dd", slug: "test-window", draftState: "PUBLISHED", recordRevision: "r1", publishedAt: "2026-10-01T00:00:00Z",
  identity: { organizationId: "sail", organizationName: "Test Steel Plant", recruitmentYear: 2026, title: pf("Test Apprentice 2026") },
  dates: { applicationOpenDate: pf("2026-09-30"), applicationCloseDate: pf("2026-10-20") }, vacancies: {}, financial: {},
  lifecycle: { status: "UPCOMING", conflicts: [], events: [] }, provenance: { status: "VERIFIED" } as RecruitmentRecord["provenance"],
  links: [{ type: "OFFICIAL_WEBSITE", label: "Site", url: "https://careers.example.in/", official: true }], documents: [], updates: [],
  examStages: stages, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-11-13T00:00:00Z",
});
const job = (stages: ExamStage[]) => snapshotToGovernmentRecruitment(projectForPreview(record(stages))) as unknown as Opportunity;
const at = (day: string) => new Date(`${day}T06:30:00Z`);

suite("Stage end date: saving");

test("SW-01 saved and kept; an end date needs a first day and must come after it", () => {
  const ok = updateExamStages(record([]), [{ ...WALKIN }], "admin-1", "x");
  assert.equal(ok.record.examStages?.[0].dateEndIso, "2026-11-21");
  assert.throws(() => updateExamStages(record([]), [{ ...WALKIN, dateIso: undefined, dateDisplay: "27 Oct – 21 Nov 2026" }], "a", "x"), /end date but no first day/);
  assert.throws(() => updateExamStages(record([]), [{ ...WALKIN, dateEndIso: "2026-10-27" }], "a", "x"), /after its first day/);
  assert.throws(() => updateExamStages(record([]), [{ ...WALKIN, dateEndIso: "2026-02-30" }], "a", "x"), /real date/);
  const plain = updateExamStages(record([]), [{ ...WALKIN, dateEndIso: undefined }], "a", "x");
  assert.ok(!("dateEndIso" in plain.record.examStages![0]), "one-day stages stored exactly as before");
});

test("SW-02 the editor offers the box and sends it only with a first day", () => {
  const src = readFileSync("src/app/admin/cms/[id]/ExamStagesEditor.tsx", "utf8");
  assert.match(src, /id="stage-date-end"/);
  assert.match(src, /dateEndIso: d\.dateIso && d\.dateEndIso \? d\.dateEndIso : undefined/);
  assert.match(src, /dateEndIso: s\.dateEndIso \?\? ""/, "an edit keeps an existing end date");
});

suite("Stage end date: what visitors see");

test("SW-03 inside the window: timeline 'under way', What's next says until when, badge says under way", () => {
  const j = job([WALKIN]);
  const ev = buildTimeline(j, at("2026-11-13")).find((e) => e.kind === "stage")!;
  assert.equal(ev.state, "ongoing");
  assert.equal(ev.untilIso, "2026-11-21");
  assert.deepEqual(whatsNext(j, at("2026-11-13")), { title: "Walk-in Document Verification", detail: "Under way until 21 Nov 2026. Schedule: 27 Oct – 21 Nov 2026 (trade-wise)." });
  assert.equal(deriveStatusBadge(j, at("2026-11-13")).label, "Under way until 21 Nov 2026");
  assert.equal(getCurrentExamSummary(j.type === "government" ? j.examStages : [], at("2026-11-13")), "Walk-in Document Verification: 27 Oct – 21 Nov 2026 (trade-wise)");
});

test("SW-04 on the first and last day it is under way; before it, upcoming; after it, awaiting an update (never assumed held)", () => {
  const j = job([WALKIN]);
  assert.equal(buildTimeline(j, at("2026-10-27")).find((e) => e.kind === "stage")!.state, "ongoing");
  assert.equal(buildTimeline(j, at("2026-11-21")).find((e) => e.kind === "stage")!.state, "ongoing");
  assert.equal(buildTimeline(j, at("2026-10-21")).find((e) => e.kind === "stage")!.state, "next");
  assert.equal(buildTimeline(j, at("2026-11-22")).find((e) => e.kind === "stage")!.state, "awaiting");
  assert.match(whatsNext(j, at("2026-11-22"))!.detail, /^Was scheduled for 27 Oct – 21 Nov 2026/);
});

test("SW-05 one-day and legacy stages behave exactly as before", () => {
  const one = { ...WALKIN, dateEndIso: undefined, dateDisplay: undefined };
  const j = job([one]);
  assert.equal(buildTimeline(j, at("2026-11-13")).find((e) => e.kind === "stage")!.state, "awaiting");
  assert.equal(deriveStatusBadge(j, at("2026-11-13")).label, "Exam Scheduled");
  assert.equal(lastDayOf(one), "2026-10-27");
  assert.ok(!isUnderWay(one, at("2026-11-13")));
});

test("SW-06 the current stage is the window while it lasts, then the next stage", () => {
  const next: ExamStage = { name: "Merit list", order: 2, status: "SCHEDULED", certainty: "TENTATIVE", kind: "SELECTION", dateIso: "2026-12-05" };
  assert.equal(currentExamStage([WALKIN, next], at("2026-11-13"))?.name, "Walk-in Document Verification");
  assert.equal(currentExamStage([WALKIN, next], at("2026-11-25"))?.name, "Merit list");
});

suite("Stage end date: reminders and the publish diff");

test("SW-07 no 'date passed' reminder while under way; one after the last day", () => {
  const r = record([WALKIN]);
  assert.ok(!attentionFor(r, "2026-11-13").some((a) => a.code === "STAGE_DATE_PASSED" || a.code === "EXAM_NEAR_NO_ADMIT_CARD"));
  assert.ok(attentionFor(r, "2026-11-24").some((a) => a.code === "STAGE_DATE_PASSED"));
  const oneDay = record([{ ...WALKIN, dateEndIso: undefined }]);
  assert.ok(attentionFor(oneDay, "2026-11-13").some((a) => a.code === "STAGE_DATE_PASSED"), "unchanged for one-day stages");
});

test("SW-08 'Publishing will change' shows the end date", () => {
  const before = projectForPreview(record([{ ...WALKIN, dateEndIso: undefined, dateDisplay: undefined }]));
  const after = projectForPreview(record([WALKIN]));
  const line = liveChanges(before, after).find((c) => c.label.includes("Walk-in"))!;
  assert.match(line.after, /until 21 Nov 2026/);
});

test("SW-09 the public copy carries the end date (it is public information)", () => {
  const j = job([WALKIN]);
  assert.equal(j.type === "government" ? j.examStages[0].dateEndIso : null, "2026-11-21");
});
