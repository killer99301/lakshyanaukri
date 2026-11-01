// Tables that continue across text and scanned pages (stage B2.5), with no
// AI: LIC HFL Table E (pages 6-9, heading on page 6 only) made of the real
// text of some pages and, for the others, the transcription a model would
// return (built from the person-checked rows). Plus orphan rows, a row
// repeated at the break, and a continuation of the wrong width.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/cross-page.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { pagesOf } from "@/lib/cms/importer/article";
import { pageText, type TranscribedPage } from "@/lib/cms/importer/scan-tables";
import { readVacancyTables } from "@/lib/cms/importer/vacancy-tables";
import { analyseVacancyTable } from "@/lib/vacancy-table";
import { LIC_TABLE_E_ROWS } from "../fixtures/vacancy-tables";

const LIC = readFileSync("tests/fixtures/notice-text/lic-hfl-batch10-pages-5-9.txt", "utf8");
const textPages = new Map((pagesOf(LIC) ?? []).map((p) => [p.page, p.text]));
/** Page `n` as the model would write it out: the person-checked rows; the heading only on page 6; the Grand Total on page 9. */
const scanned = (n: number, edit?: (rows: string[][]) => void): TranscribedPage => {
  const rows = LIC_TABLE_E_ROWS.filter((r) => r.page === n).map((r) => [r.state, r.city, String(r.n)]);
  if (n === 9) rows.push(["Grand Total", "[blank]", "232"]);
  edit?.(rows);
  return { page: n, lines: [`P a g e ${n} | 10`], tables: [{ title: n === 6 ? "Table E" : "", continues: n !== 6, columns: n === 6 ? ["State", "City", "Number of Vacancies"] : [], rows }] };
};
/** The document's text: real text for text pages, the transcription for scanned ones (as the reading job builds it). */
const doc = (scans: TranscribedPage[]) => [5, 6, 7, 8, 9].map((n) => {
  const s = scans.find((x) => x.page === n);
  return s ? pageText(s, 10) : textPages.get(n)!.trim();
}).join("\n");
const read = (scans: TranscribedPage[]) => readVacancyTables(doc(scans), { retrievalId: "d", fallbackPost: "Apprentice", apiKey: undefined, scanPages: scans });
const byPage = (rows: Array<{ source: { page: number | null; readBy?: string } }>) => {
  const out: Record<string, number> = {};
  for (const r of rows) { const k = `${r.source.page}:${r.source.readBy ?? "TEXT"}`; out[k] = (out[k] ?? 0) + 1; }
  return out;
};

suite("One table across text and scanned pages");

test("CP01 text pages 6-7, then scanned pages 8-9 with no heading: one table, 181 cities, 232, each row with its page and how it was read", async () => {
  const r = await read([scanned(8), scanned(9)]);
  const t = r.table!;
  assert.deepEqual(r.coverage.problems ?? [], []);
  assert.equal(t.rows.length, 181);
  assert.deepEqual(byPage(t.rows), { "6:TEXT": 44, "7:TEXT": 46, "8:AI_IMAGE": 47, "9:AI_IMAGE": 44 });
  assert.equal(t.rows.find((x) => x.at.city === "Ananthapur")!.total, 1);
  const an = analyseVacancyTable(t);
  assert.deepEqual([an.grandTotal?.value, an.grandTotal?.complete, an.grandTotal?.basis], [232, true, "STATED"]);
  assert.ok(LIC_TABLE_E_ROWS.every((p) => t.rows.some((x) => x.at.city === p.city && x.at.state === p.state && x.source.page === p.page)), "every city in its state, on its page");
});
test("CP02 scanned pages 6-7 (heading on 6), then text pages 8-9 whose rows have no heading: one table, the same 181 and 232", async () => {
  const r = await read([scanned(6), scanned(7)]);
  const t = r.table!;
  assert.deepEqual(r.coverage.problems ?? [], []);
  assert.deepEqual(byPage(t.rows), { "6:AI_IMAGE": 44, "7:AI_IMAGE": 46, "8:TEXT": 47, "9:TEXT": 44 });
  assert.deepEqual([t.rows.length, analyseVacancyTable(t).grandTotal?.value], [181, 232]);
  assert.ok(LIC_TABLE_E_ROWS.every((p) => t.rows.some((x) => x.at.city === p.city && x.at.state === p.state && x.source.page === p.page)));
});
test("CP03 the last text row printed again at the top of the scanned page counts once, and is said", async () => {
  const last7 = LIC_TABLE_E_ROWS.filter((x) => x.page === 7).pop()!;
  const r = await read([scanned(8, (rows) => rows.unshift([last7.state, last7.city, String(last7.n)])), scanned(9)]);
  assert.equal(r.table!.rows.length, 181);
  assert.ok((r.coverage.problems ?? []).some((p) => /page 8: the row .* is repeated from the foot of page 7; counted once/.test(p)), r.coverage.problems);
});
test("CP04 the last scanned row printed again at the top of the text page counts once, and is said", async () => {
  const first8 = LIC_TABLE_E_ROWS.find((x) => x.page === 8)!;
  const r = await read([scanned(6), scanned(7, (rows) => rows.push([first8.state, first8.city, String(first8.n)]))]);
  assert.equal(r.table!.rows.length, 181);
  assert.ok((r.coverage.problems ?? []).some((p) => /page 8: the row .* is repeated from the foot of page 7; counted once/.test(p)), r.coverage.problems);
});

