// Selection stages and recruitment milestones (after B2.5): each schedule
// entry classed by code from its printed name; the "next exam" line counts
// selection stages only; milestones kept and shown apart; older records
// without a class read exactly as before. Pure: no DB, no AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/stage-kinds.test.ts

import { randomUUID } from "node:crypto";
import { suite, test, assert } from "../intelligence/suite";
import type { ExamStage, ExamStageKind, Opportunity } from "@/types";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import { classifyStageName, stageGroups, isSelectionStage } from "@/lib/exam-stage-kind";
import { currentExamStage, deriveStatusBadge, getCurrentExamSummary } from "@/lib/lifecycle";
import { buildTimeline, whatsNext } from "@/lib/timeline";
import { updateExamStages } from "@/lib/cms/record-ops";
import { prepublishChecks } from "@/lib/cms/prepublish-checks";
import { judgeArticle } from "@/lib/cms/importer/article";
import { buildProposal } from "@/lib/cms/importer/proposal";

const kinds = (names: string[]) => names.map((n) => [n, classifyStageName(n)]);
const expect = (want: Array<[string, ExamStageKind]>) => assert.deepEqual(kinds(want.map(([n]) => n)), want);

suite("Classed by code from the printed name");

test("SK01 IBPS CRP RRBs-XV: its nine schedule entries, as the model read them from the notice", () => {
  expect([
    ["Conduct of Pre-Exam Training (PET)", "TRAINING"],
    ["Download of call letters for online examination – Preliminary (Officers/ OA)", "ADMIT_CARD"],
    ["Online Examination – Preliminary (Officers/OA)", "SELECTION"],
    ["Result of Online exam – Preliminary (Officers/ OA)", "RESULT"],
    ["Download of Call letter for Online exam – Main / Single (Officers/ OA)", "ADMIT_CARD"],
    ["Online Examination – Main / Single (Officers/OA)", "SELECTION"],
    ["Declaration of Result – Main/ Single (For Officers Scale I, II and III)", "RESULT"],
    ["Download of call letters for interview (For Officers Scale I, II and III)", "ADMIT_CARD"],
    ["Conduct of interview (For Officers Scale I, II and III)", "SELECTION"],
  ]);
});
test("SK02 other formats: LIC HFL apprentices, SSC tiers, BTSC, a state police notice", () => {
  expect([
    ["Online Entrance Examination", "SELECTION"],
    ["Document Verification & Personal Interview", "SELECTION"],
    ["Issue of Engagement Letters", "OTHER_MILESTONE"],
    ["Apprenticeship Training Commencement", "TRAINING"],
    ["Tier-I (Computer Based Examination)", "SELECTION"],
    ["Tier-II", "SELECTION"],
    ["Skill Test (DEST)", "SELECTION"],
    ["Uploading of Tentative Answer Keys", "OTHER_MILESTONE"],
    ["Final Result", "RESULT"],
    ["Written Examination", "SELECTION"],
    ["Physical Efficiency Test (PET)", "SELECTION"],
    ["Medical Examination", "SELECTION"],
    ["Admit Card Release", "ADMIT_CARD"],
    ["Exam City Intimation Slip", "ADMIT_CARD"],
    ["Merit List", "RESULT"],
    ["Upload of documents by shortlisted candidates", "DOCUMENT"],
    // As the real model read LIC's schedule: an application or fee step is an announcement, even when it names the exam.
    ["Online application", "OTHER_MILESTONE"],
    ["Fee payment", "OTHER_MILESTONE"],
    ["Last Date to pay the examination fee to BFSI Sector Skill Council of India", "OTHER_MILESTONE"],
    ["Entrance Examination will be conducted by BFSI Sector Skill Council of India", "SELECTION"],
    ["Apprenticeship Start Date/Month", "TRAINING"],
    // As the real model read BTSC's article: application-window entries are announcements, not stages.
    ["Notification Advertisement No. 29/2026", "OTHER_MILESTONE"],
    ["Last Date to Apply Online", "OTHER_MILESTONE"],
    ["Last Date for Required Documents", "DOCUMENT"],
    ["CBT Exam Date", "SELECTION"],
  ]);
});
test("SK03 a name no rule recognises is not guessed: UNCLASSIFIED (PET alone, counselling, a bare code)", () => {
  expect([["PET", "UNCLASSIFIED"], ["Counselling", "UNCLASSIFIED"], ["Stage A", "UNCLASSIFIED"]]);
});

