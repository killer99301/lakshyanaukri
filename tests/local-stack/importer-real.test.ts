// ═══════════════════════════════════════════════════════════
// The importer on six real kinds of recruitment notice
// ═══════════════════════════════════════════════════════════
//
// Through the real service and database functions, against the in-memory
// test database. The documents are fixtures laid out like the real notices
// (the LIC HFL lines are copied from the batch 10 PDF as the PDF reader gives
// them; the others follow the organisations' usual wording). The AI is
// replaced by answers that quote the source, so every value still passes the
// site's evidence checks. No network, no key.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/importer-real.test.ts
//   PROBE=1 … prints every proposed item.

import { boot, check, section, summary } from "./boot";
import { makePdf } from "./pdf-fixture";

type J = Record<string, unknown>;
type Answer = { value: unknown; evidence: string };

// ── The documents ─────────────────────────────────────────

const LIC_URL = "https://cdn.lichousing.com/2026/10/Apprentecis-Advertisement-Notification-Batch-10.pdf";
const LIC = makePdf([
  "P a g e 1 | 10\nLICHFL Apprenticeship Program-010- Advertisement Notification\nApplications are invited from fresh graduates from all Indian Universities /Institutes recognized\nby UGC/AICTE for engagement as an apprentice in various offices of LIC Housing Finance Limited\n1 Age as on 01-Oct-2026 20 to 25 years\n2 Educational Qualification Should have completed graduation in any stream as on",
  "portals of Government of India viz NATS portal https://nats.education.gov.in.in (Navigate\nto the Student Register/Login section)\nNATS portal refer to Candidate User Manual on\nhttps://nats.education.gov.in/assets/manual/student_manual.pdf\nsubmission of additional information at https://beep.bfsissc.com will be 01-Nov-2026\nlogin into the portal by visiting https://nats.education.gov.in/student_type.php . It is very",
  "S No Category Total Fee /\nCharges\n1 Scheduled Caste (SC) / Scheduled Tribe (ST) candidates Rs.200/-plus GST\n2 Person with Benchmark Disability (PwBD) candidates Rs.200/- plus GST\n3 General, EWS and Other Backward Class (OBC)-Male\ncandidates Rs.800/- plus GST",
  "Table D: Steps to apply & Important dates\nSteps Particular Date window Remarks\n1 Applications for apprenticeship\nwill be invited during\n20.10.2026 to\n01.11.2026\n2 Last Date to pay the examination\nfee to BFSI Sector Skill Council of\nIndia\n01.11.2026 All candidates who complete Step 1\n3 Entrance Examination will be\n07.11.2026 Online remote proctored",
  "Table E:\nState City Number of\nVacancies\nAssam Guwahati 3\nGrand Total 232",
]);
const LIC_RESEARCH = `LIC HFL Apprentice Recruitment 2026 - summary (ChatGPT research)
Online application: 01.10.2026 to 30.10.2026
Last date to apply online: 30.10.2026
Apply at https://nats.education.gov.in
Source: https://www.bankersadda.com/lic-hfl-apprentice-recruitment-2026/`;

const SSC_URL = "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_CGL_2026.pdf";
const SSC = makePdf([
  "F. No. HQ-PPII03/7/2026-PP_II\nStaff Selection Commission\nCombined Graduate Level Examination, 2026\nImportant Dates\nDates for submission of online applications: 09-06-2026 to 04-07-2026\nLast date and time for receipt of online applications: 04-07-2026 (23:00)\nLast date and time for making online fee payment: 05-07-2026 (23:00)\nDates of Window for Application Form Correction: 09-07-2026 to 11-07-2026",
  "Fee payable: Rs. 100/- (Rs One Hundred only).\nWomen candidates and candidates belonging to SC, ST, PwBD and ESM are exempted from payment of fee.\nApply online only at the official website https://ssc.gov.in\nAge limit: 18-32 years as on 01-08-2026\nEssential Qualification: Bachelor's Degree from a recognized University",
]);
const SSC_RESEARCH = `SSC CGL 2026 quick facts (from a coaching site)
Last date to apply online: 07-07-2026
Application fee: Rs 100
Apply: https://www.adda247.com/jobs/ssc-cgl-2026/?utm_source=chatgpt.com`;
const SSC_CORR_URL = "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Corrigendum_CGL_2026.pdf";
const SSC_CORR = makePdf(["Corrigendum\nF. No. HQ-PPII03/7/2026-PP_II\nCombined Graduate Level Examination, 2026\nThe last date for receipt of online applications is extended to 11-07-2026 (23:00).\nAll other terms and conditions remain unchanged."]);

