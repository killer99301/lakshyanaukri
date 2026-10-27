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
