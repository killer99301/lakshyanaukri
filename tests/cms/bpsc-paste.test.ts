// A difficult notice through the paste route (B2.6): BPSC 72nd CCE's Hindi
// vacancy tables (सारणी I, 22 posts; सारणी II, 3 posts), prepared outside the
// notice (written out from the page images, as an AI or a person would) and
// pasted in, in two parts: page 1, then page 2. No AI here.
//
// The fixture puts every figure where the notice prints it, Hindi labels and
// names as printed. सारणी II's post 03 is for women only: the notice prints
// its category figures on the women's line, so they are in the women's
// columns. The notice's own inconsistencies are kept, and must be said:
// सारणी II post 02's categories add up to 30 against its printed 32.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/bpsc-paste.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { buildRows, mergePasted, readPasted, suggestColumns, type ColumnRole } from "@/lib/vacancy-paste";
import { analyseVacancyTable, calculatedTotalReady, vacancyTableShapeErrors, type VacancyTable } from "@/lib/vacancy-table";

const LINES = readFileSync("tests/fixtures/paste/bpsc-72-prepared.txt", "utf8").trim().split("\n");
const HEADING = LINES[0];
// Page 1 prints सारणी I posts 1-15; page 2 posts 16-22, its Total line, and सारणी II.
const PAGE1 = [HEADING, ...LINES.slice(1, 16)].join("\n");
const PAGE2 = [HEADING, ...LINES.slice(16)].join("\n");

const NOTES = {
  vertical: "notice pp.1-2: कुल पद is the seven reservation columns added (post 1: 40+10+16+01+18+12+03 = 100)",
  ff: "notice pp.1-2: not added into कुल पद (post 1: 100 without its 02)",
  women: "notice p.1: printed under “महिलाओं के लिए आरक्षित रिक्तियों की संख्या” (vacancies reserved for women), within each category",
  pwbd: "notice pp.1-2: दिव्यांग is not added into कुल पद",
};
/** The admin's decisions in the paste panel, each with how it is known. */
function decide(roles: ColumnRole[]): ColumnRole[] {
  return roles.map((r) => {
    if (r.role !== "category" || r.kind !== "UNDETERMINED") return r;
    if (["ebc", "bc", "bc_women"].includes(r.key)) return { ...r, kind: "VERTICAL", note: NOTES.vertical };
    if (r.key === "ff") return { ...r, kind: "HORIZONTAL", note: NOTES.ff };
    if (r.key === "women" || r.partOf === "women") return { ...r, kind: "HORIZONTAL", note: NOTES.women };
    if (r.partOf === "pwbd") return { ...r, kind: "HORIZONTAL", note: NOTES.pwbd };
    return r;
  });
}
function paste(existing: VacancyTable | null, text: string, page: number, opts: { prepared?: boolean; decided?: boolean } = {}) {
  const grid = readPasted(text);
  const roles = opts.decided === false ? suggestColumns(grid) : decide(suggestColumns(grid));
  const built = buildRows(grid, roles, { page, prepared: opts.prepared ?? true, idPrefix: `p${page}-` });
  return { grid, roles, built, plan: mergePasted(existing, built, false) };
}
function both(opts: { prepared?: boolean; edit?: (s: string) => string } = {}) {
  const edit = opts.edit ?? ((s: string) => s);
  const one = paste(null, edit(PAGE1), 1, opts);
  const two = paste(one.plan.table, edit(PAGE2), 2, opts);
  return { one, two, table: two.plan.table };
}
const sugarcane = (t: VacancyTable) => t.rows.find((r) => r.at.post === "ईख पदाधिकारी, गन्ना उद्योग विभाग")!;
const errors = (t: VacancyTable) => analyseVacancyTable(t).issues.filter((i) => i.severity === "ERROR");

suite("BPSC 72nd CCE through the paste route: Hindi headings");

