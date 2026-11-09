// ═══════════════════════════════════════════════════════════
// Stage C, C2: the publish gate for Total Vacancies worked out from a table
// ═══════════════════════════════════════════════════════════
//
// Through the REAL import, decisions route, field route and publish route,
// against the in-memory test database. C0 measured the gaps this closes: any
// quote in the notice verified a total, an incomplete total could become
// VERIFIED, and AI-read or prepared rows reached the page unchecked. No AI.
//
// Kept apart (C0's limitation): tables created by the import (I), and tables
// saved in the editor on an imported job (E). A job that was never imported
// is not gated, and publishes as before (N).
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/table-total-gate.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, note, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable, VacancyTableRow } from "@/lib/vacancy-table";

type J = Record<string, unknown>;

const URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-C2-notification.pdf";
const HEADING = "Sr. No. Name of the Bank SC ST OBC EWS UR Total";
const ROW1 = "1 Alpha Gramin Bank 2 1 3 1 3 10";
const TOTAL = "Total 5 3 8 3 11 30";
const page1 = `Institute of Banking Personnel Selection\nCommon Recruitment Process TEST C2\nAnnexure I\nTentative vacancies\n${HEADING}\n${ROW1}\n2 Beta Gramin Bank 2 1 3 1 5 12`;
const PRINTED_PDF = makePdf([page1, `3 Gamma Gramin Bank 1 1 2 1 3 8\n${TOTAL}`]);
const CALCULATED_PDF = makePdf([page1, "3 Gamma Gramin Bank 1 1 2 1 3 8\nThe vacancies are tentative."]);
const LINES = { a: "Officer A Bank 10", b: "Officer B Bank 12", c: "Officer C Bank 8", d: "Officer D Bank NR", total: "Grand Total 30" };
const EDITOR_PDF = makePdf([`Institute of Banking Personnel Selection\nCommon Recruitment Process TEST C2 (editor)\nVacancies\nPost Bank Total\n${LINES.a}\n${LINES.b}\n${LINES.c}\n${LINES.d}\n${LINES.total}`]);

const row = (id: string, bank: string, line: string, total: number | null, readBy?: "AI_IMAGE" | "PREPARED"): VacancyTableRow => ({
  id, at: { post: "Officer", bank }, status: total === null ? "NOT_REPORTED" : "STATED", ...(total === null ? {} : { total }), cells: {},
  source: { retrievalId: null, page: 1, line, ...(readBy ? { readBy } : {}) },
});
const editorTable = (rows: VacancyTableRow[], printed: boolean): VacancyTable => ({
  dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], rows,
  statedTotals: printed ? [{ at: {}, total: 30, source: { retrievalId: null, page: 1, line: LINES.total } }] : [],
});
const three = (readBy?: "AI_IMAGE" | "PREPARED") => [row("a", "A Bank", LINES.a, 10, readBy), row("b", "B Bank", LINES.b, 12, readBy), row("c", "C Bank", LINES.c, 8, readBy)];

