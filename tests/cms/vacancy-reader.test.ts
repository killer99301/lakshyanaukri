// Reading vacancy tables from a notice's text (stage B1), with no AI: the
// tables found, their columns from the heading, every row read by code with
// its page and printed line, and the coverage report. Real pages: IBPS CRP
// RRBs-XV Annexure I (PDF pages 45-56) and LIC HFL batch 10 Table E (pages
// 5-9), as the importer's PDF reader gives them. Plus made-up tables for NR,
// nil, blanks, wrapped names, an unclear heading and tables that are not
// vacancies.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/vacancy-reader.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { buildVacancyTable, columnsFromHeading, findVacancyTables, linesWithPages, mergeTables, readVacancyTables, splitState, tableFromSplit } from "@/lib/cms/importer/vacancy-tables";
import { mergeCategoryRows } from "@/lib/cms/importer/article";
import { analyseVacancyTable } from "@/lib/vacancy-table";

const IBPS = readFileSync("tests/fixtures/notice-text/ibps-crp-rrb-xv-pages-45-56.txt", "utf8");
const LIC = readFileSync("tests/fixtures/notice-text/lic-hfl-batch10-pages-5-9.txt", "utf8");
const read = (text: string, fallbackPost = "Apprentice") => {
  const found = findVacancyTables(linesWithPages(text));
  return { found, ...buildVacancyTable(found, { retrievalId: "doc", fallbackPost }) };
};
/** Every printed bank line's own figures, independently of the reader: "… BANK a b c d e TOTAL …". */
const printedTotals = (text: string, page: number) => {
  const pageText = text.split(/\n-- \d+ of \d+ --\n?/)[page - 44] ?? "";
  return pageText.split("\n").map((l) => /BANK((?: (?:\d+|NR)){10,12})$/.exec(l.trim())).filter(Boolean).map((m) => m![1].trim().split(" ")[5]);
};

suite("IBPS CRP RRBs-XV: Annexure I, ten bank-wise tables");
const ibps = read(IBPS);
test("RD01 all ten tables on pages 46-55, with their own titles", () => {
  assert.deepEqual(ibps.found.map((t) => t.title), [
    "OFFICE ASSISTANTS (MULTIPURPOSE)", "OFFICER SCALE I", "Officer Scale II (General Banking Officer)", "Officer Scale II (IT)",
    "Officer Scale II (CA)", "Officer Scale II (Law)", "Officer Scale II (Treasury Manager)", "Officer Scale II (Marketing Officer)",
    "Officer Scale II (Agriculture Officer)", "Officer Scale III"]);
  assert.deepEqual(ibps.found.map((t) => t.pages.join(",")), ["46", "47", "48", "49", "50", "51", "52", "53", "54", "55"]);
  assert.ok(!ibps.found.some((t) => /out of which/i.test(t.title)), "a heading line is never a post");
});
test("RD02 columns from each heading, in printed order; 28 banks in every table", () => {
  assert.deepEqual(ibps.found[0].columns!.map((c) => c.key), ["sc", "st", "obc", "ews", "ur", "total", "pwbd_hi", "pwbd_oc", "pwbd_vi", "pwbd_id", "esm", "desm"]);
  for (const t of ibps.found.slice(1)) assert.deepEqual(t.columns!.map((c) => c.key), ["sc", "st", "obc", "ews", "ur", "total", "pwbd_hi", "pwbd_oc", "pwbd_vi", "pwbd_id"], t.title);
  assert.ok(ibps.found.every((t) => t.rows.length === 28 && t.unread.length === 0));
  assert.equal(ibps.found[0].columns!.find((c) => c.key === "ur")!.label, "General", "General is the unreserved column");
});
test("RD03 every bank's categories add up to its printed total; only Tripura is not reported", () => {
  const a = analyseVacancyTable(ibps.table!);
  assert.equal(ibps.table!.rows.length, 280);
  assert.deepEqual([...new Set(a.issues.map((i) => i.code))], ["NOT_REPORTED"]);
  assert.equal(a.issues.length, 10);
  assert.ok(a.issues.every((i) => /TRIPURA GRAMIN BANK/.test(i.message)));
});
test("RD04 the totals per post match the printed bank totals added independently", () => {
  const a = analyseVacancyTable(ibps.table!);
  ibps.found.forEach((t, i) => {
    const printed = printedTotals(IBPS, t.pages[0]).filter((v) => v !== "NR").reduce((s, v) => s + Number(v), 0);
    assert.equal(a.groups[i].total!.value, printed, t.title);
    assert.equal(a.groups[i].total!.complete, false, "Tripura not reported");
  });
  assert.equal(a.groups[1].total!.value, 4256, "Officer Scale I");
});
test("RD05 state and bank kept apart, wrapped names joined; the specialist tables get each bank's state from the tables that print it", () => {
  const oa = ibps.table!.rows.filter((r) => r.at.post === "Office Assistants (Multipurpose)");
  assert.deepEqual(oa[0].at, { post: "Office Assistants (Multipurpose)", state: "ANDHRA PRADESH", bank: "ANDHRA PRADESH GRAMEENA BANK" }, "printed over four lines");
  assert.equal(oa.find((r) => r.at.bank === "JAMMU AND KASHMIR GRAMEEN BANK")!.at.state, "JAMMU & KASHMIR");
  assert.ok(oa[0].source.line.split("\n").length >= 4 && oa[0].source.page === 46);
  const law = ibps.table!.rows.filter((r) => r.at.post === "Officer Scale II (Law)");
  assert.ok(law.every((r) => r.at.state && r.at.bank), "no empty state or bank");
  assert.equal(law.find((r) => r.at.bank === "UTTARAKHAND GRAMIN BANK")!.at.state, "UTTRAKHAND", "as the notice spells it");
});
test("RD06 PwBD and ESM are counted within the categories because the heading says so", () => {
  const pwbd = ibps.table!.categories.find((c) => c.key === "pwbd_hi")!;
  assert.equal(pwbd.kind, "HORIZONTAL");
  assert.match(pwbd.established!.note, /out of which/);
  assert.equal(ibps.table!.categories.find((c) => c.key === "esm")!.kind, "HORIZONTAL");
});
test("RD07 every row keeps the document, its page and its printed line", () => {
  assert.ok(ibps.table!.rows.every((r) => r.source.retrievalId === "doc" && r.source.page !== null && r.source.line.length > 0));
  const bihar = ibps.table!.rows.find((r) => r.at.post === "Officer Scale I" && r.at.bank === "BIHAR GRAMIN BANK")!;
  assert.equal(bihar.source.line, "4 BIHAR BIHAR GRAMIN BANK 59 30 106 39 160 394 4 4 4 4");
  assert.deepEqual(ibps.coverage.tables.map((t) => t.read), Array(10).fill(true));
});