suite("The next exam counts selection stages only");

const on = (iso: string) => new Date(`${iso}T10:00:00`);
const IBPS: ExamStage[] = [
  { name: "Conduct of Pre-Exam Training (PET)", order: 1, status: "SCHEDULED", dateIso: "2026-11-02", certainty: "CONFIRMED", kind: "TRAINING" },
  { name: "Download of call letters – Preliminary", order: 2, status: "SCHEDULED", dateIso: "2026-11-10", certainty: "CONFIRMED", kind: "ADMIT_CARD" },
  { name: "Online Examination – Preliminary", order: 3, status: "SCHEDULED", dateIso: "2026-11-22", certainty: "CONFIRMED", kind: "SELECTION" },
  { name: "Result of Online exam – Preliminary", order: 4, status: "NOT_DECLARED", certainty: "TBA", notes: "December, 2026", kind: "RESULT" },
  { name: "Conduct of interview", order: 5, status: "NOT_DECLARED", certainty: "TBA", notes: "January, 2027", kind: "SELECTION" },
];

test("SK04 with training and call letters dated earlier, the box names the exam, with its date", () => {
  assert.equal(getCurrentExamSummary(IBPS, on("2026-10-28")), "Online Examination – Preliminary: 22 Nov 2026");
  assert.equal(currentExamStage(IBPS, on("2026-11-05"))?.name, "Online Examination – Preliminary");
});
test("SK05 a postponed result is not \"Exam Postponed\"; a postponed exam is", () => {
  const opp = (stages: ExamStage[]) => ({ type: "government", application: { openDate: "2026-09-01", closeDate: "2026-09-21" }, examStages: stages, postedAt: "2026-09-01" }) as unknown as Opportunity;
  const resultLate = IBPS.map((s) => (s.kind === "RESULT" ? { ...s, status: "POSTPONED" as const } : s));
  assert.notEqual(deriveStatusBadge(opp(resultLate), on("2026-10-28")).label, "Exam Postponed");
  const examLate = IBPS.map((s) => (s.order === 3 ? { ...s, status: "POSTPONED" as const } : s));
  assert.equal(deriveStatusBadge(opp(examLate), on("2026-10-28")).label, "Exam Postponed");
});
test("SK06 only announcements on record: the box says to be announced, not a call-letter date", () => {
  assert.equal(getCurrentExamSummary(IBPS.filter((s) => s.kind !== "SELECTION"), on("2026-10-28")), "To be announced");
});

suite("Kept and shown apart; older records unchanged");

test("SK07 the dates list: selection stages, then other announcements, each in the notice's order", () => {
  const g = stageGroups(IBPS);
  assert.deepEqual(g.map((x) => [x.title, x.stages.map((s) => s.order)]), [["Selection stages", [3, 5]], ["Other announcements", [1, 2, 4]]]);
});
test("SK08 a record stored without classes is one list, in its stored order, the same objects", () => {
  const legacy: ExamStage[] = [
    { name: "Tier-II", order: 2, status: "NOT_DECLARED" },
    { name: "Tier-I", order: 1, status: "SCHEDULED", dateIso: "2026-12-12", certainty: "TENTATIVE" },
  ];
  const g = stageGroups(legacy);
  assert.equal(g.length, 1);
  assert.equal(g[0].title, null);
  assert.equal(g[0].stages, legacy, "not copied or re-sorted: rendered exactly as before");
  assert.ok(legacy.every(isSelectionStage));
  // A tentative date says so in the Exam Schedule box (maintenance batch, Nov 2026).
  assert.equal(getCurrentExamSummary(legacy, on("2026-10-28")), "Tier-I: 12 Dec 2026 (tentative)");
});
test("SK09 the timeline keeps every announcement, marked as such; what's next can be a call letter, never a fallback stage", () => {
  const job = { type: "government", application: { openDate: "2026-09-01", closeDate: "2026-09-21" }, examStages: IBPS } as unknown as Opportunity;
  const tl = buildTimeline(job, on("2026-10-28")).filter((e) => e.kind !== "application");
  assert.deepEqual(tl.map((e) => [e.label.slice(0, 22), e.kind]), [
    ["Conduct of Pre-Exam Tr", "milestone"], ["Download of call lette", "milestone"], ["Online Examination – P", "stage"],
    ["Result of Online exam ", "milestone"], ["Conduct of interview", "stage"],
  ]);
  assert.equal(whatsNext(job, on("2026-10-28"))?.title, "Conduct of Pre-Exam Training (PET)", "the nearest dated event, whatever it is");
  const undated = { ...job, examStages: IBPS.map((s) => ({ ...s, status: "NOT_DECLARED" as const, dateIso: undefined, certainty: "TBA" as const })) } as unknown as Opportunity;
  assert.equal(whatsNext(undated, on("2026-10-28"))?.title, "Online Examination – Preliminary", "with nothing dated, a selection stage, not training");
});

