// ═══════════════════════════════════════════════════════════
// Stage C, C0: the publish gate for vacancy tables as it is today
// ═══════════════════════════════════════════════════════════
//
// A measurement, not an acceptance test: it records what the gate and the
// decision route do now, before Stage C changes anything. Five imported jobs,
// one per kind of table:
//   1. printed total (rows read by code from text, the notice's grand total);
//   2. calculated total (the same rows, no printed total);
//   3. incomplete total (a row not reported);
//   4. AI-read rows (from a scanned page's image), with a printed total;
//   5. prepared rows (pasted from outside the notice), with a printed total.
//
// Each job is imported from an attested IBPS document (so it is gated), its
// table saved through the real field route, then: the gate's verdict on the
// total, what the approved rule (calculatedTotalReady) would say, whether the
// total can be "verified" by citing a single row's line, and, for the
// incomplete total, whether "not stated" is accepted. No AI.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/stage-c-baseline.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, note, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable, VacancyTableRow } from "@/lib/vacancy-table";

type J = Record<string, unknown>;

const URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-C0-notification.pdf";
const LINES = { a: "Officer A Bank 10", b: "Officer B Bank 12", c: "Officer C Bank 8", d: "Officer D Bank NR", total: "Grand Total 30" };
const PDF = makePdf([
  `Institute of Banking Personnel Selection\nCommon Recruitment Process TEST C0\nOn-line registration of Application by the Candidates 01.09.2026 to 21.09.2026\nVacancies\nPost Bank Total\n${LINES.a}\n${LINES.b}\n${LINES.c}\n${LINES.d}\n${LINES.total}`,
]);

const row = (id: string, bank: string, line: string, total: number | null, readBy?: "AI_IMAGE" | "PREPARED"): VacancyTableRow => ({
  id, at: { post: "Officer", bank }, status: total === null ? "NOT_REPORTED" : "STATED", ...(total === null ? {} : { total }), cells: {},
  source: { retrievalId: null, page: 1, line, ...(readBy ? { readBy } : {}) },
});
const table = (rows: VacancyTableRow[], printedTotal: boolean): VacancyTable => ({
  dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], rows,
  statedTotals: printedTotal ? [{ at: {}, total: 30, source: { retrievalId: null, page: 1, line: LINES.total } }] : [],
});
const three = (readBy?: "AI_IMAGE" | "PREPARED") => [row("a", "A Bank", LINES.a, 10, readBy), row("b", "B Bank", LINES.b, 12, readBy), row("c", "C Bank", LINES.c, 8, readBy)];

