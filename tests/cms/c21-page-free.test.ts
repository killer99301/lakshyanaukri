// Stage C, C2.1, by code: pages follow each row's own document (PF-1), and a
// whole-table check names every document, judged by the server, with each
// research or prepared row mapped to the official document it was compared
// with (PF-3, revision 4). A mapping records the reviewer's declared
// comparison, not proof. No database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/c21-page-free.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { tableCheckScope, printedTotalEvidence, quoteIsPrintedTotal, totalRoute, type DocStandings } from "@/lib/cms/importer/table-check";
import { analyseVacancyTable, calculatedTotalReady, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";

const DOCS: DocStandings = {
  pdf: { kind: "PDF", eligible: true },          // the official notice (PDF)
  corr: { kind: "PDF", eligible: true },         // an official corrigendum (PDF)
  web: { kind: "HTML", eligible: true },         // an official web page
  portal: { kind: "HTML", eligible: false },     // a portal article (research)
  unconf: { kind: "PDF", eligible: false },      // an unconfirmed PDF
};
const row = (id: string, bank: string, total: number | null, retrievalId: string | null, page: number | null, readBy?: "PREPARED" | "AI_IMAGE"): VacancyTableRow => ({
  id, at: { post: "Officer", bank }, status: total === null ? "NOT_REPORTED" : "STATED", ...(total === null ? {} : { total }), cells: {},
  source: { retrievalId, page, line: `${bank} ${total ?? "NR"}`, ...(readBy ? { readBy } : {}) },
});
const table = (rows: VacancyTableRow[], printed?: { total: number; line: string; retrievalId: string | null; page: number | null }): VacancyTable => ({
  dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], rows,
  statedTotals: printed ? [{ at: {}, total: printed.total, source: { retrievalId: printed.retrievalId, page: printed.page, line: printed.line } }] : [],
});
const scope = (t: VacancyTable, reviewScope: Record<string, unknown>, extra: { quote?: string | null; page?: number | null; retrievalId?: string | null } = {}) =>
  tableCheckScope({ kind: "ADMIN_VERIFIED", table: t, quote: extra.quote === undefined ? "Name of the Bank" : extra.quote, page: extra.page ?? null, reviewScope, docs: DOCS, retrievalId: extra.retrievalId === undefined ? "pdf" : extra.retrievalId });
const err = (r: ReturnType<typeof tableCheckScope>) => ("error" in r ? r.error : null);
const codes = (t: VacancyTable) => analyseVacancyTable(t, { sourceKinds: Object.fromEntries(Object.entries(DOCS).map(([k, d]) => [k, d.kind])) }).issues.map((i) => i.code);

suite("C2.1 PF-1: a row's page follows its own document");

test("P01 a PDF row with its page: no page issue; a PDF row without one: PDF_ROW_WITHOUT_PAGE", () => {
  assert.ok(!codes(table([row("a", "A", 10, "pdf", 1)])).some((c) => c === "PDF_ROW_WITHOUT_PAGE" || c === "PAGE_ON_PAGELESS_SOURCE"));
  assert.ok(codes(table([row("a", "A", 10, "pdf", null)])).includes("PDF_ROW_WITHOUT_PAGE"));
});
test("P02 a web-page row with no page: fine; with a page (an invented one): PAGE_ON_PAGELESS_SOURCE", () => {
  assert.ok(!codes(table([row("a", "A", 10, "web", null)])).some((c) => c === "PDF_ROW_WITHOUT_PAGE" || c === "PAGE_ON_PAGELESS_SOURCE"));
  assert.ok(codes(table([row("a", "A", 10, "web", 1)])).includes("PAGE_ON_PAGELESS_SOURCE"));
});
test("P03 a mixed table: the web rows need no page, but a PDF row without its page is still caught", () => {
  const c = codes(table([row("a", "A", 10, "web", null), row("b", "B", 12, "pdf", null)]));
  assert.deepEqual(c.filter((x) => x === "PDF_ROW_WITHOUT_PAGE").length, 1);
  assert.ok(!c.includes("PAGE_ON_PAGELESS_SOURCE"));
});
test("P04 a printed total follows the same rule", () => {
  assert.ok(codes(table([row("a", "A", 10, "pdf", 1)], { total: 10, line: "Total 10", retrievalId: "pdf", page: null })).includes("PDF_ROW_WITHOUT_PAGE"));
});
test("P05 both issues block readiness, like NO_SOURCE", () => {
  const t = table([row("a", "A", 10, "pdf", null), row("b", "B", 12, "pdf", 1)]);
  const r = calculatedTotalReady(t, { tableChecked: true, sourceKinds: { pdf: "PDF" } });
  assert.ok(!r.ready && r.reasons.some((x) => /pdf row without page/.test(x)), JSON.stringify(r.reasons));
});
test("P06 without the documents' kinds (any caller before C2.1), nothing changes", () => {
  const t = table([row("a", "A", 10, "pdf", null)]);
  assert.ok(!analyseVacancyTable(t).issues.some((i) => i.code === "PDF_ROW_WITHOUT_PAGE"));
});

