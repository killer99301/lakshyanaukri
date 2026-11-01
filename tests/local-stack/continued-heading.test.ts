// ═══════════════════════════════════════════════════════════
// A table continued under a "(continued)" heading, from import to publication
// ═══════════════════════════════════════════════════════════
//
// The known defect of docs/known-defects/continued-heading.md, fixed in the
// B2.5 reader: through the REAL import, apply, decisions and publish routes,
// against the in-memory test database. The exact example, and the same table
// with no heading printed again: row 3 is stored and published as "Gamma
// Gramin Bank", with page 2 and its own printed line. No AI.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/continued-heading.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, note, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable } from "@/lib/vacancy-table";

type J = Record<string, unknown>;

const URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-continued-notification.pdf";
const HEAD = "Sr. No. Name of the Bank SC ST OBC EWS UR Total";
const TOTAL = "Total 5 3 8 3 11 30";
const PAGE1 = `Institute of Banking Personnel Selection\nAnnexure I\nTentative vacancies\n${HEAD}\n1 Alpha Gramin Bank 2 1 3 1 3 10\n2 Beta Gramin Bank 2 1 3 1 5 12`;
const CASES = [
  { name: "with the (continued) heading and the column heading printed again", year: 2026, page2: `Annexure I (continued)\n${HEAD}\n3 Gamma Gramin Bank 1 1 2 1 3 8\n${TOTAL}` },
  { name: "with no heading printed again", year: 2027, page2: `3 Gamma Gramin Bank 1 1 2 1 3 8\n${TOTAL}` },
];
const EXPECTED = JSON.stringify([
  ["Alpha Gramin Bank", 10, 1, "1 Alpha Gramin Bank 2 1 3 1 3 10"],
  ["Beta Gramin Bank", 12, 1, "2 Beta Gramin Bank 2 1 3 1 5 12"],
  ["Gamma Gramin Bank", 8, 2, "3 Gamma Gramin Bank 1 1 2 1 3 8"],
]);
for (const c of CASES) expectChecks(c.name, [
  `${c.name}: stored with three rows, each bank by its own name, page and printed line`,
  `${c.name}: Total Vacancies 30 as printed, complete, and the table raises nothing to decide`,
  `${c.name}: the printed total's own line and page verify it`,
  `${c.name}: published; the public table shows "Gamma Gramin Bank", and no heading words in any bank`,
]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const decisions = await import("@/app/api/admin/cms/records/[id]/decisions/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { analyseVacancyTable } = await import("@/lib/vacancy-table");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const checks = async (id: string) => service.checksFor((await getRecruitmentById(id))!);
  const post = async (id: string, body: J) => {
    const r = await decisions.POST(req(`/api/admin/cms/records/${id}/decisions`, "POST", body), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };

  for (const c of CASES) {
    section(c.name);
    const p = await service.previewImport({
      adminId, mode: "NEW", apiKey: undefined,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: c.year, title: `TEST RECORD IBPS continued ${c.year}`, govType: "PSU" },
      sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: makePdf([PAGE1, c.page2]), url: URL, attestation: `Downloaded from ${URL} on 1 Nov 2026` }],
    } as never);
    const items = (p.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items;
    const id = (await service.applyImportFlow({ importId: p.importId, adminId, selected: items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId;
    const rec = (await getRecruitmentById(id))!;
    const table = rec.vacancies.table?.value as VacancyTable | undefined;
    const rows = (table?.rows ?? []).map((r) => [r.at.bank, r.total, r.source.page, r.source.line]);
    note(`stored: ${JSON.stringify(rows)}`);
    check(`${c.name}: stored with three rows, each bank by its own name, page and printed line`, JSON.stringify(rows) === EXPECTED, rows);
    const an = table ? analyseVacancyTable(table) : null;
    check(`${c.name}: Total Vacancies 30 as printed, complete, and the table raises nothing to decide`,
      rec.vacancies.total?.value === 30 && rec.vacancies.total.derived?.basis === "STATED" && rec.vacancies.total.derived.complete && an?.issues.length === 0, [rec.vacancies.total, an?.issues]);

    let c0 = await checks(id);
    const tot = c0.rows.find((r) => r.fieldPath === "vacancies.total")!;
    const v = await post(id, { action: "decide", fieldPath: "vacancies.total", kind: "ADMIN_VERIFIED", retrievalId: c0.retrievals[0].id, page: 2, quote: TOTAL,
      seen: { revisionId: tot.latestRevisionId, decisionId: tot.decisionId ?? null } });
    c0 = await checks(id);
    check(`${c.name}: the printed total's own line and page verify it`, v.status === 201 && c0.rows.find((r) => r.fieldPath === "vacancies.total")!.cls === "VERIFIED", v);

    // The other fields this test notice leaves open, recorded as not applicable, so that publishing turns on the vacancies.
    const lr = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "links", field: { value: [{ type: "OFFICIAL_WEBSITE", label: "IBPS", url: "https://www.ibps.in/", official: true }], status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "test" }), ctx(id));
    if (lr.status !== 200) note(`links save: ${lr.status}`);
    for (const b of (await checks(id)).blockers) {
      const cc = await checks(id);
      const row = cc.rows.find((x) => x.fieldPath === b)!;
      const out = await post(id, { action: "decide", fieldPath: b, kind: "ADMIN_NOT_APPLICABLE", retrievalId: cc.retrievals[0].id, page: 1, quote: "Institute of Banking Personnel Selection",
        justification: "a test notice: not applicable", seen: { revisionId: row.latestRevisionId, decisionId: row.decisionId ?? null } });
      if (out.status !== 201) note(`not applicable on ${b}: ${out.status} ${String(out.data.error ?? "")}`);
    }
    const pub = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", { announce: false, approveFirst: true }), ctx(id));
    const pubData = (await pub.json()) as J;
    let banks: string[] = [];
    if (pub.status === 200) {
      const snap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [id])).rows[0].snapshot as { vacancies: { table?: VacancyTable } };
      banks = (snap.vacancies.table?.rows ?? []).map((r) => r.at.bank);
    }
    note(`published: ${pub.status}; banks ${JSON.stringify(banks)}`);
    check(`${c.name}: published; the public table shows "Gamma Gramin Bank", and no heading words in any bank`,
      pub.status === 200 && banks.includes("Gamma Gramin Bank") && banks.length === 3 && banks.every((b) => !/continued|name of the bank|sr\. no/i.test(b)), [pub.status, banks, pubData.blockers ?? pubData.error]);
  }
  summary();
})().catch((e) => { console.error(e); process.exit(1); });
