// ═══════════════════════════════════════════════════════════
// Phase 8C: Recruitment Intake — Hardened Core Module (PDF extraction)
// ═══════════════════════════════════════════════════════════
//
// Two-stage intake pipeline:
//   Stage A — fetch and classify the submitted URL (may be third-party)
//   Stage B — if an official source is discovered, automatically fetch
//             and extract from it; official-page fields override Stage A
//
// Org identification hierarchy (most trusted first):
//   1. Official source domain (from discovered official links)
//   2. Title / h1 of the official page (Stage B, if fetched)
//   3. Title / h1 of the submitted page
//   4. First 2000 chars of main body text (limited scan)
//   — NEVER the full third-party HTML (avoids sidebar/ad pollution)
//
// INVARIANTS (non-negotiable):
//   - application.openDate / closeDate / notificationDate are NEVER
//     defaulted to today. Missing dates stay "TBA".
//   - totalVacancies missing → 0 placeholder + missingFields entry
//   - primarySourceUrl is NEVER set to a third-party aggregator URL
//   - provenance.status is ALWAYS "NOT_VERIFIED" from this module
//   - A Trust Gate failure blocks PR creation but does NOT block
//     the candidate save — the user completes missing fields first
// ═══════════════════════════════════════════════════════════

import type { GovernmentRecruitment, Opportunity } from "@/types";
import type { CandidateNewRecruitment } from "./types";
import type { ValidationError } from "@/lib/validation";
import {
  normalizeNotificationNumber,
  normalizeSourceUrl,
  buildTitleSimilarityKey,
  buildCandidateId,
  isDuplicateOfCanonical,
  isDuplicateCandidate,
} from "./dedup";
import { generateSlug, generateRecordId } from "./new-record-factory";
import { deriveOrgName, extractLinks, extractNotificationNumber } from "./discovery";
import { extractPdfText } from "./pdf-extractor";
import {
  OFFICIAL_DOMAINS,
  KNOWN_AGGREGATORS,
  OFFICIAL_DOMAIN_PATTERNS,
  STATE_DOMAIN_SUFFIXES,
  OFFICIAL_DOMAIN_LABELS,
  ORG_DOMAIN,
  ORG_CATEGORY,
  ORG_GOV_TYPE,
  ORG_QUALIFICATION,
} from "./org-registry";
export type { FetchPdfFn } from "./pdf-extractor";

// ─── Types ───────────────────────────────────────────────────

export type SourceKind = "OFFICIAL" | "THIRD_PARTY" | "UNKNOWN";

// Source authority tier — controls which extraction wins in mergeExtractions.
// OFFICIAL_PDF unconditionally beats all tiers for specificity-guarded fields.
// OFFICIAL_GENERIC (generic org homepage) must not supply any recruitment-specific
// canonical field — it lists multiple recruitments and cannot be attributed.
export type ExtractionSourceKind =
  | "OFFICIAL_PDF"      // Specific recruitment PDF — highest authority
  | "OFFICIAL_SPECIFIC" // Specific official recruitment page (deep URL path)
  | "OFFICIAL_GENERIC"  // Generic org homepage (root/short path)
  | "THIRD_PARTY"       // Aggregators and unverified sources
  | "UNKNOWN";          // Unclassified

// PDF text quality classification.
// TEXT_SUFFICIENT  — well-formed text layer; extraction reliable.
// TEXT_PARTIAL     — moderate text present but likely incomplete (e.g. multilingual
//                    PDF where non-Unicode font encoding silently dropped a script).
// OCR_REQUIRED     — text layer absent or too sparse; manual OCR needed.
export type PdfTextQuality = "TEXT_SUFFICIENT" | "TEXT_PARTIAL" | "OCR_REQUIRED";

export interface SourceClassification {
  kind: SourceKind;
  domain: string;
  orgId?: string;
  orgName?: string;
  aggregatorName?: string;
  isDiscoveryLeadOnly: boolean;
}

export interface OfficialSourceResult {
  found: boolean;
  url?: string;
  method: "submitted-url" | "official-link-in-page" | "none";
  note: string;
}

export interface IntakeExtraction {
  title?: string;
  notificationNumber?: string;
  totalVacancies?: number;
  postDate?: string;
  applicationOpenDate?: string;
  applicationCloseDate?: string;
  notifPdfUrl?: string;
  // Set when multiple official PDFs tie on ranking score and none can be chosen.
  // notifPdfUrl is undefined in this case — Stage C is skipped until resolved.
  ambiguousPdfCandidates?: string[];
  officialLinksFound: string[];
  rawExcerpt: string;
  confidence: number;
  specificity: number; // 0.0–1.0 — recruitment-specific evidence strength
  // Authority tier: controls field precedence in mergeExtractions.
  // OFFICIAL_PDF wins unconditionally for guarded fields; OFFICIAL_GENERIC must
  // never supply recruitment-specific canonical fields.
  sourceKind: ExtractionSourceKind;
  // Set only for OFFICIAL_PDF extractions; indicates whether the PDF text layer
  // is reliable enough for field extraction.
  pdfTextQuality?: PdfTextQuality;
}

// Evidence chain: tracks each source that contributed to the final draft
export interface EvidenceStep {
  url: string;
  sourceKind: SourceKind | "OFFICIAL_PDF";
  label: string;
  fieldsContributed: string[];
}

export interface IntakeResult {
  sourceUrl: string;
  classification: SourceClassification;
  officialSource: OfficialSourceResult;
  extraction: IntakeExtraction;
  officialPageExtraction?: IntakeExtraction; // Stage B extraction (if ran)
  pdfExtraction?: IntakeExtraction;           // Stage C PDF extraction (if ran)
  evidenceChain: EvidenceStep[];
  candidate: CandidateNewRecruitment | null;
  draft: GovernmentRecruitment | null;
  missingFields: string[];
  isDuplicate: boolean;
  duplicateReason?: string;
  duplicateMatchId?: string;
  trustGatePassed: boolean;
  trustGateErrors: ValidationError[];
  trustGateWarnings: ValidationError[];
  analysisNotes: string[];
  candidateSaved: boolean;
  fieldSources: Record<string, string>; // field name → evidence step sourceKind
  error?: string;
}

// Injectable fetch function — real by default, overridden in tests
export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  html: string | null;
  error?: string;
}>;

// ─── Source classification ────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function classifySourceUrl(url: string): SourceClassification {
  let domain: string;
  try {
    domain = extractDomain(url);
  } catch {
    return { kind: "UNKNOWN", domain: url, isDiscoveryLeadOnly: true };
  }

  const orgId = OFFICIAL_DOMAINS[domain];
  if (orgId) {
    return {
      kind: "OFFICIAL",
      domain,
      orgId,
      orgName: deriveOrgName(orgId),
      isDiscoveryLeadOnly: false,
    };
  }

  if (OFFICIAL_DOMAIN_PATTERNS.some((p) => p.test(domain))) {
    return {
      kind: "OFFICIAL",
      domain,
      isDiscoveryLeadOnly: false,
    };
  }

  const aggregatorName = KNOWN_AGGREGATORS[domain];
  if (aggregatorName) {
    return {
      kind: "THIRD_PARTY",
      domain,
      aggregatorName,
      isDiscoveryLeadOnly: true,
    };
  }

  return { kind: "UNKNOWN", domain, isDiscoveryLeadOnly: true };
}

// ─── Org identification from official domain (Priority 1) ─────
//
// Uses the official source domain as the FIRST signal for org.
// This prevents third-party sidebar/ad content from polluting the result.