suite("What cannot be joined is said, never dropped");

test("CP05 rows at the top of a page that continue no table read are not read, and said", async () => {
  // Pages 6-7 scanned but their table not written out (the model missed it): pages 8-9's rows continue nothing.
  const empty = (n: number): TranscribedPage => ({ page: n, lines: [`P a g e ${n} | 10`], tables: [] });
  const r = await read([empty(6), empty(7)]);
  assert.equal(r.table, null);
  assert.ok((r.coverage.problems ?? []).some((p) => /page 8–9: 92 row\(s\) at the top of the page continue no table that was read; not read/.test(p)), r.coverage.problems);
  assert.equal(r.coverage.unreadLines.length, 47 + 44 + 1, "every orphan line listed (the rows and the Grand Total)");
  assert.ok(r.coverage.unreadLines.every((l) => l.page === 8 || l.page === 9));
});
test("CP06 a scanned continuation with an extra cell in a row: that row is not read, and said; the rest join", async () => {
  const r = await read([scanned(8, (rows) => { rows[3] = ["Jammu And", "Kashmir", "Jammu", "1"]; }), scanned(9)]);
  assert.equal(r.table!.rows.length, 180);
  assert.ok((r.coverage.problems ?? []).some((p) => /page 8: a row continuing .* has 4 cells where the table has 3; not read/.test(p)), r.coverage.problems);
  assert.deepEqual(r.coverage.unreadLines.filter((l) => l.page === 8).map((l) => l.text), ["Jammu And | Kashmir | Jammu | 1"]);
});
test("CP07 figures at the top of a page with no table before it (an index of clauses and pages) are no table: passed over, not reported", async () => {
  const text = ["Introduction to this recruitment notice for apprentices.", "", "-- 1 of 3 --", "",
    "INTRODUCTION 1", "A. PARTICIPATING BANKS 3", "B. ELIGIBILITY CRITERIA 4", "C. APPLICATION FEE 19", "", "-- 2 of 3 --", "",
    "General instructions for candidates.", "", "-- 3 of 3 --"].join("\n");
  const r = await readVacancyTables(text, { retrievalId: "d", fallbackPost: "Apprentice", apiKey: undefined });
  assert.equal(r.table, null);
  assert.deepEqual([r.coverage.problems ?? [], r.coverage.unreadLines], [[], []]);
});

suite("Printed spellings are kept; the AI's corrections are suggestions (B2.6)");

test("CP08 the model wrote the corrected spelling but listed it: the printed name goes back, the suggestion is kept beside it and said", async () => {
  const { parseTranscription } = await import("@/lib/cms/importer/scan-tables");
  const { analyseVacancyTable, vacancyTableShapeErrors } = await import("@/lib/vacancy-table");
  // As in B2.6: page 7 prints "Thiruvananthpuram"; the model wrote "Thiruvananthapuram".
  const p7 = scanned(7, (rows) => { for (const r of rows) if (r[1] === "Thiruvananthpuram") r[1] = "Thiruvananthapuram"; });
  const raw = { lines: p7.lines, tables: p7.tables, corrections: [{ printed: "Thiruvananthpuram", suggested: "Thiruvananthapuram" }] };
  const page7 = parseTranscription(raw as never, 7);
  assert.ok(page7.tables[0].rows.some((r) => r[1] === "Thiruvananthpuram") && !page7.tables[0].rows.some((r) => r[1] === "Thiruvananthapuram"));
  const r = await read([scanned(6), page7]);
  const row = r.table!.rows.find((x) => x.at.city === "Thiruvananthpuram")!;
  assert.deepEqual([row.at.city, row.suggested, row.source.page], ["Thiruvananthpuram", { city: "Thiruvananthapuram" }, 7]);
  assert.equal(r.table!.rows.length, 181);
  assert.ok(analyseVacancyTable(r.table!).issues.some((i) => i.code === "SUGGESTED_SPELLING" && /“Thiruvananthpuram” is kept as printed \(page 7\); the AI suggests “Thiruvananthapuram”/.test(i.message)));
  assert.deepEqual(vacancyTableShapeErrors({ ...r.table!, rows: r.table!.rows.map((x) => (x.id === row.id ? { ...x, at: { ...x.at, city: "Thiruvananthapuram" }, printedAt: { city: "Thiruvananthpuram" }, suggested: undefined } : x)) }), [], "applied by an admin, the printed name kept: a valid table");
});
test("CP09 a suggestion that names no printed word, or the same spelling, is dropped", async () => {
  const { parseTranscription } = await import("@/lib/cms/importer/scan-tables");
  const p = parseTranscription({ lines: ["Patna"], tables: [], corrections: [{ printed: "Patna", suggested: "Patna" }, { printed: "", suggested: "X" }] } as never, 3);
  assert.equal(p.corrections, undefined);
});

