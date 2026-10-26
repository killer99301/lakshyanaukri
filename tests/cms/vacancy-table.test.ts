// Vacancy tables (stage A1): the notice's own figures in any shape, totals
// worked out by code, the checks, and what the rest of the site reads.
// Real tables: IBPS CRP RRBs-XV Officer Scale I (28 banks, Tripura not
// reported) and Officer Scale II GBO rows, LIC HFL Table E (state × city,
// one city without a figure), and the BTSC FSO category split.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/vacancy-table.test.ts

import { suite, test, assert } from "../intelligence/suite";
import {
  analyseVacancyTable, calculatedTotalReady, deriveVacancies, fingerprintOf, initialCategoryKind, tableFromLegacy,
  type VacancyCategory, type VacancyTable, type VacancyTableRow,
} from "@/lib/vacancy-table";
import { vacancyCategoryTable } from "@/lib/vacancy-categories";
import { IBPS_OFFICER_I_ROWS, LIC_TABLE_E_ROWS } from "../fixtures/vacancy-tables";

// ── Building the tables ───────────────────────────────────

const STATES = ["ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM", "BIHAR", "CHHATTISGARH", "GUJARAT", "HARYANA", "HIMACHAL PRADESH",
  "JAMMU & KASHMIR", "JHARKHAND", "KARNATAKA", "KERALA", "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR", "MEGHALAYA", "MIZORAM", "NAGALAND",
  "ODISHA", "PUDUCHERRY", "PUNJAB", "RAJASTHAN", "TAMIL NADU", "TELANGANA", "TRIPURA", "UTTAR PRADESH", "UTTRAKHAND", "WEST BENGAL"];
const IBPS_PAGE = 47;
const PWBD_NOTE = { by: "SOURCE" as const, note: '"PwBD (Out of Which)" over HI / OC / VI / ID, Annexure I' };
const ibpsCategories = (pwbdKind: VacancyCategory["kind"] = "HORIZONTAL"): VacancyCategory[] => [
  { key: "sc", label: "SC", kind: "VERTICAL" }, { key: "st", label: "ST", kind: "VERTICAL" },
  { key: "obc", label: "OBC (NCL)", kind: "VERTICAL" }, { key: "ews", label: "EWS", kind: "VERTICAL" },
  { key: "general", label: "General", kind: "VERTICAL" },
  ...(["hi", "oc", "vi", "id"] as const).map((k) => ({ key: `pwbd_${k}`, label: `PwBD ${k.toUpperCase()}`, kind: pwbdKind, partOf: "pwbd",
    ...(pwbdKind === "HORIZONTAL" ? { established: PWBD_NOTE } : {}) })),
];
function ibpsRow(post: string, sr: number, stateAndBank: string, figures: string[], line: string, page = IBPS_PAGE): VacancyTableRow {
  const state = STATES.find((s) => stateAndBank.startsWith(`${s} `))!;
  const bank = stateAndBank.slice(state.length + 1);
  const at = { post, state, bank };
  const source = { retrievalId: "ibps-notice", page, line };
  if (figures.every((f) => f === "NR")) return { id: `${post}#${sr}`, at, status: "NOT_REPORTED", cells: {}, source };
  const n = figures.map(Number);
  const cells = { sc: n[0], st: n[1], obc: n[2], ews: n[3], general: n[4], pwbd_hi: n[6], pwbd_oc: n[7], pwbd_vi: n[8], pwbd_id: n[9] };
  return { id: `${post}#${sr}`, at, status: n[5] === 0 ? "NIL" : "STATED", total: n[5], cells, source };
}
const officerI = (): VacancyTableRow[] => IBPS_OFFICER_I_ROWS.map((r) => ibpsRow("Officer Scale I", r.sr, r.stateAndBank, r.figures, r.line));
// Officer Scale II (General Banking Officer), PDF page 48, four of its rows as printed.
const officerII = (): VacancyTableRow[] => [
  [5, "CHHATTISGARH CHHATTISGARH GRAMIN BANK", "3 4 4 3 9 23 1 0 0 0"],
  [6, "GUJARAT GUJARAT GRAMIN BANK", "10 4 16 6 24 60 0 0 0 0"],
  [7, "HARYANA HARYANA GRAMIN BANK", "4 2 8 3 13 30 0 0 0 0"],
  [22, "RAJASTHAN RAJASTHAN GRAMIN BANK", "10 4 17 6 38 75 5 1 4 4"],
].map(([sr, sb, f]) => ibpsRow("Officer Scale II (GBO)", sr as number, sb as string, (f as string).split(" "), `${sr} ${sb} ${f}`, 48));
const ibpsTable = (rows: VacancyTableRow[], categories = ibpsCategories()): VacancyTable => ({
  dimensions: [{ key: "post", label: "Post" }, { key: "state", label: "State" }, { key: "bank", label: "Bank" }],
  categories, rows, statedTotals: [],
});
const reportedTotals = (rows: VacancyTableRow[]) => rows.filter((r) => r.status !== "NOT_REPORTED").reduce((s, r) => s + (r.total ?? 0), 0);
/** Tripura's figures as a corrigendum might give them (made up for the test; the notice says NR). */
const tripuraReported = (rows: VacancyTableRow[]) => rows.map((r) => r.at.bank.startsWith("TRIPURA")
  ? { ...r, status: "STATED" as const, total: 10, cells: { sc: 2, st: 3, obc: 1, ews: 1, general: 3, pwbd_hi: 0, pwbd_oc: 1, pwbd_vi: 0, pwbd_id: 0 },
      source: { retrievalId: "corrigendum", page: 2, line: "25 TRIPURA TRIPURA GRAMIN BANK 2 3 1 1 3 10 0 1 0 0" } } : r);