function humanizeOrgLabel(label: string): string {
  if (OFFICIAL_DOMAIN_LABELS[label]) return OFFICIAL_DOMAIN_LABELS[label];
  if (label.length <= 6) return label.toUpperCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

interface OrgInfo {
  orgId: string;
  orgName: string;
  govType: "Central Govt" | "State Govt" | "PSU Bank";
}

export function deriveOrgFromOfficialDomain(domain: string): OrgInfo | undefined {
  // Step 1: known registry
  const knownOrgId = OFFICIAL_DOMAINS[domain];
  if (knownOrgId) {
    return {
      orgId: knownOrgId,
      orgName: deriveOrgName(knownOrgId),
      govType: ORG_GOV_TYPE[knownOrgId] ?? "Central Govt",
    };
  }

  // Step 2: must be gov.in / nic.in to proceed
  if (!OFFICIAL_DOMAIN_PATTERNS.some((p) => p.test(domain))) return undefined;

  // Step 3: extract the first subdomain label
  const parts = domain.split(".");
  const label = parts[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!label || label.length < 2) return undefined;

  // Step 4: detect state vs central
  const isState = STATE_DOMAIN_SUFFIXES.some((s) => domain.endsWith(s));

  return {
    orgId: label,
    orgName: humanizeOrgLabel(label),
    govType: isState ? "State Govt" : "Central Govt",
  };
}

// ─── Known-org identification from limited text ───────────────
//
// ONLY used as fallback when official domain is not available.
// Matches known orgs only; unknown orgs fall through to deriveOrgFromOfficialDomain.
// Never call on full third-party HTML — call on title or limited body only.

function identifyKnownOrgFromText(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\bstaff selection commission\b/.test(t) || /\bssc\b/.test(t)) return "ssc";
  if (/\brailway recruitment board\b/.test(t) || /\brrb\b/.test(t) || /\bindian railways\b/.test(t)) return "rrb";
  if (/\bunion public service\b/.test(t) || /\bupsc\b/.test(t)) return "upsc";
  if (/\bbihar public service commission\b/.test(t) || /\bbpsc\b/.test(t)) return "bpsc";
  if (/\binstitute of banking personnel\b/.test(t) || /\bibps\b/.test(t)) return "ibps";
  if (/\bstate bank of india\b/.test(t) || /\bsbi\b/.test(t)) return "sbi";
  if (/\breserve bank\b/.test(t) || /\brbi\b/.test(t)) return "rbi";
  if (/\bnabard\b/.test(t)) return "nabard";
  if (/\blife insurance corporation\b/.test(t) || /\blic\b/.test(t)) return "lic";
  if (/\bindia post\b/.test(t) || /\bdepartment of posts\b/.test(t)) return "indiapost";
  return undefined;
}

// ─── Field extraction ─────────────────────────────────────────

const VACANCY_RE = [
  // Labeled patterns — require an explicit keyword adjacent to the number.
  // "Total Vacancies: 259", "Total Posts: 500", "No. of Posts: 150"
  // Negative lookahead (?!\s*[-–]\s*\d) prevents matching page ranges like "44-53".
  /total\s+(?:vacancies|posts?)[^0-9]{0,20}?(\d[\d,]+)(?!\s*[-–]\s*\d)/i,
  /no\.?\s+of\s+(?:vacancies|posts?)[^0-9]{0,20}?(\d[\d,]+)(?!\s*[-–]\s*\d)/i,
  // Proximity patterns — number followed or preceded by keyword within a short span.
  /(\d[\d,]+)(?!\s*[-–]\s*\d)\s+(?:posts?|vacanc(?:y|ies)|seats?)\b/i,
  /(?:posts?|vacanc(?:y|ies)|seats?)[^0-9]{0,20}?(\d[\d,]+)(?!\s*[-–]\s*\d)/i,
];

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDateFromText(text: string): string | undefined {
  // Supports DD/MM/YYYY, DD-MM-YYYY, and DD.MM.YYYY (common in government PDFs).
  const dmy = /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](20\d{2})\b/.exec(text);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    if (!isNaN(new Date(iso).getTime())) return iso;
  }
  const verbose = /\b(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-,]+(20\d{2})\b/.exec(text);
  if (verbose) {
    const m = MONTH_MAP[verbose[2].slice(0, 3).toLowerCase()];
    if (m) {
      const iso = `${verbose[3]}-${m}-${verbose[1].padStart(2, "0")}`;
      if (!isNaN(new Date(iso).getTime())) return iso;
    }
  }
  const ymd = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  return undefined;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// True for 4-digit calendar years (2020–2040). Guards against "2026 posts" in a
// page heading being misread as a vacancy count — real vacancies rarely equal a year.
function isCalendarYear(n: number): boolean {
  return n >= 2020 && n <= 2040;
}

// Specificity measures how recruitment-specific an extraction is.
// Generic org homepage → ~0; specific recruitment page → 0.55–1.0; PDF → ~1.0.
// Used by mergeExtractions so a generic homepage can't override a specific recruitment
// page for dates, vacancies, and the notification PDF URL.
function computeSpecificity(
  notificationNumber: string | undefined,
  totalVacancies: number | undefined,
  applicationOpenDate: string | undefined,
  applicationCloseDate: string | undefined,
  postDate: string | undefined
): number {
  let score = 0.0;
  if (notificationNumber) score += 0.35;
  if (applicationCloseDate) score += 0.25;
  if (applicationOpenDate) score += 0.20;
  if (postDate) score += 0.10;
  if (totalVacancies !== undefined && !isCalendarYear(totalVacancies)) score += 0.10;
  return Math.min(1.0, score);
}

interface RankedPdfsResult {
  ranked: string[];    // sorted by score descending; input order preserved on ties
  topScore: number;    // score of the first element
  ambiguous: boolean;  // true when ≥2 PDFs all score 0 — no context discriminated them
}

