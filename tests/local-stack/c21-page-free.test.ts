// ═══════════════════════════════════════════════════════════
// Stage C, C2.1: web pages and text without page numbers; every document named
// ═══════════════════════════════════════════════════════════
//
// Through the REAL import (an official web page "fetched" from a saved copy,
// no network), the decisions route, the field route and the gate, against the
// in-memory test database. No AI.
//
//   H   a table from an official web page: its printed total verified by its
//       line with no page; a calculated one by checking the whole document;
//       an incomplete one "not stated in full" over the whole document.
//   M   one job with an official PDF, an official web page and research: the
//       check names every document; research is never evidence; each
//       research or prepared row is mapped to an official page; a PDF row
//       without its page is never excused.
//   F   a row citing another job's document is refused.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/c21-page-free.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, note, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable, VacancyTableRow } from "@/lib/vacancy-table";

type J = Record<string, unknown>;

const HEAD = "<p>Sr. No. Name of the Bank SC ST OBC EWS UR Total</p><p>1 Alpha Gramin Bank 2 1 3 1 3 10</p><p>2 Beta Gramin Bank 2 1 3 1 5 12</p>";
const page = (rows: string, tail: string) => `<html><head><title>IBPS</title></head><body><h1>Institute of Banking Personnel Selection</h1><p>Common Recruitment Process TEST C21</p><p>Tentative vacancies</p>${HEAD}${rows}${tail}</body></html>`;
const PAGES: Record<string, string> = {
  "https://www.ibps.in/notices/c21-printed.html": page("<p>3 Gamma Gramin Bank 1 1 2 1 3 8</p>", "<p>Total 5 3 8 3 11 30</p>"),
  "https://www.ibps.in/notices/c21-calculated.html": page("<p>3 Gamma Gramin Bank 1 1 2 1 3 8</p>", "<p>The vacancies are tentative.</p>"),
  "https://www.ibps.in/notices/c21-incomplete.html": page("<p>3 Gamma Gramin Bank NR NR NR NR NR NR</p>", "<p>The vacancies are tentative.</p>"),
  "https://www.ibps.in/notices/c21-plain.html": "<html><body><h1>Institute of Banking Personnel Selection</h1><p>Common Recruitment Process TEST C21: the vacancies of the regional rural banks are announced on this page.</p></body></html>",
};
const fetchSourceFn = async (url: string) => PAGES[url]
  ? { ok: true as const, finalUrl: url, contentType: "text/html; charset=utf-8", bytes: Buffer.from(PAGES[url], "utf8") }
  : { ok: false as const, error: "blocked (403)" };
const PDF_URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-C21.pdf";
const PDF = makePdf(["Institute of Banking Personnel Selection\nCommon Recruitment Process TEST C21 (PDF)\nAlpha Gramin Bank appears in Annexure I.\nRows: Alpha Gramin Bank 10"]);
const RESEARCH = "IBPS CRP TEST C21 summary from a coaching site. The vacancies listed there include Rho Gramin Bank 5 and other banks; check the official notice for the final figures.";