const UPSC_URL = "https://upsc.gov.in/sites/default/files/Notif-CSP-26-engl.pdf";
const UPSC = makePdf([
  "Examination Notice No. 05/2026-CSP Dated: 14.02.2026\nCivil Services Examination, 2026\nThe Online Applications can be filled up to 06.03.2026 till 6:00 PM\nCandidates are required to apply online by using the website https://upsconline.gov.in",
  "Fee: Candidates have to pay a fee of Rs. 100/- (Rupees One Hundred only)\nFemale/SC/ST/Persons with Benchmark Disability candidates are exempted from payment of fee.\nAge Limits: must have attained 21 years and must not have attained 32 years on 1st August, 2026\nEducational Qualification: The candidate must hold a degree of any of Universities",
]);

const BPSC_URL = "https://bpsc.bihar.gov.in/advt/72nd-cce";
const BPSC_HTML = `<html><head><title>BPSC 72nd CCE</title></head><body>
<h2>Advt. No. 22/2026</h2>
<p>72nd Combined (Preliminary) Competitive Examination</p>
<p>Online application start date: 01.10.2026</p>
<p>Last date for online application: 30.10.2026</p>
<p>Application fee for General candidates Rs. 600/-</p>
<p>Application fee for SC/ST candidates of Bihar Rs. 150/-</p>
<p>Age: 20 to 37 years as on 01.08.2026</p>
<p>Qualification: Graduation from a recognised university</p>
<p>Apply Online: <a href="https://onlinebpsc.bihar.gov.in/">https://onlinebpsc.bihar.gov.in/</a></p>
<p>Notification: <a href="https://bpsc.bihar.gov.in/Advt/22-2026.pdf">https://bpsc.bihar.gov.in/Advt/22-2026.pdf</a></p>
</body></html>`;

const WALKIN_URL = "https://aiimspatna.edu.in/advertisement/walkin-sr-2026.pdf";
const WALKIN = makePdf([
  "All India Institute of Medical Sciences, Patna\nWalk-in-Interview for the post of Senior Resident (Non-Academic)\nDate of Walk-in-Interview: 15.11.2026 at 10:00 AM\nNo application fee is charged.\nAge: Not exceeding 45 years as on 15.11.2026\nQualification: MD/MS/DNB in the concerned discipline\nCandidates should report with original documents. No online application is required.",
]);

// ── The stand-in for the AI ───────────────────────────────
// Each answer is given only when its quote is in the prompt it was asked,
// exactly as the real model must quote the source.

const DATES_ANSWERS: Record<string, Answer[]> = {
  applicationFeeGeneral: [
    { value: 800, evidence: "candidates Rs.800/- plus GST" },
    { value: 100, evidence: "Fee payable: Rs. 100/- (Rs One Hundred only)." },
    { value: 100, evidence: "Application fee: Rs 100" },
    { value: 100, evidence: "Candidates have to pay a fee of Rs. 100/- (Rupees One Hundred only)" },
    { value: 600, evidence: "Application fee for General candidates Rs. 600/-" },
    { value: 0, evidence: "No application fee is charged." },
  ],
  applicationFeeSCST: [
    { value: 200, evidence: "Scheduled Tribe (ST) candidates Rs.200/-plus GST" },
    { value: 0, evidence: "Women candidates and candidates belonging to SC, ST, PwBD and ESM are exempted from payment of fee." },
    { value: 0, evidence: "Female/SC/ST/Persons with Benchmark Disability candidates are exempted from payment of fee." },
    { value: 150, evidence: "Application fee for SC/ST candidates of Bihar Rs. 150/-" },
    { value: 0, evidence: "No application fee is charged." },
  ],
  applicationOpenDate: [
    { value: "2026-10-01", evidence: "Online application: 01.10.2026 to 30.10.2026" },
    { value: "2026-06-09", evidence: "Dates for submission of online applications: 09-06-2026 to 04-07-2026" },
    { value: "2026-10-01", evidence: "Online application start date: 01.10.2026" },
  ],
  applicationCloseDate: [
    { value: "2026-10-30", evidence: "Last date to apply online: 30.10.2026" },
    { value: "2026-07-04", evidence: "Last date and time for receipt of online applications: 04-07-2026 (23:00)" },
    { value: "2026-07-07", evidence: "Last date to apply online: 07-07-2026" },
    { value: "2026-07-11", evidence: "The last date for receipt of online applications is extended to 11-07-2026 (23:00)." },
    { value: "2026-03-06", evidence: "The Online Applications can be filled up to 06.03.2026 till 6:00 PM" },
    { value: "2026-10-30", evidence: "Last date for online application: 30.10.2026" },
  ],
  feePaymentCloseDate: [
    { value: "2026-07-05", evidence: "Last date and time for making online fee payment: 05-07-2026 (23:00)" },
  ],
  correctionWindowEnd: [
    { value: "2026-07-11", evidence: "Dates of Window for Application Form Correction: 09-07-2026 to 11-07-2026" },
  ],
  notificationNumber: [
    { value: "F. No. HQ-PPII03/7/2026-PP_II", evidence: "F. No. HQ-PPII03/7/2026-PP_II" },
    { value: "05/2026-CSP", evidence: "Examination Notice No. 05/2026-CSP Dated: 14.02.2026" },
  ],
};

