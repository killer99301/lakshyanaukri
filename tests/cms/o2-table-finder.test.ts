// O2: the code vacancy-table reader finds short tables and tables under fee,
// age or marks lines, takes no fee, age, marks or date table for vacancies,
// and says when a short table under a vacancy heading cannot be taken. Pure:
// made-up notice text, no AI, no database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/o2-table-finder.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { findVacancyTables, linesWithPages, readVacancyTables } from "@/lib/cms/importer/vacancy-tables";

const P = (...pages: string[]) => pages.map((p, i) => `${p}\n\n-- ${i + 1} of ${pages.length} --\n`).join("\n");
const FRONT = "Institute of Banking Personnel Selection\nCommon Recruitment Process for Office Assistants\nAdvertisement No. CRP-X/2089\nEducational Qualification: graduation in any stream\nAge as on 01-Oct-2089: 18 to 28 years\nOnline applications open on 05.10.2089\nLast date to apply online: 26.10.2089";
const FEE = "Application fee: General, EWS and OBC candidates Rs.850/-\nSC/ST/PwBD candidates Rs.175/-";
const HEAD = "Annexure I\nTentative vacancies\nSr. No. Name of the Bank SC ST OBC EWS UR Total";
const R = ["1 Delta Gramin Bank 2 1 3 1 4 11", "2 Epsilon Gramin Bank 1 1 2 1 3 8", "3 Theta Gramin Bank 1 0 2 1 2 6"];
const find = (text: string) => findVacancyTables(linesWithPages(text));
/** One table, of `rows` rows, every figure matched to a column by code. */
const isTable = (text: string, rows: number) => {
  const f = find(text);
  assert.equal(f.length, 1, `one table: ${JSON.stringify(f.map((t) => t.heading))}`);
  assert.equal(f[0].rows.length, rows);
  assert.ok(f[0].columns, `columns matched for "${f[0].heading}"`);
  return f[0];
};
const isNone = (text: string) => assert.deepEqual(find(text).map((t) => t.heading), []);

suite("O2: vacancy tables the reader must find");

