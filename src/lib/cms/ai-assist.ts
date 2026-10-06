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
import { structureDocument, normalizeForMatching } from "@/intelligence/page-structurer";
import { verifyEvidence } from "@/intelligence/structured-extractor";
import { DEFAULT_GEMINI_MODEL } from "@/intelligence/gemini-extraction-provider";
import { buildAiField } from "@/lib/cms/ai-assist-apply";

// ─── Field helpers ────────────────────────────────────────

export function isEmpty(field: ProvenanceField<unknown> | undefined | null): boolean {
  if (!field) return true;
  if (field.status === "NOT_SPECIFIED") return true;
  const v = field.value;
  if (Array.isArray(v)) return v.length === 0;
  return v === null || v === undefined || v === "";
}

export function pending<T>(value: T): ProvenanceField<T> {
  return buildAiField(value);
}

export function readField(
  record: RecruitmentRecord,
  fieldPath: string,
): ProvenanceField<unknown> | undefined {
  // Whole-block fields.
  if (fieldPath === "eligibility") return record.eligibility as ProvenanceField<unknown> | undefined;
  if (fieldPath === "age") return record.age as ProvenanceField<unknown> | undefined;
  if (fieldPath === "selection") return record.selection as ProvenanceField<unknown> | undefined;
  if (fieldPath === "examPattern") return record.examPattern as ProvenanceField<unknown> | undefined;
  if (fieldPath === "syllabus") return record.syllabus as ProvenanceField<unknown> | undefined;
  // A plain list on the record; presented in field shape so the same
  // fill-or-suggest logic applies.
  if (fieldPath === "howToApply") {
    const steps = record.howToApply ?? [];
    return steps.length > 0 ? buildAiField<unknown>(steps) : undefined;
  }

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

// Returns why a value is unlikely to be a notification number, or null if it looks fine.
export function notificationNumberIssue(value: string): string | null {
  const trimmed = value.trim();
  const tokens = trimmed.split(/[\s\/\-,&()]+/).filter(Boolean);
  if (tokens.length === 0) return "is empty";
  if (tokens.every((t) => QUALIFICATION_TOKEN_RE.test(t.replace(/\.$/, "")))) {
    return "looks like a qualification label, not a notification number";
  }
  // "CHSL 2026", "NTPC 2025": aggregator pages label the exam name and year
  // as the notification. Real numbers carry more structure ("CEN 05/2026").
  if (/^[A-Za-z]+\s+(?:19|20)\d{2}$/.test(trimmed)) {
    return "looks like an exam name and year, not a notification number";
  }
  return null;
}

export function isSuspiciousNotificationNumber(value: string): boolean {
  return notificationNumberIssue(value) !== null;
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
  const numberIssue = notificationNumber !== null ? notificationNumberIssue(notificationNumber) : null;
  if (numberIssue) {
    flagged.push({ label: "Notification Number", value: notificationNumber, reason: `${numberIssue} — not applied` });
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
  } else if (openDate !== null && closeDate !== null && openDate > closeDate) {
    // ISO dates compare correctly as strings. An opening date after the closing
    // date means at least one of them is some other date from the page.
    const reason = "opening date is after the closing date — check the notification and enter manually";
    flagged.push({ label: "Application Opens", value: openDate, reason });
    flagged.push({ label: "Application Closes", value: closeDate, reason });
    openDate = null;
    closeDate = null;
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

// ─── Date extraction (Gemini + evidence verification) ─────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const ORD = "(?:st|nd|rd|th)?";

/** Every calendar date written in the text, as ISO strings. */
export function parseDatesInText(text: string): string[] {
  const found = new Set<string>();
  const add = (d: string, m: string | number, y: string) => {
    const iso = toIsoDate(d, String(m), y);
    if (iso) found.add(iso);
  };
  const month = (name: string) => MONTHS[name.toLowerCase().replace(/\.$/, "")];

  for (const m of text.matchAll(/(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g)) add(m[3], m[2], m[1]);
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?!\d)/g)) add(m[1], m[2], m[3]);
  // "7th September 2026", "07 Sep, 2026"
  for (const m of text.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})${ORD}[\\s.,-]*([A-Za-z]{3,9})\\.?,?\\s*(20\\d{2})(?!\\d)`, "g"))) {
    if (month(m[2])) add(m[1], month(m[2]), m[3]);
  }
  // "September 7, 2026"
  for (const m of text.matchAll(new RegExp(`\\b([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})${ORD},?\\s+(20\\d{2})(?!\\d)`, "g"))) {
    if (month(m[1])) add(m[2], month(m[1]), m[3]);
  }
  // "14 to 16 October 2026": the first day borrows the month and year.
  for (const m of text.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s*(?:to|-|–|and)\\s*(\\d{1,2})${ORD}\\s+([A-Za-z]{3,9})\\.?,?\\s*(20\\d{2})(?!\\d)`, "gi"))) {
    if (month(m[3])) { add(m[1], month(m[3]), m[4]); add(m[2], month(m[3]), m[4]); }
  }
  // "7th September to 7th October 2026": the first date borrows the year.
  for (const m of text.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s+([A-Za-z]{3,9})\\.?\\s*(?:to|-|–|till|until)\\s*\\d{1,2}${ORD}\\s+[A-Za-z]{3,9}\\.?,?\\s*(20\\d{2})(?!\\d)`, "gi"))) {
    if (month(m[2])) add(m[1], month(m[2]), m[3]);
  }
  return [...found].sort();
}

const DATE_KEYWORD_RE =
  /last\s+date|closing\s+date|start(?:ing)?\s+date|opening\s+date|apply\s+online|online\s+application|registration|application\s+(?:start|begin|open|clos)|fee\s+payment|correction|important\s+dates/i;
const MAX_DATE_SECTIONS = 2;
const DATE_WINDOW = 3200;

// Passages that state application dates. [] when the source has none.
export function buildDateSections(content: string, kind: SourceKind, url: string): PageSection[] {
  const blocks =
    kind === "html"
      ? structureDocument(content, url).sections.map((s) => s.text).filter((t) => t.trim().length > 0)
      : [content];

  const scored: Array<{ text: string; dates: number; order: number }> = [];
  let order = 0;
  for (const block of blocks) {
    // Walk the block in windows so a long notice yields its densest passages.
    for (let start = 0; start < block.length; start += DATE_WINDOW) {
      const text = block.slice(Math.max(0, start - 200), start + DATE_WINDOW);
      if (!DATE_KEYWORD_RE.test(text)) continue;
      const dates = parseDatesInText(text).length;
      if (dates > 0) scored.push({ text, dates, order: order++ });
    }
  }
  return scored
    .sort((a, b) => b.dates - a.dates || a.order - b.order)
    .slice(0, MAX_DATE_SECTIONS)
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...plainSection(`Dates section ${i + 1}`, s.text), type: "dates" as const }));
}

export type DateField = "applicationOpenDate" | "applicationCloseDate" | "feePaymentCloseDate" | "correctionWindowEnd";

export type DateOutcome =
  | { status: "accepted"; value: string }
  | { status: "not_stated" }
  | { status: "rejected"; value: string; reason: string }
  | { status: "skipped"; reason: string };

const CORRECTION_RE = /correction|edit\s+window|modif|rectif/i;
const FEE_PAYMENT_RE = /fee\s+payment|payment\s+of\s+(?:the\s+)?(?:application\s+)?fee|pay(?:ing)?\s+(?:the\s+)?fee/i;

// A date is accepted only when its quote is in the source, the quote contains
// that exact date, and the quote is about the right event.
export function judgeDate(
  field: DateField,
  candidate: ExtractionCandidate<string> | undefined,
  sections: PageSection[],
): DateOutcome {
  if (!candidate) return { status: "not_stated" };
  const value = candidate.value;
  const reject = (reason: string): DateOutcome => ({ status: "rejected", value, reason });

  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return reject("AI returned a date in an unexpected format");
  if (!verifyEvidence(candidate, sections).valid) return reject("AI quote not found in the source text");
  if (!parseDatesInText(candidate.evidence).includes(value)) {
    return reject("date does not appear in the quoted source text");
  }

  const quote = candidate.evidence;
  const isApplicationDate = field === "applicationOpenDate" || field === "applicationCloseDate";
  if (isApplicationDate && CORRECTION_RE.test(quote)) {
    return reject("the quote is about the correction window, not the application period");
  }
  if (field === "applicationCloseDate" && FEE_PAYMENT_RE.test(quote) && !/appl|submi|regist/i.test(quote)) {
    return reject("the quote is about fee payment, not the application closing date");
  }
  if (field === "feePaymentCloseDate" && !/fee|payment/i.test(quote)) {
    return reject("the quote does not mention fee payment");
  }
  if (field === "correctionWindowEnd" && !CORRECTION_RE.test(quote)) {
    return reject("the quote does not mention the correction window");
  }
  return { status: "accepted", value };
}

// ─── One Gemini call per Assist click ─────────────────────

const AI_SECTION_TEXT_LIMIT = 4000;
const AI_TIMEOUT_MS = 30_000;

export function buildAiPrompt(sections: PageSection[], url: string): string {
  const block = sections.map((s) => `## Section: ${s.heading}\n${s.text.slice(0, AI_SECTION_TEXT_LIMIT)}`).join("\n\n");
  return `You are extracting facts from an Indian government recruitment notice or a page describing one.

Source URL: ${url}

${block}

---

Return JSON with any of the fields below. Include a field ONLY when the text above states it. Never guess.

Each field is an object: { "value": ..., "evidence": "...", "sectionHeading": "..." }
- "evidence": a verbatim quote (10–200 characters) copied from the text, containing the value itself and the words that say what it is.
- "sectionHeading": the heading exactly as written after "## Section:".

Fields:
- "applicationFeeGeneral": integer rupees for General/UR/OBC/"all others". No currency symbols.
- "applicationFeeSCST": integer rupees for SC/ST/PwBD. Use 0 only when the text says nil, exempt or no fee.
- "applicationOpenDate": first day candidates can submit the online application. "YYYY-MM-DD".
- "applicationCloseDate": last day to submit the online application. "YYYY-MM-DD".
- "feePaymentCloseDate": last day to pay the application fee, only if stated separately. "YYYY-MM-DD".
- "correctionWindowEnd": last day of the application correction/edit window. "YYYY-MM-DD".
- "notificationNumber": the official notification, advertisement or file number exactly as written (for example "CEN 05/2026" or "F. No. HQ-C1102/5/2026-C-1"). Not the exam name.

Return one JSON object, not a list.

Rules:
1. Correction or edit window dates are NOT application dates.
2. Exam, admit card and result dates are NOT application dates.
3. The fee payment deadline is NOT the application closing date unless the text says they are the same.`;
}

