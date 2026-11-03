// ═══════════════════════════════════════════════════════════
// I2: a vacancy table in pasted text, through the real preview, apply and
// database functions on the in-memory test database, with the AI off.
//
// A prepared table is offered as the job's vacancy table, its rows marked
// prepared, beside I1's labelled fields; one whose columns need choosing is
// said with its columns and lines and not offered; a fee table is no vacancy
// table. Into an existing job a pasted table adds and changes rows but never
// removes one, the same table again changes nothing, and a table split
// differently leaves the job's rows as they are.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/i2-prepared-tables.test.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { boot, check, expectChecks, section, summary } from "./boot";
import type { VacancyTable } from "@/lib/vacancy-table";

type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; flags: string[] };
type Note = { from: string | null; removalsHeld?: number; coverage: { tables: Array<{ title: string; read: boolean; why?: string; columns?: string[] }>; unreadLines: Array<{ text: string }> };
  diff?: { added: number; changed: number; removed: number; same: number; held?: number } };
type Proposal = { items: Item[]; warnings: string[]; meta: { sources: Array<{ vacancyTables: Note | null }> } };

const TABLE = (rows: string[]) => `Vacancy table:\n| Post | UR | EWS | SC | ST | OBC | Total |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}`;
const AE = "| Assistant Engineer | 10 | 2 | 4 | 1 | 6 | 23 |", JE = "| Junior Engineer | 15 | 3 | 5 | 2 | 10 | 35 |";
const PREPARED = (table: string) => `TEST RECORD Prepared tables 2099 — prepared by ChatGPT
Last date to apply online: 09.02.2099
Application Fee: General/OBC ₹600, SC/ST/PwBD ₹100
${table}
Selection: Written examination and interview`;

const S = { A: "A: a new job from prepared text", B: "B: tables not offered", C: "C: into a job that has a table" };
expectChecks(S.A, [
  "A1 the pasted table is offered as the vacancy table, ticked, its rows marked prepared and quoted",
  "A1 …the review says it came from a pasted table, with its columns as taken",
  "A1 …the printed Total line is kept as the printed total, not a row",
  "A1 …I1's labelled fields are offered beside it",
  "A1 …and no AI request was made",
  "A2 an official pasted notice's table: its rows carry the notice, attested, no page and no “prepared”",
  "A3 saved: the rows are on the job, Total Vacancies worked out from them, and on the public preview",
]);
expectChecks(S.B, [
  "B1 a column the reader does not know: no table offered; said with its columns, and its lines listed as not read",
  "B2 the Hindi BPSC prepared table: held for the admin, its lines kept",
  "B3 a fee table is no vacancy table: nothing offered, nothing said about vacancies",
]);
expectChecks(S.C, [
  "C1 the same table again: nothing added, nothing changed (no duplicate rows)",
  "C2 a pasted table without one of the job's rows: the row is kept, never offered for removal",
  "C2 …a bank it leaves out inside a post it names: held, not removed",
  "C3 a changed figure and a new post: offered as a change and an addition, nothing removed",
  "C4 a pasted table split differently: the job's rows stand, the document's are held",
]);

