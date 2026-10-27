// Scanned pages (stage B2.4): what code does with a page the AI wrote out
// from its image. No AI here: transcriptions are given, as the model returns
// them, and checked through the same builder (B1) and vacancy engine (A1).
// LIC HFL Table E is made from the person-checked rows (pages 6-9, heading
// on page 6 only); the Telangana page 23 was read off the page image by a
// person. Plus made-up pages for unclear, zero, NR, blank and wrong figures.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/scan-tables.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { figureToken, foundTablesFromTranscription, pageText, parseTranscription, type TranscribedPage } from "@/lib/cms/importer/scan-tables";
import { buildVacancyTable, readVacancyTables } from "@/lib/cms/importer/vacancy-tables";
import { analyseVacancyTable, calculatedTotalReady, vacancyTableShapeErrors } from "@/lib/vacancy-table";
import { LIC_TABLE_E_ROWS } from "../fixtures/vacancy-tables";

const TG: TranscribedPage = JSON.parse(readFileSync("tests/fixtures/scans/tg-page23-transcription.json", "utf8"));
const build = (pages: TranscribedPage[]) => {
  const { found, problems, unread } = foundTablesFromTranscription(pages);
  const { table, coverage } = buildVacancyTable(found, { retrievalId: "scan", fallbackPost: "Apprentice" });
  return { found, problems, unread, table: table!, coverage, an: table ? analyseVacancyTable(table) : null };
};
const LIC_COLUMNS = ["State", "City", "Number of Vacancies"];
/** LIC Table E as the model writes it out, page by page: the heading on page 6 only, then rows continuing. */
function licPages(edit?: (rows: Array<{ page: number; cells: string[] }>) => void): TranscribedPage[] {
  const rows = LIC_TABLE_E_ROWS.map((r) => ({ page: r.page, cells: [r.state, r.city, r.n === null ? "[blank]" : String(r.n)] }));
  edit?.(rows);
  return [6, 7, 8, 9].map((page) => ({
    page, lines: [`P a g e ${page} | 10`],
    tables: [{ title: page === 6 ? "Table E" : "", continues: page !== 6, columns: LIC_COLUMNS,
      rows: [...rows.filter((r) => r.page === page).map((r) => r.cells), ...(page === 9 ? [["Grand Total", "[blank]", "232"]] : [])] }],
  }));
}

suite("Real tables, as the model writes them out");

test("ST01 Telangana page 23: three posts in G/W columns; the printed subtotals establish the columns; 1 + 26 + 2", () => {
  const { table, an, problems } = build([TG]);
  assert.deepEqual(problems, []);
  assert.deepEqual(an!.groups.map((g) => [g.name.slice(0, 13), g.total?.value, g.total?.complete]), [["Post Code: 14", 1, true], ["Post Code: 15", 26, true], ["Post Code: 16", 2, true]]);
  assert.equal(an!.grandTotal?.value, 29);
  assert.deepEqual(an!.issues, []);
  assert.ok(table.rows.every((r) => r.source.readBy === "AI_IMAGE" && r.source.page === 23), "every row is marked as read from the image by AI, with its page");
  assert.ok(table.categories.every((c) => c.kind === "VERTICAL" && /TOTAL G and TOTAL W columns add up these columns/.test(c.established?.note ?? "")));
  const post15 = table.rows.find((r) => /Post Code: 15/.test(r.at.post))!;
  assert.equal(post15.cells.ph_w, 1);
  assert.ok(post15.source.line.includes("01 (VH)"), "the note printed in the cell stays in the evidence line");
  assert.deepEqual(vacancyTableShapeErrors(table), [], "the editor accepts the table");
});
test("ST02 LIC Table E over four scanned pages: 181 cities, Ananthapur 1, printed Grand Total 232, each row with its page", () => {
  const { table, an, problems } = build(licPages());
  assert.deepEqual(problems, []);
  assert.equal(table.rows.length, 181);
  assert.equal(table.rows.find((r) => r.at.city === "Ananthapur")!.total, 1);
  assert.deepEqual([an!.grandTotal?.value, an!.grandTotal?.complete], [232, true]);
  assert.ok(LIC_TABLE_E_ROWS.every((p) => table.rows.some((r) => r.at.city === p.city && r.at.state === p.state && r.source.page === p.page)));
});
test("ST03 a row repeated at the top of the next page is counted once, and said", () => {
  const pages = licPages();
  const lastOn7 = pages[1].tables[0].rows[pages[1].tables[0].rows.length - 1];
  pages[2].tables[0].rows.unshift([...lastOn7]);
  const { table, problems, an } = build(pages);
  assert.equal(table.rows.length, 181);
  assert.equal(an!.grandTotal?.value, 232);
  assert.ok(problems.some((p) => /page 8: the row .* is repeated from the foot of page 7; counted once/.test(p)), problems.join("; "));
});

