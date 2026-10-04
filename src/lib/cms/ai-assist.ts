// Pure helpers for the AI Assist route. Kept free of next/server imports so
// tests exercise the same code the route runs.

import type { ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import type { VacancyRow } from "@/types";
import type { PageSection } from "@/intelligence/page-structurer";
import type { ExtractionCandidate } from "@/intelligence/extraction-provider";
import type { FetchPdfFn } from "@/intelligence/pdf-extractor";
import { extractPdfText } from "@/intelligence/pdf-extractor";
import { extractIntakeFields, classifySourceUrl, deriveOrgFromOfficialDomain } from "@/intelligence/intake";
import type { RecruitmentIdentity } from "@/types/recruitment-record";
import { structureDocument } from "@/intelligence/page-structurer";
import { verifyEvidence } from "@/intelligence/structured-extractor";
import { GeminiExtractionProvider } from "@/intelligence/gemini-extraction-provider";
import { buildAiField } from "@/lib/cms/ai-assist-apply";

// ─── Field helpers ────────────────────────────────────────

export function isEmpty(field: ProvenanceField<unknown> | undefined | null): boolean {
  if (!field) return true;
  if (field.status === "NOT_SPECIFIED") return true;
  const v = field.value;
  return v === null || v === undefined || v === "";
}

export function pending<T>(value: T): ProvenanceField<T> {
  return buildAiField(value);
}

export function readField(
  record: RecruitmentRecord,
  fieldPath: string,
): ProvenanceField<unknown> | undefined {
  const [ns, key] = fieldPath.split(".");
  if (ns === "identity") {
    return (record.identity as unknown as Record<string, unknown>)[key] as ProvenanceField<unknown> | undefined;
  }
  if (ns === "dates") {
    return (record.dates as unknown as Record<string, unknown>)[key] as ProvenanceField<unknown> | undefined;
  }
  if (ns === "vacancies") {
    if (key === "total") return record.vacancies.total as ProvenanceField<unknown> | undefined;
    if (key === "breakdown") return record.vacancies.breakdown as ProvenanceField<unknown> | undefined;
  }
  if (ns === "financial") {
    return (record.financial as unknown as Record<string, unknown>)[key] as ProvenanceField<unknown> | undefined;
  }
  return undefined;
}

// ─── Source resolution (HTML or PDF) ──────────────────────

export type SourceKind = "html" | "pdf";

export type SourceContent =
  | { ok: true; kind: SourceKind; content: string; numPages?: number }
  | { ok: false; error: string };

export function isPdfResponse(contentType: string | undefined, url: string): boolean {
  if (contentType?.toLowerCase().includes("pdf")) return true;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

const MIN_PDF_TEXT_CHARS = 50;

export async function resolveSourceContent(
  fetched: { ok: boolean; contentType?: string; error?: string; htmlContent: string | null },
  url: string,
  fetchPdfFn?: FetchPdfFn,
): Promise<SourceContent> {
  if (!fetched.ok) {
    return { ok: false, error: `Could not fetch URL: ${fetched.error ?? "request failed"}` };
  }
  if (fetched.htmlContent) {
    return { ok: true, kind: "html", content: fetched.htmlContent };
  }
  if (isPdfResponse(fetched.contentType, url)) {
    const pdf = await extractPdfText(url, fetchPdfFn);
    if (!pdf.ok || !pdf.text) {
      return { ok: false, error: `PDF could not be read: ${pdf.error ?? "no text extracted"}` };
    }
    if (pdf.text.trim().length < MIN_PDF_TEXT_CHARS) {
      return { ok: false, error: "PDF contains no usable text (possibly a scanned image PDF)" };
    }
    return { ok: true, kind: "pdf", content: pdf.text, numPages: pdf.numPages };
  }
  return {
    ok: false,
    error: `Unsupported content type: ${fetched.contentType ?? "unknown"} (only web pages and PDFs are supported)`,
  };
}

// ─── Extraction safeguards ────────────────────────────────

const TITLE_FRAGMENT_RE =
  /\b(carefully|before applying|please read|are advised|are requested|click here|read the|as under|as follows|given below)\b/i;
const TITLE_SUBJECT_RE =
  /\b(recruitment|engagement|apprentice\w*|vacanc\w+|posts?|notification|exam(?:s|inations?)?|officers?|clerks?|assistants?|engineers?|constables?|teachers?|managers?|trainees?|specialists?|cadre|services?|selection|admission)\b/i;

export function isPlausibleTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 12 || t.length > 220) return false;
  if (/^[a-z]/.test(t)) return false;
  if (/[.;,:]$/.test(t)) return false;
  if (TITLE_FRAGMENT_RE.test(t)) return false;
  return TITLE_SUBJECT_RE.test(t);
}

