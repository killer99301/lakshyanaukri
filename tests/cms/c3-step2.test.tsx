// Stage C, C3 step 2, by code: which actions the check list offers (rowActions),
// and what the decision form and the vacancy-table line say, rendered to HTML.
// The server decides everything; these only choose buttons and words from what
// the checks route returns. Clicks and the withdraw confirmation are exercised
// in the browser, not here (static rendering has no events).
//
//   npx tsx --tsconfig tsconfig.json tests/cms/c3-step2.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { rowActions, type TableTotalView } from "@/app/admin/cms/[id]/check-actions";
import { DecisionForm, TableCheckLine } from "@/app/admin/cms/[id]/ImportChecksPanel";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

const PRINTED: TableTotalView = { incomplete: false, route: "PRINTED_LINE", evidence: { line: "Total 5 3 8 3 11 30", page: 2 }, why: [], pages: [1, 2] };
const CALCULATED: TableTotalView = { incomplete: false, route: "TABLE_CHECK", evidence: null, why: ["the total is calculated from the rows"], pages: [1, 2] };
const INCOMPLETE: TableTotalView = { incomplete: true, route: "TABLE_CHECK", evidence: null, why: ["the total is incomplete", "the total is calculated from the rows"], pages: [1, 2] };
const total = (cls: string, decisionId?: string) => ({ fieldPath: "vacancies.total", cls, tier: "B" as const, value: 30, decisionId });

suite("C3 step 2: the actions offered for each field");

test("S201 a printed total: Verify, naming its printed line and page; no Not applicable, no plain Not stated", () => {
  const a = rowActions(total("UNSUPPORTED"), PRINTED);
  assert.deepEqual(a, { verify: true, notApplicable: false, notStated: false, notStatedInFull: false, withdraw: false, printedLine: { line: "Total 5 3 8 3 11 30", page: 2 }, needsTableCheck: false });
});
test("S202 the whole-table route (calculated, AI-read, prepared, no printed line): no Verify; the whole-table check said", () => {
  const a = rowActions(total("UNSUPPORTED"), CALCULATED);
  assert.deepEqual([a.verify, a.notApplicable, a.notStated, a.notStatedInFull, a.needsTableCheck, a.printedLine], [false, false, false, false, true, null]);
});
test("S203 an incomplete total: no Verify; Not stated in full; the whole-table check still said", () => {
  const a = rowActions(total("UNSUPPORTED"), INCOMPLETE);
  assert.deepEqual([a.verify, a.notApplicable, a.notStated, a.notStatedInFull, a.needsTableCheck], [false, false, false, true, true]);
});
test("S204 Not applicable is never offered for a total worked out from the table, whatever its class", () => {
  for (const cls of ["UNSUPPORTED", "SUPPORTED", "VERIFIED", "NOT_STATED", "CONFLICTING"]) for (const v of [PRINTED, CALCULATED, INCOMPLETE]) assert.equal(rowActions(total(cls), v).notApplicable, false, `${cls} ${v.route}`);
});
test("S205 once verified, or recorded not stated in full: no Verify again, no whole-table hint; Withdraw when a decision stands", () => {
  assert.deepEqual([rowActions(total("VERIFIED", "d1"), PRINTED).verify, rowActions(total("VERIFIED", "d1"), PRINTED).withdraw], [false, true]);
  const viaTable = rowActions(total("VERIFIED"), CALCULATED);
  assert.deepEqual([viaTable.needsTableCheck, viaTable.withdraw], [false, false], "verified by the table check: nothing on the total itself to withdraw");
  const ns = rowActions(total("NOT_STATED", "d2"), INCOMPLETE);
  assert.deepEqual([ns.notStatedInFull, ns.needsTableCheck, ns.withdraw], [false, false, true]);
});
test("S206 every other field, and a total with no table, behave exactly as before step 2", () => {
  const before = (r: { cls: string; tier?: "A" | "B"; value: unknown; decisionId?: string }) => ({
    verify: r.value !== null && r.value !== undefined && r.cls !== "VERIFIED", notApplicable: r.cls !== "NOT_APPLICABLE", notStated: r.cls !== "NOT_STATED" && r.tier === "B", withdraw: !!r.decisionId,
  });
  const cases = [
    { fieldPath: "dates.applicationOpenDate", cls: "SUPPORTED", tier: "B" as const, value: "2026-09-01" },
    { fieldPath: "dates.applicationCloseDate", cls: "VERIFIED", tier: "A" as const, value: "2026-09-21", decisionId: "x" },
    { fieldPath: "financial.feeGeneral", cls: "MISSING", tier: "B" as const, value: null },
    { fieldPath: "eligibility", cls: "NOT_APPLICABLE", tier: "A" as const, value: null, decisionId: "y" },
    { fieldPath: "vacancies.total", cls: "MISSING", tier: "B" as const, value: null },
    { fieldPath: "vacancies.total", cls: "SUPPORTED", tier: "B" as const, value: 12 },
  ];
  for (const c of cases) {
    const a = rowActions(c, null);
    assert.deepEqual({ verify: a.verify, notApplicable: a.notApplicable, notStated: a.notStated, withdraw: a.withdraw }, before(c), `${c.fieldPath} ${c.cls}`);
    assert.deepEqual([a.notStatedInFull, a.printedLine, a.needsTableCheck], [false, null, false]);
  }
});