export interface AiExtraction {
  fees: { general: FeeOutcome; scst: FeeOutcome };
  dates: Record<DateField, DateOutcome>;
  notificationNumber: DateOutcome;
}

const NUMBER_LABEL_RE = /notif|advt|advertisement|\bf\.?\s*no\b|\bno\.?\s*:/i;

// Accepted only when the quote is in the source, names it as a notification or
// advertisement number, and contains the value itself.
export function judgeNotificationNumber(
  candidate: ExtractionCandidate<string> | undefined,
  sections: PageSection[],
): DateOutcome {
  if (!candidate) return { status: "not_stated" };
  const value = candidate.value.trim();
  const reject = (reason: string): DateOutcome => ({ status: "rejected", value, reason });

  if (value.length < 3 || value.length > 60) return reject("AI returned an implausible notification number");
  const issue = notificationNumberIssue(value);
  if (issue) return reject(issue);
  if (!verifyEvidence(candidate, sections).valid) return reject("AI quote not found in the source text");
  if (!normalizeForMatching(candidate.evidence).includes(normalizeForMatching(value))) {
    return reject("number does not appear in the quoted source text");
  }
  if (!NUMBER_LABEL_RE.test(candidate.evidence)) {
    return reject("the quote does not call it a notification or advertisement number");
  }
  return { status: "accepted", value };
}

