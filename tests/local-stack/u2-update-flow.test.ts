// ═══════════════════════════════════════════════════════════
// CMS 2.0 U2: an LN Update pasted into Smart Intake, through the real preview, apply and database functions on
// the in-memory test database, with the AI off (a fetch that counts any request). SYNTHETIC data only.
//   1. Add New Job from an LN Update: the same engine, every item new.
//   2. Update that job with a partial LN Update: only the items given change; everything else is kept.
//   3. Text about another job: nothing is offered.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/u2-update-flow.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; flags: string[] };
type Proposal = { items: Item[]; warnings: string[] };

const TITLE = "TEST RECORD U2 Combined Exam 2097";
const ORG = "Test U2 Selection Board";
const CREATE = `LN Update v1
Job: ${TITLE}
Organisation: ${ORG}
Update type: New recruitment
Source: Test notice, dated 1 Jan 2097

Exam Stages:
Stage: Tier-I | Status: Scheduled | Date: 10 Mar 2097 | Confirmed
Stage: Tier-II | Status: Not declared

Exam Pattern:
Stage: Tier-I | Mode: Computer Based | Duration: 60 minutes
Subject: English: 25 Questions, 50 Marks
Subject: Reasoning: 25 Questions, 50 Marks
Total: 50 Questions, 100 Marks

Syllabus:
Stage: Tier-I
Subject: English: Grammar; Vocabulary
Subject: Reasoning: Analogy; Series

Application Fee: General/EWS/OBC Rs. 500, SC/ST/PwBD/Women Nil

Important Links:
Apply Online: Portal A | https://a.example.gov.in/ | For: Graduates
`;
const UPDATE = `LN Update v1
Job: ${TITLE}
Organisation: ${ORG}
Update type: Schedule
Source: Test notice 2, dated 1 Feb 2097

Exam Stages:
Stage: Tier-I | Status: Conducted
Stage: Tier-II | Status: Scheduled | From: 5 May 2097 | Until: 7 May 2097 | Tentative

Syllabus:
Stage: Tier-I
Subject: Reasoning: Coding-decoding

Important Links:
Apply Online: Portal B | https://b.example.gov.in/ | For: Diploma holders
`;

const S = { A: "A: Add New Job from an LN Update", B: "B: a partial update of that job", C: "C: the wrong job" };
expectChecks(S.A, [
  "A1 stages, pattern, syllabus, fee table and both summary fees are offered and ticked (new job, all new)",
  "A1 …the apply link is offered unticked (its address is not on the board's trusted list: the usual rule)",
  "A2 no AI request was made",
  "A3 saved: the job holds what the text gave",
]);
expectChecks(S.B, [
  "B1 only the stages, the syllabus and the new link are offered; pattern and fees are not touched",
  "B2 the syllabus keeps English and Reasoning's topics, adding one",
  "B3 saved: Tier-I keeps its date, Tier-II has its window, both portals are on the job with who each is for",
  "B4 no AI request was made",
]);
expectChecks(S.C, ["C1 text about another job: no item, and the refusal is said"]);