test("P1 three rows, nothing before them (as before)", () => { isTable(P(FRONT, `${HEAD}\n${R.join("\n")}`), 3); });
test("P2 two rows", () => {
  const t = isTable(P(FRONT, `${HEAD}\n${R.slice(0, 2).join("\n")}`), 2);
  assert.deepEqual(t.rows.map((r) => [r.words, r.page]), [["Delta Gramin Bank", 2], ["Epsilon Gramin Bank", 2]]);
  assert.deepEqual(t.columns!.map((c) => c.key), ["sc", "st", "obc", "ews", "ur", "total"]);
});
test("P3 one row: one post, split by category", () => {
  const t = isTable(P(FRONT, "Vacancy details\nName of the Post SC ST OBC EWS UR Total\nFood Safety Officer 17 2 30 11 45 105"), 1);
  assert.deepEqual(t.rows[0].figures, ["17", "2", "30", "11", "45", "105"]);
});
test("P4 three rows after fee lines naming categories, later on page 1", () => { isTable(P(`${FRONT}\n${FEE}`, `${HEAD}\n${R.join("\n")}`), 3); });
test("P5 three rows, the fee lines at the top of page 1", () => { isTable(P(`${FEE}\n${FRONT}`, `${HEAD}\n${R.join("\n")}`), 3); });
test("P6 two rows after fee lines", () => { isTable(P(`${FRONT}\n${FEE}`, `${HEAD}\n${R.slice(0, 2).join("\n")}`), 2); });
test("P7 a fee line naming no categories (as before)", () => {
  isTable(P(`${FRONT}\nApplication fee: General candidates Rs.850/-\nReserved category candidates Rs.175/-`, `${HEAD}\n${R.join("\n")}`), 3);
});
test("P8 a web page or pasted text (no page markers): two rows after a fee line, with no page", () => {
  const t = isTable(`${FRONT}\n${FEE}\n${HEAD}\n${R.slice(0, 2).join("\n")}`, 2);
  assert.ok(t.rows.every((r) => r.page === null));
});
test("P9 fee lines right above the table's own title and heading", () => {
  const t = isTable(P(FRONT, `${FEE}\n${HEAD}\n${R.join("\n")}`), 3);
  assert.equal(t.title, "Tentative vacancies");
});
test("P10 a heading split as 'SR' / 'NO.' / columns, row 1's name wrapped", () => {
  const t = isTable(P(FRONT, "OFFICE ASSISTANTS (MULTIPURPOSE)\nSR\nNO.\nSTATE BANK SC ST OBC\n(NCL) EWS GENERAL TOTAL\n1 ANDHRA\nPRADESH\nANDHRA PRADESH\nGRAMEENA BANK 144 63 243 90 360 900\n2 ASSAM ASSAM GRAMIN BANK 27 14 49 18 73 181\n3 BIHAR BIHAR GRAMIN BANK 75 38 135 50 202 500"), 3);
  assert.equal(t.rows[0].words, "ANDHRA PRADESH ANDHRA PRADESH GRAMEENA BANK");
});
test("P11 a reservation sentence naming SC, ST, OBC, EWS above the table: the table's own heading is used", () => {
  const t = isTable(P(FRONT, `Reservation for SC, ST, OBC and EWS candidates will be as per Government rules.\n${HEAD}\n${R.join("\n")}`), 3);
  assert.equal(t.heading, "Sr. No. Name of the Bank SC ST OBC EWS UR Total");
  assert.equal(t.rows[0].words, "Delta Gramin Bank", "row 1's name is its own, not the heading's");
});
test("P12 no title of its own, right under a date line", () => {
  isTable(P(FRONT, `Last date to apply online: 26.10.2089\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n${R.join("\n")}`), 3);
});
test("P13 two rows, the posts named in the rows, with a Total column", () => {
  const t = isTable(P(FRONT, "Details of vacancies\nName of Post UR EWS OBC SC ST Total\nAssistant Engineer 10 2 5 3 1 21\nJunior Engineer 20 4 10 6 2 42"), 2);
  assert.deepEqual(t.rows.map((r) => r.words), ["Assistant Engineer", "Junior Engineer"]);
});
test("P14 an age-relaxation line, a qualifying-marks line or a fee with ₹ above the table", () => {
  for (const line of ["Age relaxation: SC/ST candidates 5 years, OBC candidates 3 years", "Minimum qualifying marks: General 40%, SC/ST 35%", "Fee: ₹850/- for General and OBC; ₹175/- for SC and ST"])
    isTable(P(line, `${HEAD}\n${R.join("\n")}`), 3);
});
test("P15 a table of three rows or more is not dropped for one post named with a pay level, or for a Pay Level column", () => {
  isTable(P(FRONT, "Details of vacancies\nName of Post UR EWS OBC SC ST Total\nAssistant Engineer 10 2 5 3 1 21\nJunior Engineer 20 4 10 6 2 42\nStenographer (Pay Level 4) 3 1 2 1 0 7"), 3);
  const f = find(P(FRONT, "Details of vacancies\nName of Post Pay Level UR SC ST OBC Total\nAssistant Engineer 7 10 3 1 5 19\nJunior Engineer 6 20 6 2 10 38\nStenographer 4 3 1 0 2 6"));
  assert.equal(f.length, 1);
  assert.equal(f[0].rows.length, 3, "found as before; its columns are left for the next step to match");
});

suite("O2: other tables the reader must not take for vacancies");

test("N1 a fee table across categories, one row", () => { isNone(P(FRONT, "Application Fee\nCategory General OBC EWS SC ST\nFee (Rs.) 850 850 850 175 175")); });
test("N2 age limits across categories, one row, no 'age' in its heading and no Total", () => { isNone(P(FRONT, "Upper age limit (years)\nCategory UR OBC SC ST\nMaximum 32 35 37 37")); });
test("N3 age relaxation across categories, two rows", () => { isNone(P(FRONT, "Age relaxation\nCategory SC ST OBC EWS\nRelaxation (years) 5 5 3 0\nPwBD in addition 10 10 10 10")); });
test("N4 qualifying marks across categories, one row", () => { isNone(P(FRONT, "Minimum qualifying marks\nCategory UR EWS OBC SC ST\nQualifying marks (%) 40 40 35 35 35")); });
test("N5 an exam pattern, two rows", () => { isNone(P(FRONT, "Scheme of examination\nSl. No. Name of Test No. of Questions Maximum Marks Duration\n1 Reasoning 40 40 25\n2 English 30 30 20")); });
test("N6 an age table under a serial heading, three rows (read as vacancies before O2)", () => {
  isNone(P(FRONT, "Age limit as on 01.08.2089\nSr. No. Category UR SC ST OBC\n1 Maximum age 32 37 37 35\n2 Minimum age 21 21 21 21\n3 Relaxation 0 5 5 3"));
});
test("N7 a fee table, three rows, its heading naming categories", () => {
  isNone(P(FRONT, "Application fee\nSr. No. Category Fee Intimation charges Total\n1 General 750 100 850\n2 OBC 750 100 850\n3 SC/ST 75 100 175"));
});
test("N8 important dates written as figures, two rows", () => {
  isNone(P(FRONT, "Important dates\nEvent Day Month Year\nOnline registration opens 05 10 2089\nLast date for fee payment 26 10 2089"));
});

