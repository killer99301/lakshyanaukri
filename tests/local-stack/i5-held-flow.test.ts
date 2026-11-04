// ═══════════════════════════════════════════════════════════
// I5: held vacancy figures from Smart intake into the job's vacancy table,
// through the real import, the real field route (as the editor saves) and
// the read-only held-tables route, on the in-memory test database. No AI.
//
// A job's imports list what they held, newest first; a held table opened in
// the paste box and saved keeps its document (research stays research,
// official stays to be checked); its status is worked out from the saved
// table: not added, partly added, added, back again when rows are removed.
// A held table of another split is refused by the paste box's merge, and
// nothing is applied, verified or removed without a save.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/i5-held-flow.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import type { VacancyTable } from "@/lib/vacancy-table";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; defaultTicked: boolean };

const FRONT = "Test Public Service Commission\nRecruitment of Clerks 2099\nLast date to apply online: 30.06.2099";
const page = (...p: string[]) => p.map((x, i) => `${x}\n\n-- ${i + 1} of ${p.length} --\n`).join("\n");
const POST_BANK = page(FRONT, "Vacancies\nName of Post Name of the Bank UR SC Total\nClerk Delta Gramin Bank 1 2 3\nClerk Epsilon Gramin Bank 2 1 3\nOfficer Delta Gramin Bank 1 1 2");
const FF = `${FRONT}\nVacancy table:\n| Post | UR | FF | Total |\n| Assistant | 10 | 1 | 11 |\n| Typist | 4 | 0 | 4 |`;

const S = { A: "A: what a job's imports held", B: "B: from the paste box into the saved table", C: "C: what stays protected" };
expectChecks(S.A, [
  "A1 the job's held tables: the post-and-bank table and the pasted FF table, each with its source and lines, not added",
  "A2 the read-only route gives the same list to the admin, and nothing to a request without a session",
  "A3 a later re-import held against the job's split: listed first (newest import first)",
]);
expectChecks(S.B, [
  "B1 opening and building rows without saving changes nothing: still not added",
  "B2 the FF table, its column chosen and saved: added; its rows keep the research document, prepared, Pending",
  "B3 …the saved rows reopen, and show on the public preview",
  "B4 two of three post-and-bank rows corrected and saved: partly added (2 of 3), their lines marked corrected, the notice's document kept",
  "B5 a saved row removed: the status follows (1 of 3)",
]);
expectChecks(S.C, [
  "C1 research rows stay research: the job's table total is not checked or verified by adding them",
  "C2 a held table of another split is refused by the merge: nothing saved",
]);