suite("C2.1: a printed total from a web page or text");

test("P11 a web page's printed total: its line, no page, its own document", () => {
  const t = table([row("a", "A", 10, "web", null), row("b", "B", 20, "web", null)], { total: 30, line: "Total 30", retrievalId: "web", page: null });
  assert.deepEqual(printedTotalEvidence(t, 30, DOCS), { line: "Total 30", page: null, retrievalId: "web" });
  assert.equal(totalRoute(t, { basis: "STATED", complete: true }, 30, DOCS).route, "PRINTED_LINE");
});
test("P12 verified only by that line, with no page, from that same document", () => {
  const ev = { line: "Total 30", page: null, retrievalId: "web" } as const;
  assert.ok(quoteIsPrintedTotal(ev, 30, "Total 30", null, "web"));
  assert.ok(!quoteIsPrintedTotal(ev, 30, "Total 30", 1, "web"), "an invented page");
  assert.ok(!quoteIsPrintedTotal(ev, 30, "Total 30", null, "pdf"), "another document");
  assert.ok(!quoteIsPrintedTotal(ev, 30, "A 10", null, "web"), "a row's line");
});
test("P13 a PDF printed total keeps its page rule, as approved in C2", () => {
  const t = table([row("a", "A", 10, "pdf", 1)], { total: 10, line: "Total 10", retrievalId: "pdf", page: null });
  assert.deepEqual(printedTotalEvidence(t, 10, DOCS), { missing: "the printed grand total has no page" });
  const ok = table([row("a", "A", 10, "pdf", 1)], { total: 10, line: "Total 10", retrievalId: "pdf", page: 1 });
  assert.deepEqual(printedTotalEvidence(ok, 10, DOCS), { line: "Total 10", page: 1 });
});
test("P14 rows from research send the total to the whole-table check, with the reason", () => {
  const t = table([row("a", "A", 10, "pdf", 1), row("b", "B", 20, "portal", null)], { total: 30, line: "Total 30", retrievalId: "pdf", page: 1 });
  const r = totalRoute(t, { basis: "STATED", complete: true }, 30, DOCS);
  assert.deepEqual([r.route, r.why], ["TABLE_CHECK", ["1 row comes from research or an unconfirmed source"]]);
});

suite("C2.1 PF-3: every document named, judged by the server");

