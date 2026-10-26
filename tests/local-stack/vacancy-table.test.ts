// ═══════════════════════════════════════════════════════════
// The vacancy table in the editor (stage A2), through the REAL field route,
// writer and repository, against the in-memory test database.
//
// Tables are built the way the editor's paste builds them, from the real
// IBPS CRP RRBs-XV, LIC HFL Table E and BTSC FSO figures. Covers: saving,
// the total and breakdown worked out with their own revisions, direct edits
// of those refused, a row edit reopening checks, conflicts, removal, a
// walk-in, an untouched legacy job, publishing, and Smart intake refusing to
// overwrite a table's figures.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/vacancy-table.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { buildRows, readPasted, type ColumnRole } from "@/lib/vacancy-paste";
import type { VacancyTable } from "@/lib/vacancy-table";
import { IBPS_OFFICER_I_ROWS, LIC_TABLE_E_ROWS } from "../fixtures/vacancy-tables";

type J = Record<string, unknown>;

(async () => {
  const { pg, token, adminId } = await boot();
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const { snapshotToGovernmentRecruitment } = await import("@/lib/cms/adapter");
  const { vacancyCategoryTable } = await import("@/lib/vacancy-categories");
  const { buildApplyPayload, ApplySelectionError } = await import("@/lib/cms/importer/apply-build");
  const { getRecruitmentById } = await import("@/lib/cms/repository");

  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body ? JSON.stringify(body) : undefined });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const create = async (organizationId: string, title: string, forceCreate = true) => {
    const r = await records.POST(req("/api/admin/cms/records", "POST", { organizationId, organizationName: organizationId.toUpperCase(), govType: "State Govt", title, recruitmentYear: 2026, forceCreate }));
    return ((await r.json()) as { record: { id: string } }).record.id;
  };
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const patch = async (id: string, fieldPath: string, value: unknown, reason = "test") => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const revisions = async (id: string, path: string) => (await pg.query("SELECT id FROM field_revisions WHERE recruitment_id = $1 AND field_path = $2 ORDER BY revised_at", [id, path])).rows.map((x) => (x as { id: string }).id);
  const vac = async (id: string) => (await getRecruitmentById(id))!.vacancies;

  // ── The tables, built the way the editor's paste builds them ──
  const IBPS_ROLES: ColumnRole[] = [
    { role: "serial" }, { role: "dimension", key: "bank", label: "Bank" },
    ...(["sc", "st", "obc", "ews", "ur"].map((k) => ({ role: "category", key: k, label: k.toUpperCase(), kind: "VERTICAL" }) as ColumnRole)),
    { role: "total" },
    ...(["hi", "oc", "vi", "id"].map((k) => ({ role: "category", key: `pwbd_${k}`, label: `PwBD ${k.toUpperCase()}`, kind: "HORIZONTAL", partOf: "pwbd", note: "PwBD (Out of Which), Annexure I page 47" }) as ColumnRole)),
  ];
  const ibpsBuilt = buildRows(readPasted(IBPS_OFFICER_I_ROWS.map((r) => r.line).join("\n")), IBPS_ROLES, { idPrefix: "o1-", page: 47, constants: [{ key: "post", label: "Post", value: "Officer Scale I" }] });
  const ibps: VacancyTable = { dimensions: ibpsBuilt.dimensions, categories: ibpsBuilt.categories, rows: ibpsBuilt.rows, statedTotals: [] };
  const ibpsReported = IBPS_OFFICER_I_ROWS.filter((r) => r.figures[5] !== "NR").reduce((s, r) => s + Number(r.figures[5]), 0);

  const licGrid = readPasted(["State\tCity\tNumber of Vacancies", ...LIC_TABLE_E_ROWS.map((r) => `${r.state}\t${r.city}\t${r.n ?? ""}`)].join("\n"));
  const licBuilt = buildRows(licGrid, [{ role: "dimension", key: "state", label: "State" }, { role: "dimension", key: "city", label: "City" }, { role: "total" }],
    { idPrefix: "lic-", page: 6, constants: [{ key: "post", label: "Post", value: "Apprentice" }] });
  const lic: VacancyTable = { dimensions: licBuilt.dimensions, categories: [], rows: licBuilt.rows,
    statedTotals: [{ at: {}, total: 232, source: { retrievalId: null, page: 9, line: "Grand Total 232" } }] };

  const btscBuilt = buildRows(readPasted("Post\tUR\tEWS\tSC\tST\tEBC\tBC\tBC Women\tTotal\nFood Safety Officer\t41\t11\t17\t2\t18\t12\t4\t105"),
    [{ role: "dimension", key: "post", label: "Post" },
     ...(["ur", "ews", "sc", "st"].map((k) => ({ role: "category", key: k, label: k.toUpperCase(), kind: "VERTICAL" }) as ColumnRole)),
     { role: "category", key: "ebc", label: "EBC", kind: "UNDETERMINED" }, { role: "category", key: "bc", label: "BC", kind: "UNDETERMINED" },
     { role: "category", key: "bc women", label: "BC Women", kind: "UNDETERMINED" }, { role: "total" }], { idPrefix: "b-", page: 2 });
  const btsc: VacancyTable = { dimensions: btscBuilt.dimensions, categories: btscBuilt.categories, rows: btscBuilt.rows, statedTotals: [] };

  section("A legacy job without a table works exactly as before");
  const legacy = await create("ssc", "TEST RECORD SSC MTS 2026 (legacy)");
  let out = await patch(legacy, "vacancies.total", 9000);
  check("Total Vacancies saves as before", out.status === 200 && (out.data.record as J & { vacancies: J }).vacancies !== undefined);
  out = await patch(legacy, "vacancies.breakdown", [{ post: "MTS", count: 8000 }, { post: "Havaldar", count: 1000 }]);
  check("the post-wise breakdown saves as before", out.status === 200);
  const lv = await vac(legacy);
  check("no table, and nothing marked as calculated", !lv.table && !lv.total?.derived && !lv.breakdown?.derived && lv.total?.value === 9000);

  section("IBPS CRP RRBs-XV Officer Scale I: 28 banks, Tripura not reported");
  check("the paste builds 28 rows with no errors", ibpsBuilt.rows.length === 28 && ibpsBuilt.errors.length === 0, ibpsBuilt.errors);
  const job = await create("ibps", "TEST RECORD IBPS RRB CRP-XV 2026");
  out = await patch(job, "vacancies.table", ibps, "Pasted 28 rows from page 47");
  check("saved", out.status === 200, out.data);
  let v = await vac(job);
  check("the table is stored as pasted (28 rows, page 47, printed lines)", v.table?.value?.rows.length === 28 && v.table.value.rows.every((r) => r.source.page === 47 && r.source.line.length > 10));
  check("Total Vacancies is calculated from the reported banks and marked incomplete",
    v.total?.value === ibpsReported && v.total.derived?.basis === "CALCULATED" && v.total.derived.complete === false && v.total.status === "PENDING", v.total);
  check("the breakdown is one row for the post, with no category split while incomplete",
    v.breakdown?.value?.length === 1 && v.breakdown.value[0].post === "Officer Scale I" && v.breakdown.value[0].breakdown === undefined, v.breakdown?.value);
  const rT = await revisions(job, "vacancies.total"), rB = await revisions(job, "vacancies.breakdown"), rTab = await revisions(job, "vacancies.table");
  check("one save wrote three revisions: table, total, breakdown", rTab.length === 1 && rT.length === 1 && rB.length === 1);
  const reason = (await pg.query("SELECT reason FROM field_revisions WHERE id = $1", [rT[0]])).rows[0].reason;
  check("the total's revision says where it came from", reason === "Calculated from the vacancy table", reason);

  out = await patch(job, "vacancies.total", 5000);
  check("a direct edit of Total Vacancies is refused while there is a table", out.status === 400 && /calculated from the table/.test(String(out.data.error)), out);
  out = await patch(job, "vacancies.breakdown", [{ post: "X", count: 1 }]);
  check("…and so is a direct edit of the breakdown", out.status === 400);

  section("Editing a row reopens what depends on it");
  const tripura = (t: VacancyTable): VacancyTable => ({ ...t, rows: t.rows.map((r) => /TRIPURA/.test(r.at.bank)
    ? { ...r, status: "STATED", total: 10, cells: { sc: 2, st: 3, obc: 1, ews: 1, ur: 3, pwbd_hi: 0, pwbd_oc: 1, pwbd_vi: 0, pwbd_id: 0 }, source: { retrievalId: null, page: 3, line: "Corrigendum: Tripura Gramin Bank 2 3 1 1 3 10" } } : r) });
  out = await patch(job, "vacancies.table", tripura(ibps), "Tripura's figures from the corrigendum");
  v = await vac(job);
  check("with Tripura reported the total is complete and has the category split",
    v.total?.value === ibpsReported + 10 && v.total.derived?.complete === true && v.breakdown?.value?.[0].breakdown?.ur !== undefined, v.total);
  const before = (await revisions(job, "vacancies.total")).length;
  const moved: VacancyTable = { ...tripura(ibps), rows: tripura(ibps).rows.map((r) => /^BIHAR/.test(r.at.bank) ? { ...r, cells: { ...r.cells, sc: r.cells.sc - 1, ur: r.cells.ur + 1 } } : r) };
  out = await patch(job, "vacancies.table", moved, "Bihar: one seat moved from SC to UR");
  v = await vac(job);
  check("a row edit that leaves the total unchanged still gives the total a new revision (its inputs changed)",
    v.total?.value === ibpsReported + 10 && (await revisions(job, "vacancies.total")).length === before + 1);
  check("checks bind to a field's latest revision, so a check of the old total no longer applies",
    (await revisions(job, "vacancies.total")).length === before + 1);

  section("A stale save and a broken table are refused");
  const stale = await rev(job);
  await patch(job, "vacancies.table", tripura(ibps), "another session saves first");
  const r409 = await fields.PATCH(req(`/api/admin/cms/records/${job}/fields`, "PATCH", { fieldPath: "vacancies.table", field: { value: ibps, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: stale, reason: "late" }), ctx(job));
  check("a save made on an older revision → 409 conflict", r409.status === 409);
  out = await patch(job, "vacancies.table", { ...moved, categories: [...moved.categories, { key: "women", label: "Women", kind: "HORIZONTAL" }] });
  check("a column placed outside the total without saying how that is known → refused", out.status === 422 || out.status === 400, out);
  check("…with the reason", /how it is known/.test(String(out.data.error)), out.data.error);

  section("LIC HFL Table E: 181 cities, Ananthapur without a figure");
  const licJob = await create("lic-hfl", "TEST RECORD LIC HFL Apprentice 2026");
  out = await patch(licJob, "vacancies.table", lic, "Pasted Table E");
  v = await vac(licJob);
  check("saved with 181 rows", out.status === 200 && v.table?.value?.rows.length === 181, out.data);
  check("Total Vacancies is the notice's printed 232", v.total?.value === 232 && v.total.derived?.basis === "STATED");
  check("the post row is the 231 the cities add up to, marked incomplete", v.breakdown?.value?.[0].count === 231 && v.breakdown.derived?.complete === false, v.breakdown);
  check("Ananthapur stays a row with no figure", v.table!.value!.rows.find((r) => r.at.city === "Ananthapur")?.status === "NO_FIGURE");

  section("BTSC FSO: one post, category-wise");
  const btscJob = await create("btsc", "TEST RECORD BTSC FSO 2026");
  out = await patch(btscJob, "vacancies.table", btsc, "Pasted the category table");
  v = await vac(btscJob);
  check("Total Vacancies 105, as printed", v.total?.value === 105 && v.total.derived?.basis === "STATED" && v.total.derived.complete, v.total);
  check("the breakdown has the whole split, the overlapping categories settled by the printed total",
    JSON.stringify(Object.entries(v.breakdown?.value?.[0].breakdown ?? {}).sort()) === JSON.stringify(Object.entries({ ur: 41, ews: 11, sc: 17, st: 2, EBC: 18, BC: 12, "BC Women": 4 }).sort()), v.breakdown?.value);

  section("A walk-in with one ordinary row");
  const walkin = await create("aiims-patna", "TEST RECORD AIIMS Patna Senior Resident walk-in");
  out = await patch(walkin, "vacancies.table", { dimensions: [{ key: "post", label: "Post" }], categories: [], statedTotals: [],
    rows: [{ id: "w1", at: { post: "Senior Resident" }, status: "STATED", total: 12, cells: {}, source: { retrievalId: null, page: 1, line: "Senior Resident 12" } }] });
  v = await vac(walkin);
  check("total 12 and one breakdown row, as the old shape held them", v.total?.value === 12 && v.breakdown?.value?.length === 1 && v.breakdown.value[0].count === 12);

  section("Publishing a job with a table");
  await patch(btscJob, "links", [{ type: "OFFICIAL_WEBSITE", label: "BTSC", url: "https://btsc.bihar.gov.in/", official: true }]);
  const pub = await publish.POST(req(`/api/admin/cms/records/${btscJob}/publish`, "POST", { announce: false, approveFirst: true }), ctx(btscJob));
  const pubData = (await pub.json()) as J;
  check("approved and published", pub.status === 200, pubData);
  const snap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [btscJob])).rows[0].snapshot as { vacancies: { total: number; breakdown: unknown[] } };
  check("the public snapshot carries the worked-out total and breakdown", snap.vacancies.total === 105 && snap.vacancies.breakdown.length === 1);
  const pubTable = vacancyCategoryTable(snapshotToGovernmentRecruitment(snap as never).vacancyBreakdown);
  const cellOf = (label: string) => pubTable?.rows[0].cells[pubTable.columns.findIndex((c) => c.label === label)];
  check("the public category table reads it, with the notice's own column names",
    ["UR", "EWS", "SC", "ST", "EBC", "BC", "BC Women"].map(cellOf).join(",") === "41,11,17,2,18,12,4", pubTable?.columns.map((c) => c.label));
  const rv = await revert.POST(req(`/api/admin/cms/records/${btscJob}/revert`, "POST"), ctx(btscJob));
  check("opened for editing again", rv.status === 200);
  void approve;

  section("Publishing an incomplete total, and a legacy job");
  await patch(job, "vacancies.table", ibps, "back to the notice as printed");
  await patch(job, "links", [{ type: "OFFICIAL_WEBSITE", label: "IBPS", url: "https://www.ibps.in/", official: true }]);
  const pubI = await publish.POST(req(`/api/admin/cms/records/${job}/publish`, "POST", { announce: false, approveFirst: true }), ctx(job));
  check("the IBPS job publishes", pubI.status === 200, await pubI.clone().json());
  const snapI = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [job])).rows[0].snapshot as { vacancies: J };
  check("the snapshot carries the table and says the total is incomplete and calculated",
    (snapI.vacancies.table as VacancyTable | undefined)?.rows.length === 28 && snapI.vacancies.totalComplete === false && snapI.vacancies.totalBasis === "CALCULATED", snapI.vacancies.totalComplete);
  const jobI = snapshotToGovernmentRecruitment(snapI as never);
  check("cards and the header box say 'At least'", jobI.vacanciesDisplay === `At least ${ibpsReported.toLocaleString("en-IN")} Posts` && jobI.totalVacancies === ibpsReported, jobI.vacanciesDisplay);
  check("the page gets the table", jobI.vacancyTable?.rows.length === 28 && jobI.vacancyTotalComplete === false);
  await patch(legacy, "links", [{ type: "OFFICIAL_WEBSITE", label: "SSC", url: "https://ssc.gov.in/", official: true }]);
  const pubL = await publish.POST(req(`/api/admin/cms/records/${legacy}/publish`, "POST", { announce: false, approveFirst: true }), ctx(legacy));
  const snapL = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [legacy])).rows[0].snapshot as { vacancies: J };
  check("a legacy job's snapshot has exactly the old vacancy keys", pubL.status === 200 && JSON.stringify(Object.keys(snapL.vacancies).sort()) === '["breakdown","total"]', Object.keys(snapL.vacancies));
  const jobL = snapshotToGovernmentRecruitment(snapL as never);
  check("…and the old wording", jobL.vacanciesDisplay === "9,000 Posts" && jobL.vacancyTable === undefined, jobL.vacanciesDisplay);

  section("Smart intake's preview does not offer figures for a table job");
  const service = await import("@/lib/cms/importer/service");
  const text = "BTSC Food Safety Officer Recruitment 2026. Total Vacancies 120. Apply online from 25 September 2026 to 24 October 2026 on btsc.bihar.gov.in for the Food Safety Officer post.";
  const prev = await service.previewImport({ adminId, mode: "EXISTING", recruitmentId: btscJob, sources: [{ declaredKind: "RESEARCH", method: "paste", text }], apiKey: undefined });
  const vacItems = prev.proposal.items.filter((i) => i.fieldPath.startsWith("vacancies."));
  check("the preview read a vacancy figure", vacItems.length > 0, prev.proposal.items.map((i) => i.fieldPath));
  check("any vacancy figure it read is shown unticked, with the reason", vacItems.every((i) => !i.defaultTicked && i.flags.some((f) => /vacancy table/.test(f))), vacItems.map((i) => [i.fieldPath, i.defaultTicked, i.flags]));

  section("Stopping the table");
  out = await patch(walkin, "vacancies.table", null, "Removed the vacancy table");
  v = await vac(walkin);
  check("the table is gone; total and breakdown keep their figures as entered", out.status === 200 && !v.table && v.total?.value === 12 && !v.total.derived && v.total.manuallyEdited === true, v);
  out = await patch(walkin, "vacancies.total", 13);
  check("and Total Vacancies can be edited on its own again", out.status === 200);

  section("Smart intake does not overwrite a table's figures");
  const rec = (await getRecruitmentById(job))!;
  let refused = "";
  try {
    buildApplyPayload({ record: rec, adminId, sourceLabel: "test", selected: ["v"], confirmReplaceVerified: false,
      proposal: { items: [{ id: "v", kind: "FIELD", fieldPath: "vacancies.total", label: "Total vacancies", value: 4000, claims: [], action: "REPLACE", conflict: false, supersedes: [], defaultTicked: true, flags: [] }], replacedInImport: [], warnings: [] } });
  } catch (e) { refused = e instanceof ApplySelectionError ? e.message : `other: ${String(e)}`; }
  check("an imported total for a job with a table is refused with a reason", /has a vacancy table/.test(refused), refused);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
