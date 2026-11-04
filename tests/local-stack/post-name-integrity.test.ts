// ═══════════════════════════════════════════════════════════
// Post names in vacancy tables, through the real preview, apply and
// database functions on the in-memory test database. No AI, no network.
//
// An official notice with three posts (21, 42 and 7 vacancies) gives three
// rows under their own posts and a total of 70 — before, all three took the
// job's title and the total was 21 — in the preview, the saved job, the
// reopened job and the public preview. A re-import changes the one figure
// that changed and removes nothing. A job saved with same-named rows (as the
// defect saved them) keeps them; the posts now read are added beside them.
// A table whose post cannot be read is held and proposes nothing.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/post-name-integrity.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";
import { analyseVacancyTable, type VacancyTable } from "@/lib/vacancy-table";

type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; flags: string[] };
type Note = { removalsHeld?: number; coverage: { tables: Array<{ read: boolean; why?: string }>; unreadLines: unknown[] };
  diff?: { added: number; changed: number; removed: number; same: number; untouchedPosts: string[] } };
type Proposal = { items: Item[]; warnings: string[]; meta: { sources: Array<{ vacancyTables: Note | null }> } };

const FRONT = "Test Public Service Commission\nRecruitment of Engineers 2099\nLast date to apply online: 30.06.2099";
const page = (...p: string[]) => p.map((x, i) => `${x}\n\n-- ${i + 1} of ${p.length} --\n`).join("\n");
const TABLE = (rows: string[]) => page(FRONT, `Details of vacancies\nName of Post UR EWS OBC SC ST Total\n${rows.join("\n")}`);
const AE = "Assistant Engineer 10 2 5 3 1 21", JE = "Junior Engineer 20 4 10 6 2 42", ST = "Stenographer 3 1 2 1 0 7";

const S = { A: "A: three posts, 70 vacancies", B: "B: re-imports", C: "C: a post that cannot be read" };
expectChecks(S.A, [
  "A1 the preview: three rows under their own posts, figures as printed, no duplicate rows",
  "A2 saved: the three posts, Total Vacancies 70 (before: 21)",
  "A3 reopened and on the public preview: the same three posts and 70",
]);
expectChecks(S.B, [
  "B1 one figure changed: offered as one change, nothing removed, unticked",
  "B2 a job saved with same-named rows: they are kept, never offered for removal",
  "B2 …and the posts now read are added beside them",
]);
expectChecks(S.C, [
  "C1 post and bank run together: no table offered, said why, nothing removed from the job",
]);

