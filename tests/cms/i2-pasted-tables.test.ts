// I2: vacancy tables inside pasted text, read with the vacancy editor's own
// paste reader — which tables are offered, which wait for the admin to choose
// their columns, and which are not vacancy tables at all. Pure: no database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/i2-pasted-tables.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { joinPastedTables, readPastedTables } from "@/lib/cms/importer/pasted-tables";

const read = (t: string, prepared = true) => readPastedTables(t, { retrievalId: "src", prepared });
const rows = (t: ReturnType<typeof read>[number]) => t.table?.rows.map((r) => `${Object.values(r.at).join(" › ")}:${r.total ?? "-"}`) ?? null;

const PIPES = `TEST RECORD Prepared 2097
Last date to apply online: 09.02.2097
Vacancy table:
| Post | UR | EWS | SC | ST | OBC | Total |
|---|---|---|---|---|---|---|
| Assistant Engineer | 10 | 2 | 4 | 1 | 6 | 23 |
| Junior Engineer | 15 | 3 | 5 | 2 | 10 | 35 |
| Total | 25 | 5 | 9 | 3 | 16 | 58 |
Selection: Written examination and interview`;

suite("I2 A: the formats and layouts the paste reader reads");

test("A1 English pipes among narrative lines: rows by post, categories, its title; the Total line is the printed total, not a row", () => {
  const [t] = read(PIPES);
  assert.deepEqual([t.title, t.why, rows(t)], ["Vacancy table", null, ["Assistant Engineer:23", "Junior Engineer:35"]]);
  assert.deepEqual(t.table!.statedTotals.map((s) => s.total), [58]);
  assert.deepEqual(t.table!.categories.map((c) => c.key), ["ur", "ews", "sc", "st", "obc"]);
  assert.deepEqual(t.columns, ["Post → Post", "UR → category UR", "EWS → category EWS", "SC → category SC", "ST → category ST", "OBC → category OBC", "Total → total"]);
  assert.ok(t.table!.rows.every((r) => r.source.readBy === "PREPARED" && r.source.retrievalId === "src" && r.source.page === null && PIPES.includes(r.source.line)));
});
test("A2 tabs and commas", () => {
  assert.deepEqual(rows(read("Post\tUR\tSC\tTotal\nClerk\t10\t3\t13\nTypist\t4\t1\t5")[0]), ["Clerk:13", "Typist:5"]);
  assert.deepEqual(rows(read("Post,UR,SC,ST,Total\nClerk,10,3,2,15\nTypist,4,1,1,6")[0]), ["Clerk:15", "Typist:6"]);
});
test("A3 post with bank, state or district: each row under its post and its place", () => {
  for (const [dim, a, b] of [["Bank", "Delta Gramin Bank", "Epsilon Gramin Bank"], ["State", "Bihar", "Assam"], ["District", "Patna", "Gaya"]]) {
    const [t] = read(`| Post | ${dim} | UR | SC | Total |\n| Clerk | ${a} | 10 | 3 | 13 |\n| Clerk | ${b} | 4 | 1 | 5 |`);
    assert.deepEqual([t.why, t.table!.dimensions.map((d) => d.key), rows(t)], [null, ["post", dim.toLowerCase()], [`Clerk › ${a}:13`, `Clerk › ${b}:5`]], dim);
  }
});
test("A4 two tables in one text: both read; of one split they are one table, of two splits none is joined", () => {
  const ts = read("Table 1\n| Post | UR | SC | Total |\n| Clerk | 10 | 3 | 13 |\n\nTable 2\n| Post | UR | SC | Total |\n| Typist | 4 | 1 | 5 |");
  assert.deepEqual(ts.map(rows), [["Clerk:13"], ["Typist:5"]]);
  assert.deepEqual(joinPastedTables(ts.map((t) => t.table!))!.rows.map((r) => r.at.post), ["Clerk", "Typist"]);
  const two = read("| Post | UR | Total |\n| Clerk | 10 | 10 |\n\n| Post | Bank | UR | Total |\n| Clerk | Delta | 4 | 4 |");
  assert.equal(joinPastedTables(two.map((t) => t.table!)), null);
});
test("A5 research not marked prepared: its rows carry the research document, not “prepared”", () => {
  assert.ok(read(PIPES, false)[0].table!.rows.every((r) => r.source.readBy === undefined && r.source.retrievalId === "src"));
});
test("A6 wide-gap and PDF-line tables are not this reader's: code reads those from the text, as before", () => {
  assert.deepEqual(read("Name of Post        UR    SC    Total\nAssistant Engineer   10     4      14\nJunior Engineer      15     5      20"), []);
  assert.deepEqual(read("Name of Post UR SC Total\nAssistant Engineer 10 4 14\nJunior Engineer 15 5 20"), []);
});

