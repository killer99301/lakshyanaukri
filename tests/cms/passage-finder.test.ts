// Finding a notice's exam pattern and age limit by what the passage
// contains, not by a heading word (stage B2.1). No AI. Real pages: IBPS CRP
// RRBs-XV pages 6-8 and 20-25 (its pattern is headed "Online Examination
// Structure", which no heading rule matched), LIC HFL batch 10 pages 1-4,
// the BTSC FSO article. Plus made-up passages for other wordings and for
// lines that only look like a pattern or an age.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/passage-finder.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { findAgePassages, findPatternPassages, piecesOf } from "@/lib/cms/passage-finder";
import { buildSyllabusSections } from "@/lib/cms/ai-assist-syllabus";
import { buildDetailSections } from "@/lib/cms/ai-assist-details";
import { buildDateSections, buildFeeSections } from "@/lib/cms/ai-assist";

const IBPS = readFileSync("tests/fixtures/notice-text/ibps-crp-rrb-xv-pages-6-8-20-25.txt", "utf8");
const LIC = readFileSync("tests/fixtures/notice-text/lic-hfl-batch10-pages-1-4.txt", "utf8");
const BTSC = readFileSync("tests/fixtures/notice-text/btsc-fso-article.txt", "utf8");
const slices = (text: string, ps: Array<{ start: number; end: number }>) => ps.map((p) => text.slice(p.start, p.end));
const all = (parts: string[]) => parts.join("\n");

suite("IBPS CRP RRBs-XV: the pattern under \"Online Examination Structure\"");

test("PF01 every pattern table is found: preliminary, main and single level, with their titles", () => {
  const found = all(slices(IBPS, findPatternPassages(IBPS)));
  for (const line of [
    "The structure of the Examinations which will be conducted online are as follows:",
    "Preliminary Examination (objective) **", "2 Numerical Ability * 40 40 20 minutes",
    "Main Examination (objective)", "5 Quantitative Aptitude * 40 50 30 minutes", "Total 200 200 120 minutes",
    "Single level Examination (objective)", "1 Professional Knowledge Hindi/English 40 40 30 minutes", "TOTAL 240 200 150 minutes",
  ]) assert.ok(found.includes(line), `missing: ${line}`);
});
test("PF02 the pattern reader is given those tables (before: one sentence from page 4)", () => {
  const secs = all(buildSyllabusSections(IBPS, "pdf", "https://www.ibps.in/x.pdf", "IBPS RRB CRP-XV 2026 — Institute of Banking Personnel Selection").map((s) => s.text));
  for (const line of ["1 Reasoning * 40 40 25 minutes", "Total 200 200 120 minutes", "TOTAL 240 200 150 minutes"]) assert.ok(secs.includes(line), `not sent: ${line}`);
});
test("PF03 the age table is found, with every post's limits and the relaxations", () => {
  const found = all(slices(IBPS, findAgePassages(IBPS)));
  for (const line of ["II. Age (As on 01.09. 2026)", "Between 18 years", "Below 30 years Candidates should not have been born", "Below 40 years Candidates should not have been born", "1 Scheduled Caste (SC) /Scheduled Tribe (ST) 5 years"]) {
    assert.ok(found.includes(line), `missing: ${line}`);
  }
  const first = buildDetailSections(IBPS, "pdf", "https://www.ibps.in/x.pdf")[0];
  assert.ok(first.text.includes("II. Age (As on 01.09. 2026)"), "the age table goes to the detail reader first");
});

suite("LIC HFL and the BTSC article: tables without a duration on each row");

test("PF04 LIC: Table D's rows (questions and marks only) and the 60-minute line", () => {
  const found = all(slices(LIC, findPatternPassages(LIC)));
  for (const line of ["General/Financial Awareness 25 25", "Quantitative Aptitude 25 25", "Total 100 100", " Total duration of examination will be 60 minutes."]) assert.ok(found.includes(line), `missing: ${line}`);
  assert.ok(all(slices(LIC, findAgePassages(LIC))).includes("1 Age as on 01-Oct-2026 20 to 25 years"));
});
test("PF05 BTSC: the paper table and the minimum age", () => {
  const found = all(slices(BTSC, findPatternPassages(BTSC)));
  assert.ok(found.includes("Paper 2\tChemistry and Food Nutrition\t75\t75") && found.includes("Duration\t–\t2 Hours\t–"), found.slice(0, 300));
  assert.ok(all(slices(BTSC, findAgePassages(BTSC))).includes("The minimum age is 21 years as on 1 August 2026."));
});