suite("LIC HFL Table E: state and city");
const lic = read(LIC);
test("RD08 181 cities, state and city apart, Ananthapur 1, and the printed Grand Total of 232", () => {
  assert.equal(lic.found.length, 1);
  assert.equal(lic.table!.rows.length, 181);
  assert.deepEqual(lic.table!.dimensions.map((d) => d.key), ["post", "state", "city"]);
  const ananthapur = lic.table!.rows.find((r) => r.at.city === "Ananthapur")!;
  assert.deepEqual([ananthapur.at.state, ananthapur.total, ananthapur.status, ananthapur.source.page], ["Andhra Pradesh", 1, "STATED", 6]);
  assert.deepEqual(lic.table!.statedTotals.map((s) => [s.total, s.source.page]), [[232, 9]]);
  const a = analyseVacancyTable(lic.table!);
  assert.equal(a.groups[0].calculatedTotal, 232);
  assert.equal(a.grandTotal!.value, 232);
  assert.deepEqual(a.issues, []);
  assert.equal(lic.table!.rows.find((r) => r.at.city === "Jammu")!.at.state, "Jammu And Kashmir", "a state wrapped over two lines");
});

suite("Made-up tables: gaps, wrapping, unclear headings, other tables");
test("RD09 NR, nil, a blank and a dash are kept apart, never turned into 0", () => {
  const text = ["Name of the Post: Clerk", "SR NO. DISTRICT SC ST OBC EWS UR TOTAL", "1 PATNA 2 1 3 1 5 12", "2 GAYA NR NR NR NR NR NR",
    "3 NALANDA 0 0 0 0 0 0", "4 BHOJPUR - - - - - -", "5 SIWAN 1 0 1 0 2 4"].join("\n");
  const r = read(text, "Clerk");
  assert.deepEqual(r.table!.rows.map((x) => [x.at.district, x.status]), [["PATNA", "STATED"], ["GAYA", "NOT_REPORTED"], ["NALANDA", "NIL"], ["BHOJPUR", "NO_FIGURE"], ["SIWAN", "STATED"]]);
  const a = analyseVacancyTable(r.table!);
  assert.equal(a.groups[0].total!.value, 16);
  assert.equal(a.groups[0].total!.complete, false);
});
test("RD10 a long name wrapped before its figures is one row; a Total line is the printed total", () => {
  const text = ["Zone-wise vacancies", "SR NO. ZONE UR SC ST TOTAL", "1 EAST CENTRAL", "RAILWAY ZONE 10 3 2 15", "2 NORTH 4 1 1 6", "3 SOUTH 7 2 1 10", "TOTAL 21 6 4 31"].join("\n");
  const r = read(text, "Assistant Loco Pilot");
  assert.deepEqual(r.table!.rows.map((x) => x.at.zone), ["EAST CENTRAL RAILWAY ZONE", "NORTH", "SOUTH"]);
  assert.deepEqual(r.table!.statedTotals.map((s) => s.total), [31]);
  assert.deepEqual(analyseVacancyTable(r.table!).issues, []);
});
test("RD11 a heading code cannot match to the figures is reported as not read, never guessed", () => {
  // "HH" is a column code does not know: 4 known columns for 5 figures.
  const text = ["Annexure II: State-wise vacancies", "SR NO. STATE UR SC ST HH TOTAL", "1 BIHAR 3 4 5 1 12", "2 ASSAM 1 1 1 0 3", "3 KERALA 2 2 2 1 6"].join("\n");
  const r = read(text);
  assert.equal(r.found.length, 1);
  assert.equal(r.found[0].columns, null);
  assert.equal(r.table, null);
  assert.deepEqual(r.coverage.tables.map((t) => [t.read, t.why]), [[false, "its 5 columns of figures could not be matched to the heading"]]);
});
test("RD12 an exam pattern or fee table is not a vacancy table", () => {
  const text = ["Exam pattern", "Name of Test No. of Questions Maximum Marks", "Reasoning 40 40", "Numerical Ability 40 40", "English Language 40 40"].join("\n");
  assert.equal(read(text).found.length, 0);
});
test("RD13 heading helpers: column order, the ESM group heading, state names", () => {
  assert.deepEqual(columnsFromHeading("SR NO. STATE BANK SC ST OBC (NCL) EWS GENERAL TOTAL (Out of which) PwBD ESM HI OC VI ID ESM DESM*", 12)!.map((c) => c.key),
    ["sc", "st", "obc", "ews", "ur", "total", "pwbd_hi", "pwbd_oc", "pwbd_vi", "pwbd_id", "esm", "desm"]);
  assert.equal(columnsFromHeading("SC ST TOTAL", 5), null);
  assert.deepEqual(splitState("UTTAR PRADESH UTTAR PRADESH GRAMIN BANK"), { state: "UTTAR PRADESH", rest: "UTTAR PRADESH GRAMIN BANK" });
  assert.equal(splitState("NAGPUR CENTRAL BANK"), null);
});

