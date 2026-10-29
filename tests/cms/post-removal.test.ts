// Posts a corrigendum deletes (B2.6, design P2.3), read by code against the
// job's own vacancy table. The real case: BPSC 72nd CCE's शुद्धि-पत्र deletes
// सारणी-I serial 11, ईख पदाधिकारी (44 posts, 14 of them for women), and
// revises the total 1230-44 = 1186. Then what must refuse: a wrong count, a
// post the job does not have, a name that fits two posts, a revised total
// that does not add up. No AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/post-removal.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { readRemovals } from "@/lib/cms/importer/post-removal";
import { mergeTables } from "@/lib/cms/importer/vacancy-tables";
import { analyseVacancyTable, vacancyTableShapeErrors, type VacancyTable } from "@/lib/vacancy-table";
import { bpscTable } from "../fixtures/paste/bpsc-72";

const CORRIGENDUM = readFileSync("tests/fixtures/notice-text/bpsc-72-corrigendum.txt", "utf8");
const SUGARCANE = "ईख पदाधिकारी, गन्ना उद्योग विभाग";
const job = bpscTable();
const read = (text: string, table: VacancyTable | null = job) => readRemovals(text, table, { retrievalId: "r-corr" });

suite("BPSC 72nd CCE: the Sugarcane Officer corrigendum");

test("PR01 the deleted post is found by its serial and table, traced to the sentence that names it, with both quotes and their page", () => {
  const r = read(CORRIGENDUM);
  assert.deepEqual(r.refused, []);
  assert.equal(r.removals.length, 1);
  const x = r.removals[0];
  assert.deepEqual([x.post, x.count, x.printedCount, x.serial, x.table, x.rows.length], [SUGARCANE, 44, 44, "11", "I", 1]);
  assert.ok(/सारणी–I में क्रम संख्या–11 पर ईख पदाधिकारी \(गन्ना उद्योग विभाग\) का कोटिवार कुल 44 पद प्रकाशित किया गया है।/.test(x.quotes[0].text), x.quotes[0].text);
  assert.ok(/सारणी–I में क्रम संख्या–11 पर वर्णित पद को विलोपित किया जाता है।/.test(x.quotes[1].text), x.quotes[1].text);
  assert.deepEqual(x.quotes.map((q) => q.page), [1, 1]);
});
test("PR02 the revised total holds: the job's 1230, less the 44 posts deleted, is the 1186 the corrigendum prints", () => {
  const r = read(CORRIGENDUM);
  assert.deepEqual(r.total && [r.total.before, r.total.removed, r.total.after, r.total.quote, r.total.page], [1230, 44, 1186, "1230-44 = 1186", 1]);
  const after = analyseVacancyTable(r.table!);
  assert.deepEqual([after.grandTotal?.value, after.grandTotal?.basis, after.grandTotal?.complete], [1186, "STATED", true]);
  assert.deepEqual(after.issues.filter((i) => i.code === "STATED_TOTAL_MISMATCH"), [], "the rows add up to the printed 1186");
});
test("PR03 the post goes whole: its row, with the women's 14 inside its 44 (never subtracted again); every other post and figure untouched", () => {
  const r = read(CORRIGENDUM);
  const gone = r.removals[0].rows[0];
  assert.deepEqual([gone.total, gone.cells.women, gone.cells.ur], [44, 14, 18]);
  assert.equal(r.table!.rows.length, 24);
  assert.ok(!r.table!.rows.some((x) => x.at.post === SUGARCANE));
  assert.deepEqual(r.table!.rows, job.rows.filter((x) => x.at.post !== SUGARCANE), "the other 24 rows exactly as they were");
  assert.deepEqual([r.table!.dimensions, r.table!.categories], [job.dimensions, job.categories]);
  assert.deepEqual(vacancyTableShapeErrors(r.table!), []);
  // Women: 344 + 15 before, 14 fewer after, the share of the removed post only.
  const women = (t: VacancyTable) => t.rows.reduce((a, x) => a + (x.cells.women ?? 0), 0);
  assert.equal(women(job) - women(r.table!), 14);
});
test("PR04 सारणी I's printed Total line (1077) included the post: set aside, not left to disagree; the corrigendum's 1186 is the printed grand total", () => {
  const r = read(CORRIGENDUM);
  assert.deepEqual(r.droppedTotals.map((s) => [s.at, s.total]), [[{ table: "I" }, 1077]]);
  assert.deepEqual(r.table!.statedTotals.map((s) => [s.at, s.total, s.source.page, s.source.retrievalId]), [[{ table: "II" }, 153, 2, null], [{}, 1186, 1, "r-corr"]]);
});

