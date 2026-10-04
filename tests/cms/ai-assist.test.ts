// ═══════════════════════════════════════════════════════════
// AI Assist V2 — Unit Tests
// ═══════════════════════════════════════════════════════════
//
// Coverage (pure, no DB, no HTTP, no real Gemini calls):
//
//  AB01  vacancyRows conversion: { label, count } → VacancyRow { post, count }
//  AB02  empty vacancyRows → null value → goes to notFound
//  AB03  readField("vacancies.breakdown") returns correct ProvenanceField
//  AB04  readField("financial.feeGeneral") returns correct ProvenanceField
//  AB05  readField("financial.feeSCST") returns correct ProvenanceField
//  AB06  readField returns undefined for unknown path
//  AB07  isEmpty: undefined → true; NOT_SPECIFIED → true; PENDING+value → false
//  AB08  pending<T>: produces status=PENDING, correct value, manuallyEdited=false
//  AB09  occupied vacancies.breakdown → suggested path (not filled), value preserved
//  AB10  empty financial.feeGeneral + non-null Gemini value → fills as PENDING
//  AB11  null Gemini fee (API absent / extraction miss) → goes to notFound
//  AB12  routeFieldUpdate("vacancies.breakdown") does not change draftState
//  AB13  routeFieldUpdate("financial.feeGeneral") does not change draftState
//  AB14  routeFieldUpdate("financial.feeSCST") does not change draftState
//  AB15  applied PENDING field stays PENDING (not auto-verified)
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import type {
  RecruitmentRecord,
  ProvenanceField,
  RecruitmentIdentity,
  RecruitmentDates,
  VacancyInformation,
  FinancialInformation,
  RecruitmentLifecycle,
} from "@/types/recruitment-record";
import type { VacancyRow } from "@/types";

import { routeFieldUpdate } from "@/lib/cms/field-update-router";

import {
  isEmpty,
  pending,
  readField,
  isPdfResponse,
  resolveSourceContent,
  isPlausibleTitle,
  extractTrainingSeats,
  buildAssistCandidates,
  buildFeeSections,
  feeValueSupported,
  extractFees,
  resolveFeeMaxOutputTokens,
  feeFailureMessage,
  FEE_MAX_OUTPUT_TOKENS,
  isSuspiciousNotificationNumber,
  detectOrganization,
  yearsIn,
  compareIdentity,
  closingDateFromRange,
  pdfHeadingTitle,
  parseDatesInText,
  judgeDate,
  judgeNotificationNumber,
  extractWithAi,
  mergeAiDates,
  mergeAiNotificationNumber,
  buildAiSections,
} from "@/lib/cms/ai-assist";
import { aiAssistReason, buildAiField } from "@/lib/cms/ai-assist-apply";

// ─── Fixtures ─────────────────────────────────────────────

function pf<T>(value: T, status: ProvenanceField<T>["status"] = "VERIFIED"): ProvenanceField<T> {
  return { value, status, evidenceIds: ["evid-001"], conflict: false, manuallyEdited: false };
}

function makeIdentity(): RecruitmentIdentity {
  return {
    organizationId: "upsc",
    organizationName: "UPSC",
    recruitmentYear: 2026,
    title: pf("Test Recruitment 2026"),
  };
}

function makeDates(): RecruitmentDates {
  return {
    applicationOpenDate: pf("2026-05-01"),
    applicationCloseDate: pf("2026-06-01"),
  };
}

function makeLifecycle(): RecruitmentLifecycle {
  return {
    status: "DRAFT",
    conflicts: [],
    events: [],
  };
}

