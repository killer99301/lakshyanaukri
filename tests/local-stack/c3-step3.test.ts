// ═══════════════════════════════════════════════════════════
// Stage C, C3 step 3: the whole-table check, as the screen sends it
// ═══════════════════════════════════════════════════════════
//
// Through the REAL import (a PDF uploaded with an attestation; an official
// web page "fetched" from a saved copy; research pasted), the checks route
// (what the screen reads: tableNeeds), the panel's own form rules
// (table-check-form: what is still needed, the decision it builds), and the
// decisions route, against the in-memory test database. No AI, no network.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/c3-step3.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, note, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable, VacancyTableRow } from "@/lib/vacancy-table";
import { assignRows, buildDecision, emptyForm, stillNeeded, type TableCheckForm, type TableNeeds } from "@/app/admin/cms/[id]/table-check-form";

type J = Record<string, unknown>;

const PDF_URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-C3S3.pdf";
const PDF = makePdf([
  "Institute of Banking Personnel Selection\nCommon Recruitment Process TEST C3S3\nAnnexure I\nTentative vacancies\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n1 Alpha Gramin Bank 2 1 3 1 3 10\n2 Beta Gramin Bank 2 1 3 1 5 12",
  "3 Gamma Gramin Bank 1 1 2 1 3 8\nThe vacancies are tentative.",
]);
const WEB_URL = "https://www.ibps.in/notices/c3s3.html";
const WEB = "<html><body><h1>Institute of Banking Personnel Selection</h1><p>Common Recruitment Process TEST C3S3</p><p>Tentative vacancies</p><p>Sr. No. Name of the Bank SC ST OBC EWS UR Total</p><p>1 Alpha Gramin Bank 2 1 3 1 3 10</p><p>2 Beta Gramin Bank 2 1 3 1 5 12</p><p>3 Gamma Gramin Bank 1 1 2 1 3 8</p><p>The vacancies are tentative.</p></body></html>";
const PLAIN_URL = "https://www.ibps.in/notices/c3s3-plain.html";
const PLAIN = "<html><body><h1>Institute of Banking Personnel Selection</h1><p>Common Recruitment Process TEST C3S3: the regional rural banks' vacancies are on this page and in the notice.</p></body></html>";
const PAGES: Record<string, string> = { [WEB_URL]: WEB, [PLAIN_URL]: PLAIN };
const fetchSourceFn = async (url: string) => PAGES[url]
  ? { ok: true as const, finalUrl: url, contentType: "text/html; charset=utf-8", bytes: Buffer.from(PAGES[url], "utf8") }
  : { ok: false as const, error: "blocked (403)" };
const RESEARCH = "IBPS CRP TEST C3S3 summary from a coaching site. The banks include Rho Gramin Bank 5 and others; check the official notice.";
const HEADING = "Sr. No. Name of the Bank SC ST OBC EWS UR Total";
/** The database keeps JSON with its keys in its own order: compare with sorted keys. */
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;