const BTSC_LINE = "Unreserved (UR) 41 EWS 11 SC 17 ST 2 EBC 18 BC 12 Backward Class Women 4 Total 105";
const btscTable = (extra: Record<string, number> = {}, extraCats: VacancyCategory[] = []): VacancyTable => ({
  dimensions: [{ key: "post", label: "Post" }],
  categories: [
    { key: "ur", label: "UR", kind: initialCategoryKind("ur") }, { key: "ews", label: "EWS", kind: initialCategoryKind("ews") },
    { key: "sc", label: "SC", kind: initialCategoryKind("sc") }, { key: "st", label: "ST", kind: initialCategoryKind("st") },
    { key: "ebc", label: "EBC", kind: initialCategoryKind("ebc") }, { key: "bc", label: "BC", kind: initialCategoryKind("bc") },
    { key: "bcw", label: "Backward Class Women", kind: initialCategoryKind("bcw") }, ...extraCats,
  ],
  rows: [{ id: "fso", at: { post: "Food Safety Officer" }, status: "STATED", total: 105,
    cells: { ur: 41, ews: 11, sc: 17, st: 2, ebc: 18, bc: 12, bcw: 4, ...extra }, source: { retrievalId: "btsc-article", page: null, line: BTSC_LINE + Object.entries(extra).map(([k, n]) => ` ${k} ${n}`).join("") } }],
  statedTotals: [],
});

const licTable = (): VacancyTable => ({
  dimensions: [{ key: "post", label: "Post" }, { key: "state", label: "State" }, { key: "city", label: "City" }],
  categories: [],
  rows: LIC_TABLE_E_ROWS.map((r, i) => ({ id: `lic#${i}`, at: { post: "Apprentice", state: r.state, city: r.city },
    status: r.n === null ? "NO_FIGURE" as const : "STATED" as const, ...(r.n === null ? {} : { total: r.n }), cells: {},
    source: { retrievalId: "lic-notice", page: r.page, line: r.line } })),
  statedTotals: [{ at: {}, total: 232, source: { retrievalId: "lic-notice", page: 9, line: "Grand Total 232" } }],
});
const codes = (t: VacancyTable) => analyseVacancyTable(t).issues.map((i) => i.code);

// ── IBPS: bank-wise ───────────────────────────────────────

