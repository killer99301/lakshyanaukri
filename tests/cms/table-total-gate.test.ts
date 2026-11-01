// Total Vacancies worked out from the vacancy table, and the publish gate
// (Stage C, C2), by code: the route each total takes, the printed total's own
// evidence, and the class the gate gives. No database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/table-total-gate.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { figureIn, printedTotalEvidence, quoteIsPrintedTotal, totalRoute } from "@/lib/cms/importer/table-check";
import { classifyField, publishGate, type ClaimView, type FieldState, type TableTotalContext } from "@/lib/cms/importer/classify";
import { analyseVacancyTable, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";

const LINES = { a: "Officer A Bank 10", b: "Officer B Bank 12", c: "Officer C Bank 8", d: "Officer D Bank NR", total: "Grand Total 30" };
const row = (id: string, line: string, total: number | null, readBy?: "AI_IMAGE" | "PREPARED", page: number | null = 1): VacancyTableRow => ({
  id, at: { post: "Officer", bank: id }, status: total === null ? "NOT_REPORTED" : "STATED", ...(total === null ? {} : { total }), cells: {},
  source: { retrievalId: null, page, line, ...(readBy ? { readBy } : {}) },
});
const table = (rows: VacancyTableRow[], printed: Array<{ total: number; line: string; page: number | null }> = []): VacancyTable => ({
  dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], rows,
  statedTotals: printed.map((p) => ({ at: {}, total: p.total, source: { retrievalId: null, page: p.page, line: p.line } })),
});
const three = (readBy?: "AI_IMAGE" | "PREPARED") => [row("a", LINES.a, 10, readBy), row("b", LINES.b, 12, readBy), row("c", LINES.c, 8, readBy)];
const PRINTED = table(three(), [{ total: 30, line: LINES.total, page: 1 }]);
const CALCULATED = table(three());
const INCOMPLETE = table([row("a", LINES.a, 10), row("b", LINES.b, 12), row("d", LINES.d, null)]);

const OFFICIAL = { authenticity: "ATTESTED", originRole: "AUTHORITY" as const, originPurposes: [], declaredKind: "OFFICIAL_NOTIFICATION" };
let seq = 0;
const decision = (kind: ClaimView["kind"], quote: string | null, page: number | null, rev = "rev-1"): ClaimView =>
  ({ id: `d${++seq}`, seq, kind, value: null, fieldRevisionId: rev, quote, page, retrieval: OFFICIAL });
const ctxFor = (t: VacancyTable, opts: Partial<TableTotalContext> = {}): TableTotalContext => {
  const g = analyseVacancyTable(t).grandTotal!;
  return { table: t, derived: { basis: g.basis, complete: g.complete, fingerprint: g.fingerprint }, tableChecked: false, tableConflict: false, ...opts };
};
const stateFor = (t: VacancyTable, claims: ClaimView[] = []): FieldState => ({
  fieldPath: "vacancies.total", hasValue: true, value: analyseVacancyTable(t).grandTotal!.value, latestRevisionId: "rev-1", latestRevisionAt: "2026-11-01T00:00:00.000Z", claims,
});
const cls = (t: VacancyTable, claims: ClaimView[] = [], opts: Partial<TableTotalContext> = {}) => classifyField(stateFor(t, claims), "2026-10-31T00:00:00.000Z", ctxFor(t, opts));

suite("C2: the printed total's own evidence");

test("CG01 figures as printed: 30 is in “Grand Total 30”, 1,230 in “Total 1,230”; 30 is not in “130” or “Officer A Bank 10”", () => {
  assert.ok(figureIn(LINES.total, 30) && figureIn("Total 1,230", 1230));
  assert.ok(!figureIn("Total 130", 30) && !figureIn(LINES.a, 30));
});
test("CG02 the printed grand total's line and page are established when there is exactly one, equal to the total, with its page and figure", () => {
  assert.deepEqual(printedTotalEvidence(PRINTED, 30), { line: LINES.total, page: 1 });
});
test("CG03 not established: none printed; two printed; a different figure; no page; a line without the figure (entered by hand)", () => {
  assert.ok("missing" in printedTotalEvidence(CALCULATED, 30));
  assert.ok("missing" in printedTotalEvidence(table(three(), [{ total: 30, line: LINES.total, page: 1 }, { total: 30, line: "Total 30", page: 2 }]), 30));
  assert.ok("missing" in printedTotalEvidence(table(three(), [{ total: 31, line: "Grand Total 31", page: 1 }]), 30));
  assert.ok("missing" in printedTotalEvidence(table(three(), [{ total: 30, line: LINES.total, page: null }]), 30));
  assert.ok("missing" in printedTotalEvidence(table(three(), [{ total: 30, line: "entered by hand", page: 1 }]), 30));
});
test("CG04 the quote must hold the whole printed line, with its figure, on its page", () => {
  const ev = { line: LINES.total, page: 1 };
  assert.ok(quoteIsPrintedTotal(ev, 30, LINES.total, 1), "the line itself");
  assert.ok(quoteIsPrintedTotal(ev, 30, `Vacancies ${LINES.total}`, 1), "the line within a longer quote");
  assert.ok(!quoteIsPrintedTotal(ev, 30, LINES.a, 1), "an unrelated row's line");
  assert.ok(!quoteIsPrintedTotal(ev, 30, "30", 1), "the bare figure");
  assert.ok(!quoteIsPrintedTotal(ev, 30, LINES.total, 2), "the right words on the wrong page");
  assert.ok(!quoteIsPrintedTotal(ev, 30, LINES.total, null), "no page");
});