suite("Other wordings, and lines that only look like a pattern or an age");

test("PF06 a pattern under any heading, or none: Plan of Examination, a Tier, hours", () => {
  const plan = ["7. PLAN OF EXAMINATION", "Subject No. of Questions Max. Marks Time", "General Intelligence 25 50", "General Awareness 25 50", "Quantitative Aptitude 25 50", "English Comprehension 25 50", "Total 100 200 1 hour"].join("\n");
  assert.equal(findPatternPassages(plan).length, 1);
  assert.ok(slices(plan, findPatternPassages(plan))[0].startsWith("7. PLAN OF EXAMINATION"));
  const tier = ["Tier-II (Paper I)", "Session I: Mathematical Abilities 30 questions 90 marks 1 hour", "Session II: Reasoning 30 questions 90 marks 1 hour"].join("\n");
  assert.equal(findPatternPassages(tier).length, 1);
  const html = `<html><body><h2>Written Test</h2><table><tr><th>Subject</th><th>Questions</th><th>Marks</th><th>Duration</th></tr><tr><td>General Studies</td><td>100</td><td>100</td><td>2 hours</td></tr><tr><td>Hindi</td><td>50</td><td>50</td><td>1 hour</td></tr></table><h2>Contact</h2><p>Phone 12345</p></body></html>`;
  assert.ok(buildSyllabusSections(html, "html", "https://example.gov.in/n").some((s) => /General Studies/.test(s.text)), "a section headed only \"Written Test\" is sent for its table");
});
test("PF07 not a pattern: compensatory time, a list of centres, a fee table, a dates table", () => {
  for (const text of [
    "Compensatory time of 20 minutes per hour of examination will be allowed to PwBD candidates.",
    ["Sr. No. Name of State/UT Version of tests", "1 Andhra Pradesh English, Hindi and Telugu", "2 Assam English, Hindi and Assamese", "3 Bihar English and Hindi"].join("\n"),
    ["Category Application fee", "General / OBC 850", "SC / ST / PwBD 175"].join("\n"),
    ["Activity Dates", "Online registration 01.09.2026 21.09.2026", "Payment of fees 01.09.2026 21.09.2026"].join("\n"),
  ]) assert.deepEqual(findPatternPassages(text), [], text.slice(0, 60));
});
test("PF08 not an age limit: a form's blank, a lone number of years of service", () => {
  assert.deepEqual(findAgePassages("Age ________ years, male/female ___________ registration No. ____"), []);
  assert.deepEqual(findAgePassages("Candidates must have 2 years of experience in a bank."), []);
});
test("PF09 a long passage is sent whole, in pieces cut at line ends", () => {
  const text = Array.from({ length: 300 }, (_, i) => `${i + 1} Subject ${i} 40 40 30 minutes`).join("\n");
  const pieces = piecesOf(text, [{ start: 0, end: text.length, score: 1 }], 1000);
  assert.equal(pieces.map((p) => text.slice(p.start, p.end)).join(""), text);
  assert.ok(pieces.every((p) => p.end - p.start <= 1000 && (p.end === text.length || text[p.end] === "\n")));
});
test("PF10 date and fee passages: \"Commencement\" and \"Application charges\" wordings", () => {
  const dates = ["Schedule", "Commencement of on-line registration of application 01.09.2026", "Closure of registration of application 21.09.2026"].join("\n");
  assert.equal(buildDateSections(dates, "pdf", "x").length, 1);
  const fee = ["Application charges payable", "Rs. 175/- for SC/ST/PwBD candidates", "Rs. 850/- for all others"].join("\n");
  assert.ok(buildFeeSections(fee, "pdf", "x")[0].text.includes("Rs. 850/-"));
});