const DATE_FIELDS: DateField[] = ["applicationOpenDate", "applicationCloseDate", "feePaymentCloseDate", "correctionWindowEnd"];

function asCandidate<T extends "number" | "string">(
  raw: unknown,
  type: T,
): ExtractionCandidate<T extends "number" ? number : string> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const c = raw as { value?: unknown; evidence?: unknown; sectionHeading?: unknown };
  if (typeof c.value !== type) return undefined;
  if (type === "number" && !Number.isFinite(c.value as number)) return undefined;
  if (typeof c.evidence !== "string" || c.evidence.trim().length < 3) return undefined;
  if (typeof c.sectionHeading !== "string" || !c.sectionHeading) return undefined;
  return { value: c.value, evidence: c.evidence, sectionHeading: c.sectionHeading, confidence: "medium" } as ExtractionCandidate<
    T extends "number" ? number : string
  >;
}

export type AiJsonAnswer = { ok: true; data: Record<string, unknown> } | { ok: false; reason: string };

// One JSON request to the configured model. Never throws, never retries
// (retrying a rate limit only deepens it), and never surfaces error text:
// it can carry the request URL, which holds the API key.
export async function callAiJson(opts: {
  prompt: string;
  apiKey: string | undefined;
  fetchFn?: typeof fetch;
  maxOutputTokens?: number;
}): Promise<AiJsonAnswer> {
  if (!opts.apiKey) return { ok: false, reason: "AI extraction not configured" };

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let status = 0;

  try {
    const response = await (opts.fetchFn ?? globalThis.fetch)(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: opts.maxOutputTokens ?? resolveFeeMaxOutputTokens(process.env.GEMINI_MAX_OUTPUT_TOKENS),
        },
      }),
      signal: controller.signal,
    });
    status = response.status;
    if (!response.ok) return { ok: false, reason: feeFailureMessage(status) };

    const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    // Models sometimes wrap the object in a one-element list.
    const parsed: unknown = JSON.parse(text);
    const data = (Array.isArray(parsed) ? parsed[0] : parsed) ?? {};
    return { ok: true, data: data as Record<string, unknown> };
  } catch {
    return { ok: false, reason: feeFailureMessage(status) };
  } finally {
    clearTimeout(timer);
  }
}