suite("C2: the route each total takes");

test("CG05 a printed total on rows read by code from text: its printed line", () => {
  assert.deepEqual(totalRoute(PRINTED, ctxFor(PRINTED).derived, 30), { incomplete: false, route: "PRINTED_LINE", evidence: { line: LINES.total, page: 1 }, why: [] });
});
test("CG06 the whole-table check: calculated; incomplete; AI-read rows; prepared rows; printed but not establishable", () => {
  assert.equal(totalRoute(CALCULATED, ctxFor(CALCULATED).derived, 30).route, "TABLE_CHECK");
  assert.equal(totalRoute(INCOMPLETE, ctxFor(INCOMPLETE).derived, 22).route, "TABLE_CHECK");
  for (const readBy of ["AI_IMAGE", "PREPARED"] as const) {
    const t = table(three(readBy), [{ total: 30, line: LINES.total, page: 1 }]);
    assert.equal(totalRoute(t, ctxFor(t).derived, 30).route, "TABLE_CHECK", readBy);
  }
  const twoTotals = table(three(), [{ total: 30, line: LINES.total, page: 1 }, { total: 30, line: "Total 30", page: 2 }]);
  assert.deepEqual(totalRoute(twoTotals, { basis: "STATED", complete: true }, 30).why, ["the table holds more than one printed total for the whole table"]);
});

suite("C2: the gate's class for a total worked out from the table");