const oneWeb = table([row("a", "A", 10, "web", null), row("b", "B", 20, "web", null)]);
test("P21 a web-page table: the C1 pages-only scope is refused (no invented pages); the whole document is accepted", () => {
  assert.match(err(scope(oneWeb, { pages: [1] }, { retrievalId: "web" })) ?? "", /name every document compared/);
  const r = scope(oneWeb, { documents: [{ retrievalId: "web", whole_document: true }] }, { retrievalId: "web" });
  assert.deepEqual("scope" in r && r.scope, { documents: [{ retrievalId: "web", whole_document: true }], whole_document: true, sections: ["the whole vacancy table"] });
});
test("P22 a web page given pages, or a PDF given the whole document: refused", () => {
  assert.match(err(scope(oneWeb, { documents: [{ retrievalId: "web", pages: [1] }] }, { retrievalId: "web" })) ?? "", /has no pages/);
  const pdfT = table([row("a", "A", 10, "pdf", 1)]);
  assert.match(err(scope(pdfT, { documents: [{ retrievalId: "pdf", whole_document: true }] })) ?? "", /is a PDF: name the pages/);
});
test("P23 a mixed table: each document named, with its own pages; a missing PDF page refused, naming its document", () => {
  const t = table([row("a", "A", 10, "pdf", 46), row("b", "B", 12, "pdf", 47), row("c", "C", 8, "web", null)]);
  assert.ok("scope" in scope(t, { documents: [{ retrievalId: "pdf", pages: [46, 47] }, { retrievalId: "web", whole_document: true }] }));
  assert.match(err(scope(t, { documents: [{ retrievalId: "pdf", pages: [46] }, { retrievalId: "web", whole_document: true }] })) ?? "", /page 47 of pdf/);
  assert.match(err(scope(t, { documents: [{ retrievalId: "pdf", pages: [46, 47] }] })) ?? "", /document not named: web/);
});
test("P24 a page-free web row never excuses a PDF row without its page", () => {
  const t = table([row("a", "A", 10, "pdf", null), row("c", "C", 8, "web", null)]);
  assert.match(err(scope(t, { documents: [{ retrievalId: "pdf", pages: [1] }, { retrievalId: "web", whole_document: true }] })) ?? "", /Row a comes from a PDF but has no page/);
});
test("P25 a document the job did not bring in: refused; a row citing one: refused", () => {
  assert.match(err(scope(oneWeb, { documents: [{ retrievalId: "web", whole_document: true }, { retrievalId: "elsewhere", whole_document: true }] }, { retrievalId: "web" })) ?? "", /not brought in for this job/);
  const foreign = table([row("a", "A", 10, "elsewhere", 1)]);
  assert.match(err(scope(foreign, { pages: [1] })) ?? "", /cites a document that was not brought in/);
});
test("P26 a research or unconfirmed document is never evidence: named as a source of rows only", () => {
  const t = table([row("a", "A", 10, "pdf", 1), row("b", "B", 20, "portal", null)]);
  const asEvidence = scope(t, { documents: [{ retrievalId: "pdf", pages: [1] }, { retrievalId: "portal", whole_document: true }], comparedWith: [{ retrievalId: "pdf", rows: [{ rowId: "b", page: 1 }] }] });
  assert.match(err(asEvidence) ?? "", /portal is not official evidence/);
  assert.match(err(scope(table([row("a", "A", 10, "unconf", 1)]), { documents: [{ retrievalId: "unconf", pages: [1] }] }, { retrievalId: "unconf" })) ?? "", /unconf is not official evidence/);
});
test("P27 the words cited must come from an official document named; a web page's words with no page", () => {
  const t = table([row("a", "A", 10, "pdf", 1), row("c", "C", 8, "web", null)]);
  const docs = { documents: [{ retrievalId: "pdf", pages: [1] }, { retrievalId: "web", whole_document: true }] };
  assert.match(err(scope(t, docs, { retrievalId: "corr" })) ?? "", /must come from one of the official documents compared/);
  assert.match(err(scope(t, docs, { retrievalId: "web", page: 1 })) ?? "", /give no page/);
  assert.ok("scope" in scope(t, docs, { retrievalId: "web", page: null }));
  assert.match(err(scope(t, docs, { quote: null })) ?? "", /Copy the table's heading/);
});
test("P28 no official document at all: a table cannot be checked", () => {
  const t = table([row("b", "B", 20, "portal", null)]);
  assert.match(err(scope(t, { documents: [{ retrievalId: "portal", rowSourceOnly: true }], comparedWith: [] }, { retrievalId: null })) ?? "", /not compared with an official document: b/);
});

suite("C2.1 (revision 4): research and prepared rows, each mapped to an official document");

const mixed = table([
  row("a", "A", 10, "pdf", 47), row("b", "B", 12, "pdf", 47),
  row("r1", "R1", 5, "portal", null), row("r2", "R2", 6, "portal", null),
  row("p1", "P1", 7, null, 48, "PREPARED"), row("h1", "H1", 3, null, 47),
]);
const base = { documents: [{ retrievalId: "pdf", pages: [47, 48] }, { retrievalId: "portal", rowSourceOnly: true }] };
const ok = { ...base, comparedWith: [{ retrievalId: "pdf", rows: [{ rowId: "r1", page: 47 }, { rowId: "r2", page: 48 }, { rowId: "p1", page: 48 }] }] };

test("P31 every research and prepared row mapped once, to an official document and page: accepted and stored as given", () => {
  const r = scope(mixed, ok);
  assert.ok("scope" in r, err(r) ?? "");
  assert.deepEqual("scope" in r && "comparedWith" in r.scope && r.scope.comparedWith, ok.comparedWith);
});
test("P32 a research row left unmapped: refused, naming it", () => {
  assert.match(err(scope(mixed, { ...base, comparedWith: [{ retrievalId: "pdf", rows: [{ rowId: "r1", page: 47 }, { rowId: "p1", page: 48 }] }] })) ?? "", /not compared with an official document: r2/);
});
test("P33 a row listed twice, a row with its own official document listed, an unknown row: each refused", () => {
  const twice = { ...base, comparedWith: [{ retrievalId: "pdf", rows: [{ rowId: "r1", page: 47 }, { rowId: "r1", page: 47 }, { rowId: "r2", page: 48 }, { rowId: "p1", page: 48 }] }] };
  assert.match(err(scope(mixed, twice)) ?? "", /r1 is listed twice/);
  const own = { ...base, comparedWith: [{ retrievalId: "pdf", rows: [...ok.comparedWith[0].rows, { rowId: "a", page: 47 }] }] };
  assert.match(err(scope(mixed, own)) ?? "", /Row a comes from an official document of its own/);
  const unknown = { ...base, comparedWith: [{ retrievalId: "pdf", rows: [...ok.comparedWith[0].rows, { rowId: "zz", page: 47 }] }] };
  assert.match(err(scope(mixed, unknown)) ?? "", /not in the table: zz/);
});
test("P34 a prepared row compared with a page other than the one it claims: refused", () => {
  const wrong = { ...base, comparedWith: [{ retrievalId: "pdf", rows: [{ rowId: "r1", page: 47 }, { rowId: "r2", page: 48 }, { rowId: "p1", page: 47 }] }] };
  assert.match(err(scope(mixed, wrong)) ?? "", /Prepared row p1 claims page 48 of the notice; it was compared with page 47/);
});
test("P35 a PDF mapping with no page, a page not among those compared, or a web mapping with a page: refused", () => {
  const noPage = { ...base, comparedWith: [{ retrievalId: "pdf", rows: [{ rowId: "r1", page: null }, { rowId: "r2", page: 48 }, { rowId: "p1", page: 48 }] }] };
  assert.match(err(scope(mixed, noPage)) ?? "", /Row r1: give the page of pdf/);
  const notCompared = { ...base, comparedWith: [{ retrievalId: "pdf", rows: [{ rowId: "r1", page: 49 }, { rowId: "r2", page: 48 }, { rowId: "p1", page: 48 }] }] };
  assert.match(err(scope(mixed, notCompared)) ?? "", /page 49 of pdf is not among the pages compared/);
  const webT = table([row("w", "W", 10, "web", null), row("r1", "R1", 5, "portal", null)]);
  const webMap = { documents: [{ retrievalId: "web", whole_document: true }, { retrievalId: "portal", rowSourceOnly: true }], comparedWith: [{ retrievalId: "web", rows: [{ rowId: "r1", page: 2 }] }] };
  assert.match(err(scope(webT, webMap, { retrievalId: "web" })) ?? "", /web page or text, so the row has no page/);
  assert.ok("scope" in scope(webT, { ...webMap, comparedWith: [{ retrievalId: "web", rows: [{ rowId: "r1", page: null }] }] }, { retrievalId: "web" }));
});
test("P36 a mapping to a research document: refused (only official evidence)", () => {
  const toPortal = { ...base, comparedWith: [{ retrievalId: "portal", rows: [{ rowId: "r1", page: null }, { rowId: "r2", page: null }, { rowId: "p1", page: null }] }] };
  assert.match(err(scope(mixed, toPortal)) ?? "", /only with official evidence; portal is research/);
});
test("P37 two official documents covering different rows: accepted, each row tied to one", () => {
  const two = table([row("a", "A", 10, "pdf", 47), row("k", "K", 4, "corr", 2), row("r1", "R1", 5, "portal", null), row("r2", "R2", 6, "portal", null)]);
  const s = { documents: [{ retrievalId: "pdf", pages: [47] }, { retrievalId: "corr", pages: [2] }, { retrievalId: "portal", rowSourceOnly: true }],
    comparedWith: [{ retrievalId: "pdf", rows: [{ rowId: "r1", page: 47 }] }, { retrievalId: "corr", rows: [{ rowId: "r2", page: 2 }] }] };
  assert.ok("scope" in scope(two, s), err(scope(two, s)) ?? "");
});
test("P38 a row typed from the notice (a page, no document) must be on a page of an official PDF compared", () => {
  assert.match(err(scope(mixed, { ...ok, documents: [{ retrievalId: "pdf", pages: [48] }, { retrievalId: "portal", rowSourceOnly: true }] })) ?? "", /page 47 of pdf too|Row h1 has page 47/);
});
test("P39 the C1 single-PDF check is unchanged: pages only, as before", () => {
  const t = table([row("a", "A", 10, "pdf", 1), row("b", "B", 12, "pdf", 2)]);
  assert.deepEqual("scope" in scope(t, { pages: [1, 2] }) && scope(t, { pages: [1, 2] }), { scope: { pages: [1, 2], sections: ["the whole vacancy table"] } });
  assert.match(err(scope(t, { pages: [1] })) ?? "", /comes from page 2 too/);
});