(async () => {
  const { pg, adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { projectForPreview } = await import("@/lib/cms/projector");
  await setImporterEnabled(true);
  let calls = 0;
  const noAi = (async () => { calls++; throw new Error("no AI in this test"); }) as unknown as typeof fetch;
  let year = 2700;
  const newJob = () => ({ mode: "NEW", newJob: { organizationId: `i2-${year}`, organizationName: "Test Public Service Commission", recruitmentYear: year++, title: "TEST RECORD I2", govType: "State Govt" } });
  const preview = async (args: Record<string, unknown>) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, fetchFn: noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const research = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text, prepared: true });
  const tableOf = (p: Proposal) => p.items.find((i) => i.fieldPath === "vacancies.table");
  const noteOf = (p: Proposal) => p.meta.sources[0].vacancyTables!;

  section(S.A);
  const a = await preview({ ...newJob(), sources: [research(PREPARED(TABLE([AE, JE, "| Total | 25 | 5 | 9 | 3 | 16 | 58 |"])))] });
  const item = tableOf(a.proposal);
  const t = item?.value as VacancyTable | undefined;
  check("A1 the pasted table is offered as the vacancy table, ticked, its rows marked prepared and quoted",
    !!t && item!.defaultTicked && item!.action === "FILL" && t.rows.map((r) => `${r.at.post}:${r.total}`).join(",") === "Assistant Engineer:23,Junior Engineer:35"
    && t.rows.every((r) => r.source.readBy === "PREPARED" && r.source.page === null && /^\| (Assistant|Junior) Engineer/.test(r.source.line)), [item?.defaultTicked, t?.rows]);
  const note = noteOf(a.proposal);
  check("A1 …the review says it came from a pasted table, with its columns as taken",
    note.from === "pasted" && note.coverage.tables.length === 1 && note.coverage.tables[0].read && note.coverage.tables[0].columns?.join("; ") === "Post → Post; UR → category UR; EWS → category EWS; SC → category SC; ST → category ST; OBC → category OBC; Total → total", note);
  check("A1 …the printed Total line is kept as the printed total, not a row", t?.rows.length === 2 && t.statedTotals.length === 1 && t.statedTotals[0].total === 58, t?.statedTotals);
  check("A1 …I1's labelled fields are offered beside it",
    ["financial.feeGeneral", "financial.feeSCST", "selection", "dates.applicationCloseDate"].every((f) => a.proposal.items.some((i) => i.fieldPath === f)), a.proposal.items.map((i) => i.fieldPath));
  check("A1 …and no AI request was made", calls === 0, calls);
  const off = await preview({ ...newJob(), sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: PREPARED(TABLE([AE, JE])), url: "https://tpsc.example.gov.in/n.pdf", attestation: "Copied from the notice (I2 test)" }] });
  const offT = tableOf(off.proposal)?.value as VacancyTable | undefined;
  const offR = (await pg.query("SELECT id, authenticity FROM recruitment_source_retrievals WHERE import_id = $1", [off.importId])).rows[0];
  check("A2 an official pasted notice's table: its rows carry the notice, attested, no page and no “prepared”",
    !!offT && offT.rows.every((r) => r.source.retrievalId === offR.id && r.source.page === null && r.source.readBy === undefined) && offR.authenticity === "ATTESTED", [offR, offT?.rows.map((r) => r.source)]);
  const applied = await service.applyImportFlow({ importId: a.importId, adminId, selected: a.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null });
  const job = (await getRecruitmentById(applied.recruitmentId))!;
  const pub = projectForPreview(job);
  check("A3 saved: the rows are on the job, Total Vacancies worked out from them, and on the public preview",
    job.vacancies.table?.value?.rows.length === 2 && job.vacancies.total?.value === 58 && job.vacancies.table.status === "PENDING" && pub.vacancies.table?.rows.length === 2 && pub.vacancies.total === 58,
    [job.vacancies.total, pub.vacancies.total]);

  section(S.B);
  const b1 = await preview({ ...newJob(), sources: [research(PREPARED("Vacancy table:\n| Post | UR | SC | FF | Total |\n| Clerk | 10 | 3 | 1 | 14 |\n| Typist | 4 | 1 | 0 | 5 |"))] });
  const n1 = noteOf(b1.proposal);
  check("B1 a column the reader does not know: no table offered; said with its columns, and its lines listed as not read",
    !tableOf(b1.proposal) && !n1.coverage.tables[0].read && n1.coverage.unreadLines.length === 3
    && b1.proposal.warnings.some((w) => /^A pasted vacancy table \(“Vacancy table”\) is not offered: its columns need choosing: “FF” is not a category the reader knows\. Its columns as suggested: .*FF → category FF.*paste it into the vacancy editor's paste box/.test(w)), b1.proposal.warnings);
  const b2 = await preview({ ...newJob(), sources: [research(readFileSync("tests/fixtures/paste/bpsc-72-prepared.txt", "utf8"))] });
  const n2 = noteOf(b2.proposal);
  check("B2 the Hindi BPSC prepared table: held for the admin, its lines kept",
    !tableOf(b2.proposal) && n2.coverage.tables.length === 1 && !n2.coverage.tables[0].read && n2.coverage.unreadLines.length > 20, [n2.coverage.tables[0]?.why, n2.coverage.unreadLines.length]);
  const b3 = await preview({ ...newJob(), sources: [research(`TEST RECORD fee table 2099\nLast date to apply online: 09.02.2099\nApplication fee:\n| Category | Fee (Rs) |\n| General | 600 |\n| SC/ST | 100 |\n${"Candidates must apply online. ".repeat(3)}`)] });
  check("B3 a fee table is no vacancy table: nothing offered, nothing said about vacancies",
    !tableOf(b3.proposal) && (noteOf(b3.proposal)?.coverage.tables.length ?? 0) === 0 && !b3.proposal.warnings.some((w) => /vacancy table/.test(w)), [b3.proposal.warnings, noteOf(b3.proposal)]);

  section(S.C);
  const into = (table: string) => preview({ mode: "EXISTING", recruitmentId: applied.recruitmentId, sources: [research(PREPARED(table))] });
  const c1 = await into(TABLE([AE, JE]));
  const d1 = noteOf(c1.proposal).diff;
  // The figures are the same; the item is a replacement only for the rows' new evidence lines, and waits unticked.
  check("C1 the same table again: nothing added, nothing changed (no duplicate rows)",
    d1?.added === 0 && d1.changed === 0 && d1.removed === 0 && d1.same === 2 && (tableOf(c1.proposal)?.value as VacancyTable).rows.length === 2 && !tableOf(c1.proposal)!.defaultTicked, [d1, tableOf(c1.proposal)?.action]);
  const c2 = await into(TABLE([AE]));
  const n2c = noteOf(c2.proposal) as Note & { diff?: { untouchedPosts?: string[] } };
  check("C2 a pasted table without one of the job's rows: the row is kept, never offered for removal",
    n2c.diff?.removed === 0 && (n2c.diff.untouchedPosts ?? []).includes("Junior Engineer") && (tableOf(c2.proposal)?.value as VacancyTable).rows.length === 2
    && !tableOf(c2.proposal)?.flags.some((f) => /Proposes removing/.test(f)), [n2c.diff, n2c.removalsHeld]);
  // A post-and-bank job, with a bank the pasted table leaves out: inside a post the pasted table names, the row is held.
  const banks = await preview({ ...newJob(), sources: [research(PREPARED("| Post | Bank | UR | SC | Total |\n| Clerk | Delta | 10 | 3 | 13 |\n| Clerk | Theta | 4 | 1 | 5 |"))] });
  const bankJob = await service.applyImportFlow({ importId: banks.importId, adminId, selected: banks.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null });
  const c2b = await preview({ mode: "EXISTING", recruitmentId: bankJob.recruitmentId, sources: [research(PREPARED("| Post | Bank | UR | SC | Total |\n| Clerk | Delta | 10 | 3 | 13 |"))] });
  const n2b = noteOf(c2b.proposal);
  check("C2 …a bank it leaves out inside a post it names: held, not removed",
    n2b.diff?.removed === 0 && n2b.removalsHeld === 1 && (tableOf(c2b.proposal)?.value as VacancyTable).rows.length === 2, [n2b.diff, n2b.removalsHeld]);
  const c3 = await into(TABLE([AE.replace("| 23 |", "| 24 |").replace("| 10 |", "| 11 |"), JE, "| Draughtsman | 2 | 0 | 1 | 0 | 1 | 4 |"]));
  const d3 = noteOf(c3.proposal).diff;
  check("C3 a changed figure and a new post: offered as a change and an addition, nothing removed",
    d3?.changed === 1 && d3.added === 1 && d3.removed === 0 && tableOf(c3.proposal)?.action === "REPLACE" && !tableOf(c3.proposal)!.defaultTicked, [d3, tableOf(c3.proposal)?.action]);
  const c4 = await into("| Post | Bank | UR | SC | Total |\n| Assistant Engineer | Delta Gramin Bank | 10 | 3 | 13 |");
  const n4 = noteOf(c4.proposal);
  check("C4 a pasted table split differently: the job's rows stand, the document's are held",
    !tableOf(c4.proposal) && n4.diff?.held === 1 && n4.diff.removed === 0 && c4.proposal.warnings.some((w) => /The job's table is split by Post; this document by Post › Bank/.test(w))
    && (await getRecruitmentById(applied.recruitmentId))!.vacancies.table!.value!.rows.length === 2, [n4.diff, c4.proposal.warnings]);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