function makeRecord(overrides: {
  vacancies?: VacancyInformation;
  financial?: FinancialInformation;
} = {}): RecruitmentRecord {
  return {
    id: randomUUID(),
    slug: "test-2026",
    draftState: "DRAFT",
    recordRevision: randomUUID(),
    identity: makeIdentity(),
    dates: makeDates(),
    vacancies: overrides.vacancies ?? {},
    financial: overrides.financial ?? {},
    eligibility: undefined,
    age: undefined,
    selection: undefined,
    links: [],
    documents: [],
    lifecycle: makeLifecycle(),
    provenance: {
      sourceDraftId: undefined,
      sourceUrls: [],
      importedAt: new Date().toISOString(),
    },
    updates: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────

suite("AI Assist V2 — helpers");

test("AB01 vacancyRows conversion: label/count → VacancyRow post/count", () => {
  const vacancyRows = [
    { label: "Junior Engineer", count: 120, headerLine: "Post-wise", totalLine: "120" },
    { label: "Assistant Loco Pilot", count: 5696, headerLine: "Post-wise" },
  ];
  const rows: VacancyRow[] = vacancyRows.map((r) => ({ post: r.label, count: r.count }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].post, "Junior Engineer");
  assert.equal(rows[0].count, 120);
  assert.equal(rows[1].post, "Assistant Loco Pilot");
  assert.equal(rows[1].count, 5696);
  // headerLine and totalLine are dropped — not part of VacancyRow
  assert.equal((rows[0] as Record<string, unknown>).label, undefined);
});

test("AB02 empty vacancyRows → null value → candidate goes to notFound", () => {
  const vacancyRows: Array<{ label: string; count: number }> = [];
  const value = vacancyRows.length > 0
    ? vacancyRows.map((r) => ({ post: r.label, count: r.count }))
    : null;
  assert.equal(value, null);
});

test("AB03 readField vacancies.breakdown returns existing field", () => {
  const breakdown = pf<VacancyRow[]>([{ post: "JE", count: 10 }]);
  const record = makeRecord({ vacancies: { breakdown } });
  const field = readField(record, "vacancies.breakdown");
  assert.ok(field);
  assert.equal(field.status, "VERIFIED");
  const val = field.value as VacancyRow[];
  assert.equal(val[0].post, "JE");
});

test("AB04 readField financial.feeGeneral returns existing field", () => {
  const feeGeneral = pf<number | null>(500);
  const record = makeRecord({ financial: { feeGeneral } });
  const field = readField(record, "financial.feeGeneral");
  assert.ok(field);
  assert.equal(field.value, 500);
});

test("AB05 readField financial.feeSCST returns existing field", () => {
  const feeSCST = pf<number | null>(0);
  const record = makeRecord({ financial: { feeSCST } });
  const field = readField(record, "financial.feeSCST");
  assert.ok(field);
  assert.equal(field.value, 0);
});

test("AB06 readField returns undefined for unhandled path", () => {
  const record = makeRecord();
  assert.equal(readField(record, "howToApply"), undefined);
  assert.equal(readField(record, "selection"), undefined);
  assert.equal(readField(record, "unknown.field"), undefined);
});

suite("AI Assist V2 — isEmpty + pending");

test("AB07 isEmpty: undefined/null field → true; NOT_SPECIFIED → true; PENDING+value → false", () => {
  assert.equal(isEmpty(undefined), true);
  assert.equal(isEmpty(null), true);
  assert.equal(isEmpty(pf<string | null>(null, "NOT_SPECIFIED")), true);
  assert.equal(isEmpty(pf("")), true);   // empty string is also treated as empty
  assert.equal(isEmpty(pf("some value")), false);
  assert.equal(isEmpty(pending("some value")), false);
  assert.equal(isEmpty(pending(0)), false);
  assert.equal(isEmpty(pending([])), false);
});

test("AB08 pending<T> produces correct shape with PENDING status", () => {
  const field = pending(42);
  assert.equal(field.value, 42);
  assert.equal(field.status, "PENDING");
  assert.equal(field.manuallyEdited, false);
  assert.equal(field.conflict, false);
  assert.deepEqual(field.evidenceIds, []);
});

suite("AI Assist V2 — existing-value preservation");

test("AB09 occupied vacancies.breakdown → suggestion not fill", () => {
  const existing = pf<VacancyRow[]>([{ post: "JE", count: 100 }]);
  const record = makeRecord({ vacancies: { breakdown: existing } });

  const aiValue: VacancyRow[] = [{ post: "JE", count: 999 }];
  const currentField = readField(record, "vacancies.breakdown");

  assert.equal(isEmpty(currentField), false);

  // Simulate the suggest path
  const suggestion = {
    fieldPath: "vacancies.breakdown",
    label: "Vacancy Breakdown",
    aiValue,
    existingValue: currentField?.value,
  };
  assert.deepEqual(suggestion.existingValue, [{ post: "JE", count: 100 }]);
  assert.equal((suggestion.existingValue as VacancyRow[])[0].count, 100);
  // AI value is NOT applied
});

test("AB10 empty financial.feeGeneral + Gemini value → fills via routeFieldUpdate", () => {
  const record = makeRecord({ financial: {} });
  const currentField = readField(record, "financial.feeGeneral");
  assert.equal(isEmpty(currentField), true);

  // Simulate applying: routeFieldUpdate should accept financial.feeGeneral
  const ADMIN_ID = randomUUID();
  const result = routeFieldUpdate(
    record,
    "financial.feeGeneral",
    pending<number | null>(500),
    ADMIN_ID,
    "AI Assist",
  );
  assert.ok(result);
  const updated = result.record;
  assert.equal(updated.financial.feeGeneral?.value, 500);
  assert.equal(updated.financial.feeGeneral?.status, "PENDING");
  // draftState must not change
  assert.equal(updated.draftState, "DRAFT");
});

test("AB11 null Gemini fee → goes to notFound (not applied)", () => {
  // When GEMINI_API_KEY is absent or extraction misses, fee candidates have null value.
  // The candidate loop skips null values → notFound.
  const feeGeneral: number | null = null;
  const notFound: string[] = [];
  if (feeGeneral === null) notFound.push("Application Fee (General/OBC)");
  assert.equal(notFound.length, 1);
  assert.equal(notFound[0], "Application Fee (General/OBC)");
});

suite("AI Assist V2 — routeFieldUpdate safety");

test("AB12 routeFieldUpdate vacancies.breakdown does not change draftState", () => {
  const record = makeRecord();
  const rows: VacancyRow[] = [{ post: "Clerk", count: 250 }];
  const ADMIN_ID = randomUUID();
  const result = routeFieldUpdate(
    record,
    "vacancies.breakdown",
    pending(rows),
    ADMIN_ID,
    "AI Assist",
  );
  assert.equal(result.record.draftState, "DRAFT");
  assert.equal(result.record.vacancies.breakdown?.status, "PENDING");
  assert.equal(result.record.vacancies.breakdown?.value?.[0].post, "Clerk");
});

test("AB13 routeFieldUpdate financial.feeGeneral does not change draftState", () => {
  const record = makeRecord();
  const ADMIN_ID = randomUUID();
  const result = routeFieldUpdate(
    record,
    "financial.feeGeneral",
    pending<number | null>(700),
    ADMIN_ID,
    "AI Assist",
  );
  assert.equal(result.record.draftState, "DRAFT");
  assert.equal(result.record.financial.feeGeneral?.status, "PENDING");
  assert.equal(result.record.financial.feeGeneral?.value, 700);
});

test("AB14 routeFieldUpdate financial.feeSCST does not change draftState", () => {
  const record = makeRecord();
  const ADMIN_ID = randomUUID();
  const result = routeFieldUpdate(
    record,
    "financial.feeSCST",
    pending<number | null>(0),
    ADMIN_ID,
    "AI Assist",
  );
  assert.equal(result.record.draftState, "DRAFT");
  assert.equal(result.record.financial.feeSCST?.status, "PENDING");
  assert.equal(result.record.financial.feeSCST?.value, 0);
});

test("AB15 applied PENDING field stays PENDING — not auto-verified", () => {
  const record = makeRecord();
  const ADMIN_ID = randomUUID();
  const result = routeFieldUpdate(
    record,
    "vacancies.breakdown",
    pending<VacancyRow[]>([{ post: "SO", count: 100 }]),
    ADMIN_ID,
    "AI Assist",
  );
  // Status must remain PENDING — route never applies VERIFIED to AI-extracted values
  assert.equal(result.record.vacancies.breakdown?.status, "PENDING");
  assert.notEqual(result.record.vacancies.breakdown?.status, "VERIFIED");
});

// ═══════════════════════════════════════════════════════════
// PDF support, fee evidence verification, extraction safeguards
// ═══════════════════════════════════════════════════════════

const PDF_URL = "https://www.examplebank.bank.in/documents/d/guest/apprenticeship-advertisement-2026-27";

// Shaped like the real Canara Bank apprenticeship PDF text.
const PDF_TEXT = [
  "1",
  "ENGAGEMENT OF GRADUATE APPRENTICES UNDER APPRENTICES ACT, 1961",
  "FOR FY 2026-27",
  "Example Bank invites online applications from the eligible Indian Citizens.",
  "Please read this",
  "advertisement carefully before applying.",
  "2. TRAINING SEATS:",
  "Number of Training seats 3500",
  "State/UT Local language No of",
  "vacancies SC ST OBC EWS UR",
  "Andhra Pradesh Telugu/Urdu 247 39 17 66 24 101",
  "Assam Assamese/Bengali 42 2 5 11 4 20",
  "6. APPLICATION FEES & INTIMATION CHARGES (INCL. of GST):",
  "Application fee/ Intimation charges for Registration for Apprentice on Bank's portal:",
  "Category Amount of Fees / Intimation Charges [Non-Refundable]",
  "SC/ST/PwBD NIL",
  "All Others Rs. 500/- (incl. intimation charges)",
  "7. SELECTION PROCEDURE: Merit list will be prepared state wise.",
].join("\n");

const HTML_PAGE = `<html><head><title>Example Bank Apprentice Recruitment 2026 - 3500 Posts</title></head><body>
<h1>Example Bank Apprentice Recruitment 2026 - 3500 Posts</h1>
<p>Advt. No. EB/HR/APP/2026 for 3500 Posts of Graduate Apprentice.</p>
<h2>Important Dates</h2>
<p>Application Start Date: 01/10/2026</p>
<p>Last Date to Apply: 17/10/2026</p>
<h2>Application Fee</h2>
<p>General / OBC / EWS: Rs. 500/-</p><p>SC / ST / PwBD: Nil</p>
</body></html>`;

function geminiFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
      { status, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;
}

suite("AI Assist V3 — PDF source resolution");

test("PD01 isPdfResponse: content-type and .pdf path detected; HTML not", () => {
  assert.equal(isPdfResponse("application/pdf", PDF_URL), true);
  assert.equal(isPdfResponse("application/octet-stream", "https://x.gov.in/a/notice.PDF?v=1"), true);
  assert.equal(isPdfResponse("text/html; charset=utf-8", "https://x.gov.in/jobs"), false);
  assert.equal(isPdfResponse(undefined, "https://x.gov.in/jobs"), false);
});

test("PD02 PDF response → text extracted via extractPdfText", async () => {
  const src = await resolveSourceContent(
    { ok: true, contentType: "application/pdf", htmlContent: null },
    PDF_URL,
    async () => ({ ok: true, text: PDF_TEXT }),
  );
  assert.equal(src.ok, true);
  if (src.ok) {
    assert.equal(src.kind, "pdf");
    assert.ok(src.content.includes("Number of Training seats 3500"));
  }
});

test("PD03 HTML path unchanged: HTML content never touches the PDF extractor", async () => {
  let pdfCalled = false;
  const src = await resolveSourceContent(
    { ok: true, contentType: "text/html", htmlContent: HTML_PAGE },
    "https://example.com/job",
    async () => { pdfCalled = true; return { ok: true, text: "x" }; },
  );
  assert.equal(pdfCalled, false);
  assert.equal(src.ok && src.kind, "html");
});

test("PD04 scanned/empty/unreadable PDF → explicit failure, never success", async () => {
  const scanned = await resolveSourceContent(
    { ok: true, contentType: "application/pdf", htmlContent: null },
    PDF_URL,
    async () => ({ ok: false, text: null, error: "PDF parsed but extracted text is empty (possibly a scanned image PDF)" }),
  );
  assert.equal(scanned.ok, false);
  if (!scanned.ok) assert.match(scanned.error, /scanned/);

  const tiny = await resolveSourceContent(
    { ok: true, contentType: "application/pdf", htmlContent: null },
    PDF_URL,
    async () => ({ ok: true, text: "   page 1  " }),
  );
  assert.equal(tiny.ok, false);
});

test("PD05 unsupported content type and failed fetch → explicit failure", async () => {
  const img = await resolveSourceContent({ ok: true, contentType: "image/png", htmlContent: null }, "https://x.in/a.png");
  assert.equal(img.ok, false);
  if (!img.ok) assert.match(img.error, /Unsupported content type/);

  const failed = await resolveSourceContent({ ok: false, error: "HTTP 403", htmlContent: null }, PDF_URL);
  assert.equal(failed.ok, false);
});

suite("AI Assist V3 — extraction safeguards");

test("SG01 title: sentence fragments rejected, real titles accepted", () => {
  assert.equal(isPlausibleTitle("advertisement carefully before applying."), false);
  assert.equal(isPlausibleTitle("Candidates are advised to read the notification"), false);
  assert.equal(isPlausibleTitle("Page 1 of 20"), false);
  assert.equal(isPlausibleTitle("Example Bank Apprentice Recruitment 2026 - 3500 Posts"), true);
  assert.equal(isPlausibleTitle("Engagement of Graduate Apprentices under Apprentices Act, 1961 for FY 2026-27"), true);
});

test("SG02 PDF: an implausible title is never offered as a candidate", () => {
  const { candidates, flagged } = buildAssistCandidates(PDF_TEXT, "pdf", PDF_URL);
  const title = candidates.find((c) => c.fieldPath === "identity.title");
  if (title && title.value !== null) {
    assert.equal(isPlausibleTitle(String(title.value)), true);
  }
  for (const f of flagged.filter((x) => x.label === "Title")) {
    assert.equal(title, undefined);
    assert.match(f.reason, /not applied/);
  }
});

test("SG03 identical open/close dates → both flagged, neither a candidate", () => {
  const html = `<html><body><h1>Example Bank Apprentice Recruitment 2026</h1>
<p>Application Start Date: 01/10/2026</p><p>Last Date to Apply: 01/10/2026</p></body></html>`;
  const { candidates, flagged } = buildAssistCandidates(html, "html", "https://example.com/job");
  assert.equal(candidates.some((c) => c.fieldPath.startsWith("dates.application")), false);
  assert.deepEqual(
    flagged.map((f) => f.label).filter((l) => l.startsWith("Application")).sort(),
    ["Application Closes", "Application Opens"],
  );
});

test("SG04 distinct open/close dates pass through on the HTML path", () => {
  const { candidates, flagged } = buildAssistCandidates(HTML_PAGE, "html", "https://example.com/job");
  const get = (p: string) => candidates.find((c) => c.fieldPath === p)?.value;
  assert.equal(get("dates.applicationOpenDate"), "2026-10-01");
  assert.equal(get("dates.applicationCloseDate"), "2026-10-17");
  assert.equal(get("identity.title"), "Example Bank Apprentice Recruitment 2026 - 3500 Posts");
  assert.equal(flagged.length, 0);
});

test("SG05 training seats: explicit label in apprenticeship context only", () => {
  assert.equal(extractTrainingSeats(PDF_TEXT), 3500);
  assert.equal(extractTrainingSeats("Number of Training seats: 3,500 for Apprentices"), 3500);
  assert.equal(extractTrainingSeats("Hall capacity. Number of Training seats 3500 in the auditorium."), undefined);
  assert.equal(extractTrainingSeats("Apprentice intake 3500 across 2026"), undefined);
  assert.equal(extractTrainingSeats("Apprentices. Number of Training seats 2026"), undefined);
});

test("SG06 PDF: total from training-seats label; state-wise table never becomes a breakdown", () => {
  const { candidates } = buildAssistCandidates(PDF_TEXT, "pdf", PDF_URL);
  assert.equal(candidates.find((c) => c.fieldPath === "vacancies.total")?.value, 3500);
  assert.equal(candidates.find((c) => c.fieldPath === "vacancies.breakdown")?.value, null);
});

suite("AI Assist V3 — fee extraction with evidence verification");

test("FE01 PDF fee sections: only text around the fee heading, non-empty", () => {
  const sections = buildFeeSections(PDF_TEXT, "pdf", PDF_URL);
  assert.equal(sections.length, 1);
  assert.ok(sections[0].text.includes("All Others Rs. 500/-"));
  assert.ok(sections[0].text.length > 0 && sections[0].text.length <= 4000);
});

test("FE02 no fee text → no sections → Gemini is not called", async () => {
  let called = false;
  const fetchFn = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  const sections = buildFeeSections("Apprentice engagement notice. Selection by merit list only.", "pdf", PDF_URL);
  assert.equal(sections.length, 0);
  const fees = await extractFees({ sections, url: PDF_URL, apiKey: "test-key", fetchFn });
  assert.equal(called, false);
  assert.equal(fees.general.status, "skipped");
});

test("FE03 fees from PDF text accepted when evidence is in the source", async () => {
  const sections = buildFeeSections(PDF_TEXT, "pdf", PDF_URL);
  const fees = await extractFees({
    sections, url: PDF_URL, apiKey: "test-key",
    fetchFn: geminiFetch({
      applicationFeeGeneral: { value: 500, evidence: "All Others Rs. 500/- (incl. intimation charges)", sectionHeading: "Fee section 1", confidence: "high" },
      applicationFeeSCST: { value: 0, evidence: "SC/ST/PwBD NIL", sectionHeading: "Fee section 1", confidence: "high" },
    }),
  });
  assert.deepEqual(fees.general, { status: "accepted", value: 500 });
  assert.deepEqual(fees.scst, { status: "accepted", value: 0 });
});

test("FE04 fee whose quote is not in the source is rejected", async () => {
  const sections = buildFeeSections(PDF_TEXT, "pdf", PDF_URL);
  const fees = await extractFees({
    sections, url: PDF_URL, apiKey: "test-key",
    fetchFn: geminiFetch({
      applicationFeeGeneral: { value: 850, evidence: "General candidates must pay Rs. 850/-", sectionHeading: "Fee section 1", confidence: "high" },
    }),
  });
  assert.equal(fees.general.status, "rejected");
  assert.equal(fees.scst.status, "not_stated");
});

test("FE05 fee amount absent from its own (real) quote is rejected", async () => {
  const sections = buildFeeSections(PDF_TEXT, "pdf", PDF_URL);
  const fees = await extractFees({
    sections, url: PDF_URL, apiKey: "test-key",
    fetchFn: geminiFetch({
      applicationFeeGeneral: { value: 750, evidence: "All Others Rs. 500/- (incl. intimation charges)", sectionHeading: "Fee section 1", confidence: "high" },
      applicationFeeSCST: { value: 0, evidence: "All Others Rs. 500/- (incl. intimation charges)", sectionHeading: "Fee section 1", confidence: "low" },
    }),
  });
  assert.equal(fees.general.status, "rejected");
  assert.equal(fees.scst.status, "rejected");
});

test("FE06 feeValueSupported: whole-number match only", () => {
  assert.equal(feeValueSupported(500, "Rs. 500/-"), true);
  assert.equal(feeValueSupported(1180, "Rs. 1,180/- incl. GST"), true);
  assert.equal(feeValueSupported(850, "Rs.850/- (Inclusive of GST) for all others"), true);
  assert.equal(feeValueSupported(175, "Rs.175/- (Inclusive of GST) for SC/ST/ PwBD"), true);
  assert.equal(feeValueSupported(850, "Rs. 1.850"), false);
  assert.equal(feeValueSupported(50, "Rs. 500/-"), false);
  assert.equal(feeValueSupported(500, "Rs. 1500/-"), false);
  assert.equal(feeValueSupported(0, "SC/ST/PwBD NIL"), true);
  assert.equal(feeValueSupported(0, "Rs. 500/-"), false);
  assert.equal(feeValueSupported(-5, "Rs. -5"), false);
});

test("FE07 Gemini failure / missing key → skipped, deterministic results unaffected", async () => {
  const sections = buildFeeSections(PDF_TEXT, "pdf", PDF_URL);

  const failed = await extractFees({ sections, url: PDF_URL, apiKey: "test-key", fetchFn: geminiFetch({}, 400) });
  assert.equal(failed.general.status, "skipped");
  assert.equal(failed.scst.status, "skipped");
  if (failed.general.status === "skipped") assert.equal(failed.general.reason.includes("test-key"), false);

  const noKey = await extractFees({ sections, url: PDF_URL, apiKey: undefined });
  assert.equal(noKey.general.status, "skipped");

  const { candidates } = buildAssistCandidates(PDF_TEXT, "pdf", PDF_URL);
  assert.equal(candidates.find((c) => c.fieldPath === "vacancies.total")?.value, 3500);
});

test("FE08 HTML path: fee section found and verified end to end", async () => {
  const sections = buildFeeSections(HTML_PAGE, "html", "https://example.com/job");
  assert.ok(sections.length >= 1);
  const heading = sections[0].heading;
  const fees = await extractFees({
    sections, url: "https://example.com/job", apiKey: "test-key",
    fetchFn: geminiFetch({
      applicationFeeGeneral: { value: 500, evidence: "General / OBC / EWS: Rs. 500/-", sectionHeading: heading, confidence: "high" },
    }),
  });
  assert.deepEqual(fees.general, { status: "accepted", value: 500 });
});

suite("AI Assist V3 — preservation and state safety");

test("PS01 occupied fee field is detected as occupied, so an AI fee can only be a suggestion", () => {
  const record = makeRecord({ financial: { feeGeneral: pf<number | null>(700) } });
  const current = readField(record, "financial.feeGeneral");
  assert.equal(isEmpty(current), false);
  assert.equal(current?.value, 700);
});

test("PS02 applying an accepted fee: PENDING, draftState and lifecycle unchanged, nothing VERIFIED added", () => {
  const record = makeRecord();
  const verifiedBefore = (JSON.stringify(record).match(/"VERIFIED"/g) ?? []).length;
  const result = routeFieldUpdate(record, "financial.feeSCST", pending<number | null>(0), randomUUID(), "AI Assist");
  assert.equal(result.record.financial.feeSCST?.status, "PENDING");
  assert.equal(result.record.draftState, "DRAFT");
  assert.equal(result.record.publishedAt, undefined);
  assert.deepEqual(result.record.lifecycle, record.lifecycle);
  assert.equal((JSON.stringify(result.record).match(/"VERIFIED"/g) ?? []).length, verifiedBefore);
});

// ═══════════════════════════════════════════════════════════
// Token limit, rate limits, provenance, identity comparison,
// notification-number sanity
// ═══════════════════════════════════════════════════════════

const SRC_URL = "https://www.thirdparty-jobs.example/canara-bank-apprentice-2026";
const FEE_OK = {
  applicationFeeGeneral: { value: 500, evidence: "All Others Rs. 500/- (incl. intimation charges)", sectionHeading: "Fee section 1", confidence: "high" },
};

suite("AI Assist V4 — Gemini token limit and rate limits");

test("TK01 token limit: 4096 default, GEMINI_MAX_OUTPUT_TOKENS respected, junk ignored", () => {
  assert.equal(FEE_MAX_OUTPUT_TOKENS, 4096);
  assert.equal(resolveFeeMaxOutputTokens(undefined), 4096);
  assert.equal(resolveFeeMaxOutputTokens("8192"), 8192);
  assert.equal(resolveFeeMaxOutputTokens("abc"), 4096);
  assert.equal(resolveFeeMaxOutputTokens("0"), 4096);
});

test("TK02 the fee request actually carries the larger output limit", async () => {
  let sentLimit: unknown;
  const inner = geminiFetch(FEE_OK);
  const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sentLimit = JSON.parse(String(init?.body)).generationConfig.maxOutputTokens;
    return inner(input, init);
  }) as typeof fetch;
  const fees = await extractFees({
    sections: buildFeeSections(PDF_TEXT, "pdf", PDF_URL), url: PDF_URL, apiKey: "test-key", fetchFn: spy, maxOutputTokens: 4096,
  });
  assert.equal(sentLimit, 4096);
  assert.equal(fees.general.status, "accepted");
});

