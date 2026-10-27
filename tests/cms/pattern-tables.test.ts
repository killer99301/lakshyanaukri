// Exam-pattern tables read by code (after B2.5): the papers a notice prints
// are counted first, then each table's rows read as printed; a table that
// cannot be read is named with its page; a printed total the rows do not add
// up to is said, never corrected; the AI's pattern is used only where the
// text has no pattern table. Real text of IBPS CRP RRBs-XV (7 papers), LIC
// HFL (1) and BTSC FSO (1); made-up SSC-style and marks-first tables. No AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/pattern-tables.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { findPatternTables, readPatternTables } from "@/lib/cms/importer/pattern-tables";
import { combineReading, skippedSection } from "@/lib/cms/importer/extract";
import type { ExamPatternPaper } from "@/types/recruitment-record";

const fixture = (f: string) => readFileSync(`tests/fixtures/notice-text/${f}`, "utf8");
const IBPS = fixture("ibps-crp-rrb-xv-pages-6-8-20-25.txt");
const LIC = fixture("lic-hfl-batch10-pages-1-4.txt");
const BTSC = fixture("btsc-fso-article.txt");
const brief = (p: ExamPatternPaper) => `${p.name} | ${p.totalQuestions}/${p.totalMarks} ${p.durationMinutes ?? "-"} min | ${p.sections.map((s) => `${s.subject} ${s.questions}/${s.marks}`).join("; ")}`;

suite("Real notices: every paper counted, then read as printed");

test("PT01 IBPS: seven tables, seven papers, each with its questions, marks and duration as printed, on its page", () => {
  const r = readPatternTables(IBPS);
  assert.deepEqual([r.coverage.expected, r.coverage.read, r.coverage.problems], [7, 7, []]);
  assert.deepEqual(r.papers.map(brief), [
    "Preliminary Examination (objective) – Office Assistants (Multipurpose) | 80/80 45 min | Reasoning 40/40; Numerical Ability 40/40",
    "Preliminary Examination (objective) – Officer Scale-I | 80/80 45 min | Reasoning 40/40; Quantitative Aptitude 40/40",
    "Main Examination (objective) – Office Assistants (Multipurpose) | 200/200 120 min | Reasoning 40/50; Computer Knowledge 40/20; General Awareness 40/40; English Language 40/40; Hindi Language 40/40; Numerical Ability 40/50",
    "Main Examination (objective) – Officer Scale-I | 200/200 120 min | Reasoning 40/50; Computer Knowledge 40/20; General Awareness 40/40; English Language 40/40; Hindi Language 40/40; Quantitative Aptitude 40/50",
    "Single level Examination (objective) – Officer Scale-II (General Banking Officer) | 200/200 120 min | Reasoning 40/50; Computer Knowledge 40/20; Financial Awareness 40/40; English Language 40/40; Hindi Language 40/40; Quantitative Aptitude & Data Interpretation 40/50",
    "Single level Examination (objective) – Officer Scale-II (Specialist Cadre) | 240/200 150 min | Professional Knowledge 40/40; Reasoning 40/40; Financial Awareness 40/40; English Language 40/20; Hindi Language 40/20; Computer Knowledge 40/20; Quantitative Aptitude & Data Interpretation 40/40",
    "Single level Examination (objective) – Officer Scale- III | 200/200 120 min | Reasoning 40/50; Computer Knowledge 40/20; Financial Awareness 40/40; English Language 40/40; Hindi Language 40/40; Quantitative Aptitude & Data Interpretation 40/50",
  ]);
  assert.deepEqual(r.coverage.tables.map((t) => t.page), [21, 21, 22, 22, 24, 24, 24]);
  assert.ok(r.papers.slice(2).every((p) => /choice of one/.test(p.note ?? "")), "4 a / 4 b: English or Hindi, counted once against the total");
});
test("PT02 LIC: no serial numbers, the medium printed once beside the table, a wrapped name, the duration in the sentence after", () => {
  const r = readPatternTables(LIC);
  assert.deepEqual([r.coverage.expected, r.coverage.read], [1, 1]);
  assert.equal(brief(r.papers[0]), "Table D: Online test | 100/100 60 min | General/Financial Awareness 25/25; General English 25/25; Reasoning Ability & Computer Aptitude 25/25; Quantitative Aptitude 25/25");
});
test("PT03 BTSC article: tab-separated parts, a dash for a blank total cell, the duration in hours", () => {
  const r = readPatternTables(BTSC);
  assert.equal(brief(r.papers[0]), "BTSC FSO Exam Pattern 2026 | 100/100 120 min | Paper 1 – General Studies and Mental Ability 25/25; Paper 2 – Chemistry and Food Nutrition 75/75");
});

suite("Other formats; nothing worked out, nothing hidden");