suite("IBPS CRP RRBs-XV: bank-wise vacancies");
test("VT01 the notice as printed: 28 banks, Tripura not reported → a total of the 27 reported banks, marked incomplete", () => {
  const rows = officerI();
  assert.equal(rows.length, 28);
  const a = analyseVacancyTable(ibpsTable(rows));
  const g = a.groups[0];
  assert.equal(g.name, "Officer Scale I");
  assert.equal(g.reported, 27);
  assert.equal(g.notReported, 1);
  assert.equal(g.total!.value, reportedTotals(rows), "the sum of the printed bank totals");
  assert.equal(g.total!.basis, "CALCULATED");
  assert.equal(g.total!.complete, false, "never shown as a complete total");
  assert.match(g.total!.method, /sum of 27 rows by state and bank \(page 47\)/);
  assert.deepEqual(codes(ibpsTable(rows)), ["NOT_REPORTED"], "every printed bank adds up; only Tripura is flagged");
  assert.equal(a.grandTotal!.complete, false);
});
test("VT02 with every bank reported: complete, PwBD shown as 'of which' and not added", () => {
  const rows = tripuraReported(officerI());
  const a = analyseVacancyTable(ibpsTable(rows));
  const g = a.groups[0];
  assert.equal(g.total!.complete, true);
  assert.equal(g.total!.value, reportedTotals(rows));
  const vertical = ["sc", "st", "obc", "ews", "general"].reduce((s, k) => s + g.categories[k].value, 0);
  assert.equal(vertical, g.total!.value, "the five vertical categories make the total");
  const pwbd = ["pwbd_hi", "pwbd_oc", "pwbd_vi", "pwbd_id"].reduce((s, k) => s + g.categories[k].value, 0);
  assert.ok(pwbd > 0 && pwbd < g.total!.value, "PwBD seats are counted, separately, within the total");
  assert.deepEqual(a.issues, []);
});
test("VT03 two posts: each gets its own total; the grand total adds the posts", () => {
  const rows = [...tripuraReported(officerI()), ...officerII()];
  const a = analyseVacancyTable(ibpsTable(rows));
  assert.deepEqual(a.groups.map((g) => g.name), ["Officer Scale I", "Officer Scale II (GBO)"]);
  assert.equal(a.groups[1].total!.value, 23 + 60 + 30 + 75);
  assert.equal(a.grandTotal!.value, a.groups[0].total!.value + 188);
  assert.equal(a.grandTotal!.basis, "CALCULATED");
  assert.match(a.grandTotal!.method, /sum of 2 post totals/);
});

// ── Horizontal columns: only where the source establishes it ──

suite("Horizontal columns");
test("VT04 PwBD not yet established, but the printed bank totals show it is not part of them → established from the source", () => {
  const a = analyseVacancyTable(ibpsTable(tripuraReported(officerI()), ibpsCategories("UNDETERMINED")));
  for (const k of ["pwbd_hi", "pwbd_oc", "pwbd_vi", "pwbd_id"]) {
    const c = a.categories.find((x) => x.key === k)!;
    assert.equal(c.kind, "HORIZONTAL", k);
    assert.equal(c.established?.by, "SOURCE");
    assert.match(c.established!.note, /printed totals do not include/);
  }
  assert.equal(a.groups[0].total!.complete, true);
});
test("VT05 a 'women' column is never assumed horizontal from its name: with no printed totals it stays undecided and the total incomplete", () => {
  const t: VacancyTable = {
    dimensions: [{ key: "post", label: "Post" }],
    categories: [{ key: "ur", label: "UR", kind: "VERTICAL" }, { key: "sc", label: "SC", kind: "VERTICAL" }, { key: "women", label: "Women", kind: initialCategoryKind("women") }],
    rows: [{ id: "r", at: { post: "Constable" }, status: "STATED", cells: { ur: 60, sc: 20, women: 28 }, source: { retrievalId: "x", page: 4, line: "UR 60 SC 20 Women 28" } }],
    statedTotals: [],
  };
  assert.equal(initialCategoryKind("women"), "UNDETERMINED");
  const a = analyseVacancyTable(t);
  assert.ok(a.issues.some((i) => i.code === "UNDETERMINED_COLUMN" && /Women/.test(i.message)));
  assert.equal(a.groups[0].total, null, "no total until the place of the women column is decided");
  // Once the admin decides it (the notice says "of which 28 for women"), the total follows.
  const decided = { ...t, categories: t.categories.map((c) => c.key === "women" ? { ...c, kind: "HORIZONTAL" as const, established: { by: "ADMIN" as const, note: "notice p.4: 'of which 28 for women'" } } : c) };
  const b = analyseVacancyTable(decided);
  assert.equal(b.groups[0].total!.value, 80);
  assert.equal(b.groups[0].total!.complete, true);
});

