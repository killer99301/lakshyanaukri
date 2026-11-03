// ═══════════════════════════════════════════════════════════
// I1: information prepared outside (by an AI or a person), pasted into Smart
// intake, read by code from its labelled lines — through the real preview,
// apply and database functions on the in-memory test database, with the AI
// off (no key, and a fetch that counts any request) or a stand-in.
//
// The source stays research, marked "prepared by AI/person" when the admin
// says so; values are quoted, Pending, ticked only where the usual rules tick
// a research value; a different value from the AI is a conflict; an existing
// value is never replaced unticked; the saved job reopens and projects.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/i1-prepared-intake.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; conflict: boolean; flags: string[]; claims: Array<{ retrievalId: string; quote?: string }> };
type Proposal = { items: Item[]; warnings: string[]; meta: { sources: Array<{ label: string; prepared?: boolean; declaredKind: string; refused: Array<{ fieldPath: string; reason: string }> }> } };

const PREPARED = `TEST RECORD Prepared Intake 2098 — summary prepared by ChatGPT
Last date to apply online: 09.02.2098
Selection: Written examination and interview
Pay Scale: ₹35,400–₹1,12,400
Age Limit: 18–35 years
Application Fee: General/OBC ₹600, SC/ST/PwBD ₹100
How to apply: Register on the website, fill in the form, pay the fee online
Eligibility: Bachelor's degree in any discipline`;
const FIELDS = ["financial.feeGeneral", "financial.feeSCST", "age", "financial.payScale", "selection", "howToApply"];

