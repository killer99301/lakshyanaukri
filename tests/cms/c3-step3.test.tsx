// Stage C, C3 step 3, by code: what the whole-table check needs (S1), the
// source declaration kept and validated (S2), the row marks with the
// documents' kinds (S3), the web-page printed-total hint (S4), and the form's
// own rules: what is still needed before Record, the one decision it builds,
// and bulk assignment never ticking a confirmation. No database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/c3-step3.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { tableCheckNeeds, tableCheckScope, type DocStandings } from "@/lib/cms/importer/table-check";
import { rowAttention } from "@/lib/cms/importer/row-attention";
import type { VacancyTable, VacancyTableRow } from "@/lib/vacancy-table";
import { assignRows, buildDecision, emptyForm, stillNeeded, type TableCheckForm, type TableNeeds } from "@/app/admin/cms/[id]/table-check-form";
import { DecisionForm, TableCheckLine } from "@/app/admin/cms/[id]/ImportChecksPanel";
import { TableCheckPanel } from "@/app/admin/cms/[id]/TableCheckPanel";

const SHA = "a".repeat(64);
const DOCS: DocStandings = {
  pdf: { kind: "PDF", eligible: true, name: "ibps.in — notification", sha256: SHA, originUrl: "https://www.ibps.in/n.pdf" },
  web: { kind: "HTML", eligible: true, name: "ibps.in — notice page", sha256: "b".repeat(64), originUrl: "https://www.ibps.in/n.html" },
  portal: { kind: "HTML", eligible: false, name: "portal — research", sha256: "c".repeat(64), originUrl: "https://portal.example/x" },
};
const row = (id: string, bank: string, total: number, rid: string | null, page: number | null, readBy?: "PREPARED"): VacancyTableRow => ({
  id, at: { post: "Officer", bank }, status: "STATED", total, cells: {}, source: { retrievalId: rid, page, line: `${bank} ${total}`, ...(readBy ? { readBy } : {}) } });
const table = (rows: VacancyTableRow[]): VacancyTable => ({ dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], rows, statedTotals: [] });
const needsOf = (t: VacancyTable) => { const n = tableCheckNeeds(t, DOCS); if ("error" in n) throw new Error(n.error); return n as TableNeeds; };
const SINGLE = table([row("a", "Alpha", 10, "pdf", 46), row("b", "Beta", 12, "pdf", 47)]);
const WEB = table([row("w1", "Alpha", 10, "web", null), row("w2", "Beta", 12, "web", null)]);
const MIXED = table([row("a", "Alpha", 10, "pdf", 47), row("w", "Web", 7, "web", null), row("r1", "Rho", 5, "portal", null), row("p1", "Pi", 4, null, 48, "PREPARED")]);
const filled = (f: Partial<TableCheckForm>): TableCheckForm => ({ ...emptyForm(), quote: "Name of the Bank", confirm: true, ...f });

suite("C3 step 3, S1: what the whole-table check needs, from the server's own rule");

test("T01 one official PDF: simple; its pages; nothing to map", () => {
  const n = needsOf(SINGLE);
  assert.equal(n.simple, true);
  assert.deepEqual(n.documents.map((d) => [d.retrievalId, d.eligible, d.pages, d.rowCount]), [["pdf", true, [46, 47], 2]]);
  assert.deepEqual(n.rowsToMap, []);
});
test("T02 a web page: not simple (no pages to tick), the whole document", () => {
  const n = needsOf(WEB);
  assert.equal(n.simple, false);
  assert.deepEqual(n.documents.map((d) => [d.retrievalId, d.kind, d.pages]), [["web", "HTML", []]]);
});
test("T03 mixed: each document with its standing and pages; research and prepared rows to map, the prepared row with its claimed page", () => {
  const n = needsOf(MIXED);
  assert.deepEqual(n.documents.map((d) => [d.retrievalId, d.eligible, d.pages]), [["pdf", true, [47]], ["web", true, []], ["portal", false, []]]);
  assert.deepEqual(n.rowsToMap.map((r) => [r.rowId, r.why, r.claimedPage]), [["r1", "research", null], ["p1", "prepared", 48]]);
  assert.deepEqual(n.official.map((o) => o.retrievalId).sort(), ["pdf", "web"], "research is never offered as official");
});