suite("Unreadable, zero, NR, blank: kept apart, never filled in");

const made = (rows: string[][]): TranscribedPage => ({ page: 3, lines: [], tables: [{ title: "Vacancies", continues: false, columns: ["District", "SC", "ST", "OBC", "UR", "Total"], rows }] });
test("ST04 an unreadable figure is flagged on its row; zero is nil; NR is not reported; an empty row has no figure", () => {
  const { table, an } = build([made([
    ["Patna", "2", "[unclear]", "3", "5", "11"],
    ["Gaya", "0", "0", "0", "0", "0"],
    ["Nalanda", "NR", "NR", "NR", "NR", "NR"],
    ["Vaishali", "[blank]", "[blank]", "[blank]", "[blank]", "[blank]"],
    ["Siwan", "1", "1", "Nil", "2", "[unclear]"],
  ])]);
  const by = (d: string) => table.rows.find((r) => r.at.district === d)!;
  assert.deepEqual([by("Patna").status, by("Patna").unclear, by("Patna").cells.st], ["STATED", ["st"], undefined]);
  assert.equal(by("Gaya").status, "NIL");
  assert.equal(by("Nalanda").status, "NOT_REPORTED");
  assert.equal(by("Vaishali").status, "NO_FIGURE");
  assert.deepEqual([by("Siwan").unclear, by("Siwan").total, by("Siwan").cells.obc], [["total"], undefined, 0]);
  const unclear = an!.issues.filter((i) => i.code === "UNCLEAR_FIGURE");
  assert.equal(unclear.length, 2);
  assert.ok(unclear.every((i) => i.severity === "ERROR" && /could not be read on the scanned page \(page 3\)/.test(i.message)));
  assert.equal(an!.groups[0].total?.complete, false, "a total that needs an unreadable figure is never complete");
});
test("ST05 text where a figure belongs is unreadable, never read as a figure; a row with the wrong number of cells is not read, and said", () => {
  const { table, problems, unread } = build([made([
    ["Patna", "2", "1", "3", "5", "11"],
    ["Gaya", "2", "one", "3", "5", "11"],
    ["Nalanda", "2", "1", "3", "5"],
  ])]);
  assert.deepEqual(table.rows.find((r) => r.at.district === "Gaya")!.unclear, ["st"]);
  assert.ok(problems.some((p) => /“one” under ST is not a figure; treated as unreadable/.test(p)));
  assert.deepEqual(unread.map((u) => u.text), ["Nalanda | 2 | 1 | 3 | 5"]);
  assert.ok(problems.some((p) => /has 5 cells for 6 columns; not read/.test(p)));
});

suite("A wrong figure in the AI's reading is caught, never corrected");

test("ST06 Telangana post 15 with OC W read as 04 instead of 03: its row is an error, its W subtotal disagrees, nothing is changed, the total is not ready", () => {
  const wrong: TranscribedPage = JSON.parse(JSON.stringify(TG));
  wrong.tables[1].rows[0][2] = "04";
  const { table, an, problems } = build([wrong]);
  const post15 = table.rows.find((r) => /Post Code: 15/.test(r.at.post))!;
  assert.equal(post15.cells.oc_w, 4, "the figure stays as the AI read it");
  assert.ok(problems.some((p) => /the W columns add up to 13; the printed TOTAL W is 12/.test(p)), problems.join("; "));
  const err = an!.issues.find((i) => i.code === "ROW_TOTAL_MISMATCH");
  assert.ok(err && err.severity === "ERROR" && err.rowIds!.includes(post15.id) && /add up to 27, the printed total is 26/.test(err.message), JSON.stringify(an!.issues));
  const ready = calculatedTotalReady(table, { tableChecked: false });
  assert.ok(!ready.ready && ready.reasons.some((r) => /row total mismatch/.test(r)) && ready.reasons.some((r) => /read from scanned page images by AI/.test(r)), ready.reasons.join("; "));
});
test("ST07 LIC with one city read as 3 instead of 2: the printed Grand Total 232 disagrees with the rows", () => {
  const { an } = build(licPages((rows) => { const r = rows.find((x) => x.cells[2] === "2")!; r.cells[2] = "3"; }));
  assert.ok(an!.issues.some((i) => i.code === "STATED_TOTAL_MISMATCH"), JSON.stringify(an!.issues.map((i) => i.code)));
});

