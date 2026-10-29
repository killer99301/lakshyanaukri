// ═══════════════════════════════════════════════════════════
// A corrigendum that deletes a post (B2.6, P2.3), through the REAL preview,
// apply route, field route and restore, on the in-memory test database. No AI:
// the corrigendum's text is pasted (as the scan reader writes it out), and the
// deletion is read by code. The job holds BPSC 72nd CCE's tables as pasted,
// marked prepared outside.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/post-removal.test.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import type { VacancyTable } from "@/lib/vacancy-table";
import { bpscTable } from "../fixtures/paste/bpsc-72";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; flags: string[]; supersedes: string[] };
const CORRIGENDUM = readFileSync("tests/fixtures/notice-text/bpsc-72-corrigendum.txt", "utf8");
const SUGARCANE = "ईख पदाधिकारी, गन्ना उद्योग विभाग";

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const applyRoute = await import("@/app/api/admin/cms/import/[importId]/apply/route");
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { analyseVacancyTable, calculatedTotalReady } = await import("@/lib/vacancy-table");
  const { restorable } = await import("@/lib/cms/restore-value");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const preview = (args: J) => service.previewImport({ adminId, apiKey: undefined, ...args } as never);
  const itemsOf = (p: { proposal: unknown }) => (p.proposal as { items: Item[] }).items;
  const metaOf = (p: { proposal: unknown }) => (p.proposal as { meta: { sources: Array<{ vacancyTables: J }> }; warnings: string[] });
  const apply = async (importId: string, selected: string[]) => {
    const r = await applyRoute.POST(req(`/api/admin/cms/import/${importId}/apply`, "POST", { selected }), { params: Promise.resolve({ importId }) });
    return { status: r.status, data: (await r.json()) as J };
  };

  section("The job: BPSC 72nd CCE with its two tables pasted, prepared outside");
  const r0 = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "bpsc", organizationName: "Bihar Public Service Commission", govType: "State Govt", title: "TEST RECORD BPSC 72nd CCE 2026", recruitmentYear: 2026 }));
  const id: string = (await r0.json()).record.id;
  let rev = (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const save = async (fieldPath: string, field: unknown) => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field, clientRevision: rev, reason: "test" }), { params: Promise.resolve({ id }) });
    const d = await r.json();
    if (r.status === 200) rev = d.record.recordRevision;
    return { status: r.status, record: d.record, error: d.error };
  };
  const pasted = bpscTable();
  // Key order aside: a table read back from the database is the same table.
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as J).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;
  const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const s0 = await save("vacancies.table", { value: pasted, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  check("saved: 25 posts, Total Vacancies 1,230", s0.status === 200 && s0.record.vacancies.table.value.rows.length === 25 && s0.record.vacancies.total.value === 1230, s0.error ?? s0.record?.vacancies.total);
  const before = (await getRecruitmentById(id))!;
  const unrelated = { dates: before.dates, eligibility: before.eligibility, age: before.age, financial: before.financial, identity: before.identity };

  section("The corrigendum: the deletion offered, unticked, saying exactly what goes");
  const p1 = await preview({ mode: "EXISTING", recruitmentId: id, sources: [{ declaredKind: "OFFICIAL_CORRIGENDUM", method: "paste", text: CORRIGENDUM }] });
  const item = itemsOf(p1).find((i) => i.fieldPath === "vacancies.table");
  const offered = item?.value as VacancyTable | undefined;
  check("a vacancy table is offered, a replacement, unticked", !!item && item.action === "REPLACE" && item.defaultTicked === false, itemsOf(p1).map((i) => [i.fieldPath, i.action, i.defaultTicked]));
  check("…saying what it removes, and that the table before can be restored", !!item?.flags.some((f) => /removes what the corrigendum deletes: ईख पदाधिकारी, गन्ना उद्योग विभाग \(44 posts, table I, serial 11\).*the total becomes 1230 − 44 = 1186, as printed\. Tick to remove; the table before is kept in its history and can be restored\./.test(f)), item?.flags);
  check("24 posts, 1,186, every other row exactly as it was", offered?.rows.length === 24 && analyseVacancyTable(offered).grandTotal?.value === 1186
    && same(offered.rows, pasted.rows.filter((r) => r.at.post !== SUGARCANE)));
  const note = metaOf(p1).meta.sources[0].vacancyTables as { removal: { removals: Array<{ post: string; count: number; printedCount: number; quotes: Array<{ text: string; page: number }>; rows: Array<{ total: number; prepared: boolean; cells: Array<{ label: string; value: number; within: boolean }> }> }>; total: J; droppedTotals: Array<{ total: number }> } };
  const shown = note.removal.removals[0];
  check("the review lists the row and every figure in it: women's 14 marked within the 44", shown.post === SUGARCANE && shown.count === 44 && shown.printedCount === 44 && shown.rows[0].total === 44
    && shown.rows[0].cells.some((c) => c.label === "महिला कुल" && c.value === 14 && c.within) && shown.rows[0].cells.some((c) => c.label === "अनारक्षित" && c.value === 18 && !c.within) && shown.rows[0].prepared, shown);
  check("…with the corrigendum's two sentences and their page", shown.quotes.length === 2 && shown.quotes.every((q) => q.page === 1) && /विलोपित/.test(shown.quotes[1].text));
  check("…and the printed totals it affects: 1230 − 44 = 1186; सारणी I's 1077 set aside", note.removal.total?.after === 1186 && note.removal.droppedTotals.map((d) => d.total).join() === "1077", note.removal);
  const total = itemsOf(p1).find((i) => i.fieldPath === "vacancies.total");
  check("the corrigendum's own total figure is not ticked to save separately (the table gives it)", !total || !total.defaultTicked, total);

  section("Nothing is removed until ticked");
  const ticked = itemsOf(p1).filter((i) => i.defaultTicked).map((i) => i.id);
  const a0 = await apply(p1.importId, ticked);
  const untouched = (await getRecruitmentById(id))!;
  check("saving what is ticked by default leaves the 25 posts", (a0.status === 200 || ticked.length === 0) && untouched.vacancies.table!.value!.rows.length === 25, a0);

  section("Ticked: removed, saved, reopened");
  const p2 = await preview({ mode: "EXISTING", recruitmentId: id, sources: [{ declaredKind: "OFFICIAL_CORRIGENDUM", method: "paste", text: CORRIGENDUM }] });
  const item2 = itemsOf(p2).find((i) => i.fieldPath === "vacancies.table")!;
  const a1 = await apply(p2.importId, [item2.id]);
  const after = (await getRecruitmentById(id))!;
  check("saved", a1.status === 200, a1.data);
  check("reopened: 24 posts, Sugarcane Officer gone, Total Vacancies 1,186", after.vacancies.table!.value!.rows.length === 24 && !after.vacancies.table!.value!.rows.some((r) => r.at.post === SUGARCANE)
    && after.vacancies.total?.value === 1186, after.vacancies.total);
  check("the other posts' rows unchanged", same(after.vacancies.table!.value!.rows, pasted.rows.filter((r) => r.at.post !== SUGARCANE)));
  check("dates, eligibility, age, fees and identity untouched", same({ dates: after.dates, eligibility: after.eligibility, age: after.age, financial: after.financial, identity: after.identity }, unrelated));
  check("still prepared outside: not ready until checked against the notice", !calculatedTotalReady(after.vacancies.table!.value!, { tableChecked: false }).ready
    && calculatedTotalReady(after.vacancies.table!.value!, { tableChecked: false }).reasons.some((x) => /24 rows were prepared outside the notice/.test(x)));
  check("the table is Pending, not verified", after.vacancies.table!.status === "PENDING", after.vacancies.table!.status);

  section("History and one-click restore");
  const history = (await pg.query("SELECT old_value, new_value FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'vacancies.table' ORDER BY revised_at", [id])).rows as Array<{ old_value: { value: VacancyTable } | null; new_value: { value: VacancyTable } }>;
  const last = history[history.length - 1];
  check("the removal is a revision, with the whole table before it", last.old_value?.value.rows.length === 25 && last.new_value.value.rows.length === 24, history.length);
  const back = restorable(last.old_value);
  rev = after.recordRevision; // the editor reopened after the import
  const s2 = back.ok ? await save("vacancies.table", back.field) : { status: 0, record: null, error: back };
  check("restored: 25 posts and 1,230 again", s2.status === 200 && s2.record.vacancies.table.value.rows.length === 25 && s2.record.vacancies.total.value === 1230, s2.error ?? s2.record?.vacancies.total);
  check("…Sugarcane Officer's row as it was, women's 14 included", same(s2.record?.vacancies.table.value.rows.find((r: { at: { post: string } }) => r.at.post === SUGARCANE), pasted.rows.find((r) => r.at.post === SUGARCANE)));

  section("A corrigendum that cannot be matched removes nothing");
  const p3 = await preview({ mode: "EXISTING", recruitmentId: id, sources: [{ declaredKind: "OFFICIAL_CORRIGENDUM", method: "paste", text: CORRIGENDUM.replace("कुल 44 पद", "कुल 45 पद").replace("1230-44 = 1186", "1230-45 = 1185") }] });
  check("no table offered", !itemsOf(p3).some((i) => i.fieldPath === "vacancies.table"), itemsOf(p3).map((i) => i.fieldPath));
  check("…and why, with its words", metaOf(p3).warnings.some((w) => /deletes a post, but nothing is removed: the corrigendum says “ईख पदाधिकारी, गन्ना उद्योग विभाग” had 45 posts; the job's table has 44/.test(w)), metaOf(p3).warnings);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