const DETAIL_ANSWERS: J[] = [
  { key: "age", quote: "1 Age as on 01-Oct-2026 20 to 25 years", value: { min: 20, max: 25, asOf: "2026-10-01", relaxations: [] } },
  { key: "eligibility", quote: "Should have completed graduation in any stream", value: [{ post: "Apprentice", qualification: "Graduation in any stream" }] },
  { key: "age", quote: "Age limit: 18-32 years as on 01-08-2026", value: { min: 18, max: 32, asOf: "2026-08-01", relaxations: [] } },
  { key: "eligibility", quote: "Essential Qualification: Bachelor's Degree from a recognized University", value: [{ post: "All posts", qualification: "Bachelor's degree" }] },
  { key: "age", quote: "Age Limits: must have attained 21 years and must not have attained 32 years on 1st August, 2026", value: { min: 21, max: 32, asOf: "2026-08-01", relaxations: [] } },
  { key: "eligibility", quote: "The candidate must hold a degree of any of Universities", value: [{ post: "Civil Services", qualification: "A degree from a recognised university" }] },
  { key: "age", quote: "Age: 20 to 37 years as on 01.08.2026", value: { min: 20, max: 37, asOf: "2026-08-01", relaxations: [] } },
  { key: "eligibility", quote: "Qualification: Graduation from a recognised university", value: [{ post: "Combined Competitive Examination", qualification: "Graduation" }] },
  { key: "age", quote: "Age: Not exceeding 45 years as on 15.11.2026", value: { max: 45, asOf: "2026-11-15", relaxations: [] } },
  { key: "eligibility", quote: "Qualification: MD/MS/DNB in the concerned discipline", value: [{ post: "Senior Resident", qualification: "MD/MS/DNB in the concerned discipline" }] },
];

// The whole-text reading (smart intake): one answer per document, each part
// used only when its quote is in the prompt.
const ARTICLE_ANSWERS: J[] = [
  { feeGeneral: { value: 0, quote: "No application fee is charged." } },
  { age: { max: 45, asOf: "2026-11-15", quote: "Age: Not exceeding 45 years as on 15.11.2026" } },
  { eligibility: [{ post: "Senior Resident", qualifications: ["MD/MS/DNB in the concerned discipline"], quote: "Qualification: MD/MS/DNB in the concerned discipline" }] },
  { selectionStages: [{ name: "Walk-in-Interview", type: "INTERVIEW", quote: "Walk-in-Interview for the post of Senior Resident (Non-Academic)" }] },
  { examStages: [{ name: "Walk-in-Interview", date: "2026-11-15", dateText: "15.11.2026 at 10:00 AM", quote: "Date of Walk-in-Interview: 15.11.2026 at 10:00 AM" }] },
  { notes: [{ text: "Candidates should report with original documents.", quote: "Candidates should report with original documents." }] },
  { vacancyRows: [{ post: "Apprentice", count: 232, quote: "Grand Total 232", categories: [{ category: "Assam Guwahati", count: 3, quote: "Assam Guwahati 3" }] }] },
];

const squash = (s: string) => s.replace(/\s+/g, " ");