const S = { H: "H: a table from an official web page", M: "M: an official PDF, an official web page and research in one table", F: "F: a row citing another job's document" };
expectChecks(S.H, [
  "H: the web page's rows and printed total have no page; the server confirmed the page (CONFIRMED)",
  "H: the check list offers its printed line, with no page (from that document)",
  "H: the printed line with an invented page 1: refused",
  "H: a bank row's line: refused",
  "H: the printed line, no page, from that page: VERIFIED",
  "H: a calculated web table: the C1 pages-only check refused (no invented pages)",
  "H: a calculated web table: checked as the whole document, and the total VERIFIED",
  "H: an incomplete web total: \"not stated in full\" with pages refused, with the whole document recorded",
  "H: and with the whole table checked as well: NOT_STATED, no longer blocking",
]);
expectChecks(S.M, [
  "M: the job holds an official PDF, an official web page (both eligible) and research (not)",
  "M: the pages-only check is refused for this table",
  "M: a document left out: refused",
  "M: the research document named as evidence: refused",
  "M: a research row left unmapped: refused, naming it",
  "M: a prepared row compared with another page than it claims: refused",
  "M: every document named, each research and prepared row mapped: recorded, the total VERIFIED",
  "M: the stored check names every document and every mapped row",
  "M: a PDF row without its page: the total blocks and the check is refused, even with web rows page-free",
  "M: after a row edit, the earlier check no longer stands",
]);
expectChecks(S.F, ["F: a row citing a document of another job: the check refused"]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const decisions = await import("@/app/api/admin/cms/records/[id]/decisions/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const saveTable = async (id: string, t: VacancyTable) => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "vacancies.table", field: { value: t, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "C2.1 test" }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  type Docs = Array<{ id: string; contentKind: string; declaredKind: string; authenticity: string }>;
  const state = async (id: string) => {
    const rec = (await getRecruitmentById(id))!;
    const c = await service.checksFor(rec) as Awaited<ReturnType<typeof service.checksFor>> & { retrievals: Docs };
    return { rec, c, total: c.rows.find((r) => r.fieldPath === "vacancies.total")!, blocks: c.blockers.includes("vacancies.total") };
  };
  const post = async (id: string, body: J) => {
    const r = await decisions.POST(req(`/api/admin/cms/records/${id}/decisions`, "POST", body), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const err = (r: { data: J }) => String(r.data.error ?? "");
  const decideTotal = async (id: string, retrievalId: string, kind: string, quote: string | null, pg2: number | null, extra: J = {}) => {
    const s = await state(id);
    return post(id, { action: "decide", fieldPath: "vacancies.total", kind, retrievalId, page: pg2, quote, seen: { revisionId: s.total.latestRevisionId, decisionId: s.total.decisionId ?? null }, ...extra });
  };
  const checkTable = async (id: string, retrievalId: string, quote: string, pg2: number | null, reviewScope: J) => {
    const s = await state(id);
    return post(id, { action: "decide", fieldPath: "vacancies.table", kind: "ADMIN_VERIFIED", retrievalId, page: pg2, quote, reviewScope, seen: { revisionId: s.c.tableCheck.revisionId, decisionId: s.c.tableCheck.decisionId } });
  };
  const importJob = async (year: number, sources: J[], withTable = true) => {
    const p = await service.previewImport({ adminId, mode: "NEW", apiKey: undefined, fetchSourceFn,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title: `TEST RECORD IBPS C21 ${year}`, govType: "PSU" }, sources } as never);
    const items = (p.proposal as unknown as { items: Array<{ id: string; fieldPath: string; defaultTicked: boolean }> }).items;
    return (await service.applyImportFlow({ importId: p.importId, adminId, selected: items.filter((i) => i.defaultTicked && (withTable || i.fieldPath !== "vacancies.table")).map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId;
  };
  const url = (u: string) => ({ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: u });

  // ── H ──
  section(S.H);
  const h = await importJob(2061, [url("https://www.ibps.in/notices/c21-printed.html")]);
  let s = await state(h);
  const web = s.c.retrievals[0];
  const t0 = s.rec.vacancies.table!.value!;
  check("H: the web page's rows and printed total have no page; the server confirmed the page (CONFIRMED)",
    web.contentKind === "HTML" && web.authenticity === "CONFIRMED" && t0.rows.length === 3 && t0.rows.every((r) => r.source.page === null && r.source.retrievalId === web.id)
    && t0.statedTotals[0]?.source.page === null && s.rec.vacancies.total?.value === 30, [web, t0.rows.map((r) => r.source.page)]);
  const tt = (s.c as unknown as { tableTotal: J }).tableTotal;
  check("H: the check list offers its printed line, with no page (from that document)",
    tt.route === "PRINTED_LINE" && JSON.stringify(tt.evidence) === JSON.stringify({ line: "Total 5 3 8 3 11 30", page: null, retrievalId: web.id }), tt);
  let r = await decideTotal(h, web.id, "ADMIN_VERIFIED", "Total 5 3 8 3 11 30", 1);
  check("H: the printed line with an invented page 1: refused", r.status === 400 && /with no page/.test(err(r)), r);
  r = await decideTotal(h, web.id, "ADMIN_VERIFIED", "1 Alpha Gramin Bank 2 1 3 1 3 10", null);
  check("H: a bank row's line: refused", r.status === 400, r);
  r = await decideTotal(h, web.id, "ADMIN_VERIFIED", "Total 5 3 8 3 11 30", null);
  s = await state(h);
  check("H: the printed line, no page, from that page: VERIFIED", r.status === 201 && s.total.cls === "VERIFIED" && !s.blocks, [r, s.total]);

  const hc = await importJob(2062, [url("https://www.ibps.in/notices/c21-calculated.html")]);
  const webC = (await state(hc)).c.retrievals[0];
  r = await checkTable(hc, webC.id, "Sr. No. Name of the Bank SC ST OBC EWS UR Total", 1, { pages: [1] });
  check("H: a calculated web table: the C1 pages-only check refused (no invented pages)", r.status === 400 && /web page or text/.test(err(r)), r);
  r = await checkTable(hc, webC.id, "Sr. No. Name of the Bank SC ST OBC EWS UR Total", null, { documents: [{ retrievalId: webC.id, whole_document: true }] });
  s = await state(hc);
  check("H: a calculated web table: checked as the whole document, and the total VERIFIED", r.status === 201 && s.c.tableCheck.checked && s.total.cls === "VERIFIED", [r, s.total]);

  const hi = await importJob(2063, [url("https://www.ibps.in/notices/c21-incomplete.html")]);
  s = await state(hi);
  const webI = s.c.retrievals[0];
  note(`incomplete web total: ${s.rec.vacancies.total?.value}, complete ${s.rec.vacancies.total?.derived?.complete}`);
  const withPages = await decideTotal(hi, webI.id, "ADMIN_NOT_STATED", null, null, { justification: "Gamma Gramin Bank is NR on the page", reviewScope: { pages: [1] } });
  const whole = await decideTotal(hi, webI.id, "ADMIN_NOT_STATED", null, null, { justification: "Gamma Gramin Bank is NR on the page", reviewScope: { whole_document: true } });
  check("H: an incomplete web total: \"not stated in full\" with pages refused, with the whole document recorded",
    s.rec.vacancies.total?.derived?.complete === false && withPages.status === 400 && /record that you read the whole document/.test(err(withPages)) && whole.status === 201, [withPages, whole]);
  r = await checkTable(hi, webI.id, "Sr. No. Name of the Bank SC ST OBC EWS UR Total", null, { documents: [{ retrievalId: webI.id, whole_document: true }] });
  s = await state(hi);
  check("H: and with the whole table checked as well: NOT_STATED, no longer blocking", r.status === 201 && s.total.cls === "NOT_STATED" && !s.blocks, [r, s.total]);

  // ── M ──
  section(S.M);
  const m = await importJob(2064, [
    { declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: PDF_URL, attestation: `Downloaded from ${PDF_URL} on 1 Nov 2026` },
    url("https://www.ibps.in/notices/c21-plain.html"),
    { declaredKind: "RESEARCH", method: "paste", text: RESEARCH },
  ], false);
  s = await state(m);
  const docs = s.c.retrievals;
  const pdfDoc = docs.find((d) => d.contentKind === "PDF")!;
  const webDoc = docs.find((d) => d.contentKind === "HTML")!;
  const resDoc = docs.find((d) => d.declaredKind === "RESEARCH")!;
  const standing = await service.docStandings(m);
  check("M: the job holds an official PDF, an official web page (both eligible) and research (not)",
    !!pdfDoc && !!webDoc && !!resDoc && standing[pdfDoc.id].eligible && standing[webDoc.id].eligible && !standing[resDoc.id].eligible, [docs, standing]);
  const r0 = (id: string, bank: string, total: number, rid: string | null, pageNo: number | null, line: string, readBy?: "PREPARED"): VacancyTableRow => ({
    id, at: { post: "Officer", bank }, status: "STATED", total, cells: {}, source: { retrievalId: rid, page: pageNo, line, ...(readBy ? { readBy } : {}) } });
  const mixed: VacancyTable = { dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], statedTotals: [], rows: [
    r0("a", "Alpha Gramin Bank", 10, pdfDoc.id, 1, "Rows: Alpha Gramin Bank 10"),
    r0("w", "Web Gramin Bank", 7, webDoc.id, null, "Web Gramin Bank 7"),
    r0("r1", "Rho Gramin Bank", 5, resDoc.id, null, "Rho Gramin Bank 5"),
    r0("p1", "Pi Gramin Bank", 4, null, 1, "Pi Gramin Bank 4", "PREPARED"),
  ] };
  const saved = await saveTable(m, mixed);
  note(`mixed table saved: ${saved.status} ${saved.status === 200 ? "" : JSON.stringify(saved.data).slice(0, 200)}`);
  const QUOTE = "Alpha Gramin Bank appears in Annexure I.";
  const good = { documents: [{ retrievalId: pdfDoc.id, pages: [1] }, { retrievalId: webDoc.id, whole_document: true }, { retrievalId: resDoc.id, rowSourceOnly: true }],
    comparedWith: [{ retrievalId: pdfDoc.id, rows: [{ rowId: "r1", page: 1 }, { rowId: "p1", page: 1 }] }] };
  r = await checkTable(m, pdfDoc.id, QUOTE, 1, { pages: [1] });
  check("M: the pages-only check is refused for this table", saved.status === 200 && r.status === 400 && /name every document compared/.test(err(r)), [saved.status, r]);
  r = await checkTable(m, pdfDoc.id, QUOTE, 1, { ...good, documents: good.documents.filter((d) => d.retrievalId !== webDoc.id) });
  check("M: a document left out: refused", r.status === 400 && /document not named/.test(err(r)), r);
  r = await checkTable(m, pdfDoc.id, QUOTE, 1, { ...good, documents: [...good.documents.filter((d) => d.retrievalId !== resDoc.id), { retrievalId: resDoc.id, whole_document: true }] });
  check("M: the research document named as evidence: refused", r.status === 400 && /is not official evidence/.test(err(r)), r);
  r = await checkTable(m, pdfDoc.id, QUOTE, 1, { ...good, comparedWith: [{ retrievalId: pdfDoc.id, rows: [{ rowId: "p1", page: 1 }] }] });
  check("M: a research row left unmapped: refused, naming it", r.status === 400 && /not compared with an official document: r1/.test(err(r)), r);
  r = await checkTable(m, pdfDoc.id, QUOTE, 1, { ...good, documents: [{ retrievalId: pdfDoc.id, pages: [1, 2] }, ...good.documents.slice(1)], comparedWith: [{ retrievalId: pdfDoc.id, rows: [{ rowId: "r1", page: 1 }, { rowId: "p1", page: 2 }] }] });
  check("M: a prepared row compared with another page than it claims: refused", r.status === 400 && /Prepared row p1 claims page 1/.test(err(r)), r);
  r = await checkTable(m, pdfDoc.id, QUOTE, 1, good);
  s = await state(m);
  check("M: every document named, each research and prepared row mapped: recorded, the total VERIFIED", r.status === 201 && s.c.tableCheck.checked && s.total.cls === "VERIFIED" && !s.blocks, [r, s.total]);
  const stored = (await pg.query("SELECT review_scope FROM recruitment_field_claims WHERE recruitment_id = $1 AND field_path = 'vacancies.table' AND kind = 'ADMIN_VERIFIED' ORDER BY seq DESC LIMIT 1", [m])).rows[0]?.review_scope as J;
  note(`stored scope: ${JSON.stringify(stored)}`);
  // The database keeps JSON with its keys in its own order: compare with sorted keys.
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as J).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;
  check("M: the stored check names every document and every mapped row",
    JSON.stringify(canon(stored.documents)) === JSON.stringify(canon(good.documents)) && JSON.stringify(canon(stored.comparedWith)) === JSON.stringify(canon(good.comparedWith)), stored);
  const noPage = { ...mixed, rows: mixed.rows.map((x) => (x.id === "a" ? { ...x, source: { ...x.source, page: null } } : x)) };
  const saved2 = await saveTable(m, noPage);
  s = await state(m);
  const r2 = await checkTable(m, pdfDoc.id, QUOTE, 1, good);
  check("M: a PDF row without its page: the total blocks and the check is refused, even with web rows page-free",
    saved2.status === 200 && s.blocks && /pdf row without page/.test(s.total.reason) && r2.status === 400 && /Row a comes from a PDF but has no page/.test(err(r2)), [s.total, r2]);
  check("M: after a row edit, the earlier check no longer stands", !s.c.tableCheck.checked, s.c.tableCheck);

  // ── F ──
  section(S.F);
  const f = await importJob(2065, [url("https://www.ibps.in/notices/c21-plain.html")], false);
  const fDoc = (await state(f)).c.retrievals[0];
  await saveTable(f, { ...mixed, rows: [r0("x", "X Gramin Bank", 3, webC.id, null, "X 3")] }); // cites job hc's web page
  r = await checkTable(f, fDoc.id, "Institute of Banking Personnel Selection", null, { documents: [{ retrievalId: fDoc.id, whole_document: true }] });
  check("F: a row citing a document of another job: the check refused", r.status === 400 && /not brought in for this job/.test(err(r)), r);

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