suite("BTSC FSO: an article's category split, and merging into a job's table");
test("RD14 seven category rows from the model become one post; its quoted split becomes a one-row table of 105", () => {
  const split = mergeCategoryRows([
    { post: "Food Safety Officer", count: 41, breakdown: { ur: 41 } }, { post: "Food Safety Officer", count: 11, breakdown: { ews: 11 } },
    { post: "Food Safety Officer", count: 17, breakdown: { sc: 17 } }, { post: "Food Safety Officer", count: 2, breakdown: { st: 2 } },
    { post: "Food Safety Officer", count: 18, breakdown: { "Extremely Backward Class (EBC)": 18 } }, { post: "Food Safety Officer", count: 12, breakdown: { "Backward Class (BC)": 12 } },
    { post: "Food Safety Officer", count: 4, breakdown: { "Backward Class Women": 4 } },
  ] as never);
  const article = readFileSync("tests/fixtures/notice-text/btsc-fso-article.txt", "utf8");
  const t = tableFromSplit(split as never, 105, { retrievalId: "article", page: null, line: "Unreserved (UR)\t41" }, article)!;
  assert.match(t.rows[0].source.line, /^Unreserved \(UR\)\t41[\s\S]*Backward Class Women\t4\nTotal\t105$/, "the evidence is the article's own lines, from the quote to the last figure");
  assert.equal(t.rows.length, 1);
  const a = analyseVacancyTable(t);
  assert.equal(a.groups[0].total!.value, 105);
  assert.deepEqual(a.issues, [], "EBC, BC and Backward Class Women settled by the printed 105");
  assert.equal(tableFromSplit([{ post: "Clerk", count: 9 }], 9, { retrievalId: null, page: null, line: "" }), null, "no split, no table");
});
test("RD14b the model quotes the overview over three lines (B2.6 final run 1): the evidence still reaches every figure of the split", () => {
  const article = readFileSync("tests/fixtures/notice-text/btsc-fso-article.txt", "utf8");
  const split = [{ post: "Food Safety Officer (FSO)", count: 105, breakdown: { ur: 41, ews: 11, sc: 17, st: 2, "Extremely Backward Class (EBC)": 18, "Backward Class (BC)": 12, "Backward Class Women": 4 } }];
  const t = tableFromSplit(split as never, 105, { retrievalId: "article", page: null, line: "Post Name Food Safety Officer (FSO)\nAdvertisement Number 29/2026\nTotal Vacancies 105" }, article)!;
  const line = t.rows[0].source.line;
  assert.ok([41, 11, 17, 2, 18, 12, 4, 105].every((n) => new RegExp(`\\b${n}\\b`).test(line)), line);
  assert.match(line, /^Post Name\tFood Safety Officer \(FSO\)/, "from the quote's own first line");
});
test("RD15 merging: rows matched by every dimension; a notice replaces its posts, a corrigendum removes nothing; other posts untouched", () => {
  const row = (post: string, bank: string, total: number) => ({ id: `${post}-${bank}`, at: { post, bank }, status: "STATED" as const, total, cells: {}, source: { retrievalId: "d", page: 1, line: `${bank} ${total}` } });
  const dims = [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }];
  const existing = { dimensions: dims, categories: [], statedTotals: [], rows: [row("Clerk", "A BANK", 5), row("Clerk", "B BANK", 6), row("PO", "A BANK", 2)] };
  const incoming = { dimensions: dims, categories: [], statedTotals: [], rows: [row("Clerk", "a bank", 7), row("Clerk", "C BANK", 1)] };
  const notice = mergeTables(existing, incoming, false);
  assert.deepEqual([notice.diff.changed.length, notice.diff.added.length, notice.diff.removed.length, notice.diff.untouchedPosts], [1, 1, 1, ["PO"]]);
  assert.equal(notice.diff.changed[0].after.id, "Clerk-A BANK", "matched regardless of case, identity kept");
  assert.ok(!notice.table.rows.some((r) => r.at.bank === "B BANK") && notice.table.rows.some((r) => r.at.post === "PO"));
  const corr = mergeTables(existing, incoming, true);
  assert.equal(corr.diff.removed.length, 0);
  assert.ok(corr.table.rows.some((r) => r.at.bank === "B BANK"), "a corrigendum keeps rows it does not print");
});
test("RD16 the AI interprets a heading code cannot match; it is marked as interpreted, and labels not in the heading are refused", async () => {
  const text = ["Annexure II: State-wise vacancies", "SR NO. STATE UR SC ST HH TOTAL", "1 BIHAR 3 4 5 1 12", "2 ASSAM 1 1 1 0 3", "3 KERALA 2 2 2 1 6"].join("\n");
  const fake = (obj: unknown) => (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const cols = { columns: [{ label: "UR", kind: "UR" }, { label: "SC", kind: "SC" }, { label: "ST", kind: "ST" }, { label: "HH", kind: "OTHER" }, { label: "TOTAL", kind: "TOTAL" }] };
  const r = await readVacancyTables(text, { retrievalId: "r1", fallbackPost: "Clerk", apiKey: "test-key", fetchFn: fake(cols) });
  assert.deepEqual(r.coverage.tables.map((t) => [t.read, t.columnsBy, t.columns]), [[true, "AI", ["UR", "SC", "ST", "HH", "Total"]]]);
  assert.deepEqual(r.table!.rows.map((x) => [x.at.state, x.total, x.cells.hh]), [["BIHAR", 12, 1], ["ASSAM", 3, 0], ["KERALA", 6, 1]], "figures are as printed");
  assert.equal(r.table!.categories.find((c) => c.key === "hh")!.kind, "UNDETERMINED", "an unknown column's place is not assumed");
  const made = { columns: [...cols.columns.slice(0, 3), { label: "Women", kind: "WOMEN" }, cols.columns[4]] };
  const refused = await readVacancyTables(text, { retrievalId: "r1", fallbackPost: "Clerk", apiKey: "test-key", fetchFn: fake(made) });
  assert.equal(refused.table, null);
  assert.equal(refused.coverage.tables[0].read, false);
});
