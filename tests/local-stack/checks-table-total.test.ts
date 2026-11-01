// ═══════════════════════════════════════════════════════════
// Stage C, C3 step 1: the checks route's read-only "tableTotal"
// ═══════════════════════════════════════════════════════════
//
// Through the REAL import and GET /api/admin/cms/records/[id]/checks,
// against the in-memory test database. The route now also says how a total
// worked out from the vacancy table can be checked: the route the server
// allows, the printed line and page to cite, the reasons the whole-table
// check is needed, and the table's pages. Read only: it must change nothing
// else in the response, and nothing in the gate. No AI.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/checks-table-total.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable } from "@/lib/vacancy-table";

type J = Record<string, unknown>;

const URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-C3-notification.pdf";
const page1 = "Institute of Banking Personnel Selection\nCommon Recruitment Process TEST C3\nAnnexure I\nTentative vacancies\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n1 Alpha Gramin Bank 2 1 3 1 3 10\n2 Beta Gramin Bank 2 1 3 1 5 12";
const PRINTED = makePdf([page1, "3 Gamma Gramin Bank 1 1 2 1 3 8\nTotal 5 3 8 3 11 30"]);
const CALCULATED = makePdf([page1, "3 Gamma Gramin Bank 1 1 2 1 3 8\nThe vacancies are tentative."]);
const NO_TABLE = makePdf(["Institute of Banking Personnel Selection\nCommon Recruitment Process TEST C3 (no table)\nOn-line registration 01.09.2026 to 21.09.2026"]);

const S = "the checks route says how a table total can be checked";
expectChecks(S, [
  "a printed total: route PRINTED_LINE, its line “Total 5 3 8 3 11 30” on page 2, no reasons, pages 1 and 2",
  "a calculated total: route TABLE_CHECK, no line, the reason “the total is calculated from the rows”",
  "AI-read rows saved in the editor: route TABLE_CHECK, the reason names them",
  "a job with no vacancy table: tableTotal is null",
  "a job never imported, with a table: not gated, and its view is read only",
  "nothing else in the response changes: the same keys as before, plus tableTotal",
  "the gate is unchanged: the route's rows and blockers are the publish gate's own",
]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const checksRoute = await import("@/app/api/admin/cms/records/[id]/checks/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const checks = async (id: string) => { const r = await checksRoute.GET(req(`/api/admin/cms/records/${id}/checks`, "GET"), ctx(id)); return (await r.json()) as J & { tableTotal: J | null }; };
  const importJob = async (year: number, pdf: Buffer) => {
    const p = await service.previewImport({
      adminId, mode: "NEW", apiKey: undefined,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title: `TEST RECORD IBPS C3 ${year}`, govType: "PSU" },
      sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: pdf, url: URL, attestation: `Downloaded from ${URL} on 1 Nov 2026` }],
    } as never);
    const items = (p.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items;
    return (await service.applyImportFlow({ importId: p.importId, adminId, selected: items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId;
  };
  const saveTable = async (id: string, t: VacancyTable) => fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "vacancies.table", field: { value: t, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "C3 step 1 test" }), ctx(id));

  section(S);
  const printed = await importJob(2026, PRINTED);
  const pc = await checks(printed);
  check("a printed total: route PRINTED_LINE, its line “Total 5 3 8 3 11 30” on page 2, no reasons, pages 1 and 2",
    JSON.stringify(pc.tableTotal) === JSON.stringify({ incomplete: false, route: "PRINTED_LINE", evidence: { line: "Total 5 3 8 3 11 30", page: 2 }, why: [], pages: [1, 2] }), pc.tableTotal);
  const calc = await importJob(2027, CALCULATED);
  const cc = await checks(calc);
  check("a calculated total: route TABLE_CHECK, no line, the reason “the total is calculated from the rows”",
    cc.tableTotal?.route === "TABLE_CHECK" && cc.tableTotal.evidence === null && JSON.stringify(cc.tableTotal.why) === JSON.stringify(["the total is calculated from the rows"]) && JSON.stringify(cc.tableTotal.pages) === "[1,2]", cc.tableTotal);

  const ai = await importJob(2028, PRINTED);
  const t = (await getRecruitmentById(ai))!.vacancies.table!.value!;
  const s = await saveTable(ai, { ...t, rows: t.rows.map((r) => ({ ...r, source: { ...r.source, readBy: "AI_IMAGE" as const } })) });
  const ac = await checks(ai);
  check("AI-read rows saved in the editor: route TABLE_CHECK, the reason names them",
    s.status === 200 && ac.tableTotal?.route === "TABLE_CHECK" && (ac.tableTotal.why as string[]).includes("3 rows were read by AI from a page image"), ac.tableTotal);

  const none = await importJob(2029, NO_TABLE);
  const nc = await checks(none);
  check("a job with no vacancy table: tableTotal is null", nc.imported === true && nc.tableTotal === null, nc.tableTotal);

  const rc = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "ibps", organizationName: "IBPS", govType: "PSU", title: "TEST RECORD IBPS C3 never imported", recruitmentYear: 2030, forceCreate: true }));
  const never = ((await rc.json()) as { record: { id: string } }).record.id;
  await saveTable(never, t);
  const neverChecks = await checks(never);
  const neverGate = await service.publishGateFor((await getRecruitmentById(never))!);
  check("a job never imported, with a table: not gated, and its view is read only",
    neverChecks.imported === false && neverGate.gated === false && neverGate.ok === true && (neverChecks.tableTotal === null || typeof neverChecks.tableTotal.route === "string"), [neverChecks.imported, neverGate, neverChecks.tableTotal]);

  check("nothing else in the response changes: the same keys as before, plus tableTotal",
    JSON.stringify(Object.keys(pc).sort()) === JSON.stringify(["blockers", "fields", "imported", "ok", "retrievals", "rows", "tableCheck", "tableTotal"]), Object.keys(pc));
  let same = true;
  const diffs: unknown[] = [];
  for (const id of [printed, calc, ai, none]) {
    const c = await checks(id);
    const g = await service.publishGateFor((await getRecruitmentById(id))!);
    const a = JSON.stringify({ ok: c.ok, rows: (c.rows as Array<{ fieldPath: string; cls: string; reason: string }>).map((r) => [r.fieldPath, r.cls, r.reason]), blockers: c.blockers });
    const b = JSON.stringify({ ok: g.ok, rows: g.verdicts.map((v) => [v.fieldPath, v.cls, v.reason]), blockers: g.blockers.map((x) => x.fieldPath) });
    if (a !== b) { same = false; diffs.push({ id, a, b }); }
  }
  check("the gate is unchanged: the route's rows and blockers are the publish gate's own", same, diffs);

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