suite("C3 step 3: the form's rules");

test("T11 single PDF: needs only step 1, its pages, the words and the confirmation; builds the documents shape, which the server accepts", () => {
  const n = needsOf(SINGLE);
  assert.ok(stillNeeded(n, emptyForm(), 0).some((x) => /how you have the original of ibps.in — notification/.test(x)));
  const f = filled({ sources: { pdf: { by: "FILE_HASH", sha256: SHA } }, pagesTicked: { pdf: [46, 47] }, quoteDoc: "pdf", quotePage: "46" });
  assert.deepEqual(stillNeeded(n, f, 0), []);
  const d = buildDecision(n, f, 0);
  assert.deepEqual(d.reviewScope, { documents: [{ retrievalId: "pdf", pages: [46, 47], source: { by: "FILE_HASH", sha256: SHA } }] });
  assert.ok("scope" in tableCheckScope({ kind: "ADMIN_VERIFIED", table: SINGLE, quote: d.quote, page: d.page, reviewScope: d.reviewScope, docs: DOCS, retrievalId: d.retrievalId }));
});
test("T12 single PDF: a page left unticked is named, and Record stays disabled", () => {
  const f = filled({ sources: { pdf: { by: "FILE_HASH", sha256: SHA } }, pagesTicked: { pdf: [46] }, quoteDoc: "pdf" });
  assert.deepEqual(stillNeeded(needsOf(SINGLE), f, 0), ["page 47 of ibps.in — notification"]);
});
test("T13 a web page: the whole document, never pages; the words with no page", () => {
  const n = needsOf(WEB);
  const f = filled({ sources: { web: { by: "OFFICIAL_ADDRESS", url: "https://www.ibps.in/n.html" } }, quoteDoc: "web", quotePage: "3" });
  assert.deepEqual(stillNeeded(n, f, 0), ["that you read the whole of ibps.in — notice page"]);
  const d = buildDecision(n, { ...f, wholeDoc: { web: true } }, 0);
  assert.deepEqual([d.page, d.reviewScope], [null, { documents: [{ retrievalId: "web", whole_document: true, source: { by: "OFFICIAL_ADDRESS", url: "https://www.ibps.in/n.html" } }] }]);
  assert.ok("scope" in tableCheckScope({ kind: "ADMIN_VERIFIED", table: WEB, quote: d.quote, page: d.page, reviewScope: d.reviewScope, docs: DOCS, retrievalId: "web" }));
});
test("T14 mixed: every row mapped, the pages of the PDF include the mapped and prepared rows' pages; the built decision is accepted by the server", () => {
  const n = needsOf(MIXED);
  let f = filled({ sources: { pdf: { by: "FILE_HASH", sha256: SHA }, web: { by: "OFFICIAL_ADDRESS", url: "https://www.ibps.in/n.html" } }, wholeDoc: { web: true }, quoteDoc: "pdf", quotePage: "47" });
  assert.ok(stillNeeded(n, f, 0).includes("2 rows still to compare with an official document"));
  f = assignRows(n, f, ["r1", "p1"], "pdf", 47);
  assert.deepEqual([f.maps.r1, f.maps.p1], [{ retrievalId: "pdf", page: 47 }, { retrievalId: "pdf", page: 48 }], "the prepared row keeps the page it claims");
  assert.equal(f.confirm, false, "bulk assignment never ticks the confirmation");
  assert.deepEqual(stillNeeded(n, { ...f, pagesTicked: { pdf: [47] } }, 0), ["page 48 of ibps.in — notification", "your confirmation that the whole table matches the notice"]);
  const done = { ...f, pagesTicked: { pdf: [47, 48] }, confirm: true };
  assert.deepEqual(stillNeeded(n, done, 0), []);
  const d = buildDecision(n, done, 0);
  const r = tableCheckScope({ kind: "ADMIN_VERIFIED", table: MIXED, quote: d.quote, page: d.page, reviewScope: d.reviewScope, docs: DOCS, retrievalId: d.retrievalId });
  assert.ok("scope" in r, "error" in r ? r.error : "");
  assert.deepEqual(d.reviewScope.documents, [
    { retrievalId: "pdf", pages: [47, 48], source: { by: "FILE_HASH", sha256: SHA } },
    { retrievalId: "web", whole_document: true, source: { by: "OFFICIAL_ADDRESS", url: "https://www.ibps.in/n.html" } },
    { retrievalId: "portal", rowSourceOnly: true },
  ]);
});
test("T15 marked rows: the acknowledgment is required and its count stored", () => {
  const n = needsOf(SINGLE);
  const f = filled({ sources: { pdf: { by: "FILE_HASH", sha256: SHA } }, pagesTicked: { pdf: [46, 47] }, quoteDoc: "pdf" });
  assert.deepEqual(stillNeeded(n, f, 2), ["that you looked at the 2 marked rows (step 3)"]);
  assert.equal(buildDecision(n, { ...f, flaggedAck: true }, 2).reviewScope.flaggedRowsAcknowledged, 2);
});
test("T16 without step 1 the check is not offered (screen safeguard), whatever else is filled", () => {
  const f = filled({ pagesTicked: { pdf: [46, 47] }, quoteDoc: "pdf" });
  assert.deepEqual(stillNeeded(needsOf(SINGLE), f, 0), ["how you have the original of ibps.in — notification (step 1)"]);
});