test("CG07 printed total: the printed line, figure and page verify it; C0's unrelated row quote does not", () => {
  assert.equal(cls(PRINTED, [decision("ADMIN_VERIFIED", LINES.total, 1)]).cls, "VERIFIED");
  const byRow = cls(PRINTED, [decision("ADMIN_VERIFIED", LINES.a, 1)]);
  assert.notEqual(byRow.cls, "VERIFIED");
  assert.match(byRow.reason, /cite the notice's printed total, “Grand Total 30” \(page 1\), or check the whole table/);
});
test("CG08 printed total, no decision: pending, never verified", () => {
  assert.notEqual(cls(PRINTED).cls, "VERIFIED");
});
test("CG09 printed total: the whole-table check verifies it too", () => {
  assert.equal(cls(PRINTED, [], { tableChecked: true }).cls, "VERIFIED");
});
test("CG10 printed total not establishable (two printed totals): a quote of its line does not verify it; only the table check does", () => {
  const t = table(three(), [{ total: 30, line: LINES.total, page: 1 }, { total: 30, line: "Total 30", page: 2 }]);
  // analyse sees one grand total (the first printed): two printed grand totals are ambiguous for the route.
  assert.notEqual(cls(t, [decision("ADMIN_VERIFIED", LINES.total, 1)]).cls, "VERIFIED");
  assert.equal(cls(t, [], { tableChecked: true }).cls, "VERIFIED");
});
test("CG11 calculated total: a quote never verifies it; the whole-table check does", () => {
  assert.notEqual(cls(CALCULATED, [decision("ADMIN_VERIFIED", LINES.a, 1)]).cls, "VERIFIED");
  assert.equal(cls(CALCULATED, [], { tableChecked: true }).cls, "VERIFIED");
});
test("CG12 calculated total: the stored figure no longer matching a recalculation keeps it pending, even with the table checked", () => {
  const v = classifyField(stateFor(CALCULATED), null, { ...ctxFor(CALCULATED, { tableChecked: true }), derived: { basis: "CALCULATED", complete: true, fingerprint: "stale" } });
  assert.notEqual(v.cls, "VERIFIED");
  assert.match(v.reason, /no longer matches a recalculation/);
});
test("CG13 AI-read or prepared rows under a printed total: the printed line does not verify it; the whole-table check does", () => {
  for (const readBy of ["AI_IMAGE", "PREPARED"] as const) {
    const t = table(three(readBy), [{ total: 30, line: LINES.total, page: 1 }]);
    assert.notEqual(cls(t, [decision("ADMIN_VERIFIED", LINES.total, 1)]).cls, "VERIFIED", readBy);
    assert.equal(cls(t, [], { tableChecked: true }).cls, "VERIFIED", readBy);
  }
});
test("CG14 a row without its evidence (no page) keeps a calculated total pending, even with the table checked", () => {
  const t = table([row("a", LINES.a, 10, undefined, null), row("b", LINES.b, 12), row("c", LINES.c, 8)]);
  assert.notEqual(cls(t, [], { tableChecked: true }).cls, "VERIFIED");
});
test("CG15 a conflict open on the table: CONFLICTING, whatever was checked", () => {
  assert.equal(cls(PRINTED, [decision("ADMIN_VERIFIED", LINES.total, 1)], { tableConflict: true }).cls, "CONFLICTING");
  assert.equal(cls(CALCULATED, [], { tableChecked: true, tableConflict: true }).cls, "CONFLICTING");
});

suite("C2: an incomplete total (C-D3)");

test("CG16 never VERIFIED: not by a quote (C0's case), not by the whole-table check", () => {
  assert.notEqual(cls(INCOMPLETE, [decision("ADMIN_VERIFIED", LINES.a, 1)]).cls, "VERIFIED");
  assert.notEqual(cls(INCOMPLETE, [], { tableChecked: true }).cls, "VERIFIED");
});
test("CG17 \"not stated in full\" with the table checked and nothing else open: NOT_STATED, which Tier B accepts", () => {
  const v = cls(INCOMPLETE, [decision("ADMIN_NOT_STATED", LINES.d, 1)], { tableChecked: true });
  assert.equal(v.cls, "NOT_STATED");
  const gate = publishGate([stateFor(INCOMPLETE, [decision("ADMIN_NOT_STATED", LINES.d, 1)])], null, ctxFor(INCOMPLETE, { tableChecked: true }));
  assert.ok(!gate.blockers.some((b) => b.fieldPath === "vacancies.total"), JSON.stringify(gate.blockers));
});
test("CG18 \"not stated in full\" answers only the missing figures: the table not checked still blocks", () => {
  const v = cls(INCOMPLETE, [decision("ADMIN_NOT_STATED", LINES.d, 1)]);
  assert.notEqual(v.cls, "NOT_STATED");
  assert.match(v.reason, /answers only the missing figures; also the table has not been checked against the notice/);
});
test("CG19 \"not stated in full\" never clears a conflict, missing row evidence, or an undecided column", () => {
  const nd = [decision("ADMIN_NOT_STATED", LINES.d, 1)];
  assert.equal(cls(INCOMPLETE, nd, { tableChecked: true, tableConflict: true }).cls, "CONFLICTING");
  const noPage = table([row("a", LINES.a, 10, undefined, null), row("b", LINES.b, 12), row("d", LINES.d, null)]);
  assert.notEqual(cls(noPage, nd, { tableChecked: true }).cls, "NOT_STATED", "a row without its evidence");
  const undecided: VacancyTable = { ...INCOMPLETE, categories: [{ key: "x", label: "X", kind: "UNDETERMINED" }], rows: INCOMPLETE.rows.map((r) => (r.status === "STATED" ? { ...r, cells: { x: 1 } } : r)) };
  assert.notEqual(cls(undecided, nd, { tableChecked: true }).cls, "NOT_STATED", "a column whose place in the total is undecided");
});
test("CG20 a total entered on its own (no table) is classified exactly as before", () => {
  const s: FieldState = { fieldPath: "vacancies.total", hasValue: true, value: 30, latestRevisionId: "rev-1", latestRevisionAt: null, claims: [decision("ADMIN_VERIFIED", LINES.a, 1)] };
  assert.deepEqual(classifyField(s, null, null), classifyField(s, null));
  assert.equal(classifyField(s, null).cls, "VERIFIED");
});
test("CG21 one post: the post's printed total covers the whole table and is its evidence (as the import stores it)", () => {
  const t: VacancyTable = { ...table(three()), statedTotals: [{ at: { post: "Officer" }, total: 30, source: { retrievalId: null, page: 2, line: "Total 30" } }] };
  assert.deepEqual(printedTotalEvidence(t, 30), { line: "Total 30", page: 2 });
});
test("CG22 two posts: one post's printed total does not cover the table; a grand total and a covering post total together are ambiguous", () => {
  const two: VacancyTable = { ...table([...three(), { ...row("e", "Officer E Bank 5", 5), at: { post: "Clerk", bank: "e" } }]),
    statedTotals: [{ at: { post: "Officer" }, total: 30, source: { retrievalId: null, page: 2, line: "Total 30" } }] };
  assert.ok("missing" in printedTotalEvidence(two, 35));
  const both: VacancyTable = { ...table(three(), [{ total: 30, line: LINES.total, page: 1 }]),
    statedTotals: [{ at: {}, total: 30, source: { retrievalId: null, page: 1, line: LINES.total } }, { at: { post: "Officer" }, total: 30, source: { retrievalId: null, page: 2, line: "Total 30" } }] };
  assert.deepEqual(printedTotalEvidence(both, 30), { missing: "the table holds more than one printed total for the whole table" });
});
