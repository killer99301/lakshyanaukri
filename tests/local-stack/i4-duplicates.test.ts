// ═══════════════════════════════════════════════════════════
// I4: the notice number and duplicates, through the real preview, apply and
// database functions on the in-memory test database. No AI, no network.
//
// Two different SSC examinations that cite the same DoPT notification are not
// duplicates of each other (before I4 the second was refused). A notice read
// twice still is. A number code doubts is offered unticked and is no identity
// in the preview; if the admin ticks it, it is checked when the job is saved,
// with the same override rule. The organisation-and-year check stays.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/i4-duplicates.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

type Item = { id: string; fieldPath: string; value: unknown; defaultTicked: boolean; flags: string[] };
type Proposal = { items: Item[]; meta: { duplicates: Array<{ reason: string; id: string }> } };

const CITE = "Candidates with benchmark disabilities will be considered in accordance with Notification No. 38-16/2020-DD-III dated 04.01.2021 of the Department of Empowerment of Persons with Disabilities.";
const ssc = (exam: string, fno: string) => `F. No. ${fno}: Staff Selection Commission will hold ${exam}.
Dates for submission of online applications: 09-06-2099 to 04-07-2099
Last date and time for receipt of online applications: 04-07-2099 (23:00)
${"The Commission invites applications from eligible candidates. ".repeat(3)}
${CITE}`;
// A labelled number deep in the text: code takes it, but doubts it.
const deep = (n: string) => `Test Board\nRecruitment of Clerks 2099\nLast date to apply online: 30.06.2099\n${"The Board invites applications for Clerk posts. ".repeat(80)}\nAdvertisement No. ${n}`;

const S = { A: "A: different notices citing one notification", B: "B: real duplicates", C: "C: a number code doubts" };
expectChecks(S.A, [
  "A1 SSC CGL: its own F. No. is offered, ticked, and saved",
  "A2 SSC CHSL citing the same DoPT notification: its own F. No., no duplicate listed",
  "A2 …and saved (before I4: refused as a duplicate of CGL)",
]);
expectChecks(S.B, [
  "B1 the CGL notice imported again: listed as a duplicate by its number",
  "B1 …and refused when saved",
]);
expectChecks(S.C, [
  "C1 a number away from the notice's opening: offered unticked, with why",
  "C1 …no duplicate listed by that number in the preview",
  "C2 the admin ticks it: refused when saved, as a duplicate by its number",
  "C2 …with an override reason it is saved, as before",
  "C3 the organisation-and-year check still runs when the number is doubted",
]);

(async () => {
  const { adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  await setImporterEnabled(true);
  const preview = async (org: string, year: number, title: string, text: string) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }),
      mode: "NEW", newJob: { organizationId: org, organizationName: "Staff Selection Commission", recruitmentYear: year, title, govType: "Central Govt" },
      sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text, url: "https://ssc.gov.in/notice.pdf", attestation: "Copied from the notice (I4 test)" }] } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const numberOf = (p: Proposal) => p.items.find((i) => i.fieldPath === "identity.notificationNumber");
  const apply = (importId: string, selected: string[], override: { reason: string } | null = null) =>
    service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override }).then((r) => r.recruitmentId as string).catch((e: Error & { code?: string }) => e);
  const ticked = (p: Proposal) => p.items.filter((i) => i.defaultTicked).map((i) => i.id);

  section(S.A);
  const cgl = await preview("ssc-i4-cgl", 2099, "TEST RECORD CGL 2099", ssc("Combined Graduate Level Examination, 2099", "HQ-C11018/1/2099-C-1"));
  const cglId = await apply(cgl.importId, ticked(cgl.proposal));
  const cglJob = typeof cglId === "string" ? await getRecruitmentById(cglId) : null;
  check("A1 SSC CGL: its own F. No. is offered, ticked, and saved",
    numberOf(cgl.proposal)?.value === "F. No. HQ-C11018/1/2099-C-1" && numberOf(cgl.proposal)!.defaultTicked && cglJob?.identity.notificationNumber?.value === "F. No. HQ-C11018/1/2099-C-1",
    [numberOf(cgl.proposal), cglId instanceof Error ? cglId.message : cglId]);
  const chsl = await preview("ssc-i4-chsl", 2099, "TEST RECORD CHSL 2099", ssc("Combined Higher Secondary Level Examination, 2099", "HQ-C12011/2/2099-C-2"));
  check("A2 SSC CHSL citing the same DoPT notification: its own F. No., no duplicate listed",
    numberOf(chsl.proposal)?.value === "F. No. HQ-C12011/2/2099-C-2" && chsl.proposal.meta.duplicates.length === 0, [numberOf(chsl.proposal), chsl.proposal.meta.duplicates]);
  const chslId = await apply(chsl.importId, ticked(chsl.proposal));
  check("A2 …and saved (before I4: refused as a duplicate of CGL)", typeof chslId === "string", chslId instanceof Error ? chslId.message : chslId);

  section(S.B);
  const again = await preview("ssc-i4-cgl-again", 2099, "TEST RECORD CGL 2099 again", ssc("Combined Graduate Level Examination, 2099", "HQ-C11018/1/2099-C-1"));
  check("B1 the CGL notice imported again: listed as a duplicate by its number",
    again.proposal.meta.duplicates.some((d) => d.reason === "notification_number" && d.id === cglId), again.proposal.meta.duplicates);
  const againId = await apply(again.importId, ticked(again.proposal));
  check("B1 …and refused when saved", againId instanceof Error && (againId as { code?: string }).code === "DUPLICATE", againId instanceof Error ? againId.message : againId);

  section(S.C);
  const first = await preview("board-i4-a", 2099, "TEST RECORD Board A", `Test Board\nAdvertisement No. 07/2099\nLast date to apply online: 30.06.2099\n${"The Board invites applications. ".repeat(4)}`);
  const firstId = await apply(first.importId, ticked(first.proposal));
  const doubted = await preview("board-i4-b", 2099, "TEST RECORD Board B", deep("07/2099"));
  const n = numberOf(doubted.proposal);
  check("C1 a number away from the notice's opening: offered unticked, with why",
    typeof firstId === "string" && n?.value === "07/2099" && !n.defaultTicked && n.flags.some((f) => /not in the notice's opening — check which number is this notice's own/.test(f)), [firstId, n]);
  check("C1 …no duplicate listed by that number in the preview", !doubted.proposal.meta.duplicates.some((d) => d.reason === "notification_number"), doubted.proposal.meta.duplicates);
  const refused = await apply(doubted.importId, [...ticked(doubted.proposal), n!.id]);
  check("C2 the admin ticks it: refused when saved, as a duplicate by its number",
    refused instanceof Error && (refused as { code?: string }).code === "DUPLICATE" && /already exists/.test(refused.message), refused instanceof Error ? refused.message : refused);
  const overridden = await apply(doubted.importId, [...ticked(doubted.proposal), n!.id], { reason: "A different board's notice that reuses the number (I4 test)" });
  check("C2 …with an override reason it is saved, as before", typeof overridden === "string", overridden instanceof Error ? overridden.message : overridden);
  const sameOrgYear = await preview("board-i4-a", 2099, "TEST RECORD Board A second", deep("08/2099"));
  check("C3 the organisation-and-year check still runs when the number is doubted",
    sameOrgYear.proposal.meta.duplicates.some((d) => d.reason === "org_year" && d.id === firstId), sameOrgYear.proposal.meta.duplicates);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