function fakeGemini(prompt: string): J {
  const sections = prompt.split(/^## Section: /m).slice(1).map((s) => ({ heading: s.split("\n")[0].trim(), text: squash(s) }));
  const at = (quote: string) => sections.find((s) => s.text.includes(squash(quote)))?.heading;
  if (prompt.includes('"vacancyRows"')) {
    const text = squash(prompt);
    const quotes = (v: unknown): string[] => (v && typeof v === "object" ? Object.entries(v as J).flatMap(([k, x]) => (k === "quote" ? [String(x)] : quotes(x))) : []);
    const out: J = {};
    for (const a of ARTICLE_ANSWERS) if (quotes(a).every((q) => text.includes(squash(q)))) Object.assign(out, a);
    return out;
  }
  if (prompt.includes('"applicationFeeGeneral"')) {
    const out: J = {};
    for (const [key, answers] of Object.entries(DATES_ANSWERS)) {
      const hit = answers.find((a) => at(a.evidence));
      if (hit) out[key] = { value: hit.value, evidence: hit.evidence, sectionHeading: at(hit.evidence) };
    }
    return out;
  }
  if (prompt.includes('"howToApply"')) {
    const out: J = {};
    for (const a of DETAIL_ANSWERS) {
      const q = String(a.quote);
      if (out[String(a.key)] || !at(q)) continue;
      out[String(a.key)] = a.key === "eligibility"
        ? (a.value as J[]).map((e) => ({ ...e, evidence: q }))
        : { ...(a.value as J), evidence: q };
    }
    return out;
  }
  return {};
}

// ── The run ───────────────────────────────────────────────

(async () => {
  const { adminId } = await boot();
  process.env.GEMINI_API_KEY = "test-key-not-real";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("generativelanguage.googleapis.com")) return realFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = body.contents?.[0]?.parts?.map((p: { text?: string }) => p.text ?? "").join("\n") ?? "";
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fakeGemini(prompt)) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const files: Record<string, { bytes: Buffer; type: string }> = {
    [LIC_URL]: { bytes: LIC, type: "application/pdf" },
    [SSC_URL]: { bytes: SSC, type: "application/pdf" },
    [SSC_CORR_URL]: { bytes: SSC_CORR, type: "application/pdf" },
    [BPSC_URL]: { bytes: Buffer.from(BPSC_HTML, "utf8"), type: "text/html; charset=utf-8" },
    [WALKIN_URL]: { bytes: WALKIN, type: "application/pdf" },
  };
  const fetchSourceFn = async (url: string) => files[url]
    ? { ok: true as const, finalUrl: url, contentType: files[url].type, bytes: files[url].bytes }
    : { ok: false as const, error: "blocked (403)" };

  const service = await import("@/lib/cms/importer/service");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { TRUSTED_DOMAINS } = await import("@/lib/cms/importer/trusted-domains");
  type Preview = Awaited<ReturnType<typeof service.previewImport>>;
  type Item = Preview["proposal"]["items"][number];
  const apiKey = process.env.GEMINI_API_KEY;

  const probe = (name: string, p: Preview) => {
    if (!process.env.PROBE) return;
    console.log(`\n[probe] ${name}`);
    for (const i of p.proposal.items) console.log(`  ${i.fieldPath} = ${JSON.stringify(i.value).slice(0, 110)} | ${i.action}${i.conflict ? " CONFLICT" : ""}${i.defaultTicked ? " ticked" : ""} | ${i.flags.join("; ")}`);
    for (const s of (p.proposal as unknown as { meta: { sources: J[] } }).meta.sources) console.log(`  source: ${s.label} ${s.authenticity} ${s.originRole}`);
  };
  const get = (p: Preview, f: string, v?: unknown): Item | undefined => p.proposal.items.find((i) => i.fieldPath === f && (v === undefined || JSON.stringify(i.value) === JSON.stringify(v)));
  const links = (p: Preview) => p.proposal.items.filter((i) => i.kind === "LINK").map((i) => ({ ...(i.value as { type: string; url: string; official: boolean }), ticked: i.defaultTicked, flags: i.flags }));
  const link = (p: Preview, url: string) => links(p).find((l) => l.url === url);
  const sources = (p: Preview) => (p.proposal as unknown as { meta: { sources: Array<{ authenticity: string; originRole: string; id: string }> } }).meta.sources;
  const apply = async (p: Preview, selected: string[], confirmReplaceVerified = false) =>
    service.applyImportFlow({ importId: p.importId, adminId, selected, confirmReplaceVerified, override: null });
  const ticked = (p: Preview) => p.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id);
  const checks = async (id: string) => service.checksFor((await getRecruitmentById(id))!);
  const verify = async (id: string, fieldPath: string, retrievalId: string, quote: string | null, page: number | null) => {
    const c = await checks(id);
    const row = c.rows.find((r) => r.fieldPath === fieldPath)!;
    return service.decide({ recruitmentId: id, adminId, fieldPath, kind: "ADMIN_VERIFIED", retrievalId, page, quote, tableCell: null, reviewScope: null, justification: null, publicNote: null, seen: { revisionId: row.latestRevisionId, decisionId: row.decisionId ?? null } });
  };
  const notApplicable = async (id: string, fieldPath: string, retrievalId: string, quote: string, justification: string) => {
    const c = await checks(id);
    const row = c.rows.find((r) => r.fieldPath === fieldPath)!;
    return service.decide({ recruitmentId: id, adminId, fieldPath, kind: "ADMIN_NOT_APPLICABLE", retrievalId, page: 1, quote, tableCell: null, reviewScope: null, justification, publicNote: null, seen: { revisionId: row.latestRevisionId, decisionId: row.decisionId ?? null } });
  };
  const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return (e as Error).message; } };

  // ── 1. LIC HFL Apprentice: the real batch 10 notice + ChatGPT research ──
  section("LIC HFL Apprentice 2026: real PDF layout, partner portals, research conflict");
  const lic = await service.previewImport({
    adminId, mode: "NEW", apiKey, fetchSourceFn,
    newJob: { organizationId: "lic-hfl", organizationName: "LIC Housing Finance Limited", recruitmentYear: 2026, title: "LIC HFL Apprentice Recruitment 2026", govType: "PSU" },
    sources: [
      { declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: LIC_URL },
      { declaredKind: "RESEARCH", method: "paste", text: LIC_RESEARCH },
    ],
  });
  probe("LIC", lic);
  check("no notification number made from the word \"Notification\"", !get(lic, "identity.notificationNumber"), get(lic, "identity.notificationNumber"));
  check("last date: the PDF's 1 Nov against research 30 Oct → a conflict, nothing ticked",
    get(lic, "dates.applicationCloseDate", "2026-11-01")?.conflict === true && get(lic, "dates.applicationCloseDate", "2026-10-30")?.conflict === true
    && !get(lic, "dates.applicationCloseDate", "2026-11-01")!.defaultTicked);
  check("fees 800 / 200 quoted from page 3", get(lic, "financial.feeGeneral", 800)?.claims[0].page === 3 && get(lic, "financial.feeSCST", 200)?.claims[0].page === 3);
  check("age and eligibility from page 1, ticked", get(lic, "age")?.claims[0].page === 1 && get(lic, "age")!.defaultTicked && get(lic, "eligibility")?.defaultTicked === true);
  check("the notice's own address is the notification link, official and ticked", link(lic, LIC_URL)?.type === "OFFICIAL_NOTIFICATION" && link(lic, LIC_URL)?.official === true && link(lic, LIC_URL)?.ticked === true, link(lic, LIC_URL));
  check("NATS student page → Apply Online, official (partner for applications), ticked", link(lic, "https://nats.education.gov.in/student_type.php")?.type === "APPLY_ONLINE" && link(lic, "https://nats.education.gov.in/student_type.php")?.ticked === true);
  check("the NATS user manual is not the notification", link(lic, "https://nats.education.gov.in/assets/manual/student_manual.pdf")?.type === "OTHER");
  check("the misprinted .in.in address is not official and not ticked", link(lic, "https://nats.education.gov.in.in/")?.official === false && link(lic, "https://nats.education.gov.in.in/")?.ticked === false, link(lic, "https://nats.education.gov.in.in/"));
  check("the exam partner's site is neither notification nor website", link(lic, "https://beep.bfsissc.com/")?.type === "OTHER");
  check("the portal link from research is flagged and not ticked", (link(lic, "https://www.bankersadda.com/lic-hfl-apprentice-recruitment-2026/")?.flags ?? []).some((f) => /portal/.test(f)) && link(lic, "https://www.bankersadda.com/lic-hfl-apprentice-recruitment-2026/")?.ticked === false);
  check("no link anywhere says tracking was removed", links(lic).every((l) => !l.flags.includes("tracking removed")));
  const licJob = await apply(lic, [...ticked(lic), get(lic, "dates.applicationCloseDate", "2026-11-01")!.id]);
  const licPdf = sources(lic)[0];
  check("applied: a new draft, gated until checked", !!licJob.recruitmentId && (await checks(licJob.recruitmentId)).ok === false);
  check("the vacancy breakdown is filled from the whole-text reading", (get(lic, "vacancies.breakdown")?.value as J[] | undefined)?.[0]?.count === 232);
  check("no missing-link warning: the notice and the apply link are official", lic.proposal.warnings.every((w) => !/link/.test(w)), lic.proposal.warnings);

  // ── 2. SSC CGL: dashed dates, a fee exemption, research from a coaching site ──
  section("SSC CGL 2026: file number, dashed dates, exemption, coaching-site research");
  const ssc = await service.previewImport({
    adminId, mode: "NEW", apiKey, fetchSourceFn,
    newJob: { organizationId: "ssc", organizationName: "Staff Selection Commission", recruitmentYear: 2026, title: "SSC CGL 2026", govType: "Central Govt" },
    sources: [
      { declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: SSC_URL },
      { declaredKind: "RESEARCH", method: "paste", text: SSC_RESEARCH },
    ],
  });
  probe("SSC", ssc);
  check("file number taken as written", get(ssc, "identity.notificationNumber")?.value === "F. No. HQ-PPII03/7/2026-PP_II", get(ssc, "identity.notificationNumber"));
  check("last date 4 Jul (PDF) against 7 Jul (research) → a conflict", get(ssc, "dates.applicationCloseDate", "2026-07-04")?.conflict === true && get(ssc, "dates.applicationCloseDate", "2026-07-07")?.conflict === true);
  check("fee payment deadline and correction window kept apart from the last date", get(ssc, "dates.feePaymentCloseDate")?.value === "2026-07-05" && get(ssc, "dates.correctionWindowEnd")?.value === "2026-07-11");
  check("the fee exemption is a fee of 0 for SC/ST, quoted", get(ssc, "financial.feeSCST")?.value === 0 && /exempted/.test(get(ssc, "financial.feeSCST")!.claims[0].quote ?? ""));
  check("research and PDF agree on fee 100 → one item, not a conflict", ssc.proposal.items.filter((i) => i.fieldPath === "financial.feeGeneral").length === 1 && !get(ssc, "financial.feeGeneral")!.conflict);
  check("ssc.gov.in → official website, ticked", link(ssc, "https://ssc.gov.in/")?.type === "OFFICIAL_WEBSITE" && link(ssc, "https://ssc.gov.in/")?.ticked === true, links(ssc));
  check("the coaching-site link loses its tracking and is flagged", link(ssc, "https://www.adda247.com/jobs/ssc-cgl-2026/")?.flags.includes("tracking removed") === true && link(ssc, "https://www.adda247.com/jobs/ssc-cgl-2026/")?.ticked === false);
  const sscJob = await apply(ssc, [...ticked(ssc), get(ssc, "dates.applicationCloseDate", "2026-07-04")!.id]);
  const sscPdf = sources(ssc)[0];
  check("the last date is checked against the PDF", !!(await verify(sscJob.recruitmentId, "dates.applicationCloseDate", sscPdf.id, "Last date and time for receipt of online applications: 04-07-2026 (23:00)", 1)));
  const sscFields = (await checks(sscJob.recruitmentId)).fields;
  check("editor badges: the checked last date is VERIFIED, the PDF's fee is SUPPORTED, the CMS status stays Pending",
    sscFields["dates.applicationCloseDate"] === "VERIFIED" && sscFields["financial.feeGeneral"] === "SUPPORTED"
    && (await getRecruitmentById(sscJob.recruitmentId))!.dates.applicationCloseDate?.status === "PENDING", sscFields);
  check("research cannot support a check", /confirmed or attested/.test(await refused(() => verify(sscJob.recruitmentId, "financial.feeGeneral", sources(ssc)[1].id, "Application fee: Rs 100", null)) ?? ""));

  // ── 6. A revised notice: the SSC corrigendum extends the last date ──
  section("Revised notice: SSC corrigendum extends the last date of a checked job");
  const corr = await service.previewImport({
    adminId, mode: "EXISTING", recruitmentId: sscJob.recruitmentId, apiKey, fetchSourceFn,
    sources: [{ declaredKind: "OFFICIAL_CORRIGENDUM", method: "url", url: SSC_CORR_URL, versionLabel: "Corrigendum 1" }],
  });
  probe("SSC corrigendum", corr);
  const ext = get(corr, "dates.applicationCloseDate", "2026-07-11");
  check("11 Jul replaces the checked 4 Jul and supersedes its claim", ext?.action === "REPLACE_VERIFIED" && (ext?.supersedes.length ?? 0) >= 1, ext);
  check("the corrigendum's heading is not proposed as the title", !get(corr, "identity.title"));
  check("the corrigendum's own address is offered as a corrigendum link", link(corr, SSC_CORR_URL)?.type === "CORRIGENDUM");
  check("replacing a checked value needs the second confirmation", /confirm/i.test(await refused(() => apply(corr, [ext!.id])) ?? ""));
  await apply(corr, [ext!.id], true);
  const afterCorr = await checks(sscJob.recruitmentId);
  check("after the corrigendum the last date needs a new check", afterCorr.rows.find((r) => r.fieldPath === "dates.applicationCloseDate")?.cls !== "VERIFIED", afterCorr.rows.find((r) => r.fieldPath === "dates.applicationCloseDate"));
  check("…and can be checked against the corrigendum", !!(await verify(sscJob.recruitmentId, "dates.applicationCloseDate", sources(corr)[0].id, "extended to 11-07-2026 (23:00)", 1)));
  check("the record holds 11 Jul", (await getRecruitmentById(sscJob.recruitmentId))!.dates.applicationCloseDate?.value === "2026-07-11");

  // ── 3. UPSC CSE: the site blocks the server; an upload, then the admin's word ──
  section("UPSC CSE 2026: server blocked, uploaded copy, attestation");
  const blocked = await refused(() => service.previewImport({
    adminId, mode: "NEW", apiKey, fetchSourceFn,
    newJob: { organizationId: "upsc", organizationName: "Union Public Service Commission", recruitmentYear: 2026, title: "UPSC Civil Services 2026", govType: "Central Govt" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: UPSC_URL }],
  }));
  check("a blocked address is reported, nothing saved", /blocked/.test(blocked ?? ""), blocked);
  const upscNew = { organizationId: "upsc", organizationName: "Union Public Service Commission", recruitmentYear: 2026, title: "UPSC Civil Services 2026", govType: "Central Govt" as const };
  const upsc = await service.previewImport({
    adminId, mode: "NEW", apiKey, fetchSourceFn, newJob: upscNew,
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: UPSC, url: UPSC_URL }],
  });
  probe("UPSC upload", upsc);
  check("an upload the server never saw is UNCONFIRMED", sources(upsc)[0].authenticity === "UNCONFIRMED");
  check("the notice number is read by the AI with its quote", get(upsc, "identity.notificationNumber")?.value === "05/2026-CSP");
  check("\"filled up to 06.03.2026\" is the last date", get(upsc, "dates.applicationCloseDate")?.value === "2026-03-06");
  check("upsconline.gov.in is an official link for UPSC", link(upsc, "https://upsconline.gov.in/")?.official === true, links(upsc));
  const upscJob = await apply(upsc, ticked(upsc));
  check("an unconfirmed copy cannot support a check", /confirmed or attested/.test(await refused(() => verify(upscJob.recruitmentId, "age", sources(upsc)[0].id, "must not have attained 32 years on 1st August, 2026", 2)) ?? ""));
  const attested = await service.previewImport({
    adminId, mode: "EXISTING", recruitmentId: upscJob.recruitmentId, apiKey, fetchSourceFn,
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: UPSC, url: UPSC_URL, attestation: "I downloaded this from upsc.gov.in myself on 25 Oct 2026" }],
  });
  check("with the admin's word it is ATTESTED", sources(attested)[0].authenticity === "ATTESTED");
  await apply(attested, ticked(attested));
  check("…and an attested copy can support a check", !!(await verify(upscJob.recruitmentId, "age", sources(attested)[0].id, "must not have attained 32 years on 1st August, 2026", 2)));

  // ── 4. BPSC: an official web page, not a PDF ──
  section("BPSC 72nd CCE: official HTML page with links");
  const bpsc = await service.previewImport({
    adminId, mode: "NEW", apiKey, fetchSourceFn,
    newJob: { organizationId: "bpsc", organizationName: "Bihar Public Service Commission", recruitmentYear: 2026, title: "BPSC 72nd CCE 2026", govType: "State Govt" },
    sources: [{ declaredKind: "OFFICIAL_PAGE", method: "url", url: BPSC_URL }],
  });
  probe("BPSC", bpsc);
  check("the page is CONFIRMED (fetched by the server) and BPSC's own", sources(bpsc)[0].authenticity === "CONFIRMED" && sources(bpsc)[0].originRole === "AUTHORITY");
  check("Advt. No. read from the page", /22\/2026/.test(String(get(bpsc, "identity.notificationNumber")?.value ?? "")), get(bpsc, "identity.notificationNumber"));
  check("dates, fees, age and eligibility proposed", get(bpsc, "dates.applicationCloseDate")?.value === "2026-10-30" && get(bpsc, "financial.feeGeneral")?.value === 600 && get(bpsc, "financial.feeSCST")?.value === 150 && !!get(bpsc, "age") && !!get(bpsc, "eligibility"));
  check("the notification PDF on BPSC's site is the notification link", link(bpsc, "https://bpsc.bihar.gov.in/Advt/22-2026.pdf")?.type === "OFFICIAL_NOTIFICATION" && link(bpsc, "https://bpsc.bihar.gov.in/Advt/22-2026.pdf")?.official === true);
  check("the online portal named \"Apply Online\" is the apply link", link(bpsc, "https://onlinebpsc.bihar.gov.in/")?.type === "APPLY_ONLINE", link(bpsc, "https://onlinebpsc.bihar.gov.in/"));
  check("an official page is not offered as the notification link", link(bpsc, BPSC_URL) === undefined);

  // ── 5. Interview only: a walk-in, from an organisation not on the trusted list ──
  section("Walk-in interview (AIIMS Patna): no online form, no fee, unlisted organisation");
  const walkNew = { organizationId: "aiims-patna", organizationName: "AIIMS Patna", recruitmentYear: 2026, title: "AIIMS Patna Senior Resident Walk-in 2026", govType: "Central Govt" as const };
  const walk = await service.previewImport({
    adminId, mode: "NEW", apiKey, fetchSourceFn, newJob: walkNew,
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: WALKIN_URL }],
  });
  probe("Walk-in", walk);
  check("fetched by the server, but the host is not on the trusted list", sources(walk)[0].authenticity === "CONFIRMED" && sources(walk)[0].originRole === "UNLISTED");
  check("no last date to apply is invented from the interview date", !get(walk, "dates.applicationCloseDate"), get(walk, "dates.applicationCloseDate"));
  check("no fee: 0, quoted", get(walk, "financial.feeGeneral")?.value === 0);
  check("selection: the interview only, so no written exam", (get(walk, "selection")?.value as J)?.noWrittenExam === true, get(walk, "selection")?.value);
  const stage = (get(walk, "examStages")?.value as J[] | undefined)?.[0];
  check("exam stage: the walk-in on 15 Nov 2026, scheduled", stage?.dateIso === "2026-11-15" && stage?.status === "SCHEDULED", stage);
  check("the notice's rule is kept as an admin note", JSON.stringify(get(walk, "conditions")?.value) === JSON.stringify(["Candidates should report with original documents."]));
  check("age and eligibility come from the whole-text reading (the topic readers found no section)", (get(walk, "age")?.value as J)?.max === 45 && !!get(walk, "eligibility"));
  check("the preview warns: no official notification or apply link", walk.proposal.warnings.some((w) => /notification link/.test(w)) && walk.proposal.warnings.some((w) => /apply link/.test(w)), walk.proposal.warnings);
  check("its own address is offered, but not as official", link(walk, WALKIN_URL)?.official === false && link(walk, WALKIN_URL)?.ticked === false);
  const walkJob = await apply(walk, ticked(walk));
  const walkPdf = sources(walk)[0];
  check("an unlisted host cannot support a check", /not trusted/.test(await refused(() => verify(walkJob.recruitmentId, "age", walkPdf.id, "Age: Not exceeding 45 years as on 15.11.2026", 1)) ?? ""));
  check("…nor \"not applicable\"", /not trusted/.test(await refused(() => notApplicable(walkJob.recruitmentId, "links#APPLY_ONLINE", walkPdf.id, "No online application is required.", "Walk-in interview; there is no online form")) ?? ""));
  // Once its host is added to the list in code (a later preview freezes the new role):
  TRUSTED_DOMAINS["aiims-patna"] = [{ host: "aiimspatna.edu.in", role: "AUTHORITY", purposes: ["all"] }];
  const walk2 = await service.previewImport({ adminId, mode: "EXISTING", recruitmentId: walkJob.recruitmentId, apiKey, fetchSourceFn, sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: WALKIN_URL }] });
  await apply(walk2, ticked(walk2));
  const listed = sources(walk2)[0].id;
  check("listed: age and eligibility can be checked", !!(await verify(walkJob.recruitmentId, "age", listed, "Age: Not exceeding 45 years as on 15.11.2026", 1))
    && !!(await verify(walkJob.recruitmentId, "eligibility", listed, "Qualification: MD/MS/DNB in the concerned discipline", 1)));
  for (const f of ["dates.applicationCloseDate", "links#APPLY_ONLINE", "dates.applicationOpenDate", "dates.feePaymentCloseDate"]) {
    await notApplicable(walkJob.recruitmentId, f, listed, "No online application is required.", "Walk-in interview; there is no online form");
  }
  for (const f of ["financial.feeGeneral", "financial.feeSCST"]) await notApplicable(walkJob.recruitmentId, f, listed, "No application fee is charged.", "No fee for a walk-in");
  const walkGate = await checks(walkJob.recruitmentId);
  check("with the notice link checked and vacancies still open, the gate names only those",
    JSON.stringify(walkGate.rows.filter((r) => !(r.cls === "VERIFIED" || r.cls === "NOT_APPLICABLE" || (r.cls === "NOT_STATED" && r.tier === "B"))).map((r) => r.fieldPath).sort())
      === JSON.stringify(["links#OFFICIAL_NOTIFICATION", "vacancies.total"]), walkGate.rows.map((r) => `${r.fieldPath}:${r.cls}`));

  // ── All six land as drafts; nothing is published ──
  section("Nothing published");
  const states = await Promise.all([licJob, sscJob, upscJob, walkJob].map(async (j) => (await getRecruitmentById(j.recruitmentId))!.draftState));
  check("every imported job is still a draft", states.every((s) => s === "DRAFT"), states);
  void licPdf;
  summary();
})().catch((e) => { console.error(e); process.exit(1); });