const S = {
  IP: "I-printed: a printed total in a table created by the import",
  IC: "I-calculated: a calculated total in a table created by the import",
  EA: "E-AI: AI-read rows under a printed total",
  EP: "E-prepared: prepared rows under a printed total",
  EN: "E-incomplete: a total with a bank not reported, published as a minimum",
  N: "N: a job never imported",
};
expectChecks(S.IP, [
  "IP: the table is SUPPORTED from the import, the total printed (STATED) and complete, pending",
  "IP: C0's unrelated row quote is refused, saying which line to cite",
  "IP: the printed total's line on the wrong page is refused",
  "IP: the bare figure is refused",
  "IP: the printed total's own line, figure and page: accepted, VERIFIED, no longer blocking",
  "IP: a row edited afterwards: the total pending again",
]);
expectChecks(S.IC, [
  "IC: the total is CALCULATED, complete, pending",
  "IC: a quote is refused: a calculated total is checked by checking the whole table",
  "IC: the whole-table check verifies it",
  "IC: revoking the table check makes it pending again",
]);
expectChecks(S.EA, ["EA: the printed line does not verify it: refused, the whole table is required", "EA: pending until the whole table is checked, then VERIFIED"]);
expectChecks(S.EP, ["EP: the printed line does not verify it: refused, the whole table is required", "EP: pending until the whole table is checked, then VERIFIED"]);
expectChecks(S.EN, [
  "EN: the total is 22, incomplete; C0's row quote no longer verifies it (refused)",
  "EN: \"verified\" is refused even with the table checked",
  "EN: \"not applicable\" refused; \"not stated\" without a reason, or without the pages read, refused",
  "EN: \"not stated in full\" recorded, the figure unchanged; with the table not checked it still blocks",
  "EN: with the table checked as well: NOT_STATED, the total no longer blocks",
  "EN: \"not stated\" on a complete total is refused",
  "EN: published through the real route, the page says \"At least 22\"",
]);
expectChecks(S.N, ["N: an incomplete table on a job never imported publishes as before"]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const decisions = await import("@/app/api/admin/cms/records/[id]/decisions/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { snapshotToGovernmentRecruitment } = await import("@/lib/cms/adapter");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));

  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const patch = async (id: string, fieldPath: string, value: unknown) => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "C2 test" }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const state = async (id: string) => {
    const rec = (await getRecruitmentById(id))!;
    const c = await service.checksFor(rec);
    return { rec, c, total: c.rows.find((r) => r.fieldPath === "vacancies.total")!, blocks: c.blockers.includes("vacancies.total") };
  };
  const post = async (id: string, body: J) => {
    const r = await decisions.POST(req(`/api/admin/cms/records/${id}/decisions`, "POST", body), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const decideTotal = async (id: string, kind: string, quote: string | null, page: number | null, justification: string | null = null, pagesRead: number[] | null = null) => {
    const s = await state(id);
    return post(id, { action: "decide", fieldPath: "vacancies.total", kind, retrievalId: s.c.retrievals[0].id, page, quote, justification, reviewScope: pagesRead ? { pages: pagesRead } : null, seen: { revisionId: s.total.latestRevisionId, decisionId: s.total.decisionId ?? null } });
  };
  const checkTable = async (id: string, quote: string, pages: number[], scope?: (retrievalId: string) => J) => {
    const s = await state(id);
    const rid = s.c.retrievals[0].id;
    return post(id, { action: "decide", fieldPath: "vacancies.table", kind: "ADMIN_VERIFIED", retrievalId: rid, page: pages[0], quote, reviewScope: scope ? scope(rid) : { pages },
      seen: { revisionId: s.c.tableCheck.revisionId, decisionId: s.c.tableCheck.decisionId } });
  };
  const importJob = async (year: number, pdf: Buffer, withTable = true) => {
    const p = await service.previewImport({
      adminId, mode: "NEW", apiKey: undefined,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title: `TEST RECORD IBPS CRP C2 ${year}`, govType: "PSU" },
      sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: pdf, url: URL, attestation: `Downloaded from ${URL} on 1 Nov 2026` }],
    } as never);
    const items = (p.proposal as unknown as { items: Array<{ id: string; fieldPath: string; defaultTicked: boolean }> }).items;
    return (await service.applyImportFlow({ importId: p.importId, adminId, selected: items.filter((i) => i.defaultTicked && (withTable || i.fieldPath !== "vacancies.table")).map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId;
  };
  const err = (r: { data: J }) => String(r.data.error ?? "");

  // ── I-printed ──
  section(S.IP);
  const ip = await importJob(2026, PRINTED_PDF);
  let s = await state(ip);
  const d = s.rec.vacancies.total?.derived;
  note(`total ${s.rec.vacancies.total?.value} ${d?.basis} complete=${d?.complete}; table ${s.c.fields["vacancies.table"]}; total ${s.total.cls}: ${s.total.reason}`);
  check("IP: the table is SUPPORTED from the import, the total printed (STATED) and complete, pending",
    s.c.fields["vacancies.table"] === "SUPPORTED" && s.rec.vacancies.total?.value === 30 && d?.basis === "STATED" && d.complete && s.total.cls !== "VERIFIED" && s.blocks, [s.c.fields["vacancies.table"], d, s.total]);
  let r = await decideTotal(ip, "ADMIN_VERIFIED", ROW1, 1);
  check("IP: C0's unrelated row quote is refused, saying which line to cite", r.status === 400 && err(r).includes(`“${TOTAL}”, page 2`), r);
  r = await decideTotal(ip, "ADMIN_VERIFIED", TOTAL, 1);
  check("IP: the printed total's line on the wrong page is refused", r.status === 400, r);
  r = await decideTotal(ip, "ADMIN_VERIFIED", "30", 2);
  check("IP: the bare figure is refused", r.status === 400, r);
  r = await decideTotal(ip, "ADMIN_VERIFIED", TOTAL, 2);
  s = await state(ip);
  check("IP: the printed total's own line, figure and page: accepted, VERIFIED, no longer blocking", r.status === 201 && s.total.cls === "VERIFIED" && !s.blocks, [r, s.total]);
  const t = s.rec.vacancies.table!.value!;
  const edited = await patch(ip, "vacancies.table", { ...t, rows: t.rows.map((x) => (x.at.bank === "Gamma Gramin Bank" ? { ...x, total: 8, cells: { ...x.cells } , source: { ...x.source, line: `${x.source.line} ` } } : x)) });
  s = await state(ip);
  check("IP: a row edited afterwards: the total pending again", edited.status === 200 && s.total.cls !== "VERIFIED" && s.blocks, [edited.status, s.total]);

  // ── I-calculated ──
  section(S.IC);
  const ic = await importJob(2027, CALCULATED_PDF);
  s = await state(ic);
  note(`total ${s.rec.vacancies.total?.value} ${s.rec.vacancies.total?.derived?.basis}; ${s.total.cls}: ${s.total.reason}`);
  check("IC: the total is CALCULATED, complete, pending", s.rec.vacancies.total?.derived?.basis === "CALCULATED" && s.rec.vacancies.total.derived.complete && s.blocks, s.rec.vacancies.total);
  r = await decideTotal(ic, "ADMIN_VERIFIED", ROW1, 1);
  check("IC: a quote is refused: a calculated total is checked by checking the whole table", r.status === 400 && /checking the whole vacancy table: the total is calculated/.test(err(r)), r);
  r = await checkTable(ic, HEADING, [1, 2]);
  s = await state(ic);
  check("IC: the whole-table check verifies it", r.status === 201 && s.total.cls === "VERIFIED" && !s.blocks, [r, s.total]);
  const rv = await post(ic, { action: "revoke", fieldPath: "vacancies.table", decisionId: s.c.tableCheck.decisionId });
  s = await state(ic);
  check("IC: revoking the table check makes it pending again", rv.status === 200 && s.total.cls !== "VERIFIED" && s.blocks, [rv, s.total]);

  // ── E: AI-read and prepared rows ──
  for (const [key, readBy, year] of [["EA", "AI_IMAGE", 2028], ["EP", "PREPARED", 2029]] as const) {
    section(key === "EA" ? S.EA : S.EP);
    const id = await importJob(year, EDITOR_PDF, false);
    const saved = await patch(id, "vacancies.table", editorTable(three(readBy), true));
    r = await decideTotal(id, "ADMIN_VERIFIED", LINES.total, 1);
    check(`${key}: the printed line does not verify it: refused, the whole table is required`, saved.status === 200 && r.status === 400 && /checking the whole vacancy table/.test(err(r)), [saved.status, r]);
    const before = await state(id);
    if (key === "EP") {
      // Since C2.1: prepared rows need each row mapped to the official document and page it was compared with.
      const legacy = await checkTable(id, LINES.total, [1]);
      note(`EP: the C1 pages-only scope for prepared rows: ${legacy.status} ${err(legacy)}`);
      if (legacy.status !== 400) check("EP: the pages-only scope is refused for prepared rows (C2.1)", false, legacy);
      r = await checkTable(id, LINES.total, [1], (rid) => ({ documents: [{ retrievalId: rid, pages: [1] }],
        comparedWith: [{ retrievalId: rid, rows: ["a", "b", "c"].map((rowId) => ({ rowId, page: 1 })) }] }));
    } else {
      r = await checkTable(id, LINES.total, [1]);
    }
    s = await state(id);
    note(`${key}: before the table check ${before.total.cls} (${before.total.reason}); after ${s.total.cls}`);
    check(`${key}: pending until the whole table is checked, then VERIFIED`, before.blocks && r.status === 201 && s.total.cls === "VERIFIED" && !s.blocks, [before.total, r, s.total]);
  }

  // ── E: incomplete ──
  section(S.EN);
  const en = await importJob(2030, EDITOR_PDF, false);
  await patch(en, "vacancies.table", editorTable([row("a", "A Bank", LINES.a, 10), row("b", "B Bank", LINES.b, 12), row("d", "D Bank", LINES.d, null)], false));
  r = await decideTotal(en, "ADMIN_VERIFIED", LINES.a, 1);
  s = await state(en);
  check("EN: the total is 22, incomplete; C0's row quote no longer verifies it (refused)", s.rec.vacancies.total?.value === 22 && s.rec.vacancies.total.derived?.complete === false && r.status === 400 && /never verified/.test(err(r)), [s.rec.vacancies.total, r]);
  const tc = await checkTable(en, LINES.a, [1]);
  r = await decideTotal(en, "ADMIN_VERIFIED", LINES.a, 1);
  check("EN: \"verified\" is refused even with the table checked", tc.status === 201 && r.status === 400 && (await state(en)).total.cls !== "VERIFIED", [tc, r]);
  // Revoke the table check, to see "not stated in full" on its own.
  await post(en, { action: "revoke", fieldPath: "vacancies.table", decisionId: (await state(en)).c.tableCheck.decisionId });
  const na = await decideTotal(en, "ADMIN_NOT_APPLICABLE", LINES.d, 1, "test");
  const noReason = await decideTotal(en, "ADMIN_NOT_STATED", LINES.d, 1, null, [1]);
  const noPages = await decideTotal(en, "ADMIN_NOT_STATED", LINES.d, 1, "Bank D has not reported its vacancies (NR in the notice)");
  check("EN: \"not applicable\" refused; \"not stated\" without a reason, or without the pages read, refused",
    na.status === 400 && noReason.status === 400 && noPages.status === 400 && /pages of the notice you read/.test(err(noPages)), [na, noReason, noPages]);
  r = await decideTotal(en, "ADMIN_NOT_STATED", LINES.d, 1, "Bank D has not reported its vacancies (NR in the notice)", [1]);
  s = await state(en);
  note(`after "not stated in full", table not checked: ${s.total.cls}: ${s.total.reason}`);
  check("EN: \"not stated in full\" recorded, the figure unchanged; with the table not checked it still blocks",
    r.status === 201 && s.rec.vacancies.total?.value === 22 && s.rec.vacancies.table?.value?.rows.length === 3 && s.total.cls !== "NOT_STATED" && s.blocks, [r, s.total]);
  r = await checkTable(en, LINES.a, [1]);
  s = await state(en);
  check("EN: with the table checked as well: NOT_STATED, the total no longer blocks", r.status === 201 && s.total.cls === "NOT_STATED" && !s.blocks, [r, s.total]);
  const complete = await importJob(2031, EDITOR_PDF, false);
  await patch(complete, "vacancies.table", editorTable(three(), false));
  r = await decideTotal(complete, "ADMIN_NOT_STATED", LINES.a, 1, "nothing is missing here", [1]);
  check("EN: \"not stated\" on a complete total is refused", r.status === 400 && /complete/.test(err(r)), r);

  await patch(en, "links", [{ type: "OFFICIAL_WEBSITE", label: "IBPS", url: "https://www.ibps.in/", official: true }]);
  // Every other field this test notice leaves open, recorded as not applicable, so that only the gate's view of the total decides.
  for (const b of (await state(en)).c.blockers) {
    const row2 = (await state(en)).c.rows.find((x) => x.fieldPath === b)!;
    const out = await post(en, { action: "decide", fieldPath: b, kind: "ADMIN_NOT_APPLICABLE", retrievalId: (await state(en)).c.retrievals[0].id, page: 1, quote: "Institute of Banking Personnel Selection",
      justification: "a test notice: not applicable", seen: { revisionId: row2.latestRevisionId, decisionId: row2.decisionId ?? null } });
    if (out.status !== 201) note(`not applicable on ${b}: ${out.status} ${err(out)}`);
  }
  const leftOver = (await state(en)).c.blockers;
  note(`blockers before publishing: ${leftOver.join(", ") || "none"}`);
  const pub = await publish.POST(req(`/api/admin/cms/records/${en}/publish`, "POST", await approved(en, { announce: false, approveFirst: true })), ctx(en));
  const pubData = (await pub.json()) as J;
  let display = "";
  if (pub.status === 200) {
    const snap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [en])).rows[0].snapshot;
    display = snapshotToGovernmentRecruitment(snap as never).vacanciesDisplay;
  }
  note(`publish: ${pub.status} ${pub.status === 200 ? display : JSON.stringify(pubData).slice(0, 400)}`);
  check("EN: published through the real route, the page says \"At least 22\"", pub.status === 200 && /^At least 22\b/.test(display), [pub.status, display, pubData.blockers ?? pubData.error]);

  // ── N ──
  section(S.N);
  const rc = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "ibps", organizationName: "IBPS", govType: "PSU", title: "TEST RECORD IBPS C2 never imported", recruitmentYear: 2032, forceCreate: true }));
  const nid = ((await rc.json()) as { record: { id: string } }).record.id;
  await patch(nid, "vacancies.table", editorTable([row("a", "A Bank", LINES.a, 10), row("b", "B Bank", LINES.b, 12), row("d", "D Bank", LINES.d, null)], false));
  await patch(nid, "links", [{ type: "OFFICIAL_WEBSITE", label: "IBPS", url: "https://www.ibps.in/", official: true }]);
  const pubN = await publish.POST(req(`/api/admin/cms/records/${nid}/publish`, "POST", await approved(nid, { announce: false, approveFirst: true })), ctx(nid));
  check("N: an incomplete table on a job never imported publishes as before", pubN.status === 200 && !(await service.publishGateFor((await getRecruitmentById(nid))!)).gated, await pubN.clone().json());

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