suite("O2: a short table under a vacancy heading that cannot be taken is said, and nothing else is");

const coverageOf = async (text: string) => (await readVacancyTables(text, { retrievalId: "doc", fallbackPost: "Office Assistant", apiKey: undefined })).coverage;

test("S1 two rows whose figures do not fit the heading: a table not read, with why, its page and its lines; no rows filled in", async () => {
  const r = await readVacancyTables(P(FRONT, "Tentative vacancies (supplementary)\nSr. No. Name of the Bank SC ST OBC EWS Others UR Total\n4 Kappa Gramin Bank 1 0 2 1 0 2 6\n5 Lambda Gramin Bank 0 1 1 0 1 2 5"),
    { retrievalId: "doc", fallbackPost: "Office Assistant", apiKey: undefined });
  assert.equal(r.table, null);
  assert.deepEqual(r.coverage.tables.map((t) => [t.title, t.pages, t.rows, t.read]), [["Tentative vacancies (supplementary)", [2], 2, false]]);
  assert.match(r.coverage.tables[0].why ?? "", /its 7 figures per row could not be matched to the heading's columns by code/);
  assert.deepEqual(r.coverage.unreadLines.map((l) => [l.page, l.text]), [[2, "4 Kappa Gramin Bank 1 0 2 1 0 2 6"], [2, "5 Lambda Gramin Bank 0 1 1 0 1 2 5"]]);
});
test("S2 fee, age, relaxation, marks, exam and date tables raise no warning", async () => {
  for (const text of [
    "Application Fee\nCategory General OBC EWS SC ST\nFee (Rs.) 850 850 850 175 175",
    "Upper age limit (years)\nCategory UR OBC SC ST\nMaximum 32 35 37 37",
    "Age relaxation\nCategory SC ST OBC EWS\nRelaxation (years) 5 5 3 0\nPwBD in addition 10 10 10 10",
    "Minimum qualifying marks\nCategory UR EWS OBC SC ST\nQualifying marks (%) 40 40 35 35 35",
    "Scheme of examination\nSl. No. Name of Test No. of Questions Maximum Marks Duration\n1 Reasoning 40 40 25\n2 English 30 30 20",
    "Age limit as on 01.08.2089\nSr. No. Category UR SC ST OBC\n1 Maximum age 32 37 37 35\n2 Minimum age 21 21 21 21\n3 Relaxation 0 5 5 3",
    "Important dates\nEvent Day Month Year\nOnline registration opens 05 10 2089\nLast date for fee payment 26 10 2089",
    "Fee by category\nCategory SC ST OBC EWS Total\nSC/ST/PwBD 175 175 0 0 175",
  ]) {
    const c = await coverageOf(P(FRONT, text));
    assert.deepEqual([c.tables, c.unreadLines], [[], []], text.split("\n")[0]);
  }
});
test("S3 a short table that is taken is not also reported", async () => {
  const c = await coverageOf(P(FRONT, `${HEAD}\n${R.slice(0, 2).join("\n")}`));
  assert.deepEqual(c.tables.map((t) => [t.rows, t.read]), [[2, true]]);
  assert.deepEqual(c.unreadLines, []);
});
test("S4 kept as it was (a known limit): a short table with a Pay Level column is neither taken nor reported", async () => {
  const c = await coverageOf(P(FRONT, "Details of vacancies\nName of Post Pay Level UR SC ST OBC Total\nAssistant Engineer 7 10 3 1 5 19"));
  assert.deepEqual([c.tables, c.unreadLines], [[], []]);
});
test("S5 kept as it was (a known limit): a short table right under a date or fee line is neither taken nor reported", async () => {
  const c = await coverageOf(P(FRONT, `Last date to apply online: 26.10.2089\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n${R.slice(0, 2).join("\n")}`));
  assert.deepEqual([c.tables, c.unreadLines], [[], []]);
});