// Explicit "Number of Training seats N" label, accepted only inside an
// apprenticeship document. Never derived from any other number.
export function extractTrainingSeats(text: string): number | undefined {
  const m = /number\s+of\s+training\s+seats\s*[:\-–]?\s*(\d{1,3}(?:,\d{2,3})+|\d{1,6})(?![\d./-])/i.exec(text);
  if (!m) return undefined;
  const context = text.slice(Math.max(0, m.index - 1500), m.index + 1500);
  if (!/apprentice/i.test(context)) return undefined;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0 || n > 200_000) return undefined;
  if (n >= 1900 && n <= 2100) return undefined;
  return n;
}

// Qualification labels and class numbers ("HSC/10", "10+2", "SSC/12th") are
// sometimes picked up as notification numbers. Flag only when every part of
// the value is such a label, so real formats ("CEN 05/2026", "SSC/CGL/2026") pass.
const QUALIFICATION_TOKEN_RE =
  /^(hsc|ssc|sslc|puc|iti|ug|pg|matric(?:ulation)?|inter(?:mediate)?|diploma|graduat(?:e|ion)|degree|b\.?tech|b\.?e|b\.?sc|b\.?a|b\.?com|m\.?sc|m\.?a|m\.?com|m\.?tech|mba|mca|bca|10|12|8|10th|12th|8th|10\+2)$/i;

export function isSuspiciousNotificationNumber(value: string): boolean {
  const tokens = value.trim().split(/[\s\/\-,&()]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => QUALIFICATION_TOKEN_RE.test(t.replace(/\.$/, "")));
}

// ─── Read-only organisation / year comparison ─────────────

export type CompareStatus = "match" | "mismatch" | "ambiguous" | "not_detected";

export interface IdentityCheck {
  organization: { existing: string; detected: string | null; status: CompareStatus };
  year: { existing: number; detected: number[]; status: CompareStatus };
}

// Organisation is taken only from the source domain when the project's own
// domain registry recognises it — never guessed from third-party page text.
export function detectOrganization(url: string): string | null {
  const c = classifySourceUrl(url);
  if (c.orgName) return c.orgName;
  return deriveOrgFromOfficialDomain(c.domain)?.orgName ?? null;
}

export function yearsIn(text: string): number[] {
  const years = new Set<number>();
  for (const m of text.matchAll(/(?<!\d)(20\d{2})(?:\s*[-–\/]\s*(\d{2}))?(?!\d)/g)) {
    const y = parseInt(m[1], 10);
    years.add(y);
    if (m[2] && parseInt(m[2], 10) === (y + 1) % 100) years.add(y + 1);
  }
  return [...years].sort((a, b) => a - b);
}

const normOrg = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function compareIdentity(
  identity: Pick<RecruitmentIdentity, "organizationName" | "recruitmentYear">,
  detected: { organization: string | null; years: number[] },
): IdentityCheck {
  let orgStatus: CompareStatus = "not_detected";
  if (detected.organization) {
    const a = normOrg(identity.organizationName);
    const b = normOrg(detected.organization);
    orgStatus = a.length > 0 && (a === b || a.includes(b) || b.includes(a)) ? "match" : "mismatch";
  }

  let yearStatus: CompareStatus = "not_detected";
  if (detected.years.length === 1) {
    yearStatus = detected.years[0] === identity.recruitmentYear ? "match" : "mismatch";
  } else if (detected.years.length > 1) {
    yearStatus = detected.years.includes(identity.recruitmentYear) ? "ambiguous" : "mismatch";
  }

  return {
    organization: { existing: identity.organizationName, detected: detected.organization, status: orgStatus },
    year: { existing: identity.recruitmentYear, detected: detected.years, status: yearStatus },
  };
}