suite("The model's answer and the page text");

test("ST08 a malformed answer keeps only well-formed tables; cells as tokens", () => {
  const p = parseTranscription({ lines: ["Table E", 7, ""], tables: [{ title: "x", columns: ["A"], rows: [] }, { title: "Table E:", columns: ["State", "City", "Total"], rows: [["Bihar", "Patna", 3], "bad"] }] }, 6);
  assert.deepEqual(p.lines, ["Table E"]);
  assert.deepEqual(p.tables.map((t) => [t.title, t.rows]), [["Table E", [["Bihar", "Patna", "3"]]]]);
  assert.deepEqual(["01", "1,234", "01 (VH)", "-", "[blank]", "", "NR", "N.R.", "Nil", "[unclear]", "one"].map(figureToken), ["01", "1,234", "01", "-", "-", "-", "NR", "NR", "0", "[unclear]", null]);
});
test("ST09 a mixed document: text pages read by the text reader, scanned pages from their transcription, one table, no page read twice", async () => {
  const textPage = ["Table A: Vacancies", "State City Number of", "Vacancies", "Bihar Patna 2", "Bihar Gaya 1", "Bihar Siwan 3", "", "-- 1 of 3 --"].join("\n");
  const scanned: TranscribedPage[] = [{ page: 2, lines: [], tables: [{ title: "Table B: Vacancies", continues: false, columns: ["State", "City", "Number of Vacancies"], rows: [["Assam", "Guwahati", "4"], ["Assam", "Silchar", "1"]] }] }];
  const text = `${textPage}\n${pageText(scanned[0], 3)}\n-- 3 of 3 --`;
  const { found } = foundTablesFromTranscription(scanned);
  const r = await readVacancyTables(text, { retrievalId: "m", fallbackPost: "Apprentice", apiKey: undefined, skipPages: [2], extraFound: found });
  assert.equal(r.table!.rows.length, 5);
  assert.deepEqual(r.table!.rows.map((x) => [x.at.city, x.source.page, x.source.readBy ?? "TEXT"]), [["Patna", 1, "TEXT"], ["Gaya", 1, "TEXT"], ["Siwan", 1, "TEXT"], ["Guwahati", 2, "AI_IMAGE"], ["Silchar", 2, "AI_IMAGE"]]);
  assert.equal(analyseVacancyTable(r.table!).grandTotal?.value, 11);
});

suite("What the real model did, kept as tests");

test("ST10 the model swapped post 14's TOTAL G and TOTAL W (\"01 | -\" for \"- | 01\"): both subtotals are flagged; the other posts still establish the columns", () => {
  const misread: TranscribedPage = JSON.parse(JSON.stringify(TG));
  const row = misread.tables[0].rows[0];
  [row[25], row[26]] = ["01", "-"];
  const { problems, table, an } = build([misread]);
  assert.ok(problems.some((p) => /the G columns add up to 0; the printed TOTAL G is 1/.test(p)) && problems.some((p) => /the W columns add up to 1; the printed TOTAL W is 0/.test(p)), problems.join("; "));
  assert.ok(table.categories.every((c) => c.kind === "VERTICAL"), "established by posts 15 and 16");
  assert.equal(an!.grandTotal?.value, 29);
});
test("ST11 a continued page without a heading row: no columns, or its first row given as the headings, joins the table on the page before", () => {
  const pages = licPages();
  pages[1].tables[0] = { ...pages[1].tables[0], columns: [] };
  const p8 = pages[2].tables[0];
  pages[2].tables[0] = { ...p8, columns: p8.rows[0], rows: p8.rows.slice(1) };
  pages[3].tables[0] = { ...pages[3].tables[0], columns: ["State", "City", "Vacancies"] };
  const { table, an, problems } = build(pages);
  assert.deepEqual(problems, []);
  assert.deepEqual([table.rows.length, an!.grandTotal?.value], [181, 232]);
});