suite("What refuses: nothing is removed by a guess");

test("PR05 a wrong count: the corrigendum says 45, the job's table has 44 — nothing removed, and why", () => {
  const r = read(CORRIGENDUM.replace("कुल 44 पद", "कुल 45 पद").replace("1230-44 = 1186", "1230-45 = 1185"));
  assert.equal(r.table, null);
  assert.deepEqual(r.removals, []);
  assert.ok(r.refused.some((x) => /the corrigendum says “ईख पदाधिकारी, गन्ना उद्योग विभाग” had 45 posts; the job's table has 44/.test(x.reason)), JSON.stringify(r.refused));
});
test("PR06 an unknown post: serial 31 of सारणी-I, a post the job does not have — nothing removed", () => {
  const r = read(CORRIGENDUM.replaceAll("क्रम संख्या–11", "क्रम संख्या–31").replace("ईख पदाधिकारी\n(गन्ना उद्योग विभाग)", "मत्स्य पदाधिकारी\n(पशु एवं मत्स्य संसाधन विभाग)"));
  assert.equal(r.table, null);
  assert.ok(r.refused.some((x) => /serial 31 of table I names no post of this job/.test(x.reason)), JSON.stringify(r.refused));
});
test("PR07 the right post in the wrong table (सारणी-II): nothing removed", () => {
  const r = read(CORRIGENDUM.replaceAll("सारणी–I", "सारणी–II"));
  assert.equal(r.table, null);
  assert.ok(r.refused.some((x) => /“ईख पदाधिकारी, गन्ना उद्योग विभाग” is not in table II/.test(x.reason)), JSON.stringify(r.refused));
});
test("PR08 a name that fits two of the job's posts: nothing removed, both named", () => {
  const two: VacancyTable = {
    dimensions: [{ key: "post", label: "Post" }], categories: [], statedTotals: [],
    rows: [
      { id: "a", at: { post: "Assistant Engineer (Civil)" }, status: "STATED", total: 12, cells: {}, source: { retrievalId: null, page: 3, line: "1 Assistant Engineer (Civil) 12" } },
      { id: "b", at: { post: "Assistant Engineer (Electrical)" }, status: "STATED", total: 8, cells: {}, source: { retrievalId: null, page: 3, line: "2 Assistant Engineer (Electrical) 8" } },
    ],
  };
  const r = read("Corrigendum\n\nThe post of Assistant Engineer advertised in the notice stands withdrawn.\n-- 1 of 1 --", two);
  assert.equal(r.table, null);
  assert.ok(r.refused.some((x) => /“assistant engineer” is the name of 2 of the job's posts \(Assistant Engineer \(Civil\); Assistant Engineer \(Electrical\)\)/.test(x.reason)), JSON.stringify(r.refused));
  // Named in full, the same corrigendum removes only that one.
  const one = read("Corrigendum\n\nThe post of Assistant Engineer (Electrical) advertised in the notice stands withdrawn.\n-- 1 of 1 --", two);
  assert.deepEqual([one.removals.map((x) => x.post), one.table?.rows.map((x) => x.id)], [["Assistant Engineer (Electrical)"], ["a"]]);
});
test("PR09 a revised total that does not add up, or does not start from the job's total: nothing removed", () => {
  const bad = read(CORRIGENDUM.replace("1230-44 = 1186", "1230-44 = 1196"));
  assert.equal(bad.table, null);
  assert.ok(bad.refused.some((x) => /its revised total does not add up: 1230 − 44 is 1186, not 1196/.test(x.reason)), JSON.stringify(bad.refused));
  const other = read(CORRIGENDUM.replace("1230-44 = 1186", "1240-44 = 1196"));
  assert.equal(other.table, null);
  assert.ok(other.refused.some((x) => /it starts from 1240; the job's table adds up to 1230/.test(x.reason)), JSON.stringify(other.refused));
});
test("PR10 a job with no vacancy table: nothing removed, and said", () => {
  const r = read(CORRIGENDUM, null);
  assert.equal(r.table, null);
  assert.ok(r.refused.every((x) => /the job has no vacancy table/.test(x.reason)) && r.refused.length >= 1);
});
test("PR11 a corrigendum that deletes nothing removes nothing, and says nothing", () => {
  const r = read("Corrigendum\n\nThe last date for applying is extended to 30.06.2026.\n-- 1 of 1 --");
  assert.deepEqual([r.found, r.removals, r.refused, r.table], [0, [], [], null]);
});

suite("A corrigendum that both adds and removes posts");

test("PR12 a new post from the corrigendum's table is added and the deleted one removed; the rest untouched", () => {
  const added: VacancyTable = {
    dimensions: job.dimensions, categories: job.categories, statedTotals: [],
    rows: [{ id: "n1", at: { post: "सहायक निदेशक, ईख विकास एवं समकक्ष", table: "III" }, status: "STATED", total: 44, cells: { ur: 18 }, source: { retrievalId: "r-corr", page: 1, line: "1 | सहायक निदेशक, ईख विकास एवं समकक्ष | III | 18 | 44" } }],
  };
  const merged = mergeTables(job, added, true).table; // a corrigendum's table never removes by leaving a post out
  assert.equal(merged.rows.length, 26);
  const r = read(CORRIGENDUM.replace("1230-44 = 1186", ""), merged);
  assert.deepEqual(r.refused, []);
  assert.deepEqual([r.table!.rows.length, r.table!.rows.some((x) => x.id === "n1"), r.table!.rows.some((x) => x.at.post === SUGARCANE)], [25, true, false]);
  assert.equal(analyseVacancyTable(r.table!).grandTotal?.value, 1230 + 44 - 44);
});

suite("A scan reads the name a little differently (B2.6 final run 1: “ईंख” for “ईख”)");

/** The corrigendum as the second real read wrote it: the post's name with a dot too many. */
const READ_AS = CORRIGENDUM.replace("पर ईख पदाधिकारी", "पर ईंख पदाधिकारी");
test("PR13 serial 11 of सारणी-I is exactly one post, its count 44 matches, its name is within two characters: removed, and the spelling said", () => {
  assert.ok(READ_AS !== CORRIGENDUM);
  const r = read(READ_AS);
  assert.deepEqual(r.refused, []);
  assert.deepEqual([r.removals[0]?.post, r.removals[0]?.readAs, r.removals[0]?.printedCount, r.table?.rows.length], [SUGARCANE, "ईंख पदाधिकारी", 44, 24]);
  assert.equal(r.total?.after, 1186);
});
test("PR14 the same, but no count printed to confirm it: nothing removed", () => {
  const r = read(READ_AS.replace("का कोटिवार कुल 44 पद प्रकाशित", "का पद प्रकाशित").replace("1230-44 = 1186", ""));
  assert.equal(r.table, null);
  assert.ok(r.refused.some((x) => /reads “ईंख पदाधिकारी”, not quite “ईख पदाधिकारी, गन्ना उद्योग विभाग”, and it prints no count to confirm it/.test(x.reason)), JSON.stringify(r.refused));
});
test("PR15 a near name at a serial where the job printed another post: nothing removed", () => {
  const r = read(READ_AS.replaceAll("क्रम संख्या–11", "क्रम संख्या–12"));
  assert.equal(r.table, null);
  assert.ok(r.refused.length > 0);
});
test("PR16 a name more than two characters off is no match: nothing removed", () => {
  const r = read(CORRIGENDUM.replace("पर ईख पदाधिकारी", "पर ईखरस अधिकारी"));
  assert.equal(r.table, null);
  assert.ok(r.refused.some((x) => /serial 11 of table I names no post of this job/.test(x.reason)), JSON.stringify(r.refused));
});