// Never throws. Called only from the user-triggered AI Assist request.
export async function extractWithAi(opts: {
  sections: PageSection[];
  url: string;
  apiKey: string | undefined;
  fetchFn?: typeof fetch;
  maxOutputTokens?: number;
}): Promise<AiExtraction> {
  const skipAll = (reason: string): AiExtraction => {
    const fee: FeeOutcome = { status: "skipped", reason };
    const date: DateOutcome = { status: "skipped", reason };
    return {
      fees: { general: fee, scst: fee },
      dates: { applicationOpenDate: date, applicationCloseDate: date, feePaymentCloseDate: date, correctionWindowEnd: date },
      notificationNumber: { status: "skipped", reason },
    };
  };
  if (opts.sections.length === 0) return skipAll("nothing relevant found in the source");

  const answer = await callAiJson({ ...opts, prompt: buildAiPrompt(opts.sections, opts.url) });
  if (!answer.ok) return skipAll(answer.reason);
  const raw = answer.data;

  const dates = {} as Record<DateField, DateOutcome>;
  for (const field of DATE_FIELDS) dates[field] = judgeDate(field, asCandidate(raw[field], "string"), opts.sections);
  return {
    fees: {
      general: judgeFee(asCandidate(raw.applicationFeeGeneral, "number"), opts.sections),
      scst: judgeFee(asCandidate(raw.applicationFeeSCST, "number"), opts.sections),
    },
    dates,
    notificationNumber: judgeNotificationNumber(asCandidate(raw.notificationNumber, "string"), opts.sections),
  };
}

/** Fees only. Same request path as extractWithAi. */
export async function extractFees(opts: {
  sections: PageSection[];
  url: string;
  apiKey: string | undefined;
  fetchFn?: typeof fetch;
  maxOutputTokens?: number;
}): Promise<{ general: FeeOutcome; scst: FeeOutcome }> {
  return (await extractWithAi(opts)).fees;
}

