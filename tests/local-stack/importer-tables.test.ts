// ═══════════════════════════════════════════════════════════
// Smart intake fills the vacancy table (stage B1), through the real preview,
// apply route and import transaction, on the in-memory test database. No AI:
// tables are read by code. Real page text of IBPS CRP RRBs-XV (Annexure I)
// and LIC HFL Table E; a made-up corrigendum and a made-up re-issue.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/importer-tables.test.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import type { VacancyTable } from "@/lib/vacancy-table";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; flags: string[]; claims: Array<{ page?: number | null }> };
const IBPS = readFileSync("tests/fixtures/notice-text/ibps-crp-rrb-xv-pages-45-56.txt", "utf8");
const LIC = readFileSync("tests/fixtures/notice-text/lic-hfl-batch10-pages-5-9.txt", "utf8");

(async () => {
  const { pg, token, adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const applyRoute = await import("@/app/api/admin/cms/import/[importId]/apply/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { analyseVacancyTable } = await import("@/lib/vacancy-table");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (v: string) => ({ params: Promise.resolve({ importId: v }) });
  const count = async (q: string, p: unknown[] = []) => Number((await pg.query(q, p)).rows[0].n);
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const preview = (args: J) => service.previewImport({ adminId, apiKey: undefined, ...args } as never);
  const itemsOf = (p: { proposal: unknown }) => (p.proposal as { items: Item[] }).items;
  const metaOf = (p: { proposal: unknown }) => (p.proposal as { meta: { sources: Array<{ vacancyTables: J }> }; warnings: string[] });
  const apply = async (importId: string, selected: string[]) => {
    const r = await applyRoute.POST(req(`/api/admin/cms/import/${importId}/apply`, "POST", { selected }), ctx(importId));
    return { status: r.status, data: (await r.json()) as J };
  };

  section("IBPS CRP RRBs-XV: ten bank-wise tables into a new job");
  const ibpsJob = { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2026, title: "TEST RECORD IBPS RRB CRP-XV 2026", govType: "PSU" };
  const p1 = await preview({ mode: "NEW", newJob: ibpsJob, sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: IBPS }] });
  const tableItem = itemsOf(p1).find((i) => i.fieldPath === "vacancies.table");
  const t1 = tableItem?.value as VacancyTable | undefined;
  check("one vacancy table proposed, ticked to save (a new job)", !!tableItem && tableItem.defaultTicked && tableItem.action === "FILL", itemsOf(p1).map((i) => i.fieldPath));
  check("280 rows, 10 posts, every one with its page and printed line", t1?.rows.length === 280 && new Set(t1.rows.map((r) => r.at.post)).size === 10
    && t1.rows.every((r) => r.source.page !== null && r.source.line.length > 0 && r.source.retrievalId));
  const cov = metaOf(p1).meta.sources[0].vacancyTables as { coverage: { tables: Array<{ read: boolean; pages: number[] }> }; diff: J; from: string };
  check("the coverage report: 10 tables, all read, pages 46-55", cov.from === "tables" && cov.coverage.tables.length === 10 && cov.coverage.tables.every((t) => t.read)
    && cov.coverage.tables.map((t) => t.pages[0]).join(",") === "46,47,48,49,50,51,52,53,54,55", cov.coverage.tables);
  check("the evidence claim names the page", (tableItem?.claims[0]?.page ?? null) === 46, tableItem?.claims);
  const a1 = await apply(p1.importId, [tableItem!.id]);
  check("saved", a1.status === 200, a1.data);
  const job1 = (await getRecruitmentById(String(a1.data.recruitmentId)))!;
  const an1 = analyseVacancyTable(job1.vacancies.table!.value!);
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as J).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;
  check("the saved table is the previewed one (key order aside)", JSON.stringify(canon(job1.vacancies.table!.value)) === JSON.stringify(canon(t1)));
  check("Total Vacancies worked out on the server: at least 13,706, incomplete (Tripura)", job1.vacancies.total?.value === 13706 && job1.vacancies.total.derived?.complete === false, job1.vacancies.total);
  check("the breakdown: one row per post", job1.vacancies.breakdown?.value?.length === 10);
  check("only Tripura's ten rows are flagged", an1.issues.length === 10 && an1.issues.every((i) => i.code === "NOT_REPORTED"));
  check("revisions for the table, the total and the breakdown; one claim for the table",
    await count("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path IN ('vacancies.table','vacancies.total','vacancies.breakdown')", [job1.id]) === 3
    && await count("SELECT count(*)::int AS n FROM recruitment_field_claims WHERE recruitment_id = $1 AND field_path = 'vacancies.table'", [job1.id]) === 1);

  section("A corrigendum that changes two banks of one post");
  const corrText = ["Corrigendum No. 1 to CRP RRBs-XV", "Revised vacancies, Annexure I", "OFFICER SCALE I",
    "SR NO. STATE BANK SC ST OBC (NCL) EWS GENERAL TOTAL", "PwBD (Out of Which)", "HI OC VI ID",
    "4 BIHAR BIHAR GRAMIN BANK 60 30 106 39 160 395 4 4 4 4", "25 TRIPURA TRIPURA GRAMIN BANK 2 3 1 1 3 10 0 1 0 0",
    "26 UTTAR PRADESH UTTAR PRADESH GRAMIN BANK 64 32 115 43 171 425 5 5 5 5"].join("\n");
  const p2 = await preview({ mode: "EXISTING", recruitmentId: job1.id, sources: [{ declaredKind: "OFFICIAL_CORRIGENDUM", method: "paste", text: corrText }] });
  const corrItem = itemsOf(p2).find((i) => i.fieldPath === "vacancies.table")!;
  const diff2 = (metaOf(p2).meta.sources[0].vacancyTables as { diff: { added: number; changed: number; removed: number; same: number; changedRows: Array<{ before: J; after: J }> } }).diff;
  check("the preview lists 2 changed rows, 1 unchanged, nothing added or removed", diff2.changed === 2 && diff2.same === 1 && diff2.added === 0 && diff2.removed === 0, diff2);
  check("a changed table is not ticked by default", corrItem.action === "REPLACE" && !corrItem.defaultTicked);
  const merged = corrItem.value as VacancyTable;
  check("every other row and post is kept as it was", merged.rows.length === 280
    && JSON.stringify(merged.rows.filter((r) => r.at.post !== "Officer Scale I")) === JSON.stringify(job1.vacancies.table!.value!.rows.filter((r) => r.at.post !== "Officer Scale I")));
  const a2 = await apply(p2.importId, [corrItem.id]);
  const job2 = (await getRecruitmentById(job1.id))!;
  const bihar = job2.vacancies.table!.value!.rows.find((r) => r.at.post === "Officer Scale I" && r.at.bank === "BIHAR GRAMIN BANK")!;
  const tripura = job2.vacancies.table!.value!.rows.find((r) => r.at.post === "Officer Scale I" && r.at.bank === "TRIPURA GRAMIN BANK")!;
  check("applied: Bihar 395 from the corrigendum's line, Tripura now reported", a2.status === 200 && bihar.total === 395 && /395/.test(bihar.source.line) && tripura.status === "STATED" && tripura.total === 10, a2.data);
  check("posts keep the job's order", JSON.stringify([...new Set(job2.vacancies.table!.value!.rows.map((r) => r.at.post))]) === JSON.stringify([...new Set(job1.vacancies.table!.value!.rows.map((r) => r.at.post))]));
  check("…with the row's identity kept", bihar.id === job1.vacancies.table!.value!.rows.find((r) => r.at.post === "Officer Scale I" && r.at.bank === "BIHAR GRAMIN BANK")!.id);
  check("Officer Scale I is now complete; the total moved by 11", job2.vacancies.total?.value === 13706 + 11
    && analyseVacancyTable(job2.vacancies.table!.value!).groups.find((g) => g.name === "Officer Scale I")!.total!.complete === true, job2.vacancies.total?.value);

  section("A re-issued notice that no longer lists a bank for one post");
  const lines = IBPS.split("\n");
  const reissue = lines.filter((l) => !/^5 CHHATTISGARH GRAMIN BANK 1 1 2 0 2 6 0 0 0 0$/.test(l.trim())).join("\n");
  const p3 = await preview({ mode: "EXISTING", recruitmentId: job1.id, sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: reissue }] });
  const diff3 = (metaOf(p3).meta.sources[0].vacancyTables as { diff: { removed: number; removedRows: Array<{ at: J }>; changed: number } }).diff;
  check("the bank it no longer lists is shown as removed (its post's table was read in full)", diff3.removed === 1 && diff3.removedRows[0].at.bank === "CHHATTISGARH GRAMIN BANK" && diff3.removedRows[0].at.post === "Officer Scale II (IT)", diff3);
  check("…and the corrigendum's changes show as differences, not silently undone", diff3.changed === 2, diff3);
  check("nothing is ticked: it waits for a decision", !itemsOf(p3).find((i) => i.fieldPath === "vacancies.table")!.defaultTicked);

  section("A re-issue with a line that could not be read removes nothing");
  const garbled = lines.map((l) => /^5 CHHATTISGARH GRAMIN BANK 1 1 2 0 2 6 0 0 0 0$/.test(l.trim()) ? "5 CHHATTISGARH GRAMIN BANK 1 1 2 0 2 6 0 0" : l).join("\n");
  const p3b = await preview({ mode: "EXISTING", recruitmentId: job1.id, sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: garbled }] });
  const note3b = metaOf(p3b).meta.sources[0].vacancyTables as { removalsHeld: number; diff: { removed: number }; coverage: { unreadLines: Array<{ text: string; page: number | null }> } };
  check("the line it could not read is reported, with its page", note3b.coverage.unreadLines.some((l) => /CHHATTISGARH/.test(l.text) && l.page === 49), note3b.coverage.unreadLines);
  check("…so the row it no longer lists is kept, and the hold is said", note3b.diff.removed === 0 && note3b.removalsHeld === 1
    && (itemsOf(p3b).find((i) => i.fieldPath === "vacancies.table")!.value as VacancyTable).rows.length === 280, note3b);

  section("LIC HFL Table E into a new job");
  const p4 = await preview({ mode: "NEW", newJob: { organizationId: "lic-hfl", organizationName: "LIC Housing Finance Limited", recruitmentYear: 2026, title: "Apprentice", govType: "PSU" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: LIC }] });
  const licItem = itemsOf(p4).find((i) => i.fieldPath === "vacancies.table")!;
  const a4 = await apply(p4.importId, [licItem.id]);
  const lic = (await getRecruitmentById(String(a4.data.recruitmentId)))!;
  check("181 cities, Ananthapur 1, Total Vacancies the printed 232, complete", a4.status === 200 && lic.vacancies.table!.value!.rows.length === 181
    && lic.vacancies.table!.value!.rows.find((r) => r.at.city === "Ananthapur")!.total === 1 && lic.vacancies.total?.value === 232 && lic.vacancies.total.derived?.complete === true, lic.vacancies.total);

  section("Separate total or breakdown figures do not compete with the table");
  const p5 = await preview({ mode: "NEW", newJob: { ...ibpsJob, title: "TEST RECORD IBPS again", organizationId: "ibps-x" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: `${IBPS}\nTotal Vacancies: 13706` }] });
  const other = itemsOf(p5).filter((i) => i.fieldPath === "vacancies.total" || i.fieldPath === "vacancies.breakdown");
  check("a separate vacancy figure was read", other.length > 0, itemsOf(p5).map((i) => i.fieldPath));
  check("any separate vacancy figure is unticked, saying the table gives it", other.every((i) => !i.defaultTicked && i.flags.some((f) => /vacancy table/.test(f))), other.map((i) => [i.fieldPath, i.defaultTicked]));

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
