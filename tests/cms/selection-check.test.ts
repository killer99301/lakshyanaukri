// The selection process against stage names and the notice's own schedule
// (B2.6), by code, with the readings the real runs gave: IBPS left out the
// officers' interview; LIC read Document Verification as an interview; BTSC
// counted "Appointment and Training" as a stage; SSC added a generic
// "Computer Based Examination" beside Tier-I and Tier-II. Every change is
// said on the review item. No AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/selection-check.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { combineReading, skippedSection } from "@/lib/cms/importer/extract";
import { buildProposal, type ExtractedValue, type RetrievalSummary } from "@/lib/cms/importer/proposal";
import type { CmsSelectionInformation, CmsSelectionStage } from "@/types/recruitment-record";
import type { ExamStage } from "@/types";

const stage = (name: string, type: CmsSelectionStage["type"], order: number): CmsSelectionStage => ({ name, type, order });
function read(stages: CmsSelectionStage[], schedule: string[] = []) {
  const values: ExtractedValue[] = [{ fieldPath: "selection", value: { stages } satisfies CmsSelectionInformation, quote: "Selection" }];
  if (schedule.length) values.push({ fieldPath: "examStages", value: schedule.map((name, i) => ({ name, order: i + 1, status: "UPCOMING" }) as unknown as ExamStage), quote: "Tentative Schedule" });
  const text = "Tentative Schedule\nSelection\n-- 1 of 2 --\nGeneral instructions\n-- 2 of 2 --";
  return combineReading({
    content: text, kind: "pdf", url: "https://example.gov.in/n.pdf", organizationId: "x",
    ai: skippedSection("ai", "test"), details: skippedSection("details", "test"),
    pattern: { examPattern: { status: "not_stated" }, syllabus: { status: "not_stated" } } as never,
    article: { values, refused: [] },
  });
}
const selection = (r: ReturnType<typeof read>) => r.values.find((v) => v.fieldPath === "selection")!;
const names = (r: ReturnType<typeof read>) => (selection(r).value as CmsSelectionInformation).stages!.map((s) => `${s.order} ${s.type}: ${s.name}`);

const IBPS_SCHEDULE = [
  "Conduct of Pre-Exam Training (PET)", "Download of call letters for online examination – Preliminary (Officers/ OA)",
  "Online Examination – Preliminary (Officers/OA)", "Result of Online exam – Preliminary (Officers/ OA)",
  "Download of Call letter for Online exam – Main / Single (Officers/ OA)", "Online Examination – Main / Single (Officers/OA)",
  "Declaration of Result – Main/ Single (For Officers Scale I, II and III)", "Download of call letters for interview (For Officers Scale I, II and III)",
  "Conduct of interview (For Officers Scale I, II and III)",
];

suite("Selection stages against the schedule and their names");

test("SC01 IBPS: the officers' interview the schedule dates is added from it, to be checked for which posts it is for", () => {
  const r = read([stage("Preliminary Examination", "CBT", 1), stage("Main Examination", "CBT", 2), stage("Single level Examination", "CBT", 3)], IBPS_SCHEDULE);
  assert.deepEqual(names(r), ["1 CBT: Preliminary Examination", "2 CBT: Main Examination", "3 CBT: Single level Examination", "4 INTERVIEW: Conduct of interview (For Officers Scale I, II and III)"]);
  assert.deepEqual(selection(r).notes, ["“Conduct of interview (For Officers Scale I, II and III)” added from the notice's schedule (page 1): the selection process read did not include it — check which posts it is for"]);
});
test("SC02 IBPS when the reading has the interview (run of B2.5): nothing added, nothing said", () => {
  const r = read([stage("Preliminary Examination", "CBT", 1), stage("Main Examination", "CBT", 2), stage("Common Interview", "INTERVIEW", 3)], IBPS_SCHEDULE);
  assert.equal(names(r).length, 3);
  assert.equal(selection(r).notes, undefined);
});
test("SC03 LIC: “Document Verification” read as an interview is set to document verification, and said", () => {
  const r = read([stage("Online Examination", "WRITTEN", 1), stage("Document Verification", "INTERVIEW", 2)]);
  assert.deepEqual(names(r), ["1 WRITTEN: Online Examination", "2 DOCUMENT_VERIFICATION: Document Verification"]);
  assert.deepEqual(selection(r).notes, ["“Document Verification” was read as interview; its name says document verification: set so"]);
});
test("SC04 BTSC: “Appointment and Training” is not a stage of selection: taken out, and said", () => {
  const r = read([stage("Computer-Based Test (CBT)", "CBT", 1), stage("Document Verification", "DOCUMENT_VERIFICATION", 2), stage("Appointment and Training", "OTHER", 3)]);
  assert.deepEqual(names(r), ["1 CBT: Computer-Based Test (CBT)", "2 DOCUMENT_VERIFICATION: Document Verification"]);
  assert.deepEqual(selection(r).notes, ["“Appointment and Training” is left out of the selection process: training is not a stage of selection (it stays in the schedule if the notice dates it)"]);
});
test("SC05 SSC: a generic “Computer Based Examination” beside Tier-I and Tier-II is flagged, not removed", () => {
  const r = read([stage("Tier-I", "CBT", 1), stage("Tier-II", "CBT", 2), stage("Document Verification", "DOCUMENT_VERIFICATION", 3), stage("Computer Based Examination", "CBT", 4)]);
  assert.equal(names(r).length, 4);
  assert.deepEqual(selection(r).notes, ["“Computer Based Examination” may be the same as “Tier-I” and “Tier-II”: check, and remove it if so"]);
});
test("SC06 a reading code has nothing to say about is left exactly as read", () => {
  const r = read([stage("Computer-Based Test (CBT)", "CBT", 1), stage("Document Verification", "DOCUMENT_VERIFICATION", 2)]);
  assert.equal(selection(r).notes, undefined);
});
test("SC07 the notes are flags on the review item, next to the other flags", () => {
  const r = read([stage("Online Examination", "WRITTEN", 1), stage("Document Verification", "INTERVIEW", 2)]);
  const retrieval: RetrievalSummary = { id: "r1", declaredKind: "OFFICIAL_NOTIFICATION", authenticity: "ATTESTED", originRole: "AUTHORITY", originPurposes: [], label: "notice" };
  const p = buildProposal({ extractions: [{ retrieval, values: r.values, links: [] }], current: () => undefined });
  const item = p.items.find((i) => i.fieldPath === "selection")!;
  assert.ok(item.flags.includes("“Document Verification” was read as interview; its name says document verification: set so"), JSON.stringify(item.flags));
});

