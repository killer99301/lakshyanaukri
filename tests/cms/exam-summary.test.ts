// Which exam stage the job page and cards talk about
//   npx tsx --tsconfig tsconfig.json tests/cms/exam-summary.test.ts
import { suite, test, assert } from "../intelligence/suite";
import type { ExamStage } from "@/types";
import { currentExamStage, getCurrentExamSummary } from "@/lib/lifecycle";

// LIC HFL Apprentice 2026, as entered from the notice.
const LIC: ExamStage[] = [
  { name: "Online Entrance Examination", order: 1, status: "SCHEDULED", dateIso: "2026-11-07", certainty: "CONFIRMED" },
  { name: "Document Verification & Personal Interview", order: 2, status: "SCHEDULED", dateIso: "2026-11-15", certainty: "CONFIRMED" },
  { name: "Issue of Engagement Letters", order: 3, status: "NOT_DECLARED", certainty: "TENTATIVE", dateDisplay: "Third week of November 2026" },
  { name: "Apprenticeship Training Commencement", order: 4, status: "NOT_DECLARED", certainty: "TENTATIVE", dateDisplay: "Fourth week of November 2026" },
];
const on = (iso: string) => new Date(`${iso}T10:00:00`);

suite("Exam schedule summary");
test("ES01 two stages scheduled: the next one ahead is shown, with its date", () => {
  assert.equal(getCurrentExamSummary(LIC, on("2026-10-22")), "Online Entrance Examination: 7 Nov 2026");
});
test("ES02 on the exam day it is still the exam", () => {
  assert.equal(currentExamStage(LIC, on("2026-11-07"))?.name, "Online Entrance Examination");
});
test("ES03 after the exam, the interview is next", () => {
  assert.equal(getCurrentExamSummary(LIC, on("2026-11-08")), "Document Verification & Personal Interview: 15 Nov 2026");
});
test("ES04 once every dated stage has passed, the furthest stage reached", () => {
  assert.equal(currentExamStage(LIC, on("2026-11-20"))?.name, "Document Verification & Personal Interview");
});
test("ES05 a written date is kept as written", () => {
  const stages: ExamStage[] = [{ name: "Tier 1", order: 1, status: "SCHEDULED", dateDisplay: "Dec 2026" }];
  assert.equal(getCurrentExamSummary(stages, on("2026-10-22")), "Tier 1: Dec 2026");
});
test("ES06 held, with the next stage scheduled: the next stage is named", () => {
  const stages: ExamStage[] = [
    { name: "Prelims", order: 1, status: "CONDUCTED" },
    { name: "Mains", order: 2, status: "SCHEDULED", dateDisplay: "Jan 2027" },
  ];
  assert.equal(getCurrentExamSummary(stages, on("2026-10-22")), "Mains: Jan 2027");
});
test("ES07 nothing declared", () => {
  assert.equal(getCurrentExamSummary([{ name: "Exam", order: 1, status: "NOT_DECLARED" }], on("2026-10-22")), "Exam date not declared");
  assert.equal(getCurrentExamSummary([], on("2026-10-22")), "To be announced");
});