suite("Saved, imported and checked");

const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: ["e1"], conflict: false, manuallyEdited: false });
const record = (stages: ExamStage[] = []): RecruitmentRecord => ({
  id: randomUUID(), slug: "t-2026", draftState: "DRAFT", recordRevision: "r",
  identity: { organizationId: "ibps", organizationName: "IBPS", recruitmentYear: 2026, title: pf("Test 2026") },
  dates: { applicationCloseDate: pf<string | null>("2026-09-21") }, vacancies: {}, financial: {}, links: [], documents: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
  updates: [], examStages: stages, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}) as RecruitmentRecord;

test("SK10 the class is saved as given; a stage without one stays without one; an unknown class is refused", () => {
  const { record: r } = updateExamStages(record(), [
    { name: "Download of call letters", status: "NOT_DECLARED", kind: "ADMIT_CARD" },
    { name: "Tier-I", status: "NOT_DECLARED" },
  ], randomUUID());
  assert.deepEqual(r.examStages!.map((s) => s.kind ?? "none"), ["ADMIT_CARD", "none"]);
  assert.throws(() => updateExamStages(record(), [{ name: "x", status: "NOT_DECLARED", kind: "EXAM" }], randomUUID()), /unknown kind/);
  assert.equal(updateExamStages(record(), Array(20).fill({ name: "x", status: "NOT_DECLARED" }), randomUUID()).record.examStages!.length, 20, "room for the announcements");
});
test("SK11 Smart intake: every entry read is kept with its class; an unrecognised one is flagged for the admin", () => {
  const text = "Schedule: Conduct of Pre-Exam Training November 2026. Online Examination – Preliminary November / December 2026. Counselling January 2027. Result of Online exam December 2026.";
  const quote = (q: string) => q;
  const read = judgeArticle({ examStages: [
    { name: "Conduct of Pre-Exam Training", dateText: "November 2026", quote: quote("Conduct of Pre-Exam Training November 2026") },
    { name: "Online Examination – Preliminary", dateText: "November / December 2026", quote: quote("Online Examination – Preliminary November / December 2026") },
    { name: "Counselling", dateText: "January 2027", quote: quote("Counselling January 2027") },
    { name: "Result of Online exam", dateText: "December 2026", quote: quote("Result of Online exam December 2026") },
  ] }, text);
  const stages = read.values.find((v) => v.fieldPath === "examStages")!.value as ExamStage[];
  assert.deepEqual(stages.map((s) => s.kind), ["TRAINING", "SELECTION", "UNCLASSIFIED", "RESULT"]);
  const proposal = buildProposal({
    extractions: [{ retrieval: { id: "r1", declaredKind: "OFFICIAL_NOTIFICATION", authenticity: "ATTESTED", originRole: "NONE", originPurposes: [], label: "notice" }, values: read.values, links: [] }],
    current: () => undefined,
  });
  const item = proposal.items.find((i) => i.fieldPath === "examStages")!;
  assert.ok(item.flags.some((f) => /not classified .*“Counselling”.* choose in the exam stages editor/.test(f)), item.flags);
});
test("SK12 before publishing, an unclassified entry is warned about", () => {
  const checks = prepublishChecks(record([{ name: "Counselling", order: 1, status: "NOT_DECLARED", kind: "UNCLASSIFIED" }]), "2026-10-28");
  assert.ok(checks.some((c) => c.level === "warning" && /“Counselling” is not classified/.test(c.text)), checks.map((c) => c.text));
});
