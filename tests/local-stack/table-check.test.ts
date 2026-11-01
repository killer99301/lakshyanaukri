// ═══════════════════════════════════════════════════════════
// Stage C, C1: checking the whole vacancy table against the notice
// ═══════════════════════════════════════════════════════════
//
// Through the REAL import, decisions route and field route, against the
// in-memory test database. One decision covers the whole table and names the
// pages compared; it is bound to the table's exact revision, refused on a
// stale one, revocable, and any edit of the table leaves it behind. The gate
// itself is not changed in C1: a checked table does not make the total
// verified, and other decisions work as before. No AI.
//
// Two ways a table reaches a job, kept apart (C0's limitation):
//   I. created by the import: read by code from the notice, an extracted claim;
//   E. saved in the editor: no claim.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/table-check.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, note, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable } from "@/lib/vacancy-table";

type J = Record<string, unknown>;

const URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-C1-notification.pdf";
const HEADING = "Sr. No. Name of the Bank SC ST OBC EWS UR Total";
const PDF = makePdf([
  `Institute of Banking Personnel Selection\nCommon Recruitment Process TEST C1\nAnnexure I\nTentative vacancies\n${HEADING}\n1 Alpha Gramin Bank 2 1 3 1 3 10\n2 Beta Gramin Bank 2 1 3 1 5 12`,
  "3 Gamma Gramin Bank 1 1 2 1 3 8\nTotal 5 3 8 3 11 30",
]);