// Rank official PDF URLs by relevance to the current recruitment context.
// Accepts optional supplementaryContext that is appended before tokenising —
// used to inject Stage A's URL slug tokens when Stage B's own context is generic.
// Returns ambiguous=true when every PDF scores 0 (no discrimination possible).
function rankPdfsByRelevance(
  pdfUrls: string[],
  contextText: string,
  supplementaryContext?: string,
): RankedPdfsResult {
  if (pdfUrls.length === 0) return { ranked: [], topScore: 0, ambiguous: false };
  if (pdfUrls.length === 1) return { ranked: pdfUrls, topScore: 0, ambiguous: false };

  const combined = supplementaryContext ? contextText + " " + supplementaryContext : contextText;
  const tokens = combined.toLowerCase().split(/\W+/).filter(t => t.length >= 4 && !/^\d+$/.test(t));
  const scored = pdfUrls.map(url => ({
    url,
    score: tokens.reduce((s, token) => s + (url.toLowerCase().includes(token) ? 1 : 0), 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  // Ambiguous when the top-2 candidates share the same score — no single winner.
  // Domain tokens (e.g. "bcece" in bceceboard.bihar.gov.in) apply equally to
  // every PDF on that domain, so a topScore > 0 does not guarantee discrimination.
  const ambiguous = scored.length >= 2 && scored[1].score === topScore;
  return { ranked: scored.map(s => s.url), topScore, ambiguous };
}

// Extract meaningful recruitment-context tokens from a source URL's path.
// Used to inject Stage A context into Stage B's PDF ranking when Stage B's
// own page is a generic org homepage that can't discriminate its own PDFs.
// Tokens >= 4 chars, non-numeric, non-generic are kept.
const URL_SLUG_NOISE = new Set([
  "jobs", "recruitment", "apply", "sarkari", "govt", "government",
  "naukri", "application", "form", "online", "exam", "result",
  "admit", "card", "notification", "vacancy", "post", "latest",
  "news", "update", "alert", "free", "india", "2025", "2026", "2027",
]);

function extractUrlRecruitmentTokens(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.toLowerCase().split(/[\/-]+/);
    return parts
      .filter(t => t.length >= 4 && !/^\d+$/.test(t) && !URL_SLUG_NOISE.has(t))
      .join(" ");
  } catch {
    return "";
  }
}

function extractVacancies(text: string): number | undefined {
  for (const re of VACANCY_RE) {
    const m = re.exec(text);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      if (!isNaN(n) && n > 0 && n < 1_000_000) {
        if (isCalendarYear(n)) continue; // skip year values (e.g. "2026 posts") misread as vacancies
        return n;
      }
    }
  }
  return undefined;
}

// ─── Plain-text (PDF) extraction helpers ─────────────────────
//
// Government PDFs in regional languages (e.g. Hindi/Devanagari) are extracted
// by pdf-parse as English-only fragments — tables lose column headers, date
// labels disappear, and contact numbers appear without enough context to reject
// them without these guards. HTML pages retain enough structure for the standard
// extractNotificationNumber patterns. Plain-text mode uses safer, labeled-only
// patterns to avoid false positives.

// Lines rejected as title candidates in plain-text (PDF) mode.
const PLAIN_TEXT_TITLE_REJECT_RES = [
  /^\d{1,2}[.\/\-]\d{1,2}[.\/\-]20\d{2}$/, // date: DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY
  /^20\d{2}$/,                                // standalone year
  /^\d{1,4}$/,                                // page number or short number
  /^\d{3,6}[-\s]\d{5,12}$/,                  // phone/reference: 0612-2220230
  /^\([A-Za-z]{2,8}\)$/,                      // acronym marker: (CBT), (UR)
  /^-{4,}$|^\*{4,}$/,                         // horizontal rules
];

function isAcceptablePlainTextTitleLine(line: string): boolean {
  if (line.length < 10 || line.length >= 300) return false;
  if (/^https?:\/\//.test(line)) return false;
  return !PLAIN_TEXT_TITLE_REJECT_RES.some((re) => re.test(line));
}

// Heading keywords for plain-text title detection (no "vacancy/vacancies" — too common in body text).
const PLAIN_TEXT_HEADING_RE = /\b(?:prospectus|advertisement|advt|recruitment|notification)\b/i;

// Single-word or short-phrase generic document headings that appear on the first page of
// government PDFs but carry no meaningful title information. These are rejected so the
// extractor keeps scanning for the substantive title that follows on the next line(s).
const PLAIN_TEXT_GENERIC_HEADING_RES: RegExp[] = [
  /^NOTIFICATION$/i,
  /^NOTICE$/i,
  /^ADVERTISEMENT$/i,
  /^IMPORTANT\s+NOTICE$/i,
  /^IMPORTANT\s+INFORMATION$/i,
  /^CORRIGENDUM$/i,
];

function isGenericDocumentHeading(line: string): boolean {
  return PLAIN_TEXT_GENERIC_HEADING_RES.some((re) => re.test(line.trim()));
}

// Trailing preposition/article that signals the title continues on the next line,
// e.g. "COMMON RECRUITMENT PROCESS FOR" → next line completes the phrase.
const TITLE_HANGING_RE = /\b(?:for|of|in|on|by|to|at|and|the|with|an|a)\s*$/i;

// Extends a candidate title by concatenating subsequent lines when the current line
// ends with a hanging preposition or article. Stops at blank, generic-heading, or
// non-acceptable lines; never exceeds 20 total words; never descends into parentheticals.
function tryExtendTitle(lines: string[], lineIndex: number, base: string): string {
  let result = base;
  for (let j = lineIndex + 1; j < Math.min(lines.length, lineIndex + 5); j++) {
    if (!TITLE_HANGING_RE.test(result)) break;
    const next = lines[j].trim();
    if (!next || isGenericDocumentHeading(next) || !isAcceptablePlainTextTitleLine(next)) break;
    if (/^[([\{]/.test(next)) break;
    const extended = result + " " + next;
    if (extended.split(/\s+/).length > 20) break;
    result = extended;
  }
  return result;
}

// Prefer heading-keyword lines in the top of the document; fall back to the first short line.
// Both searches are bounded to avoid picking up body sentences from deep in the document.
function extractPlainTextTitle(text: string): string | undefined {
  const lines = text.split(/[\n\r]+/).map((l) => l.trim());
  // First pass: first 20 lines, has heading keyword, ≤ 12 words (excludes sentences).
  const TOP_HEADING = 20;
  for (let i = 0; i < Math.min(lines.length, TOP_HEADING); i++) {
    const l = lines[i];
    if (isAcceptablePlainTextTitleLine(l) && PLAIN_TEXT_HEADING_RE.test(l) && l.split(/\s+/).length <= 12
        && !isGenericDocumentHeading(l))
      return tryExtendTitle(lines, i, l);
  }
  // Second pass: first 10 lines, uppercase-start, ≤ 8 words (cover-page title only).
  const TOP_COVER = 10;
  for (let i = 0; i < Math.min(lines.length, TOP_COVER); i++) {
    const l = lines[i];
    if (isAcceptablePlainTextTitleLine(l) && /^[A-Z]/.test(l) && l.split(/\s+/).length <= 8
        && !isGenericDocumentHeading(l))
      return tryExtendTitle(lines, i, l);
  }
  return undefined;
}

// Returns true when the text immediately before matchIndex looks like a phone or
// contact context (e.g. "Helpdesk phone no. 0612-2220230").
function hasPhoneContext(text: string, matchIndex: number): boolean {
  const window = text.slice(Math.max(0, matchIndex - 150), matchIndex + 30);
  return /(?:helpdesk|phone|mobile|fax|tel\.?)\s*(?:no\.?)?\s*$/i.test(window);
}

// Tier 1: explicitly labeled advertisement/notification number.
// The label must immediately precede the code (within ~3 words).
const PLAIN_TEXT_ADVT_LABEL_RE =
  /(?:advertisement|advt\.?|advert\.?|notification)\s+no\.?\s*[:\-]?\s*([A-Z0-9()\-\/\.]{3,30}(?:\/\d{1,4})?)/i;

// Tier 2: structurally distinctive government recruitment codes.
// The format itself is an identifier — no explicit label required.
// Examples: BCECEB(BSFC)-2026/01, CEN-01/2026, SSC/CGL/01/2026
const PLAIN_TEXT_GOVT_CODE_RES = [
  /\b([A-Z]{2,12}(?:\([A-Z]{2,8}\))?[\-\/]\d{4}\/\d{1,2})\b/,  // BCECEB(BSFC)-2026/01
  /\b(CEN[\-\/]\d{2,3}\/\d{4})\b/i,                              // CEN-01/2026
  /\b([A-Z]{2,8}\/[A-Z]{2,8}\/\d{2}\/\d{4})\b/,                  // SSC/CGL/01/2026
];

// Tier 3: IBPS CRP process identifiers (e.g. CRP-PO/MT-XV, CRP-RRBs-XV).
// IBPS notifications use process names rather than labeled "Advertisement No." codes.
// Applied ONLY when the source is an authoritative ibps.in domain to prevent
// third-party text from triggering this pattern.
const IBPS_DOMAINS = new Set(["ibps.in", "www.ibps.in", "ibpsonline.ibps.in"]);
const IBPS_CRP_ID_RE = /\b(CRP[\s\-](?:PO\/MTs?|RRBs?|CLERKS?|SOs?|SPL)[\/\s\-]+[IVX]{1,8})\b/i;

// Safe notification-number extraction for plain-text (PDF) documents.
// Rejects generic "no." occurrences (helpdesk, page numbers, serial numbers).
// Returns the first explicitly labeled or structurally distinctive code, or undefined.
function extractNotificationNumberFromPlainText(text: string, sourceDomain?: string): string | undefined {
  // Tier 1: explicitly labeled
  const labelMatch = PLAIN_TEXT_ADVT_LABEL_RE.exec(text);
  if (labelMatch) {
    const idx = text.indexOf(labelMatch[0]);
    if (!hasPhoneContext(text, idx)) return labelMatch[1].trim();
  }
  // Tier 2: structurally distinctive (e.g. BCECEB(BSFC)-2026/01)
  for (const re of PLAIN_TEXT_GOVT_CODE_RES) {
    const m = re.exec(text);
    if (m) {
      const idx = text.indexOf(m[0]);
      if (!hasPhoneContext(text, idx)) return m[1].trim();
    }
  }
  // Tier 3: IBPS CRP process identifiers — only from authoritative IBPS sources.
  if (sourceDomain && IBPS_DOMAINS.has(sourceDomain)) {
    const crpMatch = IBPS_CRP_ID_RE.exec(text);
    if (crpMatch) return crpMatch[1].trim();
  }
  return undefined;
}

function extractApplicationDates(text: string): {
  openDate?: string;
  closeDate?: string;
  notificationDate?: string;
} {
  const result: { openDate?: string; closeDate?: string; notificationDate?: string } = {};

  // Date labels appear before the date value with either ":" or whitespace.
  // [:\s] matches both "Last Date: 24.09.2026" and "Last Date 24.09.2026".
  const closePatterns = [
    /(?:last\s+date|apply\s+by|closing\s+date|close\s+date|deadline|fee\s+(?:payment\s+)?last\s+date)[^:]{0,40}?[:\s]\s*(.{5,35}?(?:\d{4}))/i,
    /applications?\s+close[^:]{0,20}?[:\s]\s*(.{5,30}?(?:\d{4}))/i,
    /(?:before|upto?)\s+(.{5,25}?(?:\d{4}))/i,
    // "from DATE to DATE" range — captures the close (right-hand) date
    /from\s+.{5,30}?\d{4}\s+to\s+(.{5,25}?(?:\d{4}))/i,
  ];
  for (const re of closePatterns) {
    const m = re.exec(text);
    if (m) {
      const d = parseDateFromText(m[1]);
      if (d && !result.closeDate) result.closeDate = d;
    }
  }

  const openPatterns = [
    /(?:starting\s+date|start\s+date|opening\s+date|application\s+start\s+(?:date)?|apply\s+from|online\s+(?:application|registration)\s+(?:start(?:s|ing)?|begin))[^:]{0,40}?[:\s]\s*(.{5,35}?(?:\d{4}))/i,
    /application\s+open[^:]{0,20}?[:\s]\s*(.{5,30}?(?:\d{4}))/i,
    /from\s+(.{5,25}?(?:\d{4}))\s+to\s+/i,
  ];
  for (const re of openPatterns) {
    const m = re.exec(text);
    if (m) {
      const d = parseDateFromText(m[1]);
      if (d && !result.openDate) result.openDate = d;
    }
  }

  const notifPatterns = [
    /(?:notification\s+date|notified\s+on|published\s+on|date\s+of\s+(?:notification|advertisement|advt))[^:]{0,30}?[:\s]\s*(.{5,30}?(?:\d{4}))/i,
    /(?:advt\.?\s+date|advertisement\s+date)[^:]{0,20}?[:\s]\s*(.{5,30}?(?:\d{4}))/i,
  ];
  for (const re of notifPatterns) {
    const m = re.exec(text);
    if (m) {
      const d = parseDateFromText(m[1]);
      if (d && !result.notificationDate) result.notificationDate = d;
    }
  }

  return result;
}

function findOfficialLinksInHtml(html: string, baseUrl: string): string[] {
  const links = extractLinks(html, baseUrl);
  const official: string[] = [];
  for (const link of links) {
    if (!link.href.startsWith("http")) continue;
    const domain = extractDomain(link.href);
    const isOfficial =
      OFFICIAL_DOMAINS[domain] !== undefined ||
      OFFICIAL_DOMAIN_PATTERNS.some((p) => p.test(domain));
    if (isOfficial && !official.includes(link.href)) {
      official.push(link.href);
    }
  }
  return official;
}

function extractTitle(html: string): string | undefined {
  const titleTag = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  if (titleTag) {
    const t = titleTag[1].trim();
    if (t.length > 10 && t.length < 300) return t;
  }
  const h1 = /<h1[^>]*>([^<]+)<\/h1>/i.exec(html);
  if (h1) {
    const t = stripTags(h1[1]).trim();
    if (t.length > 10 && t.length < 300) return t;
  }
  return undefined;
}

export function extractIntakeFields(
  html: string,
  sourceUrl: string,
  pastedText?: string,
  // Supplementary ranking context from an upstream stage (e.g. Stage A URL slug).
  // Applied only when Stage B's own page context cannot discriminate between PDFs.
  externalRankingContext?: string,
  // Authority tier for merge precedence. Callers must set this explicitly; the
  // default "UNKNOWN" is treated as the lowest tier in mergeExtractions.
  sourceKind: ExtractionSourceKind = "UNKNOWN",
): IntakeExtraction {
  const combined = pastedText ? `${html}\n${pastedText}` : html;
  const text = stripTags(combined);

  // Plain-text mode: PDF text has no HTML tags. Title extraction and notification-
  // number search behave differently for plain text vs structured HTML.
  const isPlainText = !combined.includes("<");

  let title = extractTitle(html);
  if (title === undefined && isPlainText) {
    // Plain-text (PDF) mode: use safe heuristics that reject dates, page numbers,
    // and phone numbers. Returns undefined if nothing suitable found — better to
    // leave title blank than extract a wrong value that OFFICIAL_PDF would propagate.
    title = extractPlainTextTitle(combined);
  }

  // Plain-text PDFs may have the notification number deep in the document.
  // For plain-text, use a safer labeled/structural extractor that rejects generic
  // "no." patterns (which match phone numbers in Hindi government PDFs).
  const notifSearchLen = isPlainText ? 20_000 : 2_000;
  const sourceDomain = extractDomain(sourceUrl);
  const notificationNumber = isPlainText
    ? // Plain-text (PDF) mode: require explicit label or distinctive structure.
      (extractNotificationNumberFromPlainText(text.slice(0, notifSearchLen), sourceDomain) ??
       extractNotificationNumberFromPlainText(sourceUrl, sourceDomain))
    : // HTML mode: permissive patterns are safe because HTML structure provides context.
      (extractNotificationNumber(title ?? "") ??
       extractNotificationNumber(text.slice(0, notifSearchLen)) ??
       extractNotificationNumber(sourceUrl));

  const vacancies = extractVacancies(text);
  const dates = extractApplicationDates(text);

  const links = extractLinks(html, sourceUrl);
  // Collect all official-domain PDFs and rank by relevance to this recruitment context.
  // Ranking prevents an unrelated PDF on a generic homepage from winning over a
  // directly linked recruitment-specific PDF.
  const officialPdfUrls: string[] = [];
  for (const l of links) {
    if (!l.pdfUrl) continue;
    const d = extractDomain(l.pdfUrl);
    if (OFFICIAL_DOMAINS[d] !== undefined || OFFICIAL_DOMAIN_PATTERNS.some((p) => p.test(d))) {
      if (!officialPdfUrls.includes(l.pdfUrl)) officialPdfUrls.push(l.pdfUrl);
    }
  }
  const contextForRanking = (title ?? "") + " " + text.slice(0, 150);

  // Two-step PDF ranking:
  //   Step 1 — use Stage B's own page context. If it discriminates (top score > 0), done.
  //   Step 2 — if ambiguous (all PDFs score 0), fall back to supplementary slug context.
  //             If still ambiguous, leave notifPdfUrl unresolved and report candidates.
  //   Fallback — when no official PDFs exist at all, use any PDF link found on the page.
  let notifPdfUrl: string | undefined;
  let ambiguousPdfCandidates: string[] | undefined;

  if (officialPdfUrls.length === 0) {
    const anyPdfLink = links.find((l) => l.pdfUrl);
    notifPdfUrl = anyPdfLink?.pdfUrl;
  } else {
    const primary = rankPdfsByRelevance(officialPdfUrls, contextForRanking);
    if (!primary.ambiguous) {
      // Own context resolved ranking — use it; do not apply external context
      notifPdfUrl = primary.ranked[0];
    } else if (externalRankingContext) {
      // Stage B's context alone is insufficient — augment with upstream URL slug
      const augmented = rankPdfsByRelevance(officialPdfUrls, contextForRanking, externalRankingContext);
      if (!augmented.ambiguous) {
        notifPdfUrl = augmented.ranked[0];
      } else {
        ambiguousPdfCandidates = augmented.ranked;
      }
    } else {
      // Ambiguous and no supplementary context available — leave unresolved
      ambiguousPdfCandidates = primary.ranked;
    }
  }

  const officialLinksFound = findOfficialLinksInHtml(html, sourceUrl);

  const rawExcerpt = text.slice(0, 500);

  let confidence = 0.3;
  if (notificationNumber) confidence += 0.2;
  if (dates.closeDate)    confidence += 0.15;
  if (dates.openDate)     confidence += 0.1;
  if (vacancies)          confidence += 0.15;
  if (notifPdfUrl)        confidence += 0.1;
  if (title)              confidence += 0.1;
  confidence = Math.min(1, confidence);

  const specificity = computeSpecificity(
    notificationNumber, vacancies, dates.openDate, dates.closeDate, dates.notificationDate
  );

  return {
    title,
    notificationNumber,
    totalVacancies: vacancies,
    postDate: dates.notificationDate,
    applicationOpenDate: dates.openDate,
    applicationCloseDate: dates.closeDate,
    notifPdfUrl,
    ambiguousPdfCandidates,
    officialLinksFound,
    rawExcerpt,
    confidence,
    specificity,
    sourceKind,
  };
}

// ─── Two-stage helpers ────────────────────────────────────────

// Pick the best non-PDF official page link for Stage B fetching.
// PDFs are already captured as notifPdfUrl; we need a page for HTML extraction.
function pickBestOfficialPageLink(links: string[]): string | undefined {
  const nonPdf = links.filter((l) => !l.toLowerCase().endsWith(".pdf"));
  // Prefer more specific paths over bare homepages
  const withPath = nonPdf.filter((l) => {
    try { return new URL(l).pathname.length > 1; } catch { return false; }
  });
  return withPath[0] ?? nonPdf[0];
}

// Assess the quality of text extracted from a PDF based on density and script coverage.
// Used to flag multilingual PDFs where non-Unicode font encoding silently drops scripts.
export function assessPdfTextQuality(text: string, pageCount: number): PdfTextQuality {
  if (!text || text.length < 100) return "OCR_REQUIRED";
  const charsPerPage = text.length / Math.max(pageCount, 1);
  if (charsPerPage < 200) return "OCR_REQUIRED";
  const nonAscii = (text.match(/[^\x00-\x7F]/g) ?? []).length;
  const nonAsciiRatio = nonAscii / text.length;
  // Moderate density + near-zero non-ASCII suggests multilingual content was silently
  // dropped (e.g. Devanagari encoded with non-Unicode custom CMap in Indian govt PDFs).
  if (nonAsciiRatio < 0.01 && charsPerPage < 2000) return "TEXT_PARTIAL";
  return "TEXT_SUFFICIENT";
}

// Recruitment-specific fields: a lower-specificity source must not overwrite
// a higher-specificity source for these fields.
// Example: a generic org homepage (specificity ≈ 0) must not overwrite a
// third-party page that accurately describes the specific recruitment (specificity > 0).
const SPECIFICITY_GUARDED_FIELDS = new Set([
  "title", "notificationNumber", "totalVacancies", "postDate",
  "applicationOpenDate", "applicationCloseDate", "notifPdfUrl",
]);

// Fields that OFFICIAL_GENERIC must never supply — even when the base has no value.
// A generic org homepage lists multiple recruitments and cannot reliably attribute
// these recruitment-specific values to the target recruitment being processed.
// notifPdfUrl is intentionally excluded: org homepages correctly link to PDF
// repositories, and the URL is discovery data that Stage C validates.
const OFFICIAL_GENERIC_BLOCKED_FIELDS = new Set([
  "title", "notificationNumber", "totalVacancies", "postDate",
  "applicationOpenDate", "applicationCloseDate",
]);

// Authority ranking for ExtractionSourceKind — higher wins.
// OFFICIAL_PDF unconditionally wins for all guarded fields; this constant is
// used only to compute the merged sourceKind after a merge.
const AUTHORITY_RANK: Record<string, number> = {
  OFFICIAL_PDF:      4,
  OFFICIAL_SPECIFIC: 3,
  OFFICIAL_GENERIC:  2,
  THIRD_PARTY:       1,
  UNKNOWN:           0,
};

// Merge two extractions (base + override). Precedence rules for guarded fields:
//   1. OFFICIAL_PDF always wins — it is the authoritative recruitment document.
//   2. OFFICIAL_GENERIC must never supply recruitment-specific canonical fields,
//      even when the base has no value — a generic org homepage lists multiple
//      recruitments and cannot reliably attribute its values to the target one.
//   3. All other cases: specificity guard — override only wins when its
//      recruitment-specific evidence strength is equal or higher than base.
function mergeExtractions(
  base: IntakeExtraction,
  override: IntakeExtraction | undefined
): { merged: IntakeExtraction; overrideFields: string[] } {
  if (!override) return { merged: base, overrideFields: [] };

  const ov = override; // non-nullable alias for use in closure
  const overrideFields: string[] = [];

  function pick<T>(field: string, a: T | undefined, b: T | undefined): T | undefined {
    if (b === undefined) return a;
    // Rule 2: OFFICIAL_GENERIC must not supply recruitment-specific canonical fields,
    // even when the base has no value. Generic org homepages list multiple
    // recruitments; values cannot be attributed to the target recruitment.
    if (ov.sourceKind === "OFFICIAL_GENERIC" && OFFICIAL_GENERIC_BLOCKED_FIELDS.has(field)) return a;
    if (a === undefined) { overrideFields.push(field); return b; }
    if (SPECIFICITY_GUARDED_FIELDS.has(field)) {
      // Rule 1: OFFICIAL_PDF unconditionally beats any lower-authority source.
      // This ensures the authoritative recruitment PDF wins even when a generic
      // homepage accidentally had high specificity (e.g. showing a different
      // recruitment's data).
      if (ov.sourceKind === "OFFICIAL_PDF") { overrideFields.push(field); return b; }
      // Rule 3: specificity guard — base wins if it has stronger recruitment-specific evidence.
      if (ov.specificity < base.specificity) return a;
    }
    overrideFields.push(field);
    return b;
  }

  // Pre-compute notifPdfUrl so we can derive ambiguousPdfCandidates from it
  const mergedNotifPdfUrl = pick("notifPdfUrl", base.notifPdfUrl, override.notifPdfUrl);
  // Ambiguous candidates propagate when the merged result still has no resolved PDF.
  // Pick from whichever stage reported ambiguity (override takes priority as higher auth).
  const mergedAmbiguous = mergedNotifPdfUrl === undefined
    ? (ov.ambiguousPdfCandidates ?? base.ambiguousPdfCandidates)
    : undefined;

  // Merged sourceKind = highest authority among base and override.
  // This propagates through successive merges so later stages can correctly
  // compare their own authority against the accumulated prior evidence.
  const baseRank = AUTHORITY_RANK[base.sourceKind] ?? 0;
  const ovRank   = AUTHORITY_RANK[ov.sourceKind] ?? 0;
  const mergedSourceKind: ExtractionSourceKind = ovRank >= baseRank ? ov.sourceKind : base.sourceKind;

  return {
    merged: {
      title:                pick("title", base.title, override.title),
      notificationNumber:   pick("notificationNumber", base.notificationNumber, override.notificationNumber),
      totalVacancies:       pick("totalVacancies", base.totalVacancies, override.totalVacancies),
      postDate:             pick("postDate", base.postDate, override.postDate),
      applicationOpenDate:  pick("applicationOpenDate", base.applicationOpenDate, override.applicationOpenDate),
      applicationCloseDate: pick("applicationCloseDate", base.applicationCloseDate, override.applicationCloseDate),
      notifPdfUrl:          mergedNotifPdfUrl,
      ambiguousPdfCandidates: mergedAmbiguous,
      officialLinksFound:   [...new Set([...base.officialLinksFound, ...override.officialLinksFound])],
      rawExcerpt:           (ov.specificity >= base.specificity ? ov.rawExcerpt : base.rawExcerpt) || base.rawExcerpt,
      confidence:           Math.max(base.confidence, ov.confidence),
      specificity:          Math.max(base.specificity, ov.specificity),
      sourceKind:           mergedSourceKind,
    },
    overrideFields,
  };
}

// ─── Intake draft builder (NO date fabrication) ───────────────

export function buildIntakeDraft(
  candidate: CandidateNewRecruitment,
  officialSourceUrl: string | undefined,
  officialSourceType: "OFFICIAL_NOTIFICATION" | "OFFICIAL_WEBSITE" | "NOT_VERIFIED",
  existingSlugs: string[] = []
): { draft: GovernmentRecruitment; missingFields: string[] } {
  const missingFields: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const orgId = candidate.organizationId;

  // Derive website: prefer official source URL domain, then known registry, then fallback
  const officialDomain = officialSourceUrl ? extractDomain(officialSourceUrl) : undefined;
  const orgDomain = ORG_DOMAIN[orgId] ?? officialDomain ?? `${orgId}.gov.in`;
  const orgWebsite = officialDomain
    ? `https://${officialDomain}`
    : `https://${orgDomain}`;

  const title = candidate.title ?? "Title not extracted — manual entry required";
  if (!candidate.title) missingFields.push("title");

  const notificationNumber = candidate.notificationNumber ?? "";
  if (!candidate.notificationNumber) missingFields.push("notificationNumber");

  const govType = candidate.govType ?? ORG_GOV_TYPE[orgId] ?? "Central Govt";
  const totalVacancies = candidate.totalVacancies ?? 0;
  if (candidate.totalVacancies === undefined) missingFields.push("totalVacancies");

  const vacanciesDisplay = candidate.totalVacancies !== undefined
    ? `${candidate.totalVacancies} Vacancies`
    : "Not specified — verify from official notification";

  // TBA for missing application open/close — passes date sanity check (Invalid Date comparisons = false).
  // notificationDate is left undefined when not extracted; never fabricated from today.
  const notificationDate = candidate.postDate;
  const openDate = candidate.applicationOpenDate ?? "TBA";
  const closeDate = candidate.applicationCloseDate ?? "TBA";
  if (!candidate.postDate) missingFields.push("application.notificationDate");
  if (!candidate.applicationOpenDate) missingFields.push("application.openDate");
  if (!candidate.applicationCloseDate) missingFields.push("application.closeDate");

  if (!candidate.notifPdfUrl) missingFields.push("links.notification");

  const applyLink = orgWebsite;
  if (!applyLink) missingFields.push("links.apply");

  const links: GovernmentRecruitment["links"] = {
    notification: candidate.notifPdfUrl,
    apply: applyLink,
    website: orgWebsite,
  };

  // Derive year for the slug from the most authoritative available date.
  // Do NOT fall back to new Date().getFullYear() — that fabricates a year.
  const notifYear = candidate.postDate?.slice(0, 4)
    ?? candidate.applicationOpenDate?.slice(0, 4)
    ?? candidate.applicationCloseDate?.slice(0, 4);
  const slug = generateSlug(orgId, title, notifYear, existingSlugs);
  const id = generateRecordId(orgId, candidate.normalizedNotifNumber);

  const provenanceSourceUrl = officialSourceUrl;
  if (!officialSourceUrl) missingFields.push("provenance.primarySourceUrl");

  const draft: GovernmentRecruitment = {
    id,
    slug,
    type: "government",
    title,
    organizationId: orgId,
    organizationName: candidate.organizationName,
    shortDescription:
      `${candidate.organizationName} recruitment. Discovered via intake on ${today}. ` +
      `Pending official source verification.`,
    category: ORG_CATEGORY[orgId] ?? "government",
    state: "All India",
    qualification: ORG_QUALIFICATION[orgId] ?? "Graduate",
    postDate: candidate.postDate,
    notificationNumber,
    govType,
    totalVacancies,
    vacanciesDisplay,
    application: {
      notificationDate,
      openDate,
      closeDate,
    },
    examStages: [
      { name: "Details not yet declared", order: 1, status: "NOT_DECLARED", certainty: "TBA" },
    ],
    links,
    provenance: {
      status: "NOT_VERIFIED",
      lastVerifiedAt: today,
      primarySourceUrl: provenanceSourceUrl,
      primarySourceType: officialSourceType,
      notes:
        `Intake submission on ${today} from ${candidate.discoverySourceUrl}. ` +
        `Source tier: ${candidate.discoverySourceTier}. ` +
        `Confidence: ${Math.round(candidate.confidence * 100)}%. ` +
        (missingFields.length > 0
          ? `Missing fields: ${missingFields.join(", ")}. `
          : "All fields extracted. ") +
        `STATUS: NOT_VERIFIED — requires human verification before PARTIALLY_VERIFIED.`,
    },
  };

  return { draft, missingFields };
}

// ─── Default fetch function ───────────────────────────────────

async function defaultFetch(url: string): Promise<{ ok: boolean; html: string | null; error?: string }> {
  try {
    const { fetchHtmlContent } = await import("./fetcher");
    const { fetchResult, htmlContent } = await fetchHtmlContent(url, { maxRetries: 1 });
    return {
      ok: fetchResult.status === "OK",
      html: htmlContent,
      error: fetchResult.error,
    };
  } catch (e) {
    return { ok: false, html: null, error: String(e) };
  }
}

// ─── Main intake pipeline ─────────────────────────────────────

export async function runIntake(
  sourceUrl: string,
  options?: {
    pastedText?: string;
    fetchFn?: FetchFn;
    fetchPdfFn?: import("./pdf-extractor").FetchPdfFn;
    canonicalRecords?: Opportunity[];
    existingCandidates?: CandidateNewRecruitment[];
    existingSlugs?: string[];
  }
): Promise<IntakeResult> {
  const fetch = options?.fetchFn ?? defaultFetch;
  const canonicalRecords: Opportunity[] = options?.canonicalRecords ?? [];
  const existingCandidates = options?.existingCandidates ?? [];
  const existingSlugs = options?.existingSlugs ?? [];
  const analysisNotes: string[] = [];
  const evidenceChain: EvidenceStep[] = [];

  // ── 1. Validate URL ───────────────────────────────────────
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error("Not http/https");
  } catch {
    return {
      sourceUrl,
      classification: { kind: "UNKNOWN", domain: sourceUrl, isDiscoveryLeadOnly: true },
      officialSource: { found: false, method: "none", note: "Malformed URL — cannot parse" },
      extraction: { officialLinksFound: [], rawExcerpt: "", confidence: 0, specificity: 0, sourceKind: "UNKNOWN" },
      evidenceChain: [],
      candidate: null, draft: null, missingFields: [],
      isDuplicate: false, trustGatePassed: false,
      trustGateErrors: [], trustGateWarnings: [],
      analysisNotes, candidateSaved: false, fieldSources: {},
      error: `Invalid URL: ${sourceUrl}`,
    };
  }

  // ── 2. Classify source ────────────────────────────────────
  const classification = classifySourceUrl(sourceUrl);
  analysisNotes.push(`Source classified as ${classification.kind} (domain: ${classification.domain})`);
  if (classification.aggregatorName) {
    analysisNotes.push(`Known aggregator: ${classification.aggregatorName}. Values are discovery clues only — not authoritative.`);
  }
  if (classification.kind === "UNKNOWN") {
    analysisNotes.push("Domain not recognized as official or aggregator. Values require official verification.");
  }

  // ── 3. Stage A: Fetch submitted URL ──────────────────────
  const isPdf = parsedUrl.pathname.toLowerCase().endsWith(".pdf");
  let stageAHtml = "";

  if (isPdf) {
    analysisNotes.push("URL points to a PDF — HTML extraction skipped; using pasted text only");
  } else {
    const fetchResult = await fetch(sourceUrl);
    if (!fetchResult.ok || !fetchResult.html) {
      analysisNotes.push(`Fetch failed: ${fetchResult.error ?? "no HTML returned"}`);
    } else {
      stageAHtml = fetchResult.html;
    }
  }

  // ── 4. Stage A: Extract fields ───────────────────────────
  // Authority: OFFICIAL_SPECIFIC when the submitted URL is an official source;
  // THIRD_PARTY for aggregators and unknown domains.
  const stageASourceKind: ExtractionSourceKind =
    classification.kind === "OFFICIAL" ? "OFFICIAL_SPECIFIC" : "THIRD_PARTY";
  const stageAExtraction = extractIntakeFields(stageAHtml, sourceUrl, options?.pastedText, undefined, stageASourceKind);
  analysisNotes.push(`Stage A extraction: confidence=${Math.round(stageAExtraction.confidence * 100)}%, official links found=${stageAExtraction.officialLinksFound.length}`);

  // Record Stage A in evidence chain (fields contributed determined after merge)
  const stageAEvidenceIdx = evidenceChain.length;
  evidenceChain.push({
    url: sourceUrl,
    sourceKind: classification.kind,
    label: classification.aggregatorName
      ? `${classification.aggregatorName} (${classification.kind})`
      : `${classification.domain} (${classification.kind})`,
    fieldsContributed: [], // filled after merge
  });

  // ── 5. Resolve official source ────────────────────────────
  let officialSource: OfficialSourceResult;
  let stageBHtml = "";
  let stageBExtraction: IntakeExtraction | undefined;
  let officialPageEvidenceIdx = -1;

  if (classification.kind === "OFFICIAL" || isPdf) {
    officialSource = {
      found: true,
      url: sourceUrl,
      method: "submitted-url",
      note: isPdf
        ? "Submitted URL is an official notification PDF"
        : "Submitted URL is an official government source",
    };
  } else if (stageAExtraction.officialLinksFound.length > 0) {
    const bestLink = stageAExtraction.officialLinksFound[0]; // first official link as primary
    officialSource = {
      found: true,
      url: bestLink,
      method: "official-link-in-page",
      note: `Official domain link found in page: ${bestLink}`,
    };
    analysisNotes.push(`Official source link found in page: ${bestLink}`);

    // ── 5B. Stage B: Fetch and extract from official page ──
    // Pass recruitment tokens from Stage A's source URL as supplementary PDF
    // ranking context. They are used only when Stage B's own page context
    // cannot discriminate between its own PDFs (generic homepage case).
    const stageAUrlTokens = extractUrlRecruitmentTokens(sourceUrl) || undefined;

    const officialPageLink = pickBestOfficialPageLink(stageAExtraction.officialLinksFound);
    if (officialPageLink) {
      const stageBFetch = await fetch(officialPageLink);
      if (stageBFetch.ok && stageBFetch.html) {
        stageBHtml = stageBFetch.html;
        // Generic org homepage (path "/" or bare domain) provides org identity and
        // official links but not recruitment-specific data. A deep path indicates
        // a specific recruitment page with higher authority.
        const stageBPath = (() => { try { return new URL(officialPageLink).pathname; } catch { return "/"; } })();
        const stageBSourceKind: ExtractionSourceKind =
          stageBPath.length <= 1 || stageBPath === "/" ? "OFFICIAL_GENERIC" : "OFFICIAL_SPECIFIC";
        stageBExtraction = extractIntakeFields(stageBHtml, officialPageLink, undefined, stageAUrlTokens, stageBSourceKind);
        analysisNotes.push(
          `Stage B: fetched official page ${officialPageLink} — ` +
          `confidence=${Math.round(stageBExtraction.confidence * 100)}%`
        );
        officialPageEvidenceIdx = evidenceChain.length;
        evidenceChain.push({
          url: officialPageLink,
          sourceKind: "OFFICIAL",
          label: `${extractDomain(officialPageLink)} (OFFICIAL)`,
          fieldsContributed: [], // filled after merge
        });
      } else {
        analysisNotes.push(`Stage B: official page fetch failed (${officialPageLink}) — using Stage A data`);
      }
    } else {
      // Only PDF official links found — record them but can't extract more
      analysisNotes.push("Official links are PDFs only — Stage B HTML fetch skipped");
    }

  } else {
    officialSource = {
      found: false,
      method: "none",
      note: "No official government source found. Trust Gate will fail — add official URL before PR creation.",
    };
    analysisNotes.push("No official source URL found. Record cannot reach PR creation without one.");
  }

  // ── 6. Merge Stage A + Stage B extractions ────────────────
  const { merged: abMerged, overrideFields: stageBFields } = mergeExtractions(stageAExtraction, stageBExtraction);
  if (stageBFields.length > 0) {
    analysisNotes.push(`Official page overrides Stage A for: ${stageBFields.join(", ")}`);
  }
  if (abMerged.ambiguousPdfCandidates?.length) {
    const candidates = abMerged.ambiguousPdfCandidates.slice(0, 3).join(", ");
    analysisNotes.push(
      `PDF selection ambiguous — ${abMerged.ambiguousPdfCandidates.length} equally ranked official PDFs; ` +
      `notifPdfUrl left unresolved. Candidates: ${candidates}`
    );
  }

  // ── 6C. Stage C: Extract text from official PDF ───────────
  // PDF text is highest-authority evidence — overrides both Stage A and B.
  // Uses injectable fetchPdfFn for tests; live mode uses pdf-parse.
  // Graceful failure: if PDF is unavailable or unparseable, falls back
  // to Stage A+B HTML data unchanged.
  let stageCExtraction: IntakeExtraction | undefined;
  const pdfToExtract = abMerged.notifPdfUrl ?? (isPdf ? sourceUrl : undefined);
  if (pdfToExtract) {
    const pdfResult = await extractPdfText(pdfToExtract, options?.fetchPdfFn);
    if (pdfResult.ok && pdfResult.text && pdfResult.text.trim().length > 50) {
      // Run extractIntakeFields on the plain PDF text (no HTML tags present — stripTags is a no-op).
      // OFFICIAL_PDF authority ensures this extraction wins over OFFICIAL and THIRD_PARTY for all
      // specificity-guarded fields, even when an earlier stage had higher specificity.
      stageCExtraction = extractIntakeFields(pdfResult.text, pdfToExtract, undefined, undefined, "OFFICIAL_PDF");
      stageCExtraction.pdfTextQuality = assessPdfTextQuality(pdfResult.text, pdfResult.numPages ?? 1);
      analysisNotes.push(
        `Stage C: PDF text extracted (${pdfResult.numPages ?? "?"} pages, ` +
        `confidence=${Math.round(stageCExtraction.confidence * 100)}%, ` +
        `text quality: ${stageCExtraction.pdfTextQuality})`
      );
    } else {
      analysisNotes.push(
        `Stage C: PDF extraction ${pdfResult.error ? `failed — ${pdfResult.error}` : "returned empty content"} — using HTML data only`
      );
    }
  }

  // Final merge: A+B then C override (highest authority)
  const { merged: extraction, overrideFields: stageCFields } = mergeExtractions(abMerged, stageCExtraction);
  if (stageCFields.length > 0) {
    analysisNotes.push(`PDF overrides HTML for: ${stageCFields.join(", ")}`);
  }

  // Fill evidence chain fieldsContributed now that all merges are done
  const allFields = ["title", "notificationNumber", "totalVacancies", "postDate",
    "applicationOpenDate", "applicationCloseDate", "notifPdfUrl"];
  const stageBFieldSet = new Set(stageBFields);
  const stageCFieldSet = new Set(stageCFields);
  const stageAContributed = allFields.filter(
    (f) => !stageBFieldSet.has(f) && !stageCFieldSet.has(f) && extraction[f as keyof IntakeExtraction] !== undefined
  );
  evidenceChain[stageAEvidenceIdx].fieldsContributed = stageAContributed;
  if (officialPageEvidenceIdx >= 0 && stageBFields.length > 0) {
    evidenceChain[officialPageEvidenceIdx].fieldsContributed = stageBFields;
  }
  // PDF evidence step — added after Stage C so fieldsContributed reflects actual contributions
  if (pdfToExtract) {
    evidenceChain.push({
      url: pdfToExtract,
      sourceKind: "OFFICIAL_PDF",
      label: `Official PDF — ${extractDomain(pdfToExtract)} (OFFICIAL_PDF)`,
      fieldsContributed: stageCFields.length > 0 ? stageCFields : [],
    });
  }

  // Build field-level provenance: last step to contribute a field wins
  // (evidence chain is ordered low→high authority: THIRD_PARTY → OFFICIAL → OFFICIAL_PDF)
  const fieldSources: Record<string, string> = {};
  for (const step of evidenceChain) {
    for (const field of step.fieldsContributed) {
      fieldSources[field] = step.sourceKind;
    }
  }

  // ── 7. Identify organization ──────────────────────────────
  // Hierarchy: official domain > official page title > submitted page title > limited body
  let orgId = classification.orgId;
  let orgName = classification.orgName;
  let orgGovType: "Central Govt" | "State Govt" | "PSU Bank" | undefined;

  if (!orgId && officialSource.url) {
    // Priority 1: official source domain
    const officialDomain = extractDomain(officialSource.url);
    const fromDomain = deriveOrgFromOfficialDomain(officialDomain);
    if (fromDomain) {
      orgId = fromDomain.orgId;
      orgName = fromDomain.orgName;
      orgGovType = fromDomain.govType;
      // Update classification
      (classification as { orgId?: string; orgName?: string }).orgId = orgId;
      (classification as { orgId?: string; orgName?: string }).orgName = orgName;
      analysisNotes.push(`Organization identified from official domain: ${orgName} (${officialDomain})`);
    }
  }

  if (!orgId) {
    // Priority 2: title of official page (Stage B), if fetched
    const officialTitle = stageBHtml ? extractTitle(stageBHtml) : undefined;
    if (officialTitle) {
      const fromOfficialTitle = identifyKnownOrgFromText(officialTitle);
      if (fromOfficialTitle) {
        orgId = fromOfficialTitle;
        orgName = deriveOrgName(fromOfficialTitle);
        (classification as { orgId?: string; orgName?: string }).orgId = orgId;
        (classification as { orgId?: string; orgName?: string }).orgName = orgName;
        analysisNotes.push(`Organization identified from official page title: ${orgName}`);
      }
    }
  }

  if (!orgId) {
    // Priority 3: title of submitted page only (NOT full body — avoids sidebar pollution)
    const submittedTitle = extractTitle(stageAHtml) ?? "";
    const fromTitle = identifyKnownOrgFromText(submittedTitle);
    if (fromTitle) {
      orgId = fromTitle;
      orgName = deriveOrgName(fromTitle);
      (classification as { orgId?: string; orgName?: string }).orgId = orgId;
      (classification as { orgId?: string; orgName?: string }).orgName = orgName;
      analysisNotes.push(`Organization identified from submitted page title: ${orgName}`);
    }
  }

  if (!orgId && options?.pastedText) {
    // Priority 4: pasted text (user-supplied, limited and intentional)
    const fromPasted = identifyKnownOrgFromText(options.pastedText.slice(0, 1000));
    if (fromPasted) {
      orgId = fromPasted;
      orgName = deriveOrgName(fromPasted);
      analysisNotes.push(`Organization identified from pasted text: ${orgName}`);
    }
  }

  // DO NOT scan full third-party HTML for org — it contains sidebar/ad noise

  const effectiveOrgId = orgId ?? "unknown";
  const effectiveOrgName = orgName ?? "Unknown Organization";

  // Determine provenance type
  const sourceType = isPdf
    ? "OFFICIAL_NOTIFICATION"
    : classification.kind === "OFFICIAL"
      ? "OFFICIAL_WEBSITE"
      : officialSource.found
        ? (officialSource.url?.toLowerCase().endsWith(".pdf") ? "OFFICIAL_NOTIFICATION" : "OFFICIAL_WEBSITE")
        : "NOT_VERIFIED";

  // ── 8. Build candidate ────────────────────────────────────
  const rawForNorm = extraction.notificationNumber ?? extraction.title ?? sourceUrl;
  const normalizedNotifNumber = normalizeNotificationNumber(rawForNorm);
  const candidateId = buildCandidateId(effectiveOrgId, normalizedNotifNumber);
  const titleSimilarityKey = buildTitleSimilarityKey(extraction.title ?? rawForNorm);
  const sourceUrlFingerprint = normalizeSourceUrl(extraction.notifPdfUrl ?? sourceUrl);

  const candidate: CandidateNewRecruitment = {
    candidateId,
    discoverySourceId: "manual-intake",
    discoverySourceUrl: sourceUrl,
    discoverySourceTier: classification.kind === "OFFICIAL" ? 3 : 5,
    discoveredAt: new Date().toISOString(),
    organizationId: effectiveOrgId,
    organizationName: effectiveOrgName,
    govType: orgGovType,
    title: extraction.title,
    notificationNumber: extraction.notificationNumber,
    notifPdfUrl: extraction.notifPdfUrl ?? (isPdf ? sourceUrl : undefined),
    postDate: extraction.postDate,
    applicationOpenDate: extraction.applicationOpenDate,
    applicationCloseDate: extraction.applicationCloseDate,
    totalVacancies: extraction.totalVacancies,
    normalizedNotifNumber,
    sourceUrlFingerprint,
    titleSimilarityKey,
    rawExcerpt: extraction.rawExcerpt,
    confidence: extraction.confidence,
    status: "PENDING_REVIEW",
  };

  // ── 9. Dedup check ────────────────────────────────────────
  const canonicalGovt = canonicalRecords.filter((r): r is GovernmentRecruitment => r.type === "government");
  const dupCanonical = isDuplicateOfCanonical(candidate, canonicalGovt);
  if (dupCanonical.isDuplicate) {
    analysisNotes.push(`Duplicate of canonical record: ${dupCanonical.matchedRecordId} — ${dupCanonical.reason}`);
    return {
      sourceUrl, classification, officialSource, extraction,
      officialPageExtraction: stageBExtraction,
      pdfExtraction: stageCExtraction,
      evidenceChain,
      candidate,
      draft: null, missingFields: [],
      isDuplicate: true,
      duplicateReason: dupCanonical.reason,
      duplicateMatchId: dupCanonical.matchedRecordId,
      trustGatePassed: false, trustGateErrors: [], trustGateWarnings: [],
      analysisNotes, candidateSaved: false, fieldSources,
    };
  }

  const dupCandidate = isDuplicateCandidate(candidate, existingCandidates);
  if (dupCandidate) {
    analysisNotes.push("Duplicate of in-flight candidate in queue");
    return {
      sourceUrl, classification, officialSource, extraction,
      officialPageExtraction: stageBExtraction,
      pdfExtraction: stageCExtraction,
      evidenceChain,
      candidate,
      draft: null, missingFields: [],
      isDuplicate: true,
      duplicateReason: "in-flight candidate with same fingerprint already queued",
      trustGatePassed: false, trustGateErrors: [], trustGateWarnings: [],
      analysisNotes, candidateSaved: false, fieldSources,
    };
  }

  // ── 10. Build draft ───────────────────────────────────────
  const { draft, missingFields } = buildIntakeDraft(
    candidate,
    officialSource.url,
    sourceType as "OFFICIAL_NOTIFICATION" | "OFFICIAL_WEBSITE" | "NOT_VERIFIED",
    existingSlugs
  );

  // ── 11. Trust Gate pre-check ──────────────────────────────
  let trustGatePassed = false;
  let trustGateErrors: ValidationError[] = [];
  let trustGateWarnings: ValidationError[] = [];

  try {
    const { runTrustGateWithNewRecord } = await import("./trust-gate");
    const { getAllOpportunities } = await import("@/lib/repository");

    const dataset = canonicalRecords.length > 0
      ? canonicalRecords
      : getAllOpportunities();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = runTrustGateWithNewRecord(dataset, draft as any);
    trustGatePassed = tg.passed;
    trustGateErrors = tg.errors;
    trustGateWarnings = tg.warnings;

    if (tg.passed) {
      analysisNotes.push("Trust Gate PASSED — candidate is ready for PR creation via create-pr-for-new-recruit.ts");
    } else {
      analysisNotes.push(
        `Trust Gate FAILED (${tg.errors.length} error(s)) — fix before PR creation. Candidate saved for editing.`
      );
      for (const e of tg.errors) {
        analysisNotes.push(`  TG error [${e.field ?? "?"}]: ${e.message}`);
      }
    }
  } catch (e) {
    analysisNotes.push(`Trust Gate check error: ${String(e)}`);
  }

  return {
    sourceUrl, classification, officialSource, extraction,
    officialPageExtraction: stageBExtraction,
    pdfExtraction: stageCExtraction,
    evidenceChain,
    candidate, draft, missingFields,
    isDuplicate: false,
    trustGatePassed, trustGateErrors, trustGateWarnings,
    analysisNotes, candidateSaved: false, fieldSources,
  };
}
