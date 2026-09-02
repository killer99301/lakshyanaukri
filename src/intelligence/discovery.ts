// ═══════════════════════════════════════════════════════════
// Phase 7A/7B: Org-Level New Recruitment Discovery
// ═══════════════════════════════════════════════════════════
//
// Scans a government organization's notification index page
// and returns CandidateNewRecruitment objects for any notices
// not already in the canonical dataset.
//
// INVARIANT: This module NEVER modifies canonical data.
//            It only produces candidates for human review.
//
// Filtering logic:
//   INCLUDE: title/href contains recruitment-type keywords
//            ("notification", "advertisement", "vacancy", ...)
//   EXCLUDE: title/href contains operational-update keywords
//            ("result", "admit card", "answer key", ...)
//
// Duplicate detection uses 5 signals from dedup.ts.
// ═══════════════════════════════════════════════════════════

import type { GovernmentRecruitment } from "@/types";
import type { CandidateNewRecruitment, MonitoredSource } from "./types";
import {
  normalizeNotificationNumber,
  normalizeSourceUrl,
  buildTitleSimilarityKey,
  buildCandidateId,
  isDuplicateOfCanonical,
  isDuplicateCandidate,
} from "./dedup";

// ─── Keyword filters ──────────────────────────────────────────

// A notice is a NEW RECRUITMENT candidate if it hits at least one of these.
const RECRUITMENT_KEYWORDS = [
  "notification", "advertisement", "advt", "recruitment", "vacancy",
  "vacancies", "bharti", "engagement", "selection post", "apply",
  "online application", "direct recruitment",
];

// Operational update keywords — if present the notice is NOT a new recruitment.
// These belong to the existing field-update pipeline.
const OPERATIONAL_KEYWORDS = [
  "result", "merit list", "final list", "answer key", "admit card",
  "hall ticket", "cut off", "waiting list", "interview letter",
  "date sheet", "time table", "postpone", "cancelled", "corrigendum",
  "erratum", "extension of date", "joining instructions", "appointment",
  "downloading", "download link", "link activated",
];

// ─── Internal link representation ────────────────────────────

export interface ExtractedLink {
  text: string;          // visible link text
  href: string;          // resolved absolute URL
  nearbyDate?: string;   // ISO date found near this link
  pdfUrl?: string;       // PDF URL (href itself or adjacent href ending in .pdf)
}

// ─── HTML helpers ─────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, " ");
}

function resolveUrl(href: string, base: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) {
    try { return `${new URL(base).origin}${href}`; } catch { return href; }
  }
  try { return new URL(href, base).toString(); } catch { return href; }
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function extractDateFromContext(context: string): string | undefined {
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/.exec(context);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    if (!isNaN(new Date(iso).getTime())) return iso;
  }
  // "25 Aug 2026" or "25-Aug-2026"
  const verbose = /\b(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-,]+(\d{4})\b/.exec(context);
  if (verbose) {
    const m = MONTH_MAP[verbose[2].slice(0, 3).toLowerCase()];
    if (m) {
      const iso = `${verbose[3]}-${m}-${verbose[1].padStart(2, "0")}`;
      if (!isNaN(new Date(iso).getTime())) return iso;
    }
  }
  return undefined;
}

// ─── Link extraction ──────────────────────────────────────────

/**
 * Extract all meaningful <a href> links from the HTML.
 * Resolves relative URLs against the page base URL.
 */
