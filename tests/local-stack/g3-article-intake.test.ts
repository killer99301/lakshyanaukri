// ═══════════════════════════════════════════════════════════
// G3 on the in-memory test database: the two pasted articles through Smart
// intake (preview, save as draft), and further sources added to the saved
// job: an attested official notice that fills gaps and exposes a different
// date, a checked value protected from a later research paste. No AI, no
// network, no Telegram.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/g3-article-intake.test.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { boot, check, expectChecks, section, summary } from "./boot";

type Item = { id: string; fieldPath: string; value: unknown; defaultTicked: boolean; conflict: boolean; action: string; flags: string[] };
type Prop = { items: Item[]; meta: { sources: Array<{ refused: Array<{ fieldPath: string; reason: string }> }> } };

const ADDA = readFileSync("tests/fixtures/articles/adda247-south-indian-bank-jo-2026.txt", "utf8");
const GJG = readFileSync("tests/fixtures/articles/govtjobguru-sbi-am-fire-2026.txt", "utf8");
// A constructed official notice for the multi-source checks (not SBI's real notice): attested by the admin.
const OFFICIAL = [
  "STATE BANK OF INDIA", "CENTRAL RECRUITMENT & PROMOTION DEPARTMENT", "RECRUITMENT OF SPECIALIST CADRE OFFICER (TEST NOTICE FOR G3)",
  "Advertisement No: CRPD/SCO/2026-27/29", "Online Registration: 04.11.2026 to 30.11.2026",
  "Age Limit: Minimum 21 years, Maximum 40 years as on 31.10.2026", "Application Fee: General/EWS/OBC Rs. 750/-; SC/ST/PwBD Nil",
].join("\n");

const S = { A: "A: Adda247, South Indian Bank", B: "B: GovtJobGuru, SBI", C: "C: more sources into the saved job" };
expectChecks(S.A, [
  "A1 the preview offers the dates, fees, age, eligibility, selection, steps and notes, ticked; the age (its birth date does not fit) unticked",
  "A2 the CTC is not offered: 7.85 and 7.83 lakh both in Left out; no vacancy total, “Not Specified” said",
  "A3 saved as a draft: the values are Pending, from research; none is verified or can be checked",
]);
expectChecks(S.B, [
  "B1 the preview offers notice number, dates, fees, age, eligibility, selection, exam pattern and steps; the vacancy table with the category split",
  "B2 the links are the sbi.bank.in addresses as written, never ticked; the “Click Here” links are said, none made up",
  "B3 saved as a draft: eligibility, exam pattern, selection, steps and notes on the job; the total 17 waits for its check",
]);
expectChecks(S.C, [
  "C1 an attested official notice into the job: the same values match, the official fee for SC/ST/PwBD fills in, a different last date is shown, not ticked",
  "C2 the age checked against the official notice; a research paste with another age: offered as replacing a checked value, never ticked",
  "C3 nothing published, no decision made by the imports",
]);