const CASES: Array<{ name: string; year: number; table: VacancyTable }> = [
  { name: "1. printed total", year: 2026, table: table(three(), true) },
  { name: "2. calculated total", year: 2027, table: table(three(), false) },
  { name: "3. incomplete total", year: 2028, table: table([row("a", "A Bank", LINES.a, 10), row("b", "B Bank", LINES.b, 12), row("d", "D Bank", LINES.d, null)], false) },
  { name: "4. AI-read rows, printed total", year: 2029, table: table(three("AI_IMAGE"), true) },
  { name: "5. prepared rows, printed total", year: 2030, table: table(three("PREPARED"), true) },
];

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { analyseVacancyTable, calculatedTotalReady } = await import("@/lib/vacancy-table");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));

  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const saveTable = async (id: string, t: VacancyTable) => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "vacancies.table", field: { value: t, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "C0 baseline" }), { params: Promise.resolve({ id }) });
    return { status: r.status, data: (await r.json()) as J };
  };
  const totalRow = async (id: string) => {
    const c = await service.checksFor((await getRecruitmentById(id))!);
    return { c, row: c.rows.find((r) => r.fieldPath === "vacancies.total")! };
  };
  const tryDecide = async (id: string, kind: "ADMIN_VERIFIED" | "ADMIN_NOT_STATED", quote: string, justification: string | null) => {
    const { c, row: r } = await totalRow(id);
    try {
      await service.decide({ recruitmentId: id, adminId, fieldPath: "vacancies.total", kind, retrievalId: c.retrievals[0].id, page: 1, quote, tableCell: null, reviewScope: null,
        justification, publicNote: null, seen: { revisionId: r.latestRevisionId, decisionId: r.decisionId ?? null } });
      return "accepted";
    } catch (e) { return `refused: ${(e as Error).message}`; }
  };
  const gateLine = async (id: string) => {
    const rec = (await getRecruitmentById(id))!;
    const g = await service.publishGateFor(rec);
    const { row: r } = await totalRow(id);
    const tableInGate = g.verdicts.some((v) => v.fieldPath === "vacancies.table");
    const totalBlocks = g.blockers.some((b) => b.fieldPath === "vacancies.total");
    return { text: `total ${r.cls} (${r.reason}); blocks publishing: ${totalBlocks ? "yes" : "no"}; the table is in the gate: ${tableInGate ? "yes" : "no"}`, cls: r.cls, totalBlocks, tableInGate };
  };
  const results: J[] = [];

  for (const k of CASES) {
    section(k.name);
    const p = await service.previewImport({
      adminId, mode: "NEW", apiKey: undefined,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: k.year, title: `TEST RECORD IBPS CRP C0 ${k.year}`, govType: "PSU" },
      sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: URL, attestation: `Downloaded from ${URL} on 1 Nov 2026` }],
    } as never);
    const ticked = (p.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items.filter((i) => i.defaultTicked).map((i) => i.id);
    const applied = await service.applyImportFlow({ importId: p.importId, adminId, selected: ticked, confirmReplaceVerified: false, override: null });
    const id = applied.recruitmentId;
    const saved = await saveTable(id, k.table);
    check(`${k.name}: imported, gated and the table saved`, saved.status === 200 && (await service.publishGateFor((await getRecruitmentById(id))!)).gated, saved.data.error);
    const v = (await getRecruitmentById(id))!.vacancies;
    const d = v.total?.derived;
    note(`stored total: ${v.total?.value} — basis ${d?.basis}, complete ${d?.complete}, method "${d?.method}"`);
    const a = analyseVacancyTable(k.table);
    const rule = calculatedTotalReady(k.table, { tableChecked: false, stored: v.total ? { value: v.total.value as number, fingerprint: d?.fingerprint ?? "" } : null });
    note(`approved rule (calculatedTotalReady, table not checked): ${rule.ready ? "ready" : `not ready — ${rule.reasons.join("; ")}`}`);
    const before = await gateLine(id);
    note(`gate before any decision: ${before.text}`);

    // Can the total be marked checked by citing one row's printed line, which is not the total?
    const byRow = await tryDecide(id, "ADMIN_VERIFIED", LINES.a, null);
    const afterRow = await gateLine(id);
    note(`verify the total citing a single row ("${LINES.a}"): ${byRow}; then ${afterRow.text}`);
    const r: J = { case: k.name, total: v.total?.value, basis: d?.basis, complete: d?.complete, analysedTotal: a.grandTotal?.value, ruleReady: rule.ready, ruleReasons: rule.reasons,
      before: before.text, verifyByRowLine: byRow, afterVerify: afterRow.text };

    if (k.name.startsWith("2")) {
      // A row edit after the check: does the check reopen?
      const edited = { ...k.table, rows: k.table.rows.map((x) => (x.id === "a" ? { ...x, total: 11, source: { ...x.source, line: "Officer A Bank 11" } } : x)) };
      const s = await saveTable(id, edited);
      const afterEdit = await gateLine(id);
      note(`after editing a row (10 → 11, saved ${s.status}): ${afterEdit.text}`);
      r.afterRowEdit = afterEdit.text;
    }
    if (k.name.startsWith("3")) {
      // On a fresh job of the same kind, not verified first: is "not stated" accepted for the incomplete total?
      const p2 = await service.previewImport({
        adminId, mode: "NEW", apiKey: undefined,
        newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2031, title: "TEST RECORD IBPS CRP C0 2031", govType: "PSU" },
        sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: URL, attestation: `Downloaded from ${URL} on 1 Nov 2026` }],
      } as never);
      const t2 = (p2.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items.filter((i) => i.defaultTicked).map((i) => i.id);
      const id2 = (await service.applyImportFlow({ importId: p2.importId, adminId, selected: t2, confirmReplaceVerified: false, override: null })).recruitmentId;
      check("3b. a second incomplete job saved", (await saveTable(id2, k.table)).status === 200);
      const ns = await tryDecide(id2, "ADMIN_NOT_STATED", LINES.d, "Bank D has not reported its vacancies");
      const afterNs = await gateLine(id2);
      const v2 = (await getRecruitmentById(id2))!.vacancies;
      note(`record the incomplete total as "not stated": ${ns}; then ${afterNs.text}; total afterwards ${v2.total?.value ?? "none"}, table rows ${v2.table?.value?.rows.length ?? "none"}`);
      r.notStated = ns; r.afterNotStated = afterNs.text; r.totalAfterNotStated = v2.total?.value ?? null; r.tableAfterNotStated = v2.table?.value?.rows.length ?? null;
    }
    results.push(r);
  }

  console.log("\nC0 BASELINE (JSON)\n" + JSON.stringify(results, null, 2));
  summary();
})().catch((e) => { console.error(e); process.exit(1); });