const SSC = [
  "Scheme of Examination", "Tier-I (Computer Based Examination)",
  "Part Subject No. of Questions Maximum Marks Duration",
  "A General Intelligence and Reasoning 25 50", "B General Awareness 25 50", "C Quantitative Aptitude 25 50", "D English Comprehension 25 50",
  "Total 100 200 60 minutes",
  "Tier-II", "Section Subject Number of Questions Maximum Marks",
  "1 Mathematical Abilities 30 90", "2 Reasoning and General Intelligence 30 90", "Total 60 180",
  "The duration of Tier-II will be 1 hour.",
].join("\n");

test("PT04 an SSC-style scheme: two tiers with letter-marked parts; each tier its own paper, its duration where printed", () => {
  const r = readPatternTables(SSC);
  assert.deepEqual(r.papers.map(brief), [
    "Tier-I (Computer Based Examination) | 100/200 60 min | General Intelligence and Reasoning 25/50; General Awareness 25/50; Quantitative Aptitude 25/50; English Comprehension 25/50",
    "Tier-II | 60/180 60 min | Mathematical Abilities 30/90; Reasoning and General Intelligence 30/90",
  ]);
});
test("PT05 a table printing marks before questions is read in that order", () => {
  const t = ["Written Test", "Subject Maximum Marks No. of Questions", "1 Hindi 100 50", "2 General Studies 100 100", "Total 200 150"].join("\n");
  assert.equal(brief(readPatternTables(t).papers[0]), "Written Test | 150/200 - min | Hindi 50/100; General Studies 100/100");
});
test("PT06 rows that do not add up to the printed total are kept as printed, and said", () => {
  const t = ["Paper I", "Subject No. of Questions Marks", "1 Reasoning 50 50", "2 Awareness 50 50", "Total 120 100"].join("\n");
  const r = readPatternTables(t);
  assert.equal(r.papers[0].totalQuestions, 120);
  assert.deepEqual(r.coverage.problems, ["Paper I: the questions add up to 100, the printed total is 120"]);
});
test("PT07 a table whose rows cannot be read is counted and named with its page; the other papers are read", () => {
  const t = [
    "Stage I", "Name of Test No. of Questions Maximum Marks", "1 Reasoning 40 40", "Total 40 40", "", "-- 3 of 9 --",
    "Stage II", "Name of Test No. of Questions Maximum Marks", "Descriptive paper on essay writing and letters (see Annexure)", "and précis as given in the annexure", "of this notice for all candidates", "who qualify", "-- 4 of 9 --",
  ].join("\n");
  const r = readPatternTables(t);
  assert.deepEqual([r.coverage.expected, r.coverage.read], [2, 1]);
  assert.deepEqual(r.coverage.tables.filter((x) => !x.read).map((x) => [x.heading, x.page, x.why]), [["Stage II", 4, "its rows could not be read"]]);
});
test("PT08 prose only (no table): nothing counted, so the AI's reading is the pattern", () => {
  const t = "Selection: a written test of 100 marks in General Studies, followed by an interview.";
  assert.deepEqual(findPatternTables(t), []);
});

suite("In the reading: the code's papers are the pattern");

const aiPapers = (n: number): ExamPatternPaper[] => Array.from({ length: n }, (_, i) => ({ name: `AI paper ${i + 1}`, sections: [{ subject: "Reasoning", questions: 40, marks: 40 }] }));
const combine = (content: string, ai: ExamPatternPaper[]) => combineReading({
  content, kind: "pdf", url: "https://example.gov.in/n.pdf", organizationId: "x",
  ai: skippedSection("ai", "test"), details: skippedSection("details", "test"),
  pattern: { examPattern: { status: "accepted", value: ai, dropped: 0, quotes: ["Reasoning"] }, syllabus: { status: "not_stated" } } as never,
  article: { values: [], refused: [] },
});

test("PT09 IBPS: the AI's four papers are replaced by the seven read by code, with the coverage kept for the review", () => {
  const r = combine(IBPS, aiPapers(4));
  const pattern = r.values.filter((v) => v.fieldPath === "examPattern");
  assert.equal(pattern.length, 1);
  assert.equal((pattern[0].value as ExamPatternPaper[]).length, 7);
  assert.equal(pattern[0].page, 21, "evidence: the first row's lines, on their page");
  assert.deepEqual([r.patternCoverage?.expected, r.patternCoverage?.read], [7, 7]);
});
test("PT10 no pattern table in the text: the AI's papers stay, and no coverage is claimed", () => {
  const r = combine("Selection: a written test of 100 marks. Reasoning section of 40 questions.", aiPapers(2));
  assert.equal((r.values.find((v) => v.fieldPath === "examPattern")!.value as ExamPatternPaper[]).length, 2);
  assert.equal(r.patternCoverage, undefined);
});