suite("No selection process from the reading: built from the notice's schedule (B2.6 decision 3)");

/** A reading with a schedule and no selection process, as the IBPS browser read gave it. */
function readNoSelection(schedule: string[], withEmptySelection = false) {
  const values: ExtractedValue[] = [{ fieldPath: "examStages", value: schedule.map((name, i) => ({ name, order: i + 1, status: "UPCOMING" }) as unknown as ExamStage), quote: "Tentative Schedule", page: 1 }];
  if (withEmptySelection) values.push({ fieldPath: "selection", value: { stages: [] }, quote: "Selection" });
  return combineReading({
    content: "Tentative Schedule\nSelection\n-- 1 of 2 --\nGeneral instructions\n-- 2 of 2 --", kind: "pdf", url: "https://example.gov.in/n.pdf", organizationId: "x",
    ai: skippedSection("ai", "test"), details: { ...skippedSection("details", "test"), selection: { status: "not_found" } } as never,
    pattern: { examPattern: { status: "not_stated" }, syllabus: { status: "not_stated" } } as never,
    article: { values, refused: [] },
  });
}

test("SC08 IBPS without a selection process: its schedule's three selection stages, as printed, in order; the announcements left out", () => {
  const r = readNoSelection(IBPS_SCHEDULE);
  assert.deepEqual(names(r), [
    "1 CBT: Online Examination – Preliminary (Officers/OA)", "2 CBT: Online Examination – Main / Single (Officers/OA)",
    "3 INTERVIEW: Conduct of interview (For Officers Scale I, II and III)",
  ], "post-specific applicability kept in the names; training, call letters and results are not stages");
});
test("SC09 it says it was built from the schedule, with the schedule's quote and page as its evidence", () => {
  const sel = selection(readNoSelection(IBPS_SCHEDULE));
  assert.deepEqual([sel.quote, sel.page], ["Tentative Schedule", 1]);
  assert.deepEqual(sel.notes, ["built from the notice's schedule (page 1): the reading gave no selection process, so its 3 selection stages are the schedule's own entries, as printed — check them against the notice"]);
});
test("SC10 a reading's own selection process is never replaced by the schedule's (the ordinary path)", () => {
  const r = read([stage("Preliminary Examination", "CBT", 1), stage("Main Examination", "CBT", 2), stage("Common Interview", "INTERVIEW", 3)], IBPS_SCHEDULE);
  assert.deepEqual(names(r), ["1 CBT: Preliminary Examination", "2 CBT: Main Examination", "3 INTERVIEW: Common Interview"]);
  assert.ok(!(selection(r).notes ?? []).some((n) => /built from the notice's schedule/.test(n)));
});
test("SC11 an empty selection process from the reading is filled from the schedule too", () => {
  assert.equal(names(readNoSelection(IBPS_SCHEDULE, true)).length, 3);
});
test("SC12 a schedule of announcements only (call letters, results, training): nothing is built", () => {
  const r = readNoSelection(["Conduct of Pre-Exam Training (PET)", "Download of call letters for online examination", "Declaration of Result"]);
  assert.equal(r.values.find((v) => v.fieldPath === "selection"), undefined);
});
test("SC13 built from the schedule, it is no longer listed as missing, and on the review item it is flagged for checking (Pending)", () => {
  const r = readNoSelection(IBPS_SCHEDULE);
  assert.ok(!r.notFound.some((l) => /^Selection Process/.test(l)), JSON.stringify(r.notFound));
  const retrieval: RetrievalSummary = { id: "r1", declaredKind: "OFFICIAL_NOTIFICATION", authenticity: "ATTESTED", originRole: "AUTHORITY", originPurposes: [], label: "notice" };
  const item = buildProposal({ extractions: [{ retrieval, values: r.values, links: [] }], current: () => undefined }).items.find((i) => i.fieldPath === "selection")!;
  assert.ok(item.flags.some((f) => /^built from the notice's schedule/.test(f)), JSON.stringify(item.flags));
});