const S = { A: "A: prepared text, the AI off", B: "B: the usual rules", C: "C: saved and reopened" };
expectChecks(S.A, [
  "A1 the source is research, marked “prepared by AI/person” in the review",
  "A1 …and in the database it is research, never confirmed or attested",
  "A2 fees, age, pay, selection and how to apply are offered, each quoted from its line",
  "A2 …ticked (empty fields, no conflict), flagged as research and as read by code",
  "A2 …eligibility naming no post is said for the editor, not offered",
  "A3 no AI request was made",
  "A4 the mark is not given to an official source, nor to research the admin did not mark",
]);
expectChecks(S.B, [
  "B1 an official notice in the import that does not state the age: the research age waits unticked",
  "B2 the AI reads another fee: both shown, neither ticked",
  "B3 a job that already has a fee: the different research fee is offered as a replacement, unticked",
]);
expectChecks(S.C, [
  "C1 saved: the values are on the job, Pending",
  "C2 the public preview shows them",
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
  let year = 2600;
  const newJob = () => ({ mode: "NEW", newJob: { organizationId: `i1-${year}`, organizationName: "Test Public Service Commission", recruitmentYear: year++, title: "TEST RECORD I1", govType: "State Govt" } });
  const preview = async (args: Record<string, unknown>, apiKey?: string, fetchFn: typeof fetch = noAi) => {
    const p = await service.previewImport({ adminId, apiKey, fetchFn, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const research = (text: string, prepared = true) => ({ declaredKind: "RESEARCH", method: "paste", text, ...(prepared ? { prepared: true } : {}) });
  const official = (text: string) => ({ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text, url: "https://tpsc.example.gov.in/notice.pdf", attestation: "Copied from the notice (I1 test)", prepared: true });
  const items = (p: Proposal, f: string) => p.items.filter((i) => i.fieldPath === f);

  section(S.A);
  const a = await preview({ ...newJob(), sources: [research(PREPARED)] });
  const src = a.proposal.meta.sources[0];
  check("A1 the source is research, marked “prepared by AI/person” in the review",
    src.declaredKind === "RESEARCH" && src.prepared === true && /^pasted text — research, prepared by AI\/person$/.test(src.label), src);
  const stand = (await pg.query("SELECT authenticity, declared_kind FROM recruitment_source_retrievals WHERE import_id = $1", [a.importId])).rows;
  check("A1 …and in the database it is research, never confirmed or attested", stand.length === 1 && stand[0].authenticity === "NOT_APPLICABLE" && stand[0].declared_kind === "RESEARCH", stand);
  const offered = FIELDS.map((f) => items(a.proposal, f)[0]);
  check("A2 fees, age, pay, selection and how to apply are offered, each quoted from its line",
    offered.every((i) => i && i.claims.length === 1 && !!i.claims[0].quote && PREPARED.includes(i.claims[0].quote!))
    && offered[0]?.value === 600 && offered[1]?.value === 100 && offered[3]?.value === "₹35,400–₹1,12,400"
    && (offered[2]?.value as { min?: number; max?: number }).min === 18 && (offered[2]?.value as { max?: number }).max === 35, offered.map((i) => [i?.fieldPath, i?.value]));
  check("A2 …ticked (empty fields, no conflict), flagged as research and as read by code",
    offered.every((i) => i?.defaultTicked && i.action === "FILL" && i.flags.some((f) => /from research only/.test(f)) && i.flags.includes("read by code from a labelled line")), offered.map((i) => [i?.fieldPath, i?.defaultTicked, i?.flags]));
  check("A2 …eligibility naming no post is said for the editor, not offered",
    items(a.proposal, "eligibility").length === 0 && src.refused.some((r) => r.fieldPath === "eligibility" && /names no post/.test(r.reason)), src.refused);
  check("A3 no AI request was made", calls === 0, calls);
  const off = await preview({ ...newJob(), sources: [official(PREPARED), research(PREPARED, false)] });
  check("A4 the mark is not given to an official source, nor to research the admin did not mark",
    off.proposal.meta.sources.every((s) => !s.prepared && !/prepared by AI/.test(s.label)), off.proposal.meta.sources.map((s) => s.label));

  section(S.B);
  // The official notice from the organisation's own trusted address (ssc.gov.in), attested: an eligible official source.
  const officialNoAge = `Staff Selection Commission\nAdvertisement No. SSC/I1/09/2098\nLast date to apply online: 09.02.2098\n${"The Commission invites applications from eligible candidates. ".repeat(3)}`;
  const b1 = await preview({ mode: "NEW", newJob: { organizationId: "ssc", organizationName: "Staff Selection Commission", recruitmentYear: 2698, title: "TEST RECORD I1 SSC", govType: "Central Govt" },
    sources: [{ ...official(officialNoAge), url: "https://ssc.gov.in/notice-i1.pdf" }, research(PREPARED)] });
  const age = items(b1.proposal, "age")[0];
  check("B1 an official notice in the import that does not state the age: the research age waits unticked",
    !!age && !age.defaultTicked && age.flags.some((f) => /the official document in this import does not state this/.test(f)), age);
  // A stand-in for the whole-text reading only: it quotes an old fee line the labelled reading does not read.
  const withOld = `${PREPARED}\nOld fee (2096): General Rs 750`;
  const standIn = (async (_u: unknown, init?: RequestInit) => {
    const prompt = String(JSON.parse(String(init?.body ?? "{}")).contents?.[0]?.parts?.[0]?.text ?? "");
    const answer = prompt.includes('"vacancyRows"') ? { feeGeneral: { value: 750, quote: "Old fee (2096): General Rs 750" } } : {};
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const b2 = await preview({ ...newJob(), sources: [research(withOld)] }, "stand-in-not-a-key", standIn);
  const fees = items(b2.proposal, "financial.feeGeneral");
  check("B2 the AI reads another fee: both shown, neither ticked",
    JSON.stringify(fees.map((i) => i.value).sort()) === JSON.stringify([600, 750]) && fees.every((i) => i.conflict && !i.defaultTicked), fees.map((i) => [i.value, i.conflict, i.defaultTicked]));

  section(S.C);
  const applied = await service.applyImportFlow({ importId: a.importId, adminId, selected: a.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null });
  const job = (await getRecruitmentById(applied.recruitmentId))!;
  check("C1 saved: the values are on the job, Pending",
    job.financial.feeGeneral?.value === 600 && job.financial.feeSCST?.value === 100 && job.financial.payScale?.value === "₹35,400–₹1,12,400"
    && job.age?.value?.max === 35 && job.selection?.value?.stages?.length === 2 && (job.howToApply ?? []).length === 3
    && [job.financial.feeGeneral, job.financial.feeSCST, job.financial.payScale, job.age, job.selection].every((f) => f?.status === "PENDING"),
    [job.financial, job.age, job.selection, job.howToApply]);
  const pub = projectForPreview(job);
  check("C2 the public preview shows them",
    pub.financial.feeGeneral === 600 && pub.financial.feeSCST === 100 && pub.financial.payScale === "₹35,400–₹1,12,400" && !!pub.age && !!pub.selection && pub.howToApply.length === 3, pub.financial);

  section(S.B);
  const b3 = await preview({ mode: "EXISTING", recruitmentId: applied.recruitmentId, sources: [research(PREPARED.replace("₹600", "₹700"))] });
  const replace = items(b3.proposal, "financial.feeGeneral")[0];
  const same = items(b3.proposal, "financial.feeSCST")[0];
  check("B3 a job that already has a fee: the different research fee is offered as a replacement, unticked",
    replace?.action === "REPLACE" && !replace.defaultTicked && same?.action === "MATCHES", [replace, same]);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