/** Fee and date passages for one AI call, with unique headings. */
export function buildAiSections(content: string, kind: SourceKind, url: string): PageSection[] {
  const fee = buildFeeSections(content, kind, url).map((s, i) => ({ ...s, heading: `Fee section ${i + 1}` }));
  const all = [...fee, ...buildDateSections(content, kind, url), ...buildNumberSection(content, kind, url)];

  // The same passage often qualifies twice (a dates table mentions "fee payment").
  const seen = new Set<string>();
  return all.filter((s) => {
    const key = s.text.replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NUMBER_PASSAGE_RE = /(?:notification|advt\.?|advertisement)\s*(?:no|number)\b\.?|\bF\.\s*No\b\.?/i;

/** The passage that states the notification number, if any. */
export function buildNumberSection(content: string, kind: SourceKind, url: string): PageSection[] {
  const blocks =
    kind === "html" ? structureDocument(content, url).sections.map((s) => s.text) : [content];
  for (const block of blocks) {
    const m = NUMBER_PASSAGE_RE.exec(block);
    if (!m) continue;
    const text = block.slice(Math.max(0, m.index - 150), m.index + 350);
    return [{ ...plainSection("Notification section", text), type: "overview" as const }];
  }
  return [];
}

// Deterministic and AI values must agree; where only one exists it is used.
export function mergeAiNotificationNumber(
  base: { candidates: AssistCandidate[]; flagged: AssistFlag[] },
  outcome: DateOutcome,
): { candidates: AssistCandidate[]; flagged: AssistFlag[] } {
  const label = "Notification Number";
  const fieldPath = "identity.notificationNumber";
  const deterministic = base.candidates.find((c) => c.fieldPath === fieldPath)?.value as string | null | undefined;
  const aiValue = outcome.status === "accepted" ? outcome.value : null;
  // A verified number supersedes an earlier "that is not a notification number" flag.
  const flagged = aiValue && !deterministic ? base.flagged.filter((f) => f.label !== label) : [...base.flagged];

  if (outcome.status === "rejected") {
    flagged.push({ label, value: outcome.value, reason: `${outcome.reason} — not applied` });
  }

  let value: string | null = deterministic || aiValue || null;
  const same = (a: string, b: string) => normalizeForMatching(a) === normalizeForMatching(b);
  if (deterministic && aiValue && !same(deterministic, aiValue)) {
    flagged.push({ label, value: `${deterministic} or ${aiValue}`, reason: "two extraction methods disagree — check the notification and enter manually" });
    value = null;
  }

  const candidates = base.candidates.filter((c) => c.fieldPath !== fieldPath);
  if (value !== null || !flagged.some((f) => f.label === label)) {
    candidates.unshift({ fieldPath, label, value });
  }
  return { candidates, flagged };
}

// ─── Merging AI dates into the deterministic result ───────

const DATE_LABELS: Record<DateField, string> = {
  applicationOpenDate: "Application Opens",
  applicationCloseDate: "Application Closes",
  feePaymentCloseDate: "Fee Payment Deadline",
  correctionWindowEnd: "Correction Window End",
};

// Deterministic and AI values must agree. Where only one exists it is used;
// where they differ, neither is applied and both are shown for manual check.
export function mergeAiDates(
  base: { candidates: AssistCandidate[]; flagged: AssistFlag[] },
  ai: Record<DateField, DateOutcome>,
): { candidates: AssistCandidate[]; flagged: AssistFlag[] } {
  const candidates = base.candidates.filter((c) => !c.fieldPath.startsWith("dates.") || c.fieldPath === "dates.notificationDate");
  let flagged = [...base.flagged];
  const resolved: Partial<Record<DateField, string | null>> = {};

  for (const field of DATE_FIELDS) {
    const label = DATE_LABELS[field];
    const fieldPath = `dates.${field}`;
    const deterministic = base.candidates.find((c) => c.fieldPath === fieldPath)?.value as string | null | undefined;
    const outcome = ai[field];
    const aiValue = outcome.status === "accepted" ? outcome.value : null;

    if (outcome.status === "rejected") {
      flagged.push({ label, value: outcome.value, reason: `${outcome.reason} — not applied` });
    }

    if (deterministic && aiValue && deterministic !== aiValue) {
      flagged.push({ label, value: `${deterministic} or ${aiValue}`, reason: "two extraction methods disagree — check the notification and enter manually" });
      resolved[field] = null;
    } else if (deterministic || aiValue) {
      resolved[field] = deterministic || aiValue;
      // A verified AI value supersedes an earlier "could not trust the dates" flag.
      if (!deterministic && aiValue) flagged = flagged.filter((f) => !(f.label === label && /identical|after the closing date/.test(f.reason)));
    } else {
      resolved[field] = null;
    }
  }

  const open = resolved.applicationOpenDate;
  const close = resolved.applicationCloseDate;
  if (open && close && open > close) {
    const reason = "opening date is after the closing date — check the notification and enter manually";
    flagged.push({ label: DATE_LABELS.applicationOpenDate, value: open, reason });
    flagged.push({ label: DATE_LABELS.applicationCloseDate, value: close, reason });
    resolved.applicationOpenDate = null;
    resolved.applicationCloseDate = null;
  }

  const flaggedLabels = new Set(flagged.map((f) => f.label));
  for (const field of DATE_FIELDS) {
    const value = resolved[field] ?? null;
    if (value === null && flaggedLabels.has(DATE_LABELS[field])) continue;
    candidates.push({ fieldPath: `dates.${field}`, label: DATE_LABELS[field], value });
  }
  return { candidates, flagged };
}