(async () => {
  const { pg, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  await setImporterEnabled(true);
  const fetchSourceFn = async () => ({ ok: false as const, error: "no network in this test" });
  const preview = async (args: Record<string, unknown>, sources: Array<Record<string, unknown>>) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, fetchSourceFn, ...args, sources } as never);
    return { ...p, prop: p.proposal as unknown as Prop };
  };
  const items = (p: { prop: Prop }, path: string) => p.prop.items.filter((i) => i.fieldPath === path);
  const ticked = (p: { prop: Prop }, path: string) => items(p, path).filter((i) => i.defaultTicked);
  const left = (p: { prop: Prop }, path: string) => p.prop.meta.sources.flatMap((s) => s.refused).filter((r) => r.fieldPath === path).map((r) => r.reason).join(" ");
  const save = async (p: { importId: string; prop: Prop }, extra: (i: Item) => boolean = () => false) =>
    String((await service.applyImportFlow({ importId: p.importId, adminId, selected: p.prop.items.filter((i) => i.defaultTicked || extra(i)).map((i) => i.id), confirmReplaceVerified: false, override: null })).recruitmentId);
  const research = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text });

  // ── A ──
  section(S.A);
  const a = await preview({ mode: "NEW", newJob: { organizationId: "south-indian-bank", organizationName: "South Indian Bank", recruitmentYear: 2026, title: "South Indian Bank Junior Officer Recruitment 2026", govType: "PSU" } }, [research(ADDA)]);
  const want = ["dates.applicationOpenDate", "dates.applicationCloseDate", "financial.feeGeneral", "financial.feeSCST", "eligibility", "selection", "howToApply", "conditions"];
  check("A1 the preview offers the dates, fees, age, eligibility, selection, steps and notes, ticked; the age (its birth date does not fit) unticked",
    want.every((f) => ticked(a, f).length === 1) && items(a, "age").length === 1 && !items(a, "age")[0].defaultTicked && items(a, "age")[0].flags.some((f) => /born on or after/.test(f))
    && items(a, "dates.applicationOpenDate")[0].value === "2026-11-06" && items(a, "dates.applicationCloseDate")[0].value === "2026-11-13",
    a.prop.items.map((i) => [i.fieldPath, i.defaultTicked]));
  check("A2 the CTC is not offered: 7.85 and 7.83 lakh both in Left out; no vacancy total, “Not Specified” said",
    items(a, "financial.payScale").length === 0 && /7\.85 lakh/.test(left(a, "financial.payScale")) && /7\.83 lakh/.test(left(a, "financial.payScale"))
    && items(a, "vacancies.total").length === 0 && /Not Specified/.test(left(a, "vacancies.total")), [left(a, "financial.payScale"), left(a, "vacancies.total")]);
  const aJob = await save(a);
  const aChecks = await service.checksFor((await getRecruitmentById(aJob))!);
  const aRec = (await getRecruitmentById(aJob))!;
  check("A3 saved as a draft: the values are Pending, from research; none is verified or can be checked",
    aRec.dates.applicationCloseDate?.value === "2026-11-13" && aRec.dates.applicationCloseDate?.status === "PENDING" && (aRec.howToApply?.length ?? 0) === 10
    && aChecks.rows.every((r) => r.cls !== "VERIFIED") && aChecks.rows.filter((r) => r.value !== null && r.value !== undefined).every((r) => r.cls === "RESEARCH_ONLY")
    && aChecks.rows.every((r) => r.evidence.prefill === null && r.evidence.suggestions.length === 0),
    aChecks.rows.map((r) => [r.fieldPath, r.cls]));

  // ── B ──
  section(S.B);
  const b = await preview({ mode: "NEW", newJob: { organizationId: "sbi", organizationName: "State Bank of India", recruitmentYear: 2026, title: "SBI Assistant Manager Engineer (Fire) Recruitment 2026", govType: "PSU" } }, [research(GJG)]);
  const bWant = ["identity.notificationNumber", "dates.applicationOpenDate", "dates.applicationCloseDate", "dates.feePaymentCloseDate", "financial.feeGeneral", "financial.payScale", "age", "eligibility", "selection", "examPattern", "howToApply", "conditions", "vacancies.table"];
  const table = items(b, "vacancies.table")[0]?.value as { rows: Array<{ at: { post: string }; total: number; cells: Record<string, number> }> } | undefined;
  check("B1 the preview offers notice number, dates, fees, age, eligibility, selection, exam pattern and steps; the vacancy table with the category split",
    bWant.every((f) => ticked(b, f).length === 1) && items(b, "identity.notificationNumber")[0].value === "CRPD/SCO/2026-27/29"
    && JSON.stringify(table?.rows.map((r) => [r.at.post, r.total, r.cells])) === JSON.stringify([["Assistant Manager - Engineer (Fire)", 17, { sc: 2, st: 2, obc: 1, ews: 1, ur: 11 }]])
    && items(b, "financial.feeSCST")[0]?.value === 0 && !items(b, "financial.feeSCST")[0].defaultTicked,
    b.prop.items.map((i) => [i.fieldPath, i.defaultTicked, i.conflict]));
  const links = b.prop.items.filter((i) => i.fieldPath.startsWith("links#"));
  check("B2 the links are the sbi.bank.in addresses as written, never ticked; the “Click Here” links are said, none made up",
    links.length === 2 && links.every((l) => !l.defaultTicked && /^https:\/\/sbi\.bank\.in\//.test((l.value as { url: string }).url))
    && /no address in the pasted text/.test(left(b, "links#APPLY_ONLINE")), links.map((l) => l.value));
  const bJob = await save(b);
  const bRec = (await getRecruitmentById(bJob))!;
  check("B3 saved as a draft: eligibility, exam pattern, selection, steps and notes on the job; the total 17 waits for its check",
    bRec.eligibility?.value?.[0]?.post === "Assistant Manager - Engineer (Fire)" && (bRec.examPattern?.value?.[0]?.sections.length ?? 0) === 2
    && (bRec.selection?.value?.stages?.length ?? 0) === 2 && (bRec.conditions?.items?.length ?? 0) >= 10 && bRec.vacancies.table?.value?.rows.length === 1
    && bRec.vacancies.total?.value === 17 && bRec.identity.notificationNumber?.value === "CRPD/SCO/2026-27/29",
    { total: bRec.vacancies.total, table: bRec.vacancies.table?.value?.rows.length, conditions: bRec.conditions?.items?.length });

  // ── C ──
  section(S.C);
  const c = await preview({ mode: "EXISTING", recruitmentId: bJob }, [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: OFFICIAL, url: "https://sbi.bank.in/documents/g3-test-notice.pdf", attestation: "Copied from the notice (G3 test)" }]);
  const close = items(c, "dates.applicationCloseDate");
  check("C1 an attested official notice into the job: the same values match, the official fee for SC/ST/PwBD fills in, a different last date is shown, not ticked",
    items(c, "identity.notificationNumber")[0]?.action === "MATCHES" && items(c, "age")[0]?.action === "MATCHES"
    && items(c, "financial.feeSCST")[0]?.action === "FILL" && items(c, "financial.feeSCST")[0]?.value === 0
    && close.length === 1 && close[0].value === "2026-11-30" && close[0].action === "REPLACE" && !close[0].defaultTicked,
    c.prop.items.map((i) => [i.fieldPath, i.action, i.defaultTicked, JSON.stringify(i.value).slice(0, 40)]));
  await save(c);
  // A value checked against the recruiting body's own notice is protected: a listed body (IBPS), its notice attested.
  const ibps = await preview({ mode: "NEW", newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2097, title: "TEST RECORD G3 IBPS", govType: "PSU" } },
    [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", url: "https://www.ibps.in/g3-test-notice.pdf", attestation: "Copied from the notice (G3 test)",
      text: "Institute of Banking Personnel Selection\nCommon Recruitment Process (G3 test notice)\nAge Limit: Minimum 20 years, Maximum 30 years as on 01.07.2026\nOnline Registration: 01.07.2026 to 21.07.2026" }]);
  const ibpsJob = await save(ibps);
  const ck = await service.checksFor((await getRecruitmentById(ibpsJob))!);
  const ageRow = ck.rows.find((r) => r.fieldPath === "age")!;
  let decided = "";
  try {
    await service.decide({ recruitmentId: ibpsJob, adminId, fieldPath: "age", kind: "ADMIN_VERIFIED", retrievalId: ck.retrievals[0].id, page: null,
      quote: "Age Limit: Minimum 20 years, Maximum 30 years as on 01.07.2026", tableCell: null, reviewScope: null, justification: null, publicNote: null,
      seen: { revisionId: ageRow.latestRevisionId, decisionId: ageRow.decisionId ?? null } });
    decided = "VERIFIED";
  } catch (e) { decided = `refused: ${(e as Error).message}`; }
  const d = await preview({ mode: "EXISTING", recruitmentId: ibpsJob }, [research("A coaching site's summary of the IBPS recruitment, for the G3 test of a later research paste.\nAge Limit: 21 to 32 years as on 01.07.2026")]);
  const age = items(d, "age")[0];
  check("C2 the age checked against the official notice; a research paste with another age: offered as replacing a checked value, never ticked",
    decided === "VERIFIED" && !!age && age.action === "REPLACE_VERIFIED" && !age.defaultTicked, { decided, action: age?.action, ticked: age?.defaultTicked });
  const published = (await pg.query("SELECT count(*)::int AS n FROM published_recruitments")).rows[0].n;
  const decisions = (await pg.query("SELECT count(*)::int AS n FROM recruitment_field_claims WHERE kind IN ('ADMIN_VERIFIED','ADMIN_NOT_APPLICABLE','ADMIN_NOT_STATED')")).rows[0].n;
  check("C3 nothing published, no decision made by the imports", published === 0 && decisions === 1, { published, decisions });

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