suite("A table continued under a \"(continued)\" heading and its column heading printed again (known defect, fixed)");

// docs/known-defects/continued-heading.md: the first row on the next page took both lines into its name.
const HEAD = "Sr. No. Name of the Bank SC ST OBC EWS UR Total";
const PAGE_1 = ["Annexure I", "Tentative vacancies", HEAD, "1 Alpha Gramin Bank 2 1 3 1 3 10", "2 Beta Gramin Bank 2 1 3 1 5 12", "-- 1 of 2 --"];
const twoPages = (page2: string[]) => [...PAGE_1, ...page2, "-- 2 of 2 --"].join("\n");
const readTwo = async (page2: string[]) => (await readVacancyTables(twoPages(page2), { retrievalId: "d", fallbackPost: "Officer", apiKey: undefined })).table!;
const brief = (rows: Array<{ at: Record<string, string>; total?: number; source: { page: number | null; line: string } }>) => rows.map((r) => [r.at.bank, r.total, r.source.page, r.source.line]);
const EXPECTED = [
  ["Alpha Gramin Bank", 10, 1, "1 Alpha Gramin Bank 2 1 3 1 3 10"],
  ["Beta Gramin Bank", 12, 1, "2 Beta Gramin Bank 2 1 3 1 5 12"],
  ["Gamma Gramin Bank", 8, 2, "3 Gamma Gramin Bank 1 1 2 1 3 8"],
];

test("CP10 the exact example: row 3 is “Gamma Gramin Bank”, page 2, its own printed line; nothing dropped or doubled; the total 30 as printed", async () => {
  const t = await readTwo(["Annexure I (continued)", HEAD, "3 Gamma Gramin Bank 1 1 2 1 3 8", "Total 5 3 8 3 11 30"]);
  assert.deepEqual(brief(t.rows), EXPECTED);
  const an = analyseVacancyTable(t);
  assert.deepEqual([an.grandTotal?.value, an.grandTotal?.complete, an.grandTotal?.basis], [30, true, "STATED"]);
  assert.deepEqual(t.statedTotals.map((s) => [s.total, s.source.page, s.source.line]), [[30, 2, "Total 5 3 8 3 11 30"]]);
  assert.equal(an.issues.length, 0, JSON.stringify(an.issues));
});
test("CP11 a continued table with no heading printed again reads as before", async () => {
  const t = await readTwo(["3 Gamma Gramin Bank 1 1 2 1 3 8", "Total 5 3 8 3 11 30"]);
  assert.deepEqual(brief(t.rows), EXPECTED);
  assert.equal(analyseVacancyTable(t).grandTotal?.value, 30);
});
test("CP12 only the column heading printed again, or only a \"contd.\" line: each passed over the same way", async () => {
  assert.deepEqual(brief((await readTwo([HEAD, "3 Gamma Gramin Bank 1 1 2 1 3 8", "Total 5 3 8 3 11 30"])).rows), EXPECTED);
  assert.deepEqual(brief((await readTwo(["Table 2 contd.", "3 Gamma Gramin Bank 1 1 2 1 3 8", "Total 5 3 8 3 11 30"])).rows), EXPECTED);
});
test("CP13 a genuine wrapped name after the repeated heading is kept, with its printed lines", async () => {
  const t = await readTwo(["Annexure I (continued)", HEAD, "3 Gamma Gramin", "Bank 1 1 2 1 3 8", "Total 5 3 8 3 11 30"]);
  assert.deepEqual(t.rows[2].at.bank, "Gamma Gramin Bank");
  assert.deepEqual([t.rows[2].source.page, t.rows[2].source.line], [2, "3 Gamma Gramin\nBank 1 1 2 1 3 8"]);
  assert.equal(t.rows.length, 3);
});
test("CP14 on the same page as the rows before it, a wrapped name line is never passed over, whatever it says", async () => {
  const t = (await readVacancyTables(["Annexure I", "Tentative vacancies", HEAD, "1 Alpha Gramin Bank 2 1 3 1 3 10", "2 Beta Gramin Bank 2 1 3 1 5 12", "3 Gamma Gramin Bank (continued", "from 2025) 1 1 2 1 3 8", "Total 5 3 8 3 11 30", "-- 1 of 1 --"].join("\n"),
    { retrievalId: "d", fallbackPost: "Officer", apiKey: undefined })).table!;
  assert.equal(t.rows[2].at.bank, "Gamma Gramin Bank (continued from 2025)");
});