(async () => {
  const { adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { projectForPreview } = await import("@/lib/cms/projector");
  await setImporterEnabled(true);
  let year = 2800;
  const official = (text: string) => ({ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text, url: "https://tpsc.example.gov.in/notice.pdf", attestation: "Copied from the notice (post-name test)" });
  const preview = async (args: Record<string, unknown>) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const newJob = (title = "TEST RECORD Engineers") => ({ mode: "NEW", newJob: { organizationId: `pn-${year}`, organizationName: "Test Public Service Commission", recruitmentYear: year++, title, govType: "State Govt" } });
  const apply = (p: { importId: string; proposal: Proposal }) => service.applyImportFlow({ importId: p.importId, adminId, selected: p.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null });
  const tableOf = (p: Proposal) => p.items.find((i) => i.fieldPath === "vacancies.table");
  const posts = (t: VacancyTable | undefined | null) => (t?.rows ?? []).map((r) => `${r.at.post}:${r.total}`);
  const note = (p: Proposal) => p.meta.sources[0].vacancyTables!;

  section(S.A);
  const a = await preview({ ...newJob(), sources: [official(TABLE([AE, JE, ST]))] });
  const t = tableOf(a.proposal)?.value as VacancyTable;
  check("A1 the preview: three rows under their own posts, figures as printed, no duplicate rows",
    JSON.stringify(posts(t)) === JSON.stringify(["Assistant Engineer:21", "Junior Engineer:42", "Stenographer:7"]) && tableOf(a.proposal)!.defaultTicked
    && analyseVacancyTable(t).issues.every((i) => i.code !== "DUPLICATE_ROW") && t.rows[1].cells.obc === 10, posts(t));
  const applied = await apply(a);
  const saved = (await getRecruitmentById(applied.recruitmentId))!;
  check("A2 saved: the three posts, Total Vacancies 70 (before: 21)",
    saved.vacancies.total?.value === 70 && posts(saved.vacancies.table?.value).length === 3 && saved.vacancies.table?.status === "PENDING", [saved.vacancies.total?.value, posts(saved.vacancies.table?.value)]);
  const reopened = (await getRecruitmentById(applied.recruitmentId))!;
  const pub = projectForPreview(reopened);
  check("A3 reopened and on the public preview: the same three posts and 70",
    JSON.stringify(posts(pub.vacancies.table)) === JSON.stringify(posts(t)) && pub.vacancies.total === 70 && pub.vacancies.totalComplete === true, [pub.vacancies.total, posts(pub.vacancies.table)]);

  section(S.B);
  const b1 = await preview({ mode: "EXISTING", recruitmentId: applied.recruitmentId, sources: [official(TABLE([AE.replace(" 10 ", " 11 ").replace(" 21", " 22"), JE, ST]))] });
  const d1 = note(b1.proposal).diff!;
  check("B1 one figure changed: offered as one change, nothing removed, unticked",
    d1.changed === 1 && d1.removed === 0 && d1.same === 2 && d1.added === 0 && tableOf(b1.proposal)?.action === "REPLACE" && !tableOf(b1.proposal)!.defaultTicked, d1);
  // A job as the defect saved it: three rows all under the job's title (made here with a pasted table so named).
  const old = await preview({ ...newJob("TEST RECORD Old"), sources: [{ declaredKind: "RESEARCH", method: "paste", prepared: true,
    text: `TEST RECORD Old 2099\nLast date to apply online: 30.06.2099\n| Post | UR | Total |\n| TEST RECORD Old | 10 | 21 |\n| TEST RECORD Old | 20 | 42 |\n| TEST RECORD Old | 3 | 7 |` }] });
  const oldJob = await apply(old);
  const before = posts((await getRecruitmentById(oldJob.recruitmentId))!.vacancies.table?.value);
  const b2 = await preview({ mode: "EXISTING", recruitmentId: oldJob.recruitmentId, sources: [official(TABLE([AE, JE, ST]))] });
  const d2 = note(b2.proposal).diff!;
  const offered = tableOf(b2.proposal)?.value as VacancyTable | undefined;
  check("B2 a job saved with same-named rows: they are kept, never offered for removal",
    before.length === 3 && d2.removed === 0 && d2.untouchedPosts.includes("TEST RECORD Old") && posts(offered).filter((p) => p.startsWith("TEST RECORD Old")).length === 3
    && !tableOf(b2.proposal)?.flags.some((f) => /Proposes removing/.test(f)), [before, d2]);
  check("B2 …and the posts now read are added beside them",
    d2.added === 3 && ["Assistant Engineer:21", "Junior Engineer:42", "Stenographer:7"].every((p) => posts(offered).includes(p)) && !tableOf(b2.proposal)!.defaultTicked, posts(offered));

  section(S.C);
  const c1 = await preview({ mode: "EXISTING", recruitmentId: applied.recruitmentId,
    sources: [official(page(FRONT, "Vacancies\nName of Post Name of the Bank UR SC Total\nClerk Delta Gramin Bank 1 2 3\nClerk Epsilon Gramin Bank 2 1 3\nOfficer Delta Gramin Bank 1 1 2"))] });
  const n3 = note(c1.proposal);
  check("C1 post and bank run together: no table offered, said why, nothing removed from the job",
    !tableOf(c1.proposal) && n3.coverage.tables[0]?.read === false && /run together in one name/.test(n3.coverage.tables[0].why ?? "")
    && c1.proposal.warnings.some((w) => /was not read: each row's post and bank run together/.test(w))
    && (await getRecruitmentById(applied.recruitmentId))!.vacancies.table!.value!.rows.length === 3, [n3.coverage, c1.proposal.warnings]);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