// ── BTSC: category-wise ───────────────────────────────────

suite("BTSC FSO: one post, category-wise");
test("VT06 EBC, BC and Backward Class Women are shown by the printed total to be part of it; the total is the notice's 105", () => {
  const a = analyseVacancyTable(btscTable());
  for (const k of ["ebc", "bc", "bcw"]) assert.equal(a.categories.find((c) => c.key === k)!.kind, "VERTICAL", k);
  const g = a.groups[0];
  assert.equal(g.total!.value, 105);
  assert.equal(g.total!.basis, "STATED", "one printed row is the notice's own figure");
  assert.deepEqual(a.issues, []);
});
test("VT07 an extra women column of 37 on the same row: the printed 105 shows it is counted within the categories", () => {
  const a = analyseVacancyTable(btscTable({ women: 37 }, [{ key: "women", label: "Women (horizontal)", kind: "UNDETERMINED" }]));
  assert.equal(a.categories.find((c) => c.key === "women")!.kind, "HORIZONTAL");
  assert.equal(a.groups[0].total!.value, 105);
  assert.deepEqual(a.issues, []);
});

// ── LIC HFL: state × city ─────────────────────────────────

suite("LIC HFL Table E: state × city");
test("VT08 181 cities, one printed without a figure; the notice's 232 is used and the gap is flagged", () => {
  const a = analyseVacancyTable(licTable());
  const g = a.groups[0];
  assert.equal(g.rowIds.length, 181);
  assert.equal(g.noFigure, 1);
  assert.equal(g.calculatedTotal, 231, "the rows with a figure");
  assert.equal(g.total!.basis, "CALCULATED");
  assert.equal(g.total!.complete, false);
  assert.equal(a.grandTotal!.value, 232);
  assert.equal(a.grandTotal!.basis, "STATED");
  assert.ok(a.issues.some((i) => i.code === "NO_FIGURE" && /Ananthapur/.test(i.message)));
  assert.ok(!a.issues.some((i) => i.code === "STATED_TOTAL_MISMATCH"), "an incomplete sum is not a contradiction");
  assert.ok(!a.issues.some((i) => i.code === "DUPLICATE_ROW"), "Jammu And Kashmir, wrapped over two lines, is one row");
});

// ── Problems the checks must catch ────────────────────────