suite("C3 step 2: the decision form and the vacancy-table line, rendered");

const row = { fieldPath: "vacancies.total", label: "Total vacancies", cls: "UNSUPPORTED", reason: "r", tier: "B" as const, value: 22, latestRevisionId: "rev" };
const docs = [{ id: "d1", declaredKind: "OFFICIAL_NOTIFICATION", versionLabel: null, originHost: "ibps.in", originRole: "AUTHORITY", authenticity: "ATTESTED", contentKind: "PDF", pageCount: 2 }];
const noop = () => {};

test("S211 Not stated in full: its title, the table's pages to tick, no whole-document shortcut, the reason required, and what it does not answer", () => {
  const html = renderToStaticMarkup(<DecisionForm recordId="j" row={row} kind="ADMIN_NOT_STATED" retrievals={docs} onDone={noop} onCancel={noop} inFull={{ pages: [1, 2] }} />);
  const t = text(html);
  assert.match(t, /Not stated in full: the notice does not give these figures/);
  assert.match(t, /Pages of the notice you read for the missing figures \(required\)/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2, "one box per page of the table, none for the whole document");
  assert.ok(!/whole document/i.test(t), "no whole-document option");
  assert.match(t, /Why \(kept in the history\) \(required\)/);
  assert.match(t, /The figure stays as it is, and the public page says “At least 22”\. This answers only the missing figures: the whole table must still be checked/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Record<\/button>/, "Record disabled until a page and a reason are given");
});
test("S212 the ordinary Not stated form is unchanged: the whole-document option, no page boxes, no in-full words", () => {
  const html = renderToStaticMarkup(<DecisionForm recordId="j" row={{ ...row, fieldPath: "financial.feeGeneral" }} kind="ADMIN_NOT_STATED" retrievals={docs} onDone={noop} onCancel={noop} />);
  const t = text(html);
  assert.match(t, /The notice does not state this/);
  assert.match(t, /I read the whole document/);
  assert.ok(!/in full/.test(t) && !/missing figures/.test(t));
});
test("S213 Verify on a printed total names its line and page; the words and page are left empty for the person (C3-D1)", () => {
  const html = renderToStaticMarkup(<DecisionForm recordId="j" row={{ ...row, value: 30 }} kind="ADMIN_VERIFIED" retrievals={docs} onDone={noop} onCancel={noop} printedLine={{ line: "Total 5 3 8 3 11 30", page: 2 }} />);
  assert.match(text(html), /Cite the notice's printed total: “Total 5 3 8 3 11 30”, page 2\. Any other line does not verify it\./);
  assert.ok(!/value="Total 5 3 8 3 11 30"/.test(html) && !/>Total 5 3 8 3 11 30<\/textarea>/.test(html), "the quote is not filled in");
  assert.ok(!/value="2"/.test(html), "the page is not filled in");
});
test("S214 the table line: checked, with its pages and Withdraw; not checked, with what that means; nothing for a job with no table", () => {
  const checked = text(renderToStaticMarkup(<TableCheckLine state={{ checked: true, decisionId: "t1", pages: [1, 2], revisionId: "r" }} tableTotal={CALCULATED} editable onWithdraw={noop} />));
  assert.match(checked, /Vacancy table: checked against the notice \(pages 1, 2\) Withdraw the table check/);
  const notChecked = text(renderToStaticMarkup(<TableCheckLine state={{ checked: false, decisionId: null, pages: [], revisionId: "r" }} tableTotal={INCOMPLETE} editable onWithdraw={noop} />));
  assert.match(notChecked, /Vacancy table: not checked against the notice/);
  assert.match(notChecked, /can be checked only by checking the whole table against the notice \(the total is incomplete; the total is calculated from the rows\)/);
  assert.match(notChecked, /not available on this screen yet .*; until then this total stays pending\./);
  const printed = text(renderToStaticMarkup(<TableCheckLine state={{ checked: false, decisionId: null, pages: [], revisionId: "r" }} tableTotal={PRINTED} editable onWithdraw={noop} />));
  assert.match(printed, /can be verified by the notice's printed total, or by checking the whole table/);
  assert.ok(!/stays pending/.test(printed));
  assert.equal(renderToStaticMarkup(<TableCheckLine state={{ checked: false, decisionId: null, pages: [], revisionId: null }} tableTotal={null} editable onWithdraw={noop} />), "");
});
test("S215 no button that does nothing: the not-yet-available table check is words only; Withdraw only when it can be done", () => {
  const notChecked = renderToStaticMarkup(<TableCheckLine state={{ checked: false, decisionId: null, pages: [], revisionId: "r" }} tableTotal={CALCULATED} editable onWithdraw={noop} />);
  assert.ok(!/<button/.test(notChecked), "no button while the table check cannot be done here");
  const readOnly = renderToStaticMarkup(<TableCheckLine state={{ checked: true, decisionId: "t1", pages: [1, 2], revisionId: "r" }} tableTotal={CALCULATED} editable={false} onWithdraw={noop} />);
  assert.ok(!/<button/.test(readOnly), "a job not open for editing: no Withdraw");
});