suite("C3 step 3, S2: the declared source, kept when given, validated, never required");

const sc = (reviewScope: Record<string, unknown>) => tableCheckScope({ kind: "ADMIN_VERIFIED", table: SINGLE, quote: "Name of the Bank", page: 46, reviewScope, docs: DOCS, retrievalId: "pdf" });
test("T21 the document's own fingerprint: kept; another: refused", () => {
  const ok = sc({ documents: [{ retrievalId: "pdf", pages: [46, 47], source: { by: "FILE_HASH", sha256: SHA.toUpperCase() } }] });
  assert.ok("scope" in ok && "documents" in ok.scope && JSON.stringify(ok.scope.documents[0].source) === JSON.stringify({ by: "FILE_HASH", sha256: SHA }));
  const bad = sc({ documents: [{ retrievalId: "pdf", pages: [46, 47], source: { by: "FILE_HASH", sha256: "d".repeat(64) } }] });
  assert.match("error" in bad ? bad.error : "", /not the file that was imported/);
});
test("T22 the document's own address: kept; another: refused; an unknown method: refused", () => {
  assert.ok("scope" in sc({ documents: [{ retrievalId: "pdf", pages: [46, 47], source: { by: "OFFICIAL_ADDRESS", url: "https://www.ibps.in/n.pdf" } }] }));
  const bad = sc({ documents: [{ retrievalId: "pdf", pages: [46, 47], source: { by: "OFFICIAL_ADDRESS", url: "https://www.ibps.in/other.pdf" } }] });
  assert.match("error" in bad ? bad.error : "", /not the address it was imported from/);
  const odd = sc({ documents: [{ retrievalId: "pdf", pages: [46, 47], source: { by: "TRUST_ME" } }] });
  assert.match("error" in odd ? odd.error : "", /fingerprint or the official address/);
});
test("T23 no declared source: still accepted (never a server requirement); the C1 pages-only shape: unchanged", () => {
  assert.ok("scope" in sc({ documents: [{ retrievalId: "pdf", pages: [46, 47] }] }));
  assert.deepEqual(sc({ pages: [46, 47] }), { scope: { pages: [46, 47], sections: ["the whole vacancy table"] } });
});
test("T24 the marked-rows count must be a whole number", () => {
  const bad = sc({ documents: [{ retrievalId: "pdf", pages: [46, 47] }], flaggedRowsAcknowledged: -1 });
  assert.match("error" in bad ? bad.error : "", /whole number/);
});

suite("C3 step 3, S3 and S4");