const S = { P: "P: one official PDF, through the screen's form", Q: "Q: the page of a PDF's words (step 4 fix D1)", W: "W: an official web page", M: "M: PDF, web page, research and prepared rows", R: "R: stale and refused" };
expectChecks(S.P, [
  "P: the checks route gives the table's needs: one official PDF, its pages, nothing to compare; simple",
  "P: the form asks for step 1, the pages, the words and the confirmation, nothing more",
  "P: recorded through the documents shape the screen sends; the total VERIFIED",
  "P: the declared source (the file's own fingerprint) is kept with the check",
  "P: a different file's fingerprint: refused",
]);
expectChecks(S.Q, [
  "Q: no page for a PDF's words: the form names it, and the server refuses it too",
  "Q: page 0: the form asks for a page number, and the server refuses it too",
  "Q: a page not compared: the form names it, and the server refuses it too",
  "Q: nothing was recorded by the refused attempts",
  "Q: a page compared: nothing still needed, and recorded",
]);
expectChecks(S.W, [
  "W: the web page's needs: no pages, the whole document",
  "W: recorded as the whole document, the address declared and kept; the total VERIFIED",
  "W: an address other than the page's own: refused",
]);
expectChecks(S.M, [
  "M: the needs list each document with its standing; the research and prepared rows to compare; research never offered as official",
  "M: the form names the rows still to compare, then the pages they need",
  "M: bulk assignment fills documents and pages but leaves the confirmation unticked",
  "M: recorded as one decision: every document, every row compared, the marked-rows count; the total VERIFIED",
  "M: no per-row decision exists",
]);
expectChecks(S.R, [
  "R: the check made on a table that has since changed: refused as changed (409)",
  "R: a table citing another job's document: the needs say why it cannot be checked here",
]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const checksRoute = await import("@/app/api/admin/cms/records/[id]/checks/route");
  const decisions = await import("@/app/api/admin/cms/records/[id]/decisions/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  type Retrieval = { id: string; contentKind: string; declaredKind: string; sha256: string; originUrl: string | null };
  type Checks = { rows: Array<{ fieldPath: string; cls: string }>; blockers: string[]; retrievals: Retrieval[]; tableCheck: { checked: boolean; revisionId: string | null; decisionId: string | null }; tableNeeds: TableNeeds | null; tableNeedsError: string | null };
  const checks = async (id: string) => (await (await checksRoute.GET(req(`/api/admin/cms/records/${id}/checks`, "GET"), ctx(id))).json()) as Checks;
  const totalCls = (c: Checks) => c.rows.find((r) => r.fieldPath === "vacancies.total")?.cls;
  const saveTable = async (id: string, t: VacancyTable) => fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "vacancies.table", field: { value: t, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "C3 step 3 test" }), ctx(id));
  /** What the panel's Record button sends. */
  const record = async (id: string, c: Checks, f: TableCheckForm, flagged = 0, seen?: { revisionId: string | null; decisionId: string | null }) => {
    const d = buildDecision(c.tableNeeds!, f, flagged);
    const r = await decisions.POST(req(`/api/admin/cms/records/${id}/decisions`, "POST", { action: "decide", fieldPath: "vacancies.table", kind: "ADMIN_VERIFIED", retrievalId: d.retrievalId, page: d.page, quote: d.quote, reviewScope: d.reviewScope,
      seen: seen ?? { revisionId: c.tableCheck.revisionId, decisionId: c.tableCheck.decisionId } }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const importJob = async (year: number, sources: J[], withTable = true) => {
    const p = await service.previewImport({ adminId, mode: "NEW", apiKey: undefined, fetchSourceFn,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title: `TEST RECORD IBPS C3S3 ${year}`, govType: "PSU" }, sources } as never);
    const items = (p.proposal as unknown as { items: Array<{ id: string; fieldPath: string; defaultTicked: boolean }> }).items;
    return (await service.applyImportFlow({ importId: p.importId, adminId, selected: items.filter((i) => i.defaultTicked && (withTable || i.fieldPath !== "vacancies.table")).map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId;
  };
  const storedScope = async (id: string) => (await pg.query("SELECT review_scope FROM recruitment_field_claims WHERE recruitment_id = $1 AND field_path = 'vacancies.table' AND kind = 'ADMIN_VERIFIED' ORDER BY seq DESC LIMIT 1", [id])).rows[0]?.review_scope as J | undefined;
  const pdfSource = { declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: PDF_URL, attestation: `Downloaded from ${PDF_URL} on 1 Nov 2026` };

  // ── P ──
  section(S.P);
  const p = await importJob(2071, [pdfSource]);
  let c = await checks(p);
  const pdf = c.retrievals[0];
  const n = c.tableNeeds!;
  check("P: the checks route gives the table's needs: one official PDF, its pages, nothing to compare; simple",
    !!n && n.simple && n.documents.length === 1 && n.documents[0].retrievalId === pdf.id && n.documents[0].eligible && JSON.stringify(n.documents[0].pages) === "[1,2]" && n.rowsToMap.length === 0, n);
  const fP: TableCheckForm = { ...emptyForm(), sources: { [pdf.id]: { by: "FILE_HASH", sha256: pdf.sha256 } }, pagesTicked: { [pdf.id]: [1, 2] }, quoteDoc: pdf.id, quotePage: "1", quote: HEADING, confirm: true };
  const askedFor = stillNeeded(n, emptyForm(), 0);
  note(`asked for at first: ${askedFor.join(" | ")}`);
  check("P: the form asks for step 1, the pages, the words and the confirmation, nothing more",
    askedFor.length === 5 && /how you have the original/.test(askedFor[0]) && /the pages of/.test(askedFor[1]) && /document the words/.test(askedFor[2]) && /a line of the table/.test(askedFor[3]) && /confirmation/.test(askedFor[4]) && stillNeeded(n, fP, 0).length === 0, askedFor);
  let r = await record(p, c, fP);
  c = await checks(p);
  check("P: recorded through the documents shape the screen sends; the total VERIFIED", r.status === 201 && c.tableCheck.checked && totalCls(c) === "VERIFIED", [r, totalCls(c)]);
  const sp = await storedScope(p);
  check("P: the declared source (the file's own fingerprint) is kept with the check",
    JSON.stringify((sp?.documents as J[])?.[0]?.source) === JSON.stringify({ by: "FILE_HASH", sha256: pdf.sha256 }), sp);
  const p2 = await importJob(2072, [pdfSource]);
  const c2 = await checks(p2);
  r = await record(p2, c2, { ...fP, sources: { [c2.retrievals[0].id]: { by: "FILE_HASH", sha256: "e".repeat(64) } }, pagesTicked: { [c2.retrievals[0].id]: [1, 2] }, quoteDoc: c2.retrievals[0].id });
  check("P: a different file's fingerprint: refused", r.status === 400 && /not the file that was imported/.test(String(r.data.error)), r);

  // ── Q ──
  section(S.Q);
  const q = c2.retrievals[0];
  const fQ = (quotePage: string): TableCheckForm => ({ ...fP, sources: { [q.id]: { by: "FILE_HASH", sha256: q.sha256 } }, pagesTicked: { [q.id]: [1, 2] }, quoteDoc: q.id, quotePage });
  r = await record(p2, c2, fQ(""));
  check("Q: no page for a PDF's words: the form names it, and the server refuses it too",
    JSON.stringify(stillNeeded(c2.tableNeeds!, fQ(""), 0)) === JSON.stringify(["the page of the words you cite"]) && r.status === 400, [stillNeeded(c2.tableNeeds!, fQ(""), 0), r]);
  r = await record(p2, c2, fQ("0"));
  check("Q: page 0: the form asks for a page number, and the server refuses it too",
    JSON.stringify(stillNeeded(c2.tableNeeds!, fQ("0"), 0)) === JSON.stringify(["the page of the words you cite, as a page number"]) && r.status === 400, [stillNeeded(c2.tableNeeds!, fQ("0"), 0), r]);
  const fQ3 = { ...fQ("2"), pagesTicked: { [q.id]: [1] } };
  r = await record(p2, c2, fQ3);
  check("Q: a page not compared: the form names it, and the server refuses it too",
    stillNeeded(c2.tableNeeds!, fQ3, 0).includes("the page of the words you cite must be one you compared") && r.status === 400, [stillNeeded(c2.tableNeeds!, fQ3, 0), r]);
  check("Q: nothing was recorded by the refused attempts", !(await checks(p2)).tableCheck.checked && !(await storedScope(p2)));
  // The heading is printed on page 1: cited with page 2 (a page compared, but not its page) it is refused (8 Nov 2026).
  const wrongPage = await record(p2, c2, fQ("2"));
  r = await record(p2, c2, fQ("1"));
  const cQ = await checks(p2);
  check("Q: a page compared: nothing still needed, and recorded",
    stillNeeded(c2.tableNeeds!, fQ("1"), 0).length === 0 && wrongPage.status === 400 && /on page 1 of this PDF, not page 2/.test(JSON.stringify(wrongPage))
    && r.status === 201 && cQ.tableCheck.checked && totalCls(cQ) === "VERIFIED", [wrongPage, r, totalCls(cQ)]);

  // ── W ──
  section(S.W);
  const w = await importJob(2073, [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: WEB_URL }]);
  c = await checks(w);
  const web = c.retrievals[0];
  check("W: the web page's needs: no pages, the whole document",
    c.tableNeeds!.documents.length === 1 && c.tableNeeds!.documents[0].kind === "HTML" && c.tableNeeds!.documents[0].pages.length === 0 && !c.tableNeeds!.simple, c.tableNeeds);
  const fW: TableCheckForm = { ...emptyForm(), sources: { [web.id]: { by: "OFFICIAL_ADDRESS", url: WEB_URL } }, wholeDoc: { [web.id]: true }, quoteDoc: web.id, quote: HEADING, confirm: true };
  r = await record(w, c, fW);
  c = await checks(w);
  const sw = await storedScope(w);
  check("W: recorded as the whole document, the address declared and kept; the total VERIFIED",
    r.status === 201 && totalCls(c) === "VERIFIED" && JSON.stringify(canon((sw?.documents as J[])?.[0])) === JSON.stringify(canon({ retrievalId: web.id, source: { by: "OFFICIAL_ADDRESS", url: WEB_URL }, whole_document: true })), [r, sw]);
  const w2 = await importJob(2074, [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: WEB_URL }]);
  const cw2 = await checks(w2);
  r = await record(w2, cw2, { ...fW, sources: { [cw2.retrievals[0].id]: { by: "OFFICIAL_ADDRESS", url: "https://www.ibps.in/notices/other.html" } }, wholeDoc: { [cw2.retrievals[0].id]: true }, quoteDoc: cw2.retrievals[0].id });
  check("W: an address other than the page's own: refused", r.status === 400 && /not the address it was imported from/.test(String(r.data.error)), r);

  // ── M ──
  section(S.M);
  const m = await importJob(2075, [pdfSource, { declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: PLAIN_URL }, { declaredKind: "RESEARCH", method: "paste", text: RESEARCH }], false);
  c = await checks(m);
  const mPdf = c.retrievals.find((x) => x.contentKind === "PDF")!;
  const mWeb = c.retrievals.find((x) => x.contentKind === "HTML" && x.declaredKind !== "RESEARCH")!;
  const mRes = c.retrievals.find((x) => x.declaredKind === "RESEARCH")!;
  const r0 = (id: string, bank: string, total: number, rid: string | null, pageNo: number | null, readBy?: "PREPARED"): VacancyTableRow => ({
    id, at: { post: "Officer", bank }, status: "STATED", total, cells: {}, source: { retrievalId: rid, page: pageNo, line: `${bank} ${total}`, ...(readBy ? { readBy } : {}) } });
  await saveTable(m, { dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], statedTotals: [], rows: [
    r0("a", "Alpha Gramin Bank", 10, mPdf.id, 1), r0("w", "Web Gramin Bank", 7, mWeb.id, null),
    r0("r1", "Rho Gramin Bank", 5, mRes.id, null), r0("p1", "Pi Gramin Bank", 4, null, 2, "PREPARED"),
  ] });
  c = await checks(m);
  const nm = c.tableNeeds!;
  check("M: the needs list each document with its standing; the research and prepared rows to compare; research never offered as official",
    !!nm && JSON.stringify(nm.documents.map((d) => [d.retrievalId === mPdf.id ? "pdf" : d.retrievalId === mWeb.id ? "web" : "research", d.eligible, d.pages]).sort()) === JSON.stringify([["pdf", true, [1]], ["research", false, []], ["web", true, []]])
    && JSON.stringify(nm.rowsToMap.map((x) => [x.rowId, x.why, x.claimedPage])) === JSON.stringify([["r1", "research", null], ["p1", "prepared", 2]])
    && !nm.official.some((o) => o.retrievalId === mRes.id), nm);
  let f: TableCheckForm = { ...emptyForm(), sources: { [mPdf.id]: { by: "FILE_HASH", sha256: mPdf.sha256 }, [mWeb.id]: { by: "OFFICIAL_ADDRESS", url: PLAIN_URL } },
    pagesTicked: { [mPdf.id]: [1] }, wholeDoc: { [mWeb.id]: true }, quoteDoc: mPdf.id, quotePage: "1", quote: "Common Recruitment Process TEST C3S3" };
  const before = stillNeeded(nm, f, 0);
  f = assignRows(nm, f, ["r1", "p1"], mPdf.id, 1);
  const afterAssign = stillNeeded(nm, f, 0);
  note(`still needed before assigning: ${before.join(" | ")}; after: ${afterAssign.join(" | ")}`);
  check("M: the form names the rows still to compare, then the pages they need",
    before.includes("2 rows still to compare with an official document") && afterAssign.some((x) => /page 2 of/.test(x)), [before, afterAssign]);
  check("M: bulk assignment fills documents and pages but leaves the confirmation unticked",
    f.confirm === false && f.maps.r1?.page === 1 && f.maps.p1?.page === 2 && afterAssign.includes("your confirmation that the whole table matches the notice"), f.maps);
  f = { ...f, pagesTicked: { [mPdf.id]: [1, 2] }, confirm: true };
  r = await record(m, c, f, 0);
  c = await checks(m);
  const sm = await storedScope(m);
  note(`stored: ${JSON.stringify(sm)}`);
  check("M: recorded as one decision: every document, every row compared, the marked-rows count; the total VERIFIED",
    r.status === 201 && c.tableCheck.checked && totalCls(c) === "VERIFIED" && (sm?.documents as J[])?.length === 3 && JSON.stringify((sm?.comparedWith as Array<{ rows: J[] }>)?.flatMap((x) => x.rows).map((x) => x.rowId).sort()) === JSON.stringify(["p1", "r1"]), [r, totalCls(c), sm]);
  const perRow = (await pg.query("SELECT count(*)::int AS n FROM recruitment_field_claims WHERE recruitment_id = $1 AND kind = 'ADMIN_VERIFIED' AND field_path <> 'vacancies.table'", [m])).rows[0].n as number;
  check("M: no per-row decision exists", perRow === 0, perRow);

  // ── R ──
  section(S.R);
  const stale = await checks(p2);
  const t = (await getRecruitmentById(p2))!.vacancies.table!.value!;
  await saveTable(p2, { ...t, rows: t.rows.map((x) => (x.at.bank === "Gamma Gramin Bank" ? { ...x, total: 8, source: { ...x.source, line: `${x.source.line} ` } } : x)) });
  const fR = { ...fP, sources: { [stale.retrievals[0].id]: { by: "FILE_HASH" as const, sha256: stale.retrievals[0].sha256 } }, pagesTicked: { [stale.retrievals[0].id]: [1, 2] }, quoteDoc: stale.retrievals[0].id };
  r = await record(p2, stale, fR);
  check("R: the check made on a table that has since changed: refused as changed (409)", r.status === 409, r);
  const fj = await importJob(2076, [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: PLAIN_URL }], false);
  await saveTable(fj, { dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], statedTotals: [], rows: [r0("x", "X Gramin Bank", 3, mPdf.id, 1)] });
  const cf = await checks(fj);
  check("R: a table citing another job's document: the needs say why it cannot be checked here",
    cf.tableNeeds === null && /not brought in for this job/.test(String(cf.tableNeedsError)), [cf.tableNeeds, cf.tableNeedsError]);

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