test("BP01 Hindi headings are read: categories keyed, printed labels kept; serial, pay and age skipped; women's columns one group", () => {
  const { roles } = paste(null, PAGE1, 1, { decided: false });
  const cat = (key: string) => roles.find((r) => r.role === "category" && r.key === key) as Extract<ColumnRole, { role: "category" }>;
  assert.deepEqual(roles.slice(0, 4).map((r) => r.role), ["serial", "dimension", "dimension", "ignore"]);
  assert.deepEqual(roles.slice(1, 3).map((r) => (r as { key: string }).key), ["post", "table"]);
  assert.deepEqual(["ur", "ews", "sc", "st"].map((k) => [cat(k).label, cat(k).kind]),
    [["अनारक्षित", "VERTICAL"], ["आर्थिक रूप से कमजोर वर्ग", "VERTICAL"], ["अनुसूचित जाति", "VERTICAL"], ["अनुसूचित जनजाति", "VERTICAL"]]);
  assert.deepEqual(["ebc", "bc", "bc_women", "ff"].map((k) => cat(k).kind), ["UNDETERMINED", "UNDETERMINED", "UNDETERMINED", "UNDETERMINED"], "not standard: the admin decides, from the notice");
  assert.equal(roles[11].role, "total");
  assert.deepEqual(roles.filter((r) => r.role === "category" && r.partOf === "women").map((r) => (r as { key: string }).key), ["women_ur", "women_ews", "women_sc", "women_st", "women_ebc", "women_bc"]);
  assert.equal(cat("women").label, "महिला कुल");
  assert.deepEqual(roles.slice(20, 24).map((r) => (r as { key: string }).key), ["pwbd_vi", "pwbd_dd", "pwbd_oh", "pwbd_md"]);
  assert.equal(roles[24].role, "ignore", "the minimum age is no vacancy figure");
});

suite("Rows, totals and evidence");