suite("Checks");
test("VT09 a duplicated row is flagged and counted once", () => {
  const rows = tripuraReported(officerI());
  const bihar = rows.find((r) => r.at.bank.startsWith("BIHAR"))!;
  const a = analyseVacancyTable(ibpsTable([...rows, { ...bihar, id: "copy" }]));
  assert.ok(a.issues.some((i) => i.code === "DUPLICATE_ROW" && i.rowIds!.includes("copy")));
  assert.equal(a.groups[0].total!.value, reportedTotals(rows));
});
test("VT10 a bank whose categories do not make its printed total is flagged", () => {
  const rows = tripuraReported(officerI()).map((r) => r.at.bank.startsWith("BIHAR") ? { ...r, cells: { ...r.cells, sc: r.cells.sc + 5 } } : r);
  const i = analyseVacancyTable(ibpsTable(rows)).issues.find((x) => x.code === "ROW_TOTAL_MISMATCH")!;
  assert.match(i.message, /BIHAR GRAMIN BANK: the categories add up to 399, the printed total is 394/);
});
test("VT11 a printed post total that the complete rows do not reach is a conflict to decide", () => {
  const rows = tripuraReported(officerI());
  const t = { ...ibpsTable(rows), statedTotals: [{ at: { post: "Officer Scale I" }, total: 4000, source: { retrievalId: "ibps-notice", page: 12, line: "Officer Scale I 4000" } }] };
  const a = analyseVacancyTable(t);
  const i = a.issues.find((x) => x.code === "STATED_TOTAL_MISMATCH")!;
  assert.match(i.message, new RegExp(`prints 4000, its rows add up to ${reportedTotals(rows)}`));
  assert.equal(a.groups[0].total!.basis, "STATED");
  assert.equal(a.groups[0].calculatedTotal, reportedTotals(rows), "both figures are kept for the decision");
});
test("VT12 more PwBD seats than the bank's total is flagged; a row without page or line is flagged", () => {
  const rows = tripuraReported(officerI()).map((r) => r.at.bank.startsWith("NAGALAND") ? { ...r, cells: { ...r.cells, pwbd_hi: 2, pwbd_oc: 1 } } : r);
  assert.ok(codes(ibpsTable(rows)).includes("HORIZONTAL_EXCEEDS_TOTAL"));
  const noSource = tripuraReported(officerI()).map((r, i) => i === 0 ? { ...r, source: { retrievalId: null, page: null, line: "" } } : r);
  assert.ok(codes(ibpsTable(noSource)).includes("NO_SOURCE"));
});
test("VT13 a bank printed as all zeros is nil, not missing", () => {
  const a = analyseVacancyTable(ibpsTable(tripuraReported(officerI())));
  const manipur = officerI().find((r) => r.at.bank.startsWith("MANIPUR"))!;
  assert.equal(manipur.status, "NIL");
  assert.ok(a.groups[0].total!.inputs.includes(manipur.id));
  assert.equal(a.groups[0].total!.complete, true);
});

// ── Tier B and reproducibility ────────────────────────────

suite("Tier B: when a calculated total counts as checked");
test("VT14 only a complete, conflict-free, evidenced, checked and reproducible calculation is ready", () => {
  const complete = ibpsTable(tripuraReported(officerI()));
  const stored = analyseVacancyTable(complete).grandTotal!;
  assert.deepEqual(calculatedTotalReady(complete, { tableChecked: true, stored }), { ready: true, reasons: [] });
  assert.ok(calculatedTotalReady(complete, { tableChecked: false, stored }).reasons.includes("the table has not been checked against the notice"));
  const asPrinted = calculatedTotalReady(ibpsTable(officerI()), { tableChecked: true });
  assert.equal(asPrinted.ready, false);
  assert.ok(asPrinted.reasons.includes("the total is incomplete") && asPrinted.reasons.some((r) => /not reported/.test(r)));
  const edited = ibpsTable(tripuraReported(officerI()).map((r) => r.at.bank.startsWith("BIHAR") ? { ...r, total: 395, cells: { ...r.cells, sc: 60 } } : r));
  assert.ok(calculatedTotalReady(edited, { tableChecked: true, stored }).reasons.includes("the stored total no longer matches a recalculation from the rows"),
    "editing a row reopens the check");
  assert.ok(calculatedTotalReady(btscTable(), { tableChecked: true }).reasons.some((r) => /printed in the notice/.test(r)), "a printed total follows the usual checks");
});
test("VT15b a figure typed over a row read from the notice is flagged, and keeps the total from counting as checked", () => {
  const typedOver = ibpsTable(tripuraReported(officerI()).map((r) => r.at.bank.startsWith("BIHAR") ? { ...r, total: 395, cells: { ...r.cells, general: 161 } } : r));
  const i = analyseVacancyTable(typedOver).issues.find((x) => x.code === "FIGURES_NOT_IN_LINE")!;
  assert.match(i.message, /BIHAR GRAMIN BANK: 395, 161 are not in the line this row was read from \(page 47\)/);
  assert.ok(calculatedTotalReady(typedOver, { tableChecked: true }).reasons.some((r) => /figures not in line/.test(r)));
});
test("VT15 the fingerprint follows the figures, not the order of keys", () => {
  assert.equal(fingerprintOf({ a: 1, b: [1, 2] }), fingerprintOf({ b: [1, 2], a: 1 }));
  assert.notEqual(fingerprintOf({ a: 1 }), fingerprintOf({ a: 2 }));
  assert.match(fingerprintOf({ a: 1 }), /^[0-9a-f]{16}$/);
});