// ─── Recovering values the base extractor gets wrong on PDFs ─────

function toIsoDate(d: string, m: string, y: string): string | null {
  const day = parseInt(d, 10), month = parseInt(m, 10), year = parseInt(y, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// A combined label ("Opening date and closing date … 01.10.2026 to 17.10.2026")
// makes the base extractor read the first date for both fields. When the source
// itself prints an explicit "<open> to <close>" range starting on that date, and
// every such range agrees, the end of the range is the closing date. Nothing is
// inferred: no agreeing range in the source → null, and the dates stay flagged.
export function closingDateFromRange(text: string, openIso: string): string | null {
  const RANGE = /(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\s+to\s+(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/gi;
  const ends = new Set<string>();
  for (const m of text.matchAll(RANGE)) {
    if (toIsoDate(m[1], m[2], m[3]) !== openIso) continue;
    const end = toIsoDate(m[4], m[5], m[6]);
    if (end && end > openIso) ends.add(end);
  }
  return ends.size === 1 ? [...ends][0] : null;
}

// Official notices open with their subject as an upper-case heading. Used only
// when the base extractor's title was rejected, and only if the heading itself
// passes the title checks.
export function pdfHeadingTitle(text: string): string | null {
  const lines = text.slice(0, 1500).split(/\r?\n/).map((l) => l.trim());
  const isHeadingLine = (l: string) => {
    const letters = l.replace(/[^A-Za-z]/g, "");
    return letters.length >= 8 && letters === letters.toUpperCase();
  };
  for (let i = 0; i < lines.length; i++) {
    if (!isHeadingLine(lines[i])) continue;
    const run: string[] = [];
    while (i < lines.length && run.length < 4 && (isHeadingLine(lines[i]) || (run.length > 0 && /^FOR\b|^\(?\d{4}/.test(lines[i])))) {
      run.push(lines[i]);
      i++;
    }
    const candidate = run.join(" ").replace(/\s+/g, " ").replace(/^["“”']+|["“”']+$/g, "").trim();
    if (isPlausibleTitle(candidate)) return candidate;
  }
  return null;
}

export interface AssistCandidate {
  fieldPath: string;
  label: string;
  value: unknown;
}

export interface AssistFlag {
  label: string;
  value: unknown;
  reason: string;
}

export function buildAssistCandidates(
  content: string,
  kind: SourceKind,
  url: string,
): {
  candidates: AssistCandidate[];
  flagged: AssistFlag[];
  detected: { organization: string | null; years: number[] };
} {
  const extraction = extractIntakeFields(content, url);
  const flagged: AssistFlag[] = [];

  let notificationNumber: string | null = extraction.notificationNumber ?? null;
  if (notificationNumber !== null && isSuspiciousNotificationNumber(notificationNumber)) {
    flagged.push({
      label: "Notification Number",
      value: notificationNumber,
      reason: "looks like a qualification label, not a notification number — not applied",
    });
    notificationNumber = null;
  }

  let title: string | null = extraction.title ?? null;
  if (title !== null && !isPlausibleTitle(title)) {
    const heading = kind === "pdf" ? pdfHeadingTitle(content) : null;
    if (heading) {
      title = heading;
    } else {
      flagged.push({ label: "Title", value: title, reason: "does not look like a recruitment title — not applied" });
      title = null;
    }
  } else if (title === null && kind === "pdf") {
    title = pdfHeadingTitle(content);
  }

  let openDate: string | null = extraction.applicationOpenDate ?? null;
  let closeDate: string | null = extraction.applicationCloseDate ?? null;
  if (openDate !== null && openDate === closeDate) {
    const rangeEnd = closingDateFromRange(kind === "pdf" ? content : content.replace(/<[^>]+>/g, " "), openDate);
    if (rangeEnd) {
      closeDate = rangeEnd;
    } else {
      const reason = "opening and closing dates are identical — check the notification and enter manually";
      flagged.push({ label: "Application Opens", value: openDate, reason });
      flagged.push({ label: "Application Closes", value: closeDate, reason });
      openDate = null;
      closeDate = null;
    }
  }

  const totalVacancies: number | null =
    extraction.totalVacancies ?? (kind === "pdf" ? extractTrainingSeats(content) ?? null : null);

  // Only rows the deterministic extractor actually found — never inferred from the total.
  const breakdown: VacancyRow[] | null =
    extraction.vacancyRows && extraction.vacancyRows.length > 0
      ? extraction.vacancyRows.map((r) => ({ post: r.label, count: r.count }))
      : null;

  const flaggedLabels = new Set(flagged.map((f) => f.label));
  const candidates: AssistCandidate[] = [
    { fieldPath: "identity.title",              label: "Title",               value: title },
    { fieldPath: "identity.notificationNumber", label: "Notification Number", value: notificationNumber },
    { fieldPath: "dates.notificationDate",      label: "Notification Date",   value: extraction.postDate ?? null },
    { fieldPath: "dates.applicationOpenDate",   label: "Application Opens",   value: openDate },
    { fieldPath: "dates.applicationCloseDate",  label: "Application Closes",  value: closeDate },
    { fieldPath: "vacancies.total",             label: "Total Vacancies",     value: totalVacancies },
    { fieldPath: "vacancies.breakdown",         label: "Vacancy Breakdown",   value: breakdown },
  ].filter((c) => !(c.value === null && flaggedLabels.has(c.label)));

  // Year evidence: only values that survived the safeguards, plus the opening
  // lines of a PDF (where the notice heading sits).
  const yearText = [
    title ?? "",
    openDate ?? "",
    closeDate ?? "",
    extraction.postDate ?? "",
    kind === "pdf" ? content.slice(0, 600) : "",
  ].join(" ");

  return {
    candidates,
    flagged,
    detected: { organization: detectOrganization(url), years: yearsIn(yearText) },
  };
}

// ─── Fee extraction (Gemini + evidence verification) ──────

const FEE_STRONG_RE = /application\s+fees?|intimation\s+charges?|examination\s+fees?|exam\s+fees?|registration\s+fees?|fee\s+(?:structure|details|payable)/gi;
const FEE_WEAK_RE = /\bfees?\b/gi;
const FEE_WINDOW_BEFORE = 200;
const FEE_WINDOW_AFTER = 1600;
const MAX_FEE_SECTIONS = 2;
const MAX_FEE_CANDIDATE_WINDOWS = 20;
const FEE_AMOUNT_RE = /(?:Rs\.?|₹|INR)\s*\d[\d,]*|\d[\d,]*\s*\/-|\bnil\b|\bno\s+fees?\b|\bexempt(?:ed)?\b/gi;

function plainSection(heading: string, text: string): PageSection {
  return { type: "financial", heading, text, rawHtml: "", tables: [], lists: [], links: [], paragraphs: [] };
}

// Sections that actually discuss fees. Returns [] when the source has none,
// in which case Gemini must not be called.
export function buildFeeSections(content: string, kind: SourceKind, url: string): PageSection[] {
  if (kind === "html") {
    return structureDocument(content, url)
      .sections.filter(
        (s) =>
          s.heading &&
          s.text.trim().length > 0 &&
          (s.type === "financial" || /\bfees?\b/i.test(s.heading) || /\bfees?\b/i.test(s.text)),
      )
      .slice(0, MAX_FEE_SECTIONS);
  }

  let matches = [...content.matchAll(FEE_STRONG_RE)];
  if (matches.length === 0) matches = [...content.matchAll(FEE_WEAK_RE)];

  // Long notices mention "fee" many times (date tables, instructions). Keep only
  // passages that actually state an amount or an exemption, densest first.
  const windows: Array<{ start: number; end: number; amounts: number }> = [];
  for (const m of matches) {
    const start = Math.max(0, (m.index ?? 0) - FEE_WINDOW_BEFORE);
    const end = Math.min(content.length, (m.index ?? 0) + FEE_WINDOW_AFTER);
    const last = windows[windows.length - 1];
    if (last && start <= last.end) continue;
    const amounts = content.slice(start, end).match(FEE_AMOUNT_RE)?.length ?? 0;
    if (amounts > 0) windows.push({ start, end, amounts });
    if (windows.length === MAX_FEE_CANDIDATE_WINDOWS) break;
  }
  return windows
    .sort((a, b) => b.amounts - a.amounts || a.start - b.start)
    .slice(0, MAX_FEE_SECTIONS)
    .sort((a, b) => a.start - b.start)
    .map((w, i) => plainSection(`Fee section ${i + 1}`, content.slice(w.start, w.end)));
}

// The quoted evidence must itself state the amount.
export function feeValueSupported(value: number, evidence: string): boolean {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) return false;
  const e = evidence.replace(/(\d),(?=\d)/g, "$1");
  // A preceding digit or "digit." means the number is part of a longer one
  // ("1850", "1.850"). A bare dot does not: notices write "Rs.850/-".
  if (value === 0) return /\bnil\b|\bexempt(?:ed|ion)?\b|\bno\s+fees?\b|\bfree\b|(?<!\d)(?<!\d\.)0(?!\d)(?!\.\d)/i.test(e);
  return new RegExp(`(?<!\\d)(?<!\\d\\.)${value}(?!\\d)`).test(e);
}

export type FeeOutcome =
  | { status: "accepted"; value: number }
  | { status: "not_stated" }
  | { status: "rejected"; value: number; reason: string }
  | { status: "skipped"; reason: string };

function judgeFee(
  candidate: ExtractionCandidate<number> | undefined,
  sections: PageSection[],
): FeeOutcome {
  if (!candidate) return { status: "not_stated" };
  const check = verifyEvidence(candidate, sections);
  if (!check.valid) {
    return { status: "rejected", value: candidate.value, reason: "AI quote not found in the source text" };
  }
  if (!feeValueSupported(candidate.value, candidate.evidence)) {
    return { status: "rejected", value: candidate.value, reason: "amount does not appear in the quoted source text" };
  }
  return { status: "accepted", value: candidate.value };
}

// The 512-token provider default is consumed by model "thinking" tokens,
// truncating the JSON answer, so this call sets its own limit.
export const FEE_MAX_OUTPUT_TOKENS = 4096;

export function resolveFeeMaxOutputTokens(envValue: string | undefined): number {
  const n = envValue ? parseInt(envValue, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : FEE_MAX_OUTPUT_TOKENS;
}

// Built from the HTTP status only. Provider error text can embed the request
// URL, which carries the API key, so it is never surfaced.
export function feeFailureMessage(httpStatus: number): string {
  if (httpStatus === 429) return "AI rate limit reached — wait a minute and try again";
  if (httpStatus === 404) return "configured AI model is not available";
  if (httpStatus === 401 || httpStatus === 403) return "AI key was rejected";
  if (httpStatus >= 200 && httpStatus < 300) return "AI response was incomplete";
  return "AI service unavailable";
}

// Never throws. Called only from the user-triggered AI Assist request.
export async function extractFees(opts: {
  sections: PageSection[];
  url: string;
  apiKey: string | undefined;
  fetchFn?: typeof fetch;
  maxOutputTokens?: number;
}): Promise<{ general: FeeOutcome; scst: FeeOutcome }> {
  const skip = (reason: string) => {
    const o: FeeOutcome = { status: "skipped", reason };
    return { general: o, scst: o };
  };
  if (opts.sections.length === 0) return skip("no fee section in the source");
  if (!opts.apiKey) return skip("AI extraction not configured");

  const baseFetch = opts.fetchFn ?? globalThis.fetch;
  let lastStatus = 0;
  // The provider retries a 429 twice; retrying a rate limit only deepens it.
  // Hand it a plain client error instead so it stops after one attempt.
  const guardedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await baseFetch(input, init);
    lastStatus = response.status;
    return response.status === 429 ? new Response(null, { status: 400 }) : response;
  }) as typeof fetch;

  try {
    const provider = new GeminiExtractionProvider({
      apiKey: opts.apiKey,
      fetchFn: guardedFetch,
      maxOutputTokens:
        opts.maxOutputTokens ?? resolveFeeMaxOutputTokens(process.env.GEMINI_MAX_OUTPUT_TOKENS),
    });
    const result = await provider.extractFromSections(opts.sections, opts.url);
    if (provider.lastError) return skip(feeFailureMessage(lastStatus));
    return {
      general: judgeFee(result.applicationFeeGeneral, opts.sections),
      scst: judgeFee(result.applicationFeeSCST, opts.sections),
    };
  } catch {
    return skip(feeFailureMessage(lastStatus));
  }
}