(async () => {
  const { pg, adminId, token } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { projectForPreview } = await import("@/lib/cms/projector");
  const { buildRows, mergePasted, readPasted, suggestColumns } = await import("@/lib/vacancy-paste");
  const { sourceForHeldRow } = await import("@/lib/cms/importer/held-tables");
  const heldRoute = await import("@/app/api/admin/cms/records/[id]/held-tables/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  await setImporterEnabled(true);
  const req = (path: string, method: string, body?: unknown, cookie = `admin_sid=${token}`) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie }, body: body ? JSON.stringify(body) : undefined });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const saveTable = async (id: string, table: VacancyTable, reason: string) =>
    { const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "vacancies.table", field: { value: table, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason }), ctx(id)); if (r.status !== 200) console.log("SAVE", r.status, JSON.stringify(await r.json()).slice(0, 400)); return r.status; };
  const official = (text: string) => ({ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text, url: "https://tpsc.example.gov.in/notice.pdf", attestation: "Copied from the notice (I5 test)" });
  const research = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text, prepared: true });
  let year = 2900;
  const importInto = async (args: J, sources: J[]) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args, sources } as never);
    const items = (p.proposal as unknown as { items: Item[] }).items;
    return (await service.applyImportFlow({ importId: p.importId, adminId, selected: items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId as string;
  };
  const newJob = (title: string) => ({ mode: "NEW", newJob: { organizationId: `i5-${year}`, organizationName: "Test Public Service Commission", recruitmentYear: year++, title, govType: "State Govt" } });
  const heldOf = async (id: string) => service.heldTablesForJob((await getRecruitmentById(id))!);
  const retrievalKind = async (id: string) => (await pg.query("SELECT declared_kind FROM recruitment_source_retrievals WHERE id = $1", [id])).rows[0]?.declared_kind;

  section(S.A);
  const job = await importInto(newJob("TEST RECORD I5 Clerks"), [official(POST_BANK), research(FF)]);
  const held = await heldOf(job);
  const bank = held.find((h) => h.kind === "NOT_READ")!, ff = held.find((h) => h.kind === "PASTED")!;
  check("A1 the job's held tables: the post-and-bank table and the pasted FF table, each with its source and lines, not added",
    held.length === 2 && !!bank && !!ff && bank.lines[0].text === "Name of Post Name of the Bank UR SC Total" && ff.text.split("\n").length === 3
    && held.every((h) => h.status === "NOT_ADDED") && ff.research && ff.prepared && !bank.research, held.map((h) => [h.kind, h.title, h.status, h.sourceLabel]));
  const viaRoute = (await (await heldRoute.GET(req(`/api/admin/cms/records/${job}/held-tables`, "GET"), ctx(job))).json()) as { held: unknown[] };
  const noSession = (await heldRoute.GET(req(`/api/admin/cms/records/${job}/held-tables`, "GET", undefined, ""), ctx(job))).status;
  check("A2 the read-only route gives the same list to the admin, and nothing to a request without a session", viaRoute.held.length === 2 && noSession >= 400, [viaRoute.held.length, noSession]);

  section(S.B);
  // Opening the FF table and building its rows, as the paste box does, without saving.
  const grid = readPasted(ff.text);
  const roles = suggestColumns(grid).map((r, i) => (grid.headers[i] === "FF" ? { role: "category" as const, key: "ff", label: "FF (freedom fighters)", kind: "UNDETERMINED" as const } : r));
  const built = buildRows(grid, roles, { idPrefix: "h-", prepared: true });
  const rows = built.rows.map((r) => ({ ...r, source: sourceForHeldRow(r.source.line, ff) }));
  check("B1 opening and building rows without saving changes nothing: still not added",
    (await heldOf(job)).every((h) => h.status === "NOT_ADDED") && !(await getRecruitmentById(job))!.vacancies.table?.value, (await heldOf(job)).map((h) => h.status));
  const plan = mergePasted(null, { ...built, rows }, false);
  const saved = await saveTable(job, plan.table, "Held figures from Smart intake: the FF table");
  const after = await getRecruitmentById(job);
  const t = after!.vacancies.table!;
  check("B2 the FF table, its column chosen and saved: added; its rows keep the research document, prepared, Pending",
    saved === 200 && (await heldOf(job)).find((h) => h.kind === "PASTED")!.status === "ADDED" && (await heldOf(job)).find((h) => h.kind === "NOT_READ")!.status === "NOT_ADDED"
    && t.value!.rows.every((r) => r.source.retrievalId === ff.sourceId && r.source.readBy === "PREPARED" && r.source.line.startsWith("| ")) && await retrievalKind(ff.sourceId) === "RESEARCH" && t.status === "PENDING",
    [saved, t.value?.rows.map((r) => r.source), t.status]);
  const reopened = (await getRecruitmentById(job))!;
  check("B3 …the saved rows reopen, and show on the public preview",
    JSON.stringify(reopened.vacancies.table!.value!.rows.map((r) => [r.at.post, r.total])) === JSON.stringify([["Assistant", 11], ["Typist", 4]]) && projectForPreview(reopened).vacancies.total === 15,
    projectForPreview(reopened).vacancies);

  // A job with only the post-and-bank table held (official): two of its rows corrected and saved.
  const bankJob = await importInto(newJob("TEST RECORD I5 Banks"), [official(POST_BANK)]);
  const bh = (await heldOf(bankJob))[0];
  const corrected = ["Post\tBank\tUR\tSC\tTotal", "Clerk\tDelta Gramin Bank\t1\t2\t3", "Clerk\tEpsilon Gramin Bank\t2\t1\t3"].join("\n");
  const g2 = readPasted(corrected);
  const b2 = buildRows(g2, suggestColumns(g2), { idPrefix: "b-" });
  const rows2 = b2.rows.map((r) => ({ ...r, source: sourceForHeldRow(r.source.line, bh) }));
  await saveTable(bankJob, mergePasted(null, { ...b2, rows: rows2 }, false).table, "Held figures: two banks");
  const part = (await heldOf(bankJob))[0];
  const bankRows = (await getRecruitmentById(bankJob))!.vacancies.table!.value!.rows;
  check("B4 two of three post-and-bank rows corrected and saved: partly added (2 of 3), their lines marked corrected, the notice's document kept",
    part.status === "PARTIAL" && part.added === 2 && part.of === 3 && bankRows.every((r) => r.source.line.startsWith("(corrected in the editor) ") && r.source.retrievalId === bh.sourceId)
    && await retrievalKind(bh.sourceId) === "OFFICIAL_NOTIFICATION", [part.status, part.added, part.of, bankRows.map((r) => r.source)]);
  const tableNow = (await getRecruitmentById(bankJob))!.vacancies.table!.value!;
  await saveTable(bankJob, { ...tableNow, rows: tableNow.rows.slice(0, 1) }, "Removed a row");
  const less = (await heldOf(bankJob))[0];
  check("B5 a saved row removed: the status follows (1 of 3)", less.status === "PARTIAL" && less.added === 1, [less.status, less.added]);

  section(S.A);
  // A re-import into the first job whose table is split by bank: held against the job's post-wise table (317ec05).
  await importInto({ mode: "EXISTING", recruitmentId: job }, [official(page(FRONT, "ASSISTANT\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n1 Delta Gramin Bank 2 1 3 1 4 11\n2 Epsilon Gramin Bank 1 1 2 1 3 8\n3 Theta Gramin Bank 1 0 2 1 2 6"))]);
  const later = await heldOf(job);
  check("A3 a later re-import held against the job's split: listed first (newest import first)",
    later[0].kind === "SPLIT" && later[0].status === "NOT_ADDED" && later[0].appliedAt >= later[later.length - 1].appliedAt && later.length === 3
    && later[0].text.startsWith("Post\tBank\t"), later.map((h) => [h.kind, h.appliedAt, h.status]));

  section(S.C);
  const checks = await service.checksFor((await getRecruitmentById(job))!);
  const totalRow = (checks as unknown as { rows: Array<{ fieldPath: string; cls: string }> }).rows.find((r) => r.fieldPath === "vacancies.total");
  check("C1 research rows stay research: the job's table total is not checked or verified by adding them",
    !!totalRow && totalRow.cls !== "VERIFIED" && (await getRecruitmentById(job))!.vacancies.table!.status === "PENDING", totalRow);
  const splitHeld = later[0];
  const g3 = readPasted(splitHeld.text);
  const b3 = buildRows(g3, suggestColumns(g3), { idPrefix: "s-" });
  const refused = mergePasted((await getRecruitmentById(job))!.vacancies.table!.value!, { ...b3, rows: b3.rows.map((r) => ({ ...r, source: sourceForHeldRow(r.source.line, splitHeld) })) }, false);
  check("C2 a held table of another split is refused by the merge: nothing saved",
    /The table is split by Post; the pasted rows by Post › Bank/.test(refused.problems[0] ?? "") && refused.added.length === 0 && (await getRecruitmentById(job))!.vacancies.table!.value!.rows.length === 2, refused.problems);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