// ── What the rest of the site reads ───────────────────────

suite("Derived total and breakdown (backward compatible)");
test("VT16 IBPS: one row per post with its split; the existing public table reads it unchanged", () => {
  const d = deriveVacancies(ibpsTable([...tripuraReported(officerI()), ...officerII()]));
  assert.deepEqual(d.breakdown.map((r) => r.post), ["Officer Scale I", "Officer Scale II (GBO)"]);
  const ii = d.breakdown[1];
  assert.equal(ii.count, 188);
  assert.equal(ii.basis, "CALCULATED");
  assert.deepEqual(ii.breakdown, { sc: 27, st: 14, obc: 45, ews: 18, ur: 84, pwbd: { hi: 6, oc: 1, vi: 4, id: 4 } }, "General is filed under UR");
  assert.equal(d.total!.value, d.breakdown[0].count + 188);
  const pub = vacancyCategoryTable(d.breakdown)!;
  assert.deepEqual(pub.columns.map((c) => c.label), ["UR", "EWS", "OBC", "SC", "ST", "PwBD"]);
  assert.deepEqual(pub.rows[1].cells, [84, 18, 45, 27, 14, 15], "PwBD parts summed for the public column");
});
test("VT17 incomplete figures stay marked incomplete, and incomplete category sums are left out", () => {
  const d = deriveVacancies(ibpsTable(officerI()));
  assert.equal(d.breakdown[0].complete, false);
  assert.equal(d.breakdown[0].breakdown, undefined, "no category split shown as if complete");
  assert.equal(d.total!.complete, false);
});
test("VT18 a plain one-row post (a walk-in) derives exactly what the old shape held", () => {
  const t: VacancyTable = { dimensions: [{ key: "post", label: "Post" }], categories: [],
    rows: [{ id: "w", at: { post: "Senior Resident" }, status: "STATED", total: 12, cells: {}, source: { retrievalId: "x", page: 1, line: "Senior Resident 12" } }], statedTotals: [] };
  const d = deriveVacancies(t);
  assert.deepEqual(d.breakdown.map(({ post, count }) => ({ post, count })), [{ post: "Senior Resident", count: 12 }]);
  assert.equal(d.total!.value, 12);
  assert.equal(d.total!.basis, "STATED");
});

suite("Moving a job entered the old way to a table");
test("VT19 rows keep their figures and say they were entered by hand; a total the rows do not reach is kept as a conflict", () => {
  const t = tableFromLegacy(9100, [{ post: "MTS", count: 8000, breakdown: { ur: 4000, sc: 1200, st: 600, obc: 1600, ews: 600 } }, { post: "Havaldar", count: 1000 }]);
  const a = analyseVacancyTable(t);
  assert.deepEqual(a.groups.map((g) => [g.name, g.total!.value, g.total!.basis]), [["MTS", 8000, "ENTERED"], ["Havaldar", 1000, "ENTERED"]], "never 'printed in the notice'");
  assert.equal(a.grandTotal!.value, 9100);
  assert.equal(a.grandTotal!.basis, "ENTERED");
  assert.ok(a.issues.some((i) => i.code === "STATED_TOTAL_MISMATCH" && /9100.*9000/.test(i.message)), "the earlier 9,100 is not dropped");
  assert.equal(a.issues.filter((i) => i.code === "NO_SOURCE").length, 2);
  const same = analyseVacancyTable(tableFromLegacy(9000, [{ post: "MTS", count: 8000 }, { post: "Havaldar", count: 1000 }]));
  assert.ok(!same.issues.some((i) => i.code === "STATED_TOTAL_MISMATCH") && same.grandTotal!.value === 9000);
  assert.equal(analyseVacancyTable(tableFromLegacy(500, [])).grandTotal!.value, 500, "a total with no rows is kept");
  assert.ok(calculatedTotalReady(t, { tableChecked: true }).reasons.some((r) => /entered by hand/.test(r)));
});