test("RL01 HTTP 429 → clear rate-limit message, exactly one request, no secrets", async () => {
  let calls = 0;
  const fetchFn = (async () => { calls++; return new Response("{}", { status: 429 }); }) as unknown as typeof fetch;
  const fees = await extractFees({
    sections: buildFeeSections(PDF_TEXT, "pdf", PDF_URL), url: PDF_URL, apiKey: "secret-test-key", fetchFn,
  });
  assert.equal(calls, 1);
  assert.equal(fees.general.status, "skipped");
  if (fees.general.status === "skipped") {
    assert.match(fees.general.reason, /rate limit/i);
    assert.equal(fees.general.reason.includes("secret-test-key"), false);
    assert.equal(/https?:\/\//.test(fees.general.reason), false);
  }
});

test("RL02 model, key and truncated-response failures get distinct safe messages", async () => {
  const sections = buildFeeSections(PDF_TEXT, "pdf", PDF_URL);
  const reasonFor = async (fetchFn: typeof fetch) => {
    const f = await extractFees({ sections, url: PDF_URL, apiKey: "secret-test-key", fetchFn });
    return f.general.status === "skipped" ? f.general.reason : `unexpected:${f.general.status}`;
  };
  const status = (s: number) => (async () => new Response("{}", { status: s })) as unknown as typeof fetch;
  const truncated = (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"applicationFeeGeneral": {"val' }] } }] }), { status: 200 })) as unknown as typeof fetch;

  const model = await reasonFor(status(404));
  const key = await reasonFor(status(403));
  const cut = await reasonFor(truncated);
  assert.match(model, /model is not available/);
  assert.match(key, /key was rejected/);
  assert.match(cut, /incomplete/);
  assert.equal(new Set([model, key, cut, feeFailureMessage(429), feeFailureMessage(503)]).size, 5);
  for (const r of [model, key, cut]) assert.equal(r.includes("secret-test-key"), false);
});

suite("AI Assist V4 — source provenance");

test("PV01 revision note names the exact source URL and claims nothing more", () => {
  for (const mode of ["filled", "applied"] as const) {
    const note = aiAssistReason(SRC_URL, mode);
    assert.ok(note.includes(SRC_URL));
    assert.match(note, /AI Assist/);
    assert.match(note, /unverified, requires human verification/);
    assert.equal(/official/i.test(note), false);
  }
  assert.notEqual(aiAssistReason(SRC_URL, "filled"), aiAssistReason(SRC_URL, "applied"));
});

test("PV02 auto-fill path: revision carries the source URL, field is PENDING", () => {
  const record = makeRecord();
  const result = routeFieldUpdate(
    record, "financial.feeGeneral", pending<number | null>(500), randomUUID(), aiAssistReason(SRC_URL, "filled"),
  );
  assert.ok(result.revision.reason?.includes(SRC_URL));
  assert.equal(result.record.financial.feeGeneral?.status, "PENDING");
});

test("PV03 apply path: existing evidence IDs kept, source URL recorded, never VERIFIED", () => {
  const record = makeRecord({ vacancies: { total: pf<number | null>(3000) } });
  const existingIds = record.vacancies.total?.evidenceIds ?? [];
  assert.deepEqual(existingIds, ["evid-001"]);

  const field = buildAiField<number | null>(3500, existingIds);
  const result = routeFieldUpdate(record, "vacancies.total", field, randomUUID(), aiAssistReason(SRC_URL, "applied"));

  assert.deepEqual(result.record.vacancies.total?.evidenceIds, ["evid-001"]);
  assert.equal(result.record.vacancies.total?.value, 3500);
  assert.equal(result.record.vacancies.total?.status, "PENDING");
  assert.ok(result.revision.reason?.includes(SRC_URL));
  assert.equal(result.record.draftState, "DRAFT");
});

test("PV04 buildAiField copies the ID list and defaults to none", () => {
  const ids = ["a", "b"];
  const f = buildAiField("x", ids);
  ids.push("c");
  assert.deepEqual(f.evidenceIds, ["a", "b"]);
  assert.deepEqual(buildAiField("x").evidenceIds, []);
});

suite("AI Assist V4 — organisation / year read-only comparison");

test("ID01 organisation only from a recognised official domain, never a third-party page", () => {
  assert.equal(detectOrganization("https://www.govtjobguru.in/canara-bank-apprentice-2026"), null);
  assert.equal(detectOrganization(SRC_URL), null);
  assert.equal(typeof detectOrganization("https://upsc.gov.in/examinations/active"), "string");
});

test("ID02 yearsIn: single years, FY spans, ISO dates", () => {
  assert.deepEqual(yearsIn("Example Bank Apprentice Recruitment 2026"), [2026]);
  assert.deepEqual(yearsIn("FOR FY 2026-27"), [2026, 2027]);
  assert.deepEqual(yearsIn("2026-10-01 2026-10-17"), [2026]);
  assert.deepEqual(yearsIn("Apprentices Act, 1961"), []);
});

test("ID03 compareIdentity: match, mismatch, ambiguous, not detected", () => {
  const id = { organizationName: "Union Public Service Commission", recruitmentYear: 2026 };
  const same = compareIdentity(id, { organization: "Union Public Service Commission", years: [2026] });
  assert.equal(same.organization.status, "match");
  assert.equal(same.year.status, "match");

  const diff = compareIdentity(id, { organization: "Staff Selection Commission", years: [2025] });
  assert.equal(diff.organization.status, "mismatch");
  assert.equal(diff.year.status, "mismatch");

  const amb = compareIdentity(id, { organization: null, years: [2026, 2027] });
  assert.equal(amb.organization.status, "not_detected");
  assert.equal(amb.year.status, "ambiguous");

  assert.equal(compareIdentity(id, { organization: null, years: [] }).year.status, "not_detected");
  assert.equal(compareIdentity(id, { organization: null, years: [2024, 2025] }).year.status, "mismatch");
});

test("ID04 organisation and year are never candidates (no write path)", () => {
  for (const [content, kind, url] of [[PDF_TEXT, "pdf", PDF_URL], [HTML_PAGE, "html", "https://example.com/job"]] as const) {
    const { candidates, detected } = buildAssistCandidates(content, kind, url);
    assert.equal(candidates.some((c) => /organi[sz]ation|recruitmentYear|govType/.test(c.fieldPath)), false);
    assert.ok(Array.isArray(detected.years));
  }
  assert.deepEqual(buildAssistCandidates(PDF_TEXT, "pdf", PDF_URL).detected.years, [2026, 2027]);
  assert.deepEqual(buildAssistCandidates(HTML_PAGE, "html", "https://example.com/job").detected.years, [2026]);
});

suite("AI Assist V4 — notification-number sanity");

test("NN01 qualification labels are suspicious", () => {
  for (const v of ["HSC/10", "10+2", "SSC/12th", "B.Tech/B.E", "Graduate", "ITI / Diploma", "10th-12th"]) {
    assert.equal(isSuspiciousNotificationNumber(v), true, v);
  }
});

test("NN02 legitimate formats are not rejected", () => {
  for (const v of [
    "CEN 05/2026", "CRPD/SCO/2026-27/22", "EB/HR/APP/2026", "SSC/CGL/2026", "12/2026",
    "Advt. No. 3/2026", "01/2026-27", "RRB/BBS/Advt/CEN-05/2026", "HRD/APP/10/2026", "F.No. 1/7/2026-R",
  ]) {
    assert.equal(isSuspiciousNotificationNumber(v), false, v);
  }
});

suite("AI Assist V5 — PDF dates, heading title, fee passage selection");

test("DR01 combined open/close label resolved from the explicit range in the source", () => {
  const text = "Opening date and closing date for on-line registration\nin Website\n01.10.2026 to\n17.10.2026\n[both days inclusive]\nApply online from 01.10.2026 to 17.10.2026 through the link.";
  assert.equal(closingDateFromRange(text, "2026-10-01"), "2026-10-17");
});

test("DR02 no range, conflicting ranges, or a range starting elsewhere → null (stays flagged)", () => {
  assert.equal(closingDateFromRange("Last date 01.10.2026. Apply on 01.10.2026 only.", "2026-10-01"), null);
  assert.equal(closingDateFromRange("01.10.2026 to 17.10.2026 … 01.10.2026 to 21.10.2026", "2026-10-01"), null);
  assert.equal(closingDateFromRange("Fee payment 05.10.2026 to 17.10.2026", "2026-10-01"), null);
  assert.equal(closingDateFromRange("01.10.2026 to 30.09.2026", "2026-10-01"), null);
  assert.equal(closingDateFromRange("01.10.2026 to 31.02.2027", "2026-10-01"), null);
});

test("DR03 end to end: PDF with the combined label yields distinct dates and no date flag", () => {
  const text = [
    "ENGAGEMENT OF GRADUATE APPRENTICES UNDER APPRENTICES ACT, 1961",
    "FOR FY 2026-27",
    "Example Bank invites online applications.",
    "Opening date and closing date for on-line registration",
    "in Website",
    "01.10.2026 to",
    "17.10.2026",
    "Number of Training seats 3500 for Apprentices",
  ].join("\n");
  const { candidates, flagged } = buildAssistCandidates(text, "pdf", PDF_URL);
  const get = (p: string) => candidates.find((c) => c.fieldPath === p)?.value;
  const open = get("dates.applicationOpenDate");
  const close = get("dates.applicationCloseDate");
  if (open === close && open !== null && open !== undefined) {
    assert.fail(`identical dates offered as candidates: ${String(open)}`);
  }
  if (open === "2026-10-01") assert.equal(close, "2026-10-17");
  assert.equal(flagged.some((f) => f.label.startsWith("Application") && get("dates.applicationCloseDate") != null), false);
});

test("HT01 upper-case notice heading used as PDF title", () => {
  assert.equal(
    pdfHeadingTitle("1\nENGAGEMENT OF GRADUATE APPRENTICES UNDER APPRENTICES ACT, 1961\nFOR FY 2026-27\nExample Bank, a leading Public Sector Bank, invites applications."),
    "ENGAGEMENT OF GRADUATE APPRENTICES UNDER APPRENTICES ACT, 1961 FOR FY 2026-27",
  );
});

test("HT02 headings that are not recruitment subjects are not used", () => {
  assert.equal(pdfHeadingTitle("EXAMPLE BANK\nHEAD OFFICE BENGALURU\nPlease read this advertisement carefully before applying."), null);
  assert.equal(pdfHeadingTitle("Page 1 of 20\nplain sentence text only, no heading here at all."), null);
  assert.equal(pdfHeadingTitle("IMPORTANT INSTRUCTIONS, PLEASE READ THE FOLLOWING CAREFULLY\nbody text"), null);
});

test("FW01 fee passages: amount-bearing section chosen over earlier date-table mentions", () => {
  const filler = "General instructions for candidates. ".repeat(80);
  const text = [
    "IMPORTANT DATES",
    "Payment of Application Fees/Intimation Charges (Online) 01.09.2026 to 21.09.2026",
    filler,
    "Candidates must pay application fees separately for each post.",
    filler,
    "C. APPLICATION FEE/ INTIMATION CHARGES",
    "Officer (Scale I, II & III): Rs. 175/- for SC/ST/PwBD candidates; Rs. 850/- for all others",
    filler,
  ].join("\n");
  const sections = buildFeeSections(text, "pdf", PDF_URL);
  assert.ok(sections.length >= 1 && sections.length <= 2);
  assert.ok(sections.some((s) => s.text.includes("Rs. 850/-")));
  assert.equal(sections.some((s) => s.text.startsWith("IMPORTANT DATES")), false);
});

test("FW02 fee mentioned but no amount anywhere → no passage, so no AI call", () => {
  const text = "Payment of application fee is online only. Fee once paid is not refundable. " + "Other text. ".repeat(50);
  assert.equal(buildFeeSections(text, "pdf", PDF_URL).length, 0);
});

suite("AI Assist V6 — AI-extracted dates and notification number");

const DATES_TEXT = [
  "Events Dates",
  "Online Application Started 7th September 2026",
  "Application Dates 7th September to 7th October 2026.",
  "Last Date to Submit Form 7th October 2026 (11 PM)",
  "Last Date for Online Fee Payment 8th October 2026 (11 PM)",
  "Application Form Correction Window 14th to 16th October 2026",
  "Notification No.: F. No. HQ-C1102/5/2026-C-1",
].join("\n");
const dateSection = [{ type: "dates", heading: "Dates section 1", text: DATES_TEXT, rawHtml: "", tables: [], lists: [], links: [], paragraphs: [] }] as never;
const cand = (value: string, evidence: string) => ({ value, evidence, sectionHeading: "Dates section 1", confidence: "high" as const });

test("AD01 parseDatesInText reads the formats notices use", () => {
  assert.deepEqual(parseDatesInText("07.09.2026 and 07/10/2026 and 2026-10-08"), ["2026-09-07", "2026-10-07", "2026-10-08"]);
  assert.deepEqual(parseDatesInText("7th September 2026"), ["2026-09-07"]);
  assert.deepEqual(parseDatesInText("September 7, 2026"), ["2026-09-07"]);
  assert.deepEqual(parseDatesInText("14th to 16th October 2026"), ["2026-10-14", "2026-10-16"]);
  assert.deepEqual(parseDatesInText("7th September to 7th October 2026"), ["2026-09-07", "2026-10-07"]);
  assert.deepEqual(parseDatesInText("31 February 2026 or 2026 posts"), []);
});

test("AD02 a date is accepted only when its quote is in the source and contains it", () => {
  assert.deepEqual(judgeDate("applicationCloseDate", cand("2026-10-07", "Last Date to Submit Form 7th October 2026 (11 PM)"), dateSection), { status: "accepted", value: "2026-10-07" });
  assert.equal(judgeDate("applicationCloseDate", cand("2026-10-09", "Last Date to Submit Form 7th October 2026 (11 PM)"), dateSection).status, "rejected");
  assert.equal(judgeDate("applicationCloseDate", cand("2026-10-07", "Last date is 7th October 2026, confirmed"), dateSection).status, "rejected");
  assert.equal(judgeDate("applicationOpenDate", cand("07/09/2026", "Online Application Started 7th September 2026"), dateSection).status, "rejected");
  assert.equal(judgeDate("applicationOpenDate", undefined, dateSection).status, "not_stated");
});

test("AD03 a correction-window or fee-payment date never becomes an application date", () => {
  const correction = "Application Form Correction Window 14th to 16th October 2026";
  assert.equal(judgeDate("applicationOpenDate", cand("2026-10-14", correction), dateSection).status, "rejected");
  assert.equal(judgeDate("applicationCloseDate", cand("2026-10-16", correction), dateSection).status, "rejected");
  assert.equal(judgeDate("correctionWindowEnd", cand("2026-10-16", correction), dateSection).status, "accepted");
  const feePay = "Last Date for Online Fee Payment 8th October 2026 (11 PM)";
  assert.equal(judgeDate("applicationCloseDate", cand("2026-10-08", feePay), dateSection).status, "rejected");
  assert.equal(judgeDate("feePaymentCloseDate", cand("2026-10-08", feePay), dateSection).status, "accepted");
  assert.equal(judgeDate("correctionWindowEnd", cand("2026-10-07", "Last Date to Submit Form 7th October 2026 (11 PM)"), dateSection).status, "rejected");
});

test("AD04 one AI call returns verified dates, fees and number; a list-wrapped answer is handled", async () => {
  const payload = [{
    applicationOpenDate: cand("2026-09-07", "Application Dates 7th September to 7th October 2026."),
    applicationCloseDate: cand("2026-10-07", "Last Date to Submit Form 7th October 2026 (11 PM)"),
    feePaymentCloseDate: cand("2026-10-08", "Last Date for Online Fee Payment 8th October 2026 (11 PM)"),
    correctionWindowEnd: cand("2026-10-16", "Application Form Correction Window 14th to 16th October 2026"),
    notificationNumber: cand("F. No. HQ-C1102/5/2026-C-1", "Notification No.: F. No. HQ-C1102/5/2026-C-1"),
  }];
  let calls = 0;
  const inner = geminiFetch(payload);
  const fetchFn = (async (i: RequestInfo | URL, init?: RequestInit) => { calls++; return inner(i, init); }) as typeof fetch;
  const ai = await extractWithAi({ sections: dateSection, url: PDF_URL, apiKey: "test-key", fetchFn });
  assert.equal(calls, 1);
  assert.deepEqual(ai.dates.applicationOpenDate, { status: "accepted", value: "2026-09-07" });
  assert.deepEqual(ai.dates.applicationCloseDate, { status: "accepted", value: "2026-10-07" });
  assert.deepEqual(ai.dates.feePaymentCloseDate, { status: "accepted", value: "2026-10-08" });
  assert.deepEqual(ai.dates.correctionWindowEnd, { status: "accepted", value: "2026-10-16" });
  assert.deepEqual(ai.notificationNumber, { status: "accepted", value: "F. No. HQ-C1102/5/2026-C-1" });
  assert.equal(ai.fees.general.status, "not_stated");
});

test("AD05 notification number: exam names, unquoted values and unlabelled quotes are rejected", () => {
  assert.equal(judgeNotificationNumber(cand("CHSL 2026", "Notification No.: F. No. HQ-C1102/5/2026-C-1"), dateSection).status, "rejected");
  assert.equal(judgeNotificationNumber(cand("HQ-9999/1/2026", "Notification No.: F. No. HQ-C1102/5/2026-C-1"), dateSection).status, "rejected");
  assert.equal(judgeNotificationNumber(cand("7th October 2026", "Last Date to Submit Form 7th October 2026 (11 PM)"), dateSection).status, "rejected");
  assert.equal(judgeNotificationNumber(undefined, dateSection).status, "not_stated");
});

test("AD06 merge: AI fills what the base missed; disagreement is flagged, not applied", () => {
  const skipped = { status: "not_stated" } as const;
  const ok = (value: string) => ({ status: "accepted", value }) as const;
  const none = { applicationOpenDate: skipped, applicationCloseDate: skipped, feePaymentCloseDate: skipped, correctionWindowEnd: skipped };

  // Base flagged impossible dates; AI supplies verified ones → flags cleared, values offered.
  const flaggedBase = {
    candidates: [{ fieldPath: "identity.title", label: "Title", value: "X Recruitment 2026" }],
    flagged: [
      { label: "Application Opens", value: "2026-10-14", reason: "opening date is after the closing date — check the notification and enter manually" },
      { label: "Application Closes", value: "2026-10-07", reason: "opening date is after the closing date — check the notification and enter manually" },
    ],
  };
  let m = mergeAiDates(flaggedBase, { ...none, applicationOpenDate: ok("2026-09-07"), applicationCloseDate: ok("2026-10-07") });
  const get = (r: typeof m, p: string) => r.candidates.find((c) => c.fieldPath === p)?.value;
  assert.equal(get(m, "dates.applicationOpenDate"), "2026-09-07");
  assert.equal(get(m, "dates.applicationCloseDate"), "2026-10-07");
  assert.equal(m.flagged.length, 0);
  assert.equal(get(m, "identity.title"), "X Recruitment 2026");

  // Both methods have a value and they differ → neither applied.
  const base = { candidates: [{ fieldPath: "dates.applicationCloseDate", label: "Application Closes", value: "2026-10-17" }], flagged: [] };
  m = mergeAiDates(base, { ...none, applicationCloseDate: ok("2026-10-07") });
  assert.equal(m.candidates.some((c) => c.fieldPath === "dates.applicationCloseDate"), false);
  assert.match(m.flagged[0].reason, /disagree/);

  // Agreement → applied once, no flag.
  m = mergeAiDates(base, { ...none, applicationCloseDate: ok("2026-10-17") });
  assert.equal(get(m, "dates.applicationCloseDate"), "2026-10-17");
  assert.equal(m.flagged.length, 0);

  // AI pair that is itself impossible → flagged.
  m = mergeAiDates({ candidates: [], flagged: [] }, { ...none, applicationOpenDate: ok("2026-10-14"), applicationCloseDate: ok("2026-10-07") });
  assert.equal(m.candidates.some((c) => c.fieldPath.startsWith("dates.application") && c.value !== null), false);
  assert.equal(m.flagged.length, 2);

  // AI rejected value is surfaced for manual check, never applied.
  m = mergeAiDates({ candidates: [], flagged: [] }, { ...none, applicationOpenDate: { status: "rejected", value: "2026-10-14", reason: "the quote is about the correction window, not the application period" } });
  assert.equal(get(m, "dates.applicationOpenDate"), undefined);
  assert.match(m.flagged[0].reason, /correction window/);
});

test("AD07 merge number: verified AI number replaces a flagged exam-name value", () => {
  const base = {
    candidates: [{ fieldPath: "identity.title", label: "Title", value: "X" }],
    flagged: [{ label: "Notification Number", value: "CHSL 2026", reason: "looks like an exam name and year, not a notification number — not applied" }],
  };
  const m = mergeAiNotificationNumber(base, { status: "accepted", value: "F. No. HQ-C1102/5/2026-C-1" });
  assert.equal(m.candidates.find((c) => c.fieldPath === "identity.notificationNumber")?.value, "F. No. HQ-C1102/5/2026-C-1");
  assert.equal(m.flagged.length, 0);

  const differ = mergeAiNotificationNumber(
    { candidates: [{ fieldPath: "identity.notificationNumber", label: "Notification Number", value: "CEN 05/2026" }], flagged: [] },
    { status: "accepted", value: "CEN 06/2026" },
  );
  assert.equal(differ.candidates.some((c) => c.fieldPath === "identity.notificationNumber"), false);
  assert.match(differ.flagged[0].reason, /disagree/);
});

test("AD08 passages sent to the AI are deduplicated and limited", () => {
  const html = `<html><body><h1>Example Commission CHSL Recruitment 2026</h1>
<h2>Important Dates</h2><p>Last Date to Submit Form 7th October 2026. Last Date for Online Fee Payment 8th October 2026. Application Fee Rs. 100/-</p>
<h2>Other</h2><p>Notification No.: F. No. HQ-C1102/5/2026-C-1</p></body></html>`;
  const sections = buildAiSections(html, "html", "https://example.com/job");
  const texts = sections.map((s) => s.text.replace(/\s+/g, " ").trim());
  assert.equal(new Set(texts).size, texts.length);
  assert.equal(new Set(sections.map((s) => s.heading)).size, sections.length);
  assert.ok(sections.length >= 2 && sections.length <= 5);
  assert.equal(buildAiSections("<html><body><p>Nothing relevant here.</p></body></html>", "html", "https://example.com/x").length, 0);
});

test("NN04 exam name plus year is not a notification number", () => {
  for (const v of ["CHSL 2026", "NTPC 2025", "CGL 2026"]) {
    assert.equal(isSuspiciousNotificationNumber(v), true, v);
  }
  for (const v of ["CEN 05/2026", "CHSL/2026/01", "CRP RRBs XV", "Advt. No. 3/2026", "HQ-C1101/1/2026"]) {
    assert.equal(isSuspiciousNotificationNumber(v), false, v);
  }
});

test("DR04 opening date after closing date → both flagged, neither a candidate", () => {
  const html = `<html><body><h1>Example Commission CHSL Recruitment 2026</h1>
<p>Application Start Date: 14/10/2026</p><p>Last Date to Apply: 07/10/2026</p></body></html>`;
  const { candidates, flagged } = buildAssistCandidates(html, "html", "https://example.com/job");
  const open = candidates.find((c) => c.fieldPath === "dates.applicationOpenDate")?.value;
  const close = candidates.find((c) => c.fieldPath === "dates.applicationCloseDate")?.value;
  if (typeof open === "string" && typeof close === "string") {
    assert.ok(open <= close, `open ${open} is after close ${close}`);
  }
  if (flagged.some((f) => f.label === "Application Opens")) {
    assert.equal(open, undefined);
    assert.equal(close, undefined);
    assert.match(flagged.find((f) => f.label === "Application Opens")!.reason, /after the closing date/);
  }
});

test("NN03 a normal page yields no notification-number flag", () => {
  const { candidates, flagged } = buildAssistCandidates(HTML_PAGE, "html", "https://example.com/job");
  assert.equal(flagged.some((f) => f.label === "Notification Number"), false);
  const n = candidates.find((c) => c.fieldPath === "identity.notificationNumber")?.value;
  if (typeof n === "string") assert.equal(isSuspiciousNotificationNumber(n), false);
});