const I = "I: a table created by the import";
const E = "E: a table saved in the editor";
expectChecks(I, [
  "I: the import reads the table by code from pages 1 and 2, three rows",
  "I: saved, the table is SUPPORTED (the import's extracted claim) and not checked",
  "I: the total worked out from it has no claim of its own: UNSUPPORTED, and it blocks publishing",
  "I: refused with no pages named",
  "I: refused when page 2 of the table is left out, naming it",
  "I: refused when the words are not in the notice",
  "I: refused when the words are on a page not compared",
  "I: \"not stated\" and \"not applicable\" refused on the table, and the table is untouched",
  "I: recorded: one decision, the pages compared stored as 1, 2 for the whole table",
  "I: the table is now checked, at its latest revision, VERIFIED, and its rows unchanged",
  "I: since C2, the checked table verifies its printed total (nothing else open); every other field's class is unchanged",
  "I: a second decision made on the revision before the check is refused as changed (409)",
  "I: revoked: no longer checked, back to SUPPORTED",
  "I: checked again, then a row edited in the editor: no longer checked, not VERIFIED",
  "I: a decision on the table as it was before the edit is refused as changed (409)",
  "I: since C2, with the rows no longer adding up to the printed total, even its own printed line leaves it pending",
]);
expectChecks(E, [
  "E: saved in the editor, the table has no claim: UNSUPPORTED, not checked",
  "E: the whole-table check is recorded the same way",
  "E: saving the same table again leaves the check behind (a new revision)",
]);

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
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "vacancies.table", field: { value: t, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "C1 test" }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const state = async (id: string) => {
    const rec = (await getRecruitmentById(id))!;
    const c = await service.checksFor(rec);
    const gate = await service.publishGateFor(rec);
    return { rec, c, gate, total: c.rows.find((r) => r.fieldPath === "vacancies.total")! };
  };
  const decide = async (id: string, body: J) => {
    const r = await decisions.POST(req(`/api/admin/cms/records/${id}/decisions`, "POST", { action: "decide", ...body }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const revoke = async (id: string, decisionId: string) => {
    const r = await decisions.POST(req(`/api/admin/cms/records/${id}/decisions`, "POST", { action: "revoke", fieldPath: "vacancies.table", decisionId }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  /** A decision on the whole table, with the table's current revision and decision as seen. */
  const checkTable = async (id: string, extra: J = {}) => {
    const s = await state(id);
    return decide(id, { fieldPath: "vacancies.table", kind: "ADMIN_VERIFIED", retrievalId: s.c.retrievals[0].id, page: 1, quote: HEADING,
      reviewScope: { pages: [2, 1, 1] }, seen: { revisionId: s.c.tableCheck.revisionId, decisionId: s.c.tableCheck.decisionId }, ...extra });
  };

  // ── I ──
  section(I);
  const p = await service.previewImport({
    adminId, mode: "NEW", apiKey: undefined,
    newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2026, title: "TEST RECORD IBPS CRP C1 2026", govType: "PSU" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: URL, attestation: `Downloaded from ${URL} on 1 Nov 2026` }],
  } as never);
  const items = (p.proposal as unknown as { items: Array<{ id: string; fieldPath: string; value: unknown; defaultTicked: boolean }> }).items;
  const tItem = items.find((i) => i.fieldPath === "vacancies.table");
  const tRows = (tItem?.value as VacancyTable | undefined)?.rows ?? [];
  check("I: the import reads the table by code from pages 1 and 2, three rows",
    tRows.length === 3 && JSON.stringify(tRows.map((r) => [r.at.bank, r.total, r.source.page])) === JSON.stringify([["Alpha Gramin Bank", 10, 1], ["Beta Gramin Bank", 12, 1], ["Gamma Gramin Bank", 8, 2]]),
    tRows.map((r) => [r.at.bank, r.total, r.source.page]));
  const id = (await service.applyImportFlow({ importId: p.importId, adminId, selected: items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId;
  let s = await state(id);
  check("I: saved, the table is SUPPORTED (the import's extracted claim) and not checked", s.c.fields["vacancies.table"] === "SUPPORTED" && !s.c.tableCheck.checked, [s.c.fields["vacancies.table"], s.c.tableCheck]);
  check("I: the total worked out from it has no claim of its own: UNSUPPORTED, and it blocks publishing",
    s.total.cls === "UNSUPPORTED" && s.gate.blockers.some((b) => b.fieldPath === "vacancies.total"), s.total);
  const gateBefore = s.gate.verdicts.map((v) => `${v.fieldPath}:${v.cls}`);
  const rowsBefore = JSON.stringify(s.rec.vacancies.table?.value?.rows);
  const seenBefore = { revisionId: s.c.tableCheck.revisionId, decisionId: null };

  let r = await checkTable(id, { reviewScope: null });
  check("I: refused with no pages named", r.status === 400 && /Name the pages/.test(String(r.data.error)), r);
  r = await checkTable(id, { reviewScope: { pages: [1] } });
  check("I: refused when page 2 of the table is left out, naming it", r.status === 400 && /from page 2 too/.test(String(r.data.error)), r);
  r = await checkTable(id, { quote: "Officer Scale IV vacancies" });
  check("I: refused when the words are not in the notice", r.status === 400 && /not in the document/.test(String(r.data.error)), r);
  r = await checkTable(id, { page: 5 });
  check("I: refused when the words are on a page not compared", r.status === 400 && /one of the pages compared/.test(String(r.data.error)), r);
  const ns = await checkTable(id, { kind: "ADMIN_NOT_STATED", justification: "test" });
  const na = await checkTable(id, { kind: "ADMIN_NOT_APPLICABLE", justification: "test" });
  s = await state(id);
  check("I: \"not stated\" and \"not applicable\" refused on the table, and the table is untouched",
    ns.status === 400 && na.status === 400 && JSON.stringify(s.rec.vacancies.table?.value?.rows) === rowsBefore && !s.c.tableCheck.checked, [ns.data.error, na.data.error]);

  r = await checkTable(id);
  const claims = await pg.query("SELECT kind, review_scope, quote, page FROM recruitment_field_claims WHERE recruitment_id = $1 AND field_path = 'vacancies.table' AND kind <> 'EXTRACTED'", [id]);
  note(`recorded: ${r.status} ${JSON.stringify(claims.rows)}`);
  check("I: recorded: one decision, the pages compared stored as 1, 2 for the whole table",
    r.status === 201 && claims.rows.length === 1 && JSON.stringify((claims.rows[0] as J).review_scope) === JSON.stringify({ pages: [1, 2], sections: ["the whole vacancy table"] }), [r, claims.rows]);
  s = await state(id);
  check("I: the table is now checked, at its latest revision, VERIFIED, and its rows unchanged",
    s.c.tableCheck.checked && JSON.stringify(s.c.tableCheck.pages) === "[1,2]" && s.c.fields["vacancies.table"] === "VERIFIED" && JSON.stringify(s.rec.vacancies.table?.value?.rows) === rowsBefore, s.c.tableCheck);
  // C1 alone left the gate as it was; C2 (table-total-gate.test.ts) makes the whole-table check verify the total it supports.
  const others = (v: Array<{ fieldPath: string; cls: string }>) => JSON.stringify(v.filter((x) => x.fieldPath !== "vacancies.total").map((x) => `${x.fieldPath}:${x.cls}`));
  check("I: since C2, the checked table verifies its printed total (nothing else open); every other field's class is unchanged",
    s.total.cls === "VERIFIED" && !s.gate.blockers.some((b) => b.fieldPath === "vacancies.total") && others(s.gate.verdicts) === JSON.stringify(gateBefore.filter((x) => !x.startsWith("vacancies.total:"))),
    s.gate.verdicts.map((v) => `${v.fieldPath}:${v.cls}`));
  r = await checkTable(id, { seen: seenBefore });
  check("I: a second decision made on the revision before the check is refused as changed (409)", r.status === 409, r);

  const rv = await revoke(id, s.c.tableCheck.decisionId!);
  s = await state(id);
  check("I: revoked: no longer checked, back to SUPPORTED", rv.status === 200 && !s.c.tableCheck.checked && s.c.fields["vacancies.table"] === "SUPPORTED", [rv, s.c.tableCheck, s.c.fields["vacancies.table"]]);

  r = await checkTable(id);
  const checkedAgain = (await state(id)).c.tableCheck;
  const t = s.rec.vacancies.table!.value!;
  const edited = await saveTable(id, { ...t, rows: t.rows.map((x) => (x.at.bank === "Gamma Gramin Bank" ? { ...x, total: 9 } : x)) });
  s = await state(id);
  check("I: checked again, then a row edited in the editor: no longer checked, not VERIFIED",
    r.status === 201 && checkedAgain.checked && edited.status === 200 && !s.c.tableCheck.checked && s.c.fields["vacancies.table"] !== "VERIFIED", [r.status, edited.status, s.c.tableCheck, s.c.fields["vacancies.table"]]);
  r = await checkTable(id, { seen: { revisionId: checkedAgain.revisionId, decisionId: checkedAgain.decisionId } });
  check("I: a decision on the table as it was before the edit is refused as changed (409)", r.status === 409, r);

  const tot = (await state(id)).total;
  r = await decide(id, { fieldPath: "vacancies.total", kind: "ADMIN_VERIFIED", retrievalId: s.c.retrievals[0].id, page: 2, quote: "Total 5 3 8 3 11 30",
    seen: { revisionId: tot.latestRevisionId, decisionId: tot.decisionId ?? null } });
  const after = (await state(id)).total;
  note(`the total after its own decision, rows 10 + 12 + 9 against the printed 30: ${r.status}, ${after.cls}: ${after.reason}`);
  check("I: since C2, with the rows no longer adding up to the printed total, even its own printed line leaves it pending",
    r.status === 201 && after.cls !== "VERIFIED" && /stated total mismatch/.test(after.reason), [r, after]);

  // ── E ──
  section(E);
  const p2 = await service.previewImport({
    adminId, mode: "NEW", apiKey: undefined,
    newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2027, title: "TEST RECORD IBPS CRP C1 2027", govType: "PSU" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: URL, attestation: `Downloaded from ${URL} on 1 Nov 2026` }],
  } as never);
  const items2 = (p2.proposal as unknown as { items: Array<{ id: string; fieldPath: string; defaultTicked: boolean }> }).items;
  // Saved without the import's table: the table comes from the editor instead.
  const id2 = (await service.applyImportFlow({ importId: p2.importId, adminId, selected: items2.filter((i) => i.defaultTicked && i.fieldPath !== "vacancies.table").map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId;
  // The same rows typed into the editor: without job I's document ids, which job E never brought in (C2.1 refuses
  // a row that cites another job's document: tests/local-stack/c21-page-free.test.ts).
  const own = { ...t, rows: t.rows.map((x) => ({ ...x, source: { ...x.source, retrievalId: null } })), statedTotals: t.statedTotals.map((x) => ({ ...x, source: { ...x.source, retrievalId: null } })) };
  const saved = await saveTable(id2, own);
  s = await state(id2);
  check("E: saved in the editor, the table has no claim: UNSUPPORTED, not checked", saved.status === 200 && s.c.fields["vacancies.table"] === "UNSUPPORTED" && !s.c.tableCheck.checked, [saved.status, s.c.fields["vacancies.table"]]);
  r = await checkTable(id2);
  check("E: the whole-table check is recorded the same way", r.status === 201 && (await state(id2)).c.tableCheck.checked, r);
  const again = await saveTable(id2, (await getRecruitmentById(id2))!.vacancies.table!.value!); // its own table, saved unchanged
  s = await state(id2);
  note(`saving the same table again: ${again.status}; checked afterwards: ${s.c.tableCheck.checked}`);
  check("E: saving the same table again leaves the check behind (a new revision)", again.status === 200 && !s.c.tableCheck.checked, [again.status, s.c.tableCheck]);

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