(async () => {
  const { adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  await setImporterEnabled(true);
  let calls = 0;
  const noAi = (async () => { calls++; throw new Error("no AI in this test"); }) as unknown as typeof fetch;
  const preview = async (args: Record<string, unknown>) => {
    const p = await service.previewImport({ adminId, apiKey: "would-be-used-if-the-ai-ran", fetchFn: noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const paste = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text, prepared: true });
  const at = (p: Proposal, f: string) => p.items.filter((i) => i.fieldPath === f);

  section(S.A);
  const a = await preview({ mode: "NEW", newJob: { organizationId: "u2-test-board", organizationName: ORG, recruitmentYear: 2097, title: TITLE, govType: "Central Govt" }, sources: [paste(CREATE)] });
  const want = ["examStages", "examPattern", "syllabus", "financial.feeTable", "financial.feeGeneral", "financial.feeSCST"];
  check("A1 stages, pattern, syllabus, fee table and both summary fees are offered and ticked (new job, all new)",
    want.every((f) => at(a.proposal, f).length === 1 && at(a.proposal, f)[0].defaultTicked), a.proposal.items.map((i) => [i.fieldPath, i.action, i.defaultTicked]));
  const link = at(a.proposal, "links#APPLY_ONLINE");
  check("A1 …the apply link is offered unticked (its address is not on the board's trusted list: the usual rule)", link.length === 1 && !link[0].defaultTicked, link);
  check("A2 no AI request was made", calls === 0, calls);
  const created = await service.applyImportFlow({ importId: a.importId, adminId, selected: a.proposal.items.filter((i) => i.defaultTicked || i.fieldPath === "links#APPLY_ONLINE").map((i) => i.id), confirmReplaceVerified: false, override: null });
  const j1 = (await getRecruitmentById(created.recruitmentId))!;
  check("A3 saved: the job holds what the text gave",
    j1.examStages?.length === 2 && j1.syllabus?.value?.length === 2 && j1.examPattern?.value?.[0].sections.length === 2
    && j1.financial.feeTable?.value?.length === 2 && j1.financial.feeGeneral?.value === 500 && j1.financial.feeSCST?.value === 0
    && j1.links.some((l) => l.url === "https://a.example.gov.in/" && l.appliesTo === "Graduates"),
    { stages: j1.examStages, syl: j1.syllabus?.value, fee: j1.financial, links: j1.links });

  section(S.B);
  const b = await preview({ mode: "EXISTING", recruitmentId: created.recruitmentId, sources: [paste(UPDATE)] });
  const paths = [...new Set(b.proposal.items.filter((i) => i.action !== "MATCHES").map((i) => i.fieldPath))].sort();
  check("B1 only the stages, the syllabus and the new link are offered; pattern and fees are not touched",
    JSON.stringify(paths) === JSON.stringify(["examStages", "links#APPLY_ONLINE", "syllabus"]), b.proposal.items.map((i) => [i.fieldPath, i.action]));
  const syl = at(b.proposal, "syllabus")[0]?.value as Array<{ subject: string; topics: string[] }> | undefined;
  check("B2 the syllabus keeps English and Reasoning's topics, adding one",
    !!syl && JSON.stringify(syl.find((s) => s.subject === "English")?.topics) === JSON.stringify(["Grammar", "Vocabulary"])
    && JSON.stringify(syl.find((s) => s.subject === "Reasoning")?.topics) === JSON.stringify(["Analogy", "Series", "Coding-decoding"]), syl);
  const chosen = b.proposal.items.filter((i) => i.action !== "MATCHES").map((i) => i.id);
  const updated = await service.applyImportFlow({ importId: b.importId, adminId, selected: chosen, confirmReplaceVerified: false, override: null });
  const j2 = (await getRecruitmentById(updated.recruitmentId))!;
  const [t1, t2] = j2.examStages ?? [];
  check("B3 saved: Tier-I keeps its date, Tier-II has its window, both portals are on the job with who each is for",
    t1?.status === "CONDUCTED" && t1.dateIso === "2097-03-10" && t2?.dateIso === "2097-05-05" && t2.dateEndIso === "2097-05-07" && t2.certainty === "TENTATIVE"
    && j2.links.filter((l) => l.type === "APPLY_ONLINE").map((l) => l.appliesTo).join("|") === "Graduates|Diploma holders"
    && j2.examPattern?.value?.[0].sections.length === 2 && j2.financial.feeTable?.value?.length === 2,
    { stages: j2.examStages, links: j2.links });
  check("B4 no AI request was made", calls === 0, calls);

  section(S.C);
  const c = await preview({ mode: "EXISTING", recruitmentId: created.recruitmentId, sources: [paste(UPDATE.replace(`Organisation: ${ORG}`, "Organisation: Test Coal Company"))] });
  check("C1 text about another job: no item, and the refusal is said",
    c.proposal.items.length === 0 && c.proposal.warnings.some((w) => /another recruitment/.test(w)), c.proposal);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