test("T31 the row marks show C2.1's page problems when given the kinds", () => {
  const t = table([row("a", "Alpha", 10, "pdf", null), row("b", "Beta", 12, "pdf", 1)]);
  assert.equal(rowAttention(t).length, 0);
  const a = rowAttention(t, { sourceKinds: { pdf: "PDF" } });
  assert.ok(a.some((x) => x.rowId === "a" && x.problems.some((p) => p.code === "PDF_ROW_WITHOUT_PAGE")));
});
const retr = [
  { id: "pdf", declaredKind: "OFFICIAL_NOTIFICATION", versionLabel: null, originHost: "ibps.in", originRole: "AUTHORITY", authenticity: "ATTESTED", contentKind: "PDF", pageCount: 2 },
  { id: "web", declaredKind: "OFFICIAL_PAGE", versionLabel: "notice page", originHost: "ibps.in", originRole: "AUTHORITY", authenticity: "CONFIRMED", contentKind: "HTML", pageCount: null },
];
const vRow = { fieldPath: "vacancies.total", label: "Total vacancies", cls: "UNSUPPORTED", reason: "r", tier: "B" as const, value: 30, latestRevisionId: "rev" };
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
test("T41 a web page's printed total: no “page .”; the web page named and pre-selected; no page box", () => {
  const html = renderToStaticMarkup(<DecisionForm recordId="j" row={vRow} kind="ADMIN_VERIFIED" retrievals={retr} onDone={() => {}} onCancel={() => {}} printedLine={{ line: "Total 30", page: null, retrievalId: "web" }} />);
  const t = text(html);
  assert.ok(!/page \./.test(t), t);
  assert.match(t, /Cite the notice's printed total: “Total 30”, from the official web page or text it is on \(ibps.in — notice page/);
  assert.match(html, /<option value="web" selected="">/);
  assert.ok(!/Page \(required\)|>Page</.test(t), "no page box for a web page");
});
test("T42 a PDF printed total: unchanged (its page named)", () => {
  const t = text(renderToStaticMarkup(<DecisionForm recordId="j" row={vRow} kind="ADMIN_VERIFIED" retrievals={retr} onDone={() => {}} onCancel={() => {}} printedLine={{ line: "Total 30", page: 2 }} />));
  assert.match(t, /Cite the notice's printed total: “Total 30”, page 2\./);
});

suite("C3 step 3: the panel and the table line, rendered");

test("T51 the table line offers “Check the whole table” only when it can be done; otherwise says why", () => {
  const view = { incomplete: false, route: "TABLE_CHECK" as const, evidence: null, why: ["the total is calculated from the rows"], pages: [1] };
  const st = { checked: false, decisionId: null, pages: [], revisionId: "r" };
  assert.match(renderToStaticMarkup(<TableCheckLine state={st} tableTotal={view} editable onWithdraw={() => {}} onOpenCheck={() => {}} />), /data-open-table-check/);
  const cannot = renderToStaticMarkup(<TableCheckLine state={st} tableTotal={view} editable onWithdraw={() => {}} cannotCheck="Row x cites a document that was not brought in for this job" />);
  assert.ok(!/<button/.test(cannot) && /It cannot be checked here: Row x cites a document/.test(text(cannot)));
});
test("T52 the panel opens with nothing ticked and Record disabled; mixed: the rows to compare listed, research labelled, prepared page fixed", () => {
  const html = renderToStaticMarkup(<TableCheckPanel recordId="j" table={MIXED} needs={needsOf(MIXED)} revisionId="r" decisionId={null}
    retrievals={[{ id: "pdf", contentKind: "PDF", sha256: SHA, originUrl: "https://www.ibps.in/n.pdf" }, { id: "web", contentKind: "HTML", sha256: "b".repeat(64), originUrl: "https://www.ibps.in/n.html" }]}
    onDone={() => {}} onCancel={() => {}} />);
  const t = text(html);
  assert.ok(!/checked=""/.test(html), "nothing ticked");
  assert.match(html, /<button[^>]*data-record-table-check[^>]*disabled=""/);
  assert.match(t, /Rows to compare with the official notice \(2\)/);
  assert.match(t, /research \(a portal, an article or other unofficial text\): not the notice/);
  assert.match(t, /prepared outside the notice \(research\): not the notice/);
  assert.match(t, /as the server extracted it from the web page or text: it is not the page/);
  assert.ok(!/retrievalId|comparedWith|\{"/.test(t), "no JSON or internal names on the screen");
});