suite("I2 B: what waits for the admin, and what is no vacancy table");

test("B1 a column the reader does not know: the table is said, its columns as suggested, no rows offered", () => {
  const [t] = read("| Post | UR | SC | FF | Total |\n| Clerk | 10 | 3 | 1 | 14 |\n| Typist | 4 | 1 | 0 | 5 |");
  assert.equal(t.table, null);
  assert.match(t.why!, /its columns need choosing: “FF” is not a category the reader knows/);
  assert.ok(t.columns.includes("FF → category FF") && t.lines.length === 3, "the columns and every line are kept for the paste box");
});
test("B2 the Hindi BPSC table (prepared): found, its Bihar categories (EBC, BC, BC women, FF) left for the admin to choose", () => {
  const [t] = read(readFileSync("tests/fixtures/paste/bpsc-72-prepared.txt", "utf8"));
  assert.equal(t.table, null);
  assert.match(t.why!, /अत्यंत पिछड़ा वर्ग \(EBC\)” is not a category the reader knows/);
  assert.ok(t.columns.some((c) => /^अनारक्षित → category/.test(c)) && t.columns.some((c) => /^वेतनमान → skipped$/.test(c)), t.columns.join(" | "));
});
test("B3 banks with no post column: the post is not taken from the line above", () => {
  const [t] = read("Office Assistants\nBank\tSC\tUR\tTotal\nDelta Gramin Bank\t2\t4\t6");
  assert.equal(t.table, null);
  assert.match(t.why!, /no column names the post \(the line above says “Office Assistants”\)/);
});
test("B4 a line that is not a row (a bad figure): the table is not offered, and why", () => {
  const [t] = read("| Post | UR | SC | Total |\n| Clerk | 1O | 3 | 13 |\n| Typist | 4 | 1 | 5 |");
  assert.equal(t.table, null);
  assert.match(t.why!, /not every line could be read as a row: Line 2, UR: "1O" is not a whole number/);
});
test("B5 fees, dates, marks and pay tables are not vacancy tables", () => {
  for (const t of [
    "Application fee:\n| Category | Fee (Rs) |\n| General | 600 |\n| SC/ST | 100 |",
    "| Item | General | OBC | SC |\n| Fee | 600 | 600 | 100 |",
    "| Subject | Questions | Marks |\n| Reasoning | 50 | 50 |\n| English | 50 | 50 |",
    "| Event | Date |\n| Apply from | 01.03.2097 |\n| Last date | 31.03.2097 |",
    "| Post | Pay Level |\n| Clerk | Level 2 |\n| Typist | Level 2 |",
  ]) assert.deepEqual(read(t), [], t);
});
test("B7 a vacancy table right under a fee line: the fee line is no title, so the table is still read", () => {
  const [t] = read("Application Fee: General/OBC ₹600, SC/ST/PwBD ₹100\n| Post | UR | SC | Total |\n| Clerk | 10 | 3 | 13 |");
  assert.deepEqual([t.title, t.why, rows(t)], ["", null, ["Clerk:13"]]);
});
test("B6 a vacancy table with a pay column: the pay is skipped, the table read", () => {
  const [t] = read("| Post | Pay Level | UR | SC | Total |\n| Clerk | Level 2 | 10 | 3 | 13 |");
  assert.deepEqual([t.why, rows(t), t.columns[1]], [null, ["Clerk:13"], "Pay Level → skipped"]);
});