export function extractLinks(html: string, baseUrl: string): ExtractedLink[] {
  const results: ExtractedLink[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const inner = m[2];

    // Extract href from attributes
    const hrefMatch = /\bhref=["']([^"']+)["']/i.exec(attrs);
    if (!hrefMatch) continue;

    const rawHref = hrefMatch[1].trim();
    if (!rawHref || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:") || rawHref === "#") continue;

    const href = resolveUrl(rawHref, baseUrl);
    const text = stripTags(inner).trim().replace(/\s+/g, " ");

    if (!text || text.length < 8 || text.length > 350) continue;

    const pdfUrl = href.toLowerCase().includes(".pdf") ? href : undefined;

    // Look for a date in ±150 chars around this link
    const ctxStart = Math.max(0, m.index - 100);
    const ctxEnd = Math.min(html.length, m.index + m[0].length + 100);
    const nearbyDate = extractDateFromContext(html.slice(ctxStart, ctxEnd));

    results.push({ text, href, nearbyDate, pdfUrl });
  }

  return results;
}

// ─── Notification number extraction ──────────────────────────

const NOTIF_RE = [
  /\b(advt\.?\s*no\.?\s*[\d\/\-]+(?:\/\d{4})?)/i,
  /\b(no\.?\s*\d[\d\/\-]+(?:\/\d{4})?)/i,
  /\b(cen[\-\s]?\d+\/\d{4})\b/i,
  // Handles compound codes like BCECEB(BSFC)-2026/01 — org code + optional parenthesised suffix + year/seq
  /\b([A-Z]{2,10}(?:\([A-Z]{2,8}\))?[\-\/]\d{4}(?:\/\d{1,2})?)\b/,
  /\b([A-Z]{2,10}[\-\/]\d{2,4}(?:\/\d{4})?)\b/,
  /\b([A-Z]{2,8}[\-\s]?\d{4})\b/,
];

export function extractNotificationNumber(title: string): string | undefined {
  for (const re of NOTIF_RE) {
    const hit = re.exec(title);
    if (hit) return hit[1].trim();
  }
  return undefined;
}

// ─── Recruitment notice filter ────────────────────────────────

export function isNewRecruitmentNotice(text: string): boolean {
  const lower = text.toLowerCase();
  const hasRecruitmentKw = RECRUITMENT_KEYWORDS.some((kw) => lower.includes(kw));
  if (!hasRecruitmentKw) return false;
  const isOperational = OPERATIONAL_KEYWORDS.some((kw) => lower.includes(kw));
  return !isOperational;
}

// ─── Org name registry ────────────────────────────────────────

const ORG_NAMES: Record<string, string> = {
  ssc:       "Staff Selection Commission",
  rrb:       "Railway Recruitment Boards",
  upsc:      "Union Public Service Commission",
  bpsc:      "Bihar Public Service Commission",
  ibps:      "Institute of Banking Personnel Selection",
  sbi:       "State Bank of India",
  rbi:       "Reserve Bank of India",
  nabard:    "National Bank for Agriculture and Rural Development",
  lic:       "Life Insurance Corporation of India",
  indiapost: "India Post",
};

export function deriveOrgName(orgId: string): string {
  return ORG_NAMES[orgId] ?? orgId.toUpperCase();
}

// ─── Main discovery function ──────────────────────────────────

/**
 * Scan one ORG_DISCOVERY source page and return new recruitment candidates.
 *
 * @param html                 Fetched HTML of the notification index page
 * @param source               The ORG_DISCOVERY MonitoredSource (provides orgId, url, tier)
 * @param canonicalRecords     All canonical GovernmentRecruitment records (read-only check)
 * @param existingCandidates   Already-discovered candidates this run (cross-candidate dedup)
 * @returns                    New unique candidates not already in canonical data or in-flight
 */
export function discoverNewRecruitments(
  html: string,
  source: MonitoredSource,
  canonicalRecords: GovernmentRecruitment[],
  existingCandidates: CandidateNewRecruitment[]
): CandidateNewRecruitment[] {
  const links = extractLinks(html, source.url);
  const result: CandidateNewRecruitment[] = [];

  for (const link of links) {
    // Only proceed if title looks like a new recruitment notice
    if (!isNewRecruitmentNotice(link.text)) continue;

    const title = link.text;
    const notificationNumber = extractNotificationNumber(title);
    const notifPdfUrl = link.pdfUrl;

    // Build dedup fingerprints
    const rawForNorm = notificationNumber ?? title;
    const normalizedNotifNumber = normalizeNotificationNumber(rawForNorm);
    const candidateId = buildCandidateId(source.organizationId, normalizedNotifNumber);
    const titleSimilarityKey = buildTitleSimilarityKey(title);
    const sourceUrlFingerprint = normalizeSourceUrl(notifPdfUrl ?? link.href);

    // Confidence: base 0.4, increments for richer extraction
    let confidence = 0.4;
    if (notificationNumber) confidence += 0.2;
    if (link.nearbyDate)    confidence += 0.2;
    if (notifPdfUrl)        confidence += 0.2;

    const rawExcerpt = `[${title}] ${link.nearbyDate ?? "no date"} ${notifPdfUrl ?? link.href}`.slice(0, 500);

    const candidate: CandidateNewRecruitment = {
      candidateId,
      discoverySourceId:  source.id,
      discoverySourceUrl: source.url,
      discoverySourceTier: source.tier,
      discoveredAt:       new Date().toISOString(),
      organizationId:     source.organizationId,
      organizationName:   deriveOrgName(source.organizationId),
      title,
      notificationNumber,
      notifPdfUrl,
      postDate:           link.nearbyDate,
      normalizedNotifNumber,
      sourceUrlFingerprint,
      titleSimilarityKey,
      rawExcerpt,
      confidence,
      status: "PENDING_REVIEW",
    };

    // Signal 1–5: check against canonical records
    const canonicalCheck = isDuplicateOfCanonical(candidate, canonicalRecords);
    if (canonicalCheck.isDuplicate) continue;

    // Signal 1–5: check against already-discovered candidates this run
    if (isDuplicateCandidate(candidate, [...existingCandidates, ...result])) continue;

    result.push(candidate);
  }

  return result;
}