test("BP02 two pastes (page 1, page 2): 22 + 3 posts, names as printed, each row with its page and line, marked prepared", () => {
  const { one, two, table } = both();
  assert.deepEqual([one.built.errors, two.built.errors, one.plan.problems, two.plan.problems], [[], [], [], []]);
  assert.deepEqual(vacancyTableShapeErrors(table), []);
  assert.equal(table.rows.length, 25);
  assert.deepEqual([table.rows.filter((r) => r.at.table === "I").length, table.rows.filter((r) => r.at.table === "II").length], [22, 3]);
  assert.deepEqual([...new Set(table.rows.filter((r) => r.at.table === "I").map((r) => r.source.page))], [1, 2]);
  assert.ok(table.rows.every((r) => r.source.readBy === "PREPARED" && r.source.line.includes(r.at.post)));
  const s = sugarcane(table);
  assert.deepEqual([s.total, s.cells.ur, s.cells.ews, s.cells.sc, s.cells.st, s.cells.ebc, s.cells.bc, s.cells.bc_women, s.cells.women, s.cells.ff, s.source.page],
    [44, 18, 4, 7, 1, 8, 5, 1, 14, 1, 1]);
  assert.equal(table.rows.find((r) => r.at.table === "II" && r.at.post.startsWith("अनुमंडल संरक्षण"))!.total, 101);
});
test("BP03 the Total lines are the notice's printed totals for सारणी I and II, not posts", () => {
  const { two, table } = both();
  assert.deepEqual(table.statedTotals.map((s) => [s.at, s.total, s.source.page]), [[{ table: "I" }, 1077, 2], [{ table: "II" }, 153, 2]]);
  assert.deepEqual([table.statedTotals[0].cells!.ur, table.statedTotals[0].cells!.women, table.statedTotals[0].cells!.ff], [466, 344, 22]);
  assert.ok(two.built.notes.some((n) => /total line: kept as the notice's printed total for I \(1077\)/.test(n)));
  assert.ok(!table.rows.some((r) => /total/i.test(r.at.post)));
});
test("BP04 the admin's decisions: 1230 in all (1077 + 153), never double-counted; सारणी I agrees with its printed Total line in every column", () => {
  const { table } = both();
  const a = analyseVacancyTable(table);
  assert.deepEqual([a.grandTotal?.value, a.grandTotal?.complete, a.grandTotal?.basis], [1230, true, "CALCULATED"]);
  assert.equal(a.categories.find((c) => c.key === "women")?.kind, "HORIZONTAL");
  assert.equal(table.categories.find((c) => c.key === "women_ur")?.established?.note, NOTES.women);
  // सारणी I: no error at all; its printed Total line holds in every column.
  const firstTable = new Set(table.rows.filter((r) => r.at.table === "I").map((r) => r.id));
  assert.deepEqual(errors(table).filter((i) => i.rowIds?.some((id) => firstTable.has(id)) || /^I:/.test(i.message)), []);
});
test("BP05 the notice's own inconsistencies in सारणी II are said, not corrected: post 02 adds up to 30 (printed 32); the women-only post 03 prints its categories on the women's line", () => {
  const { table } = both();
  const found = errors(table).map((i) => `${i.code}: ${i.message}`);
  assert.equal(found.length, 2, found.join("\n"));
  assert.ok(found.some((m) => /^ROW_TOTAL_MISMATCH: वित्तीय प्रशासनिक .*: the categories add up to 30, the printed total is 32/.test(m)), found.join("\n"));
  assert.ok(found.some((m) => /^ROW_TOTAL_MISMATCH: अनुमंडल संरक्षण .*: the categories add up to 3, the printed total is 101/.test(m)), found.join("\n"));
});
test("BP06 prepared rows are research: the table is not ready until checked against the notice, whatever the arithmetic", () => {
  const { table } = both();
  const r = calculatedTotalReady(table, { tableChecked: false });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => /25 rows were prepared outside the notice \(by an AI, a person or another website\); check them against the notice's pages/.test(x)), r.reasons.join("; "));
  const copied = both({ prepared: false }).table;
  assert.ok(copied.rows.every((x) => x.source.readBy === undefined));
  assert.ok(!calculatedTotalReady(copied, { tableChecked: false }).reasons.some((x) => /prepared outside/.test(x)));
});

suite("Mistakes in a prepared table are caught");

test("BP07 a wrong figure (Sugarcane Officer's UR 18 typed as 19): its row and सारणी I's printed UR total both disagree, and say so", () => {
  const { table } = both({ edit: (s) => s.replace("| ईख पदाधिकारी, गन्ना उद्योग विभाग | I | Level - 9 | 18 |", "| ईख पदाधिकारी, गन्ना उद्योग विभाग | I | Level - 9 | 19 |") });
  const found = errors(table).map((i) => i.message);
  assert.ok(found.some((m) => /ईख पदाधिकारी.*: the categories add up to 45, the printed total is 44/.test(m)), found.join("\n"));
  assert.ok(found.some((m) => /^I: the notice prints 466 for अनारक्षित \(page 2\); its 22 rows add up to 467/.test(m)), found.join("\n"));
});
test("BP08 a women's total that its parts do not add up to is said", () => {
  const { table } = both({ edit: (s) => s.replace("| 06 | 01 | 02 | 00 | 03 | 02 | 14 |", "| 06 | 01 | 02 | 00 | 03 | 02 | 15 |") });
  const found = errors(table).filter((i) => i.code === "PARTS_TOTAL_MISMATCH").map((i) => i.message);
  assert.equal(found.length, 1);
  assert.ok(/ईख पदाधिकारी.*: महिला अनारक्षित \+ .* add up to 14; the printed महिला कुल is 15/.test(found[0]), found[0]);
});
test("BP09 the women's share pasted as a second line under its post (the notice's layout) is not read as a post: it is refused, with how to prepare it", () => {
  const twoLine = [HEADING, LINES[1], "| | | | | 14 | 04 | 06 | 00 | 06 | 04 | | 34 | | | | | | | | | | | | | |"].join("\n");
  const { built } = paste(null, twoLine, 1);
  assert.equal(built.rows.length, 1);
  assert.ok(built.errors.some((e) => /Line 3: no Post, Table\. If these are a second line of figures for the row above \(the women's share, say\), prepare them as more columns of that row\./.test(e)), built.errors.join("\n"));
});
test("BP10 the same table pasted from a spreadsheet (tabs) gives the same rows and totals", () => {
  const tabs = (s: string) => s.split("\n").map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()).join("\t")).join("\n");
  const a = both().table, b = both({ edit: tabs }).table;
  const shape = (t: VacancyTable) => JSON.stringify([t.rows.map((r) => [r.at, r.total, r.cells]), t.statedTotals.map((s) => [s.at, s.total, s.cells])]);
  assert.equal(shape(b), shape(a));
});
test("BP11 a second total line for the same rows is refused, never added twice", () => {
  const { built } = paste(null, [HEADING, LINES[1], LINES[23], LINES[23]].join("\n"), 2);
  assert.ok(built.errors.some((e) => /a second “Total” line for the same rows/.test(e)), built.errors.join("\n"));
  assert.equal(built.statedTotals.length, 1);
});
