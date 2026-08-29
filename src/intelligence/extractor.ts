// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine Content Extractor
// Phase 2A: HTML text extraction + keyword signal detection
// ═══════════════════════════════════════════════════════════
//
// CRITICAL TRUST RULE:
//   Signals detected here are hypotheses, not facts.
//   "postponed appears on the official website" means:
//   "the word postponed appears somewhere on this page."
//   It does NOT mean "the exam is postponed."
//
//   A ContentSignal must travel through the verification
//   state machine before any canonical field is updated.
//   The extractor NEVER modifies canonical data.
//
// Two public functions:
//   extractTextFromHtml(html)  → cleaned plaintext
//   detectSignals(text, ctx)   → matched patterns
//
// getOpportunityKeywords(opp) → keywords for context filtering
// ═══════════════════════════════════════════════════════════

import type { Opportunity } from "@/types";
import type { ContentSignal, CandidateEventType, DisambiguationScore } from "./types";

// ─── Signal Pattern Definitions ──────────────────────────────
// Ordered by specificity — more specific patterns first within
// each group so we prefer longer matches.

interface PatternDef {
  id: string;
  patterns: string[];          // lowercase search strings
  eventType: CandidateEventType;
  baseConfidence: number;      // 0.0–1.0
}

const SIGNAL_PATTERNS: PatternDef[] = [
  // ── Corrigendum (most specific — check first) ──
  {
    id: "CORRIGENDUM",
    patterns: ["corrigendum", "erratum", "amendment to notification", "amendment to advt"],
    eventType: "CORRIGENDUM",
    baseConfidence: 0.82,
  },

  // ── Cancellation ──
  {
    id: "CANCELLED",
    patterns: ["stands cancelled", "examination cancelled", "exam cancelled", "cancelled examination",
               "recruitment cancelled", "cancelled", "cancellation", "रद्द"],
    eventType: "EXAM_CANCELLED",
    baseConfidence: 0.78,
  },

  // ── Postponement ──
  {
    id: "POSTPONED",
    patterns: ["has been postponed", "stands postponed", "postponement", "postponed until",
               "postponed to", "postponed", "deferred", "स्थगित"],
    eventType: "EXAM_POSTPONED",
    baseConfidence: 0.75,
  },

  // ── Re-examination ──
  {
    id: "RE_EXAM",
    patterns: ["re-examination", "re-exam", "fresh examination", "reexamination"],
    eventType: "RE_EXAM",
    baseConfidence: 0.72,
  },

  // ── Exam date changed / rescheduled ──
  {
    id: "RESCHEDULED",
    patterns: ["rescheduled", "revised date", "new exam date", "new date", "revised schedule",
               "new schedule", "date changed", "नई तिथि"],
    eventType: "EXAM_DATE_CHANGE",
    baseConfidence: 0.68,
  },

  // ── Application deadline extension ──
  {
    id: "DEADLINE_EXTENDED",
    patterns: [
      "last date extended", "last date has been extended", "date extended",
      "extended till", "extended to", "deadline extended",
      "registration extended", "application extended", "application date extended",
    ],
    eventType: "APPLICATION_DEADLINE_CHANGE",
    baseConfidence: 0.72,
  },

  // ── Vacancy revision ──
  {
    id: "VACANCY_CHANGE",
    patterns: [
      "revised vacancy", "vacancy revised", "vacancy increased", "vacancy changed",
      "additional posts", "additional vacancies", "vacancy reduced",
    ],
    eventType: "VACANCY_CHANGE",
    baseConfidence: 0.68,
  },

  // ── New notification ──
  {
    id: "NEW_NOTICE",
    patterns: ["new notification", "fresh notification", "new advertisement", "new advt", "new recruitment"],
    eventType: "NEW_NOTICE",
    baseConfidence: 0.60,
  },

  // ── Result ──
  {
    id: "RESULT",
    patterns: [
      "result declared", "result announced", "result published", "result out",
      "final result", "provisional result", "merit list",
    ],
    eventType: "RESULT_RELEASED",
    baseConfidence: 0.65,
  },

  // ── Admit card ──
  {
    id: "ADMIT_CARD",
    patterns: ["admit card", "hall ticket", "call letter", "e-admit"],
    eventType: "ADMIT_CARD_RELEASED",
    baseConfidence: 0.65,
  },

  // ── Answer key ──
  {
    id: "ANSWER_KEY",
    patterns: ["answer key", "provisional answer key", "final answer key", "answer sheet"],
    eventType: "ANSWER_KEY_RELEASED",
    baseConfidence: 0.68,
  },
];

// ─── HTML → Plaintext ────────────────────────────────────────

/**
 * Strip HTML tags and decode common entities.
 * Returns normalized whitespace plaintext.
 * No external parser — pure string manipulation.
 *
 * Limitation: does not handle malformed HTML or all Unicode entities.
 * Sufficient for Phase 2A keyword detection from government portal pages.
 */
export function extractTextFromHtml(html: string): string {
  return html
    // Remove entire <script> blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    // Remove entire <style> blocks
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Remove all remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 10))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Opportunity Keywords ────────────────────────────────────

/**
 * Derive context keywords for an opportunity.
 * Used to filter signals to those near relevant opportunity mentions.
 *
 * A signal found in close proximity to these keywords is more likely
 * to pertain to this opportunity than a generic page mention.
 */
export function getOpportunityKeywords(opp: Opportunity): string[] {
  const keywords: string[] = [
    opp.organizationId.toLowerCase(),
    opp.organizationName.toLowerCase(),
  ];

  if (opp.type === "government") {
    // Add notification number tokens
    const notifTokens = opp.notificationNumber
      .toLowerCase()
      .split(/[\s/,;]+/)
      .filter((t) => t.length >= 2);
    keywords.push(...notifTokens);

    // Add meaningful words from title (skip very short words)
    const titleTokens = opp.title
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3);
    keywords.push(...titleTokens);
  }

  // Deduplicate
  return [...new Set(keywords)];
}

// ─── Identifier Normalization ─────────────────────────────────

/**
 * Normalize an identifier string for fuzzy matching.
 *
 * Handles common formatting differences found in aggregator pages:
 *   "CEN-05/2024"   → "cen 05/2024"
 *   "CEN 05 / 2024" → "cen 05/2024"
 *   "CEN05/2024"    → "cen05/2024"  (no-space variant preserved)
 *   "CRP-XVI"       → "crp xvi"
 *   "72 / 2026"     → "72/2026"
 *   "72nd"          → "72"          (ordinal suffix stripped — aggregator cardinal bridge)
 *   "70th"          → "70"
 *
 * Ordinal stripping bridges the gap between canonical identifiers ("72nd", extracted
 * from the opportunity title) and aggregator article titles ("BPSC 72 Pre New Exam
 * Date 2026") which use the plain cardinal form. Both identifier and zone are
 * normalized before comparison, so matching remains symmetric.
 *
 * INVARIANT: normalizeIdentifier(normalizeIdentifier(s)) === normalizeIdentifier(s)
 */
export function normalizeIdentifier(s: string): string {
  return s
    .toLowerCase()
    .replace(/-/g, " ")               // CEN-05 → CEN 05
    .replace(/\s*\/\s*/g, "/")        // 72 / 2026 → 72/2026
    .replace(/\s+/g, " ")             // collapse whitespace
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")  // 72nd → 72, 70th → 70
    .trim();
}

// ─── Phase 2C: Entity Disambiguation ─────────────────────────
//
// Determines whether a signal's matched identifier is specifically about
// our canonical recruitment vs. another recruitment of the same org.
//
// Competing tokens (ordinals, CEN codes, exam-code+year pairs) are
// extracted from the strict zone. If any competing token is CLOSER to the
// change keyword than our matched identifier, the signal is AMBIGUOUS.
//
// This catches cases like:
//   "BPSC 70th Final Result 2026 ... Bihar BPSC 72nd CCE"
//   → "70th" (ordinal) is 5 chars from "result"; "72nd" is 80 chars away → AMBIGUOUS
//
//   "BPSC AEDO 2025 Exam Cancelled ... BPSC 71th Mains ... Bihar BPSC 72nd CCE"
//   → "aedo 2025" (code+year) is 10 chars from "cancelled"; "72nd" is 70 chars away → AMBIGUOUS

const DISAMBIGUATION_TIGHT_CHARS = 80;  // identifier within this many chars of keyword center = STRONG
const DISAMBIGUATION_AMBIGUOUS_FACTOR = 0.40; // confidence multiplier when competitor is closer
const DISAMBIGUATION_MODERATE_FACTOR  = 0.80; // confidence multiplier when identifier is in zone but not tight

/**
 * Extract tokens from the zone that likely identify a DIFFERENT recruitment of the same org.
 * These "competitor" tokens are used to detect when a signal actually describes another exam.
 *
 * Three token types:
 *   1. Ordinals (70th, 71st, 71th) — different exam in a numbered series
 *   2. Slash-year codes (06/2024) — different notification number
 *   3. Exam-code + year (aedo 2025, chsl 2026, cds 2026) — different exam by name
 *
 * Tokens that match (or are contained in) our own normalized identifiers are excluded.
 */
function extractCompetingTokens(
  zone: string,                   // lowercase strict zone (not normalizeIdentifier'd)
  normalizedIds: string[]         // our normalized identifiers for this opportunity
): Array<{ token: string; position: number }> {
  const results: Array<{ token: string; position: number }> = [];

  // Helper: true if this token is already covered by one of our identifiers
  const isCovered = (tok: string) =>
    normalizedIds.some((id) => id.includes(tok) || tok.includes(id));

  let m: RegExpExecArray | null;

  // 1. Ordinals: 70th, 71st, 71th, 68th, 33rd, etc.
  const ordRe = /\b\d{2,3}(?:st|nd|rd|th)\b/g;
  ordRe.lastIndex = 0;
  while ((m = ordRe.exec(zone)) !== null) {
    if (!isCovered(m[0])) results.push({ token: m[0], position: m.index });
  }

  // 2. Slash-year notification numbers: 06/2024, 33/2026, etc.
  const slashRe = /\b\d+\/\d{4}\b/g;
  slashRe.lastIndex = 0;
  while ((m = slashRe.exec(zone)) !== null) {
    if (!isCovered(m[0])) results.push({ token: m[0], position: m.index });
  }

  // 3. Exam-code + year pairs: "aedo 2025", "chsl 2026", "cds 2026", "cms 2026", etc.
  //    Only 3-6 char alpha codes followed by a 4-digit year (2020+).
  //    Bare years (e.g. "postponed to 2027") are intentionally excluded to avoid
  //    treating new-date mentions as competitor recruitment signals.
  const codeYearRe = /\b([a-z]{3,6})\s+20\d{2}\b/g;
  codeYearRe.lastIndex = 0;
  while ((m = codeYearRe.exec(zone)) !== null) {
    const code = m[1];
    if (!isCovered(m[0]) && !isCovered(code)) {
      results.push({ token: m[0], position: m.index });
    }
  }

  return results;
}

/**
 * Compute the entity-disambiguation score for a signal that passed isOpportunityMatch.
 *
 * @param strictZone       - Lowercase (not normalizeIdentifier'd) strict zone string
 * @param kwOffsetInZone   - Start position of the change keyword within the zone
 * @param kwLen            - Length of the change keyword string
 * @param matchedIdentifier - Original (pre-normalization) identifier that triggered the match
 * @param normalizedIds    - All normalized identifiers for this opportunity
 */
export function computeDisambiguation(
  strictZone: string,
  kwOffsetInZone: number,
  kwLen: number,
  matchedIdentifier: string,
  normalizedIds: string[]
): {
  score: DisambiguationScore;
  identifierProximity: number;
  competitorTerm?: string;
  competitorProximity?: number;
} {
  const kwCenter = kwOffsetInZone + kwLen / 2;

  // Find matched identifier position using normalized comparison
  const normZone = normalizeIdentifier(strictZone);
  const normId   = normalizeIdentifier(matchedIdentifier);
  const idPosNorm = normZone.indexOf(normId);
  const identifierProximity = idPosNorm === -1 ? 999 : Math.abs(idPosNorm - kwCenter);

  // Extract competing tokens from the raw lowercase zone
  const competitors = extractCompetingTokens(strictZone, normalizedIds);

  // Find the competitor closest to the keyword center
  let closestDist = Infinity;
  let closestTerm: string | undefined;
  for (const comp of competitors) {
    const dist = Math.abs(comp.position - kwCenter);
    if (dist < closestDist) {
      closestDist = dist;
      closestTerm = comp.token;
    }
  }

  // Score
  if (closestDist < identifierProximity) {
    // A competing recruitment term is closer to the keyword than our identifier
    return { score: "AMBIGUOUS", identifierProximity, competitorTerm: closestTerm, competitorProximity: closestDist };
  }
  if (identifierProximity <= DISAMBIGUATION_TIGHT_CHARS) {
    // Our identifier is tightly bound to the keyword — high confidence
    return { score: "STRONG", identifierProximity };
  }
  // Identifier is in zone but not tight — moderate confidence
  return { score: "MODERATE", identifierProximity };
}

// ─── Opportunity Identifiers ─────────────────────────────────

/**
 * Extract highly specific identifiers from an opportunity's canonical record.
 * These are used for Phase 2B isOpportunityMatch: only a signal with one of these
 * identifiers within 150 chars is treated as firmly tied to this opportunity.
 *
 * Identifiers are distinct from keywords (org name, title words) which are broader.
 * A signal that has a keyword nearby but NO identifier is REJECTED AMBIGUOUS:
 * we can't tell which specific exam it refers to.
 *
 * Two tiers of identifiers are returned:
 *   Formal: notification number tokens (72/2026, cen 05/2024) — most specific
 *   Title:  ordinal / exam-code tokens from the title (72nd, cgl) — aggregator-friendly
 *
 * Aggregator pages (sarkariresult.com category pages) typically carry "72nd CCE"
 * in article titles but NOT the formal "Advt No. 72/2026". Title-derived tokens
 * bridge this gap without relying on LLM interpretation.
 */
export function getOpportunityIdentifiers(opp: Opportunity): string[] {
  if (opp.type !== "government") return [];

  const ids: string[] = [];
  const notif = opp.notificationNumber.toLowerCase();
  const titleLower = opp.title.toLowerCase();

  // Pattern 1: NN/YYYY slash-year (e.g. "72/2026", "05/2024", "06/2024")
  const slashYear = notif.match(/\d+\/\d{4}/g);
  if (slashYear) ids.push(...slashYear);

  // Pattern 2: CEN NN/YYYY (e.g. "cen 05/2024")
  // Also emits normalized form so "cen-05/2024" matches via normalizeIdentifier
  const cenMatch = notif.match(/cen\s*\d+\/\d{4}/g);
  if (cenMatch) ids.push(...cenMatch.map((m) => normalizeIdentifier(m)));

  // Pattern 3: CODE YYYY exam code (e.g. "cgl 2026", "cse 2026")
  const codeYear = notif.match(/\b[a-z]{2,6}\s+20\d{2}\b/g);
  if (codeYear) {
    const skip = new Set(["advt", "exam", "form", "year"]);
    for (const c of codeYear) {
      const code = c.split(/\s+/)[0];
      if (!skip.has(code) && code.length >= 3) ids.push(c);
    }
  }

  // Pattern 4: CRP cycle codes (e.g. "CRP PO/MT-XVI" → "crp xvi", "crp po/mt xvi")
  if (notif.includes("crp")) {
    const romanMatch = notif.match(/\b[xvi]+\b/gi);
    if (romanMatch) {
      for (const rm of romanMatch) {
        if (rm.length >= 2) ids.push(`crp ${rm.toLowerCase()}`);
      }
    }
    // Full CRP notation normalized (handles "CRP PO/MT-XVI" → "crp po/mt xvi")
    const crpFull = normalizeIdentifier(notif.replace(/advt\s*no\.?\s*/i, "").trim());
    if (crpFull.length >= 5) ids.push(crpFull);
  }

  // Pattern 5: Ordinal series numbers from title (e.g. "72nd" from "BPSC 72nd CCE")
  // Aggregator pages carry ordinals in article titles; formal notification numbers rarely appear.
  // Only extract ordinals where the number is >= 10 (avoids "1st", "2nd", "3rd", "4th" etc.)
  const ordinals = titleLower.match(/\b[1-9]\d+\s*(?:st|nd|rd|th)\b/g);
  if (ordinals) {
    ids.push(...ordinals.map((o) => o.replace(/\s+/g, "")));
  }

  // Pattern 6: Short exam code alone from title (e.g. "ntpc", "cgl", "cse")
  // Only add if the code is ≥3 chars and appears in BOTH the notification and title
  // (avoids grabbing generic words from the title alone)
  const titleCodes = titleLower.match(/\b[a-z]{3,6}\b/g) ?? [];
  const notifCodes = notif.match(/\b[a-z]{3,6}\b/g) ?? [];
  const skipWords = new Set(["exam", "level", "post", "advt", "form", "year",
                             "with", "from", "that", "this", "have", "been",
                             "service", "commission", "recruitment", "for",
                             "and", "the", "in", "of"]);
  const notifCodeSet = new Set(notifCodes);
  for (const tc of titleCodes) {
    if (!skipWords.has(tc) && notifCodeSet.has(tc) && tc.length >= 3) {
      ids.push(tc);
    }
  }

  return [...new Set(ids)].filter((id) => id.length >= 3);
}

// ─── Signal Detection ────────────────────────────────────────

const CONTEXT_WINDOW_CHARS = 150;     // chars before and after match for the matchedText window
const KEYWORD_PROXIMITY_CHARS = 400;  // broad window: any keyword here gives full confidence
const RELEVANCE_STRICT_WINDOW = 150;  // tight window: 4+ char keyword must be here for isRelevant
const RELEVANCE_STRICT_MIN_KW_LEN = 4; // minimum keyword length to count toward strict relevance
const RELEVANCE_MIN_WORDS = 8;        // matchedText must have at least this many words (filters nav items)

/**
 * Detect recruitment-change signals in the extracted plaintext.
 *
 * For each pattern, searches the text case-insensitively.
 * Confidence is boosted when the match is near an opportunity keyword.
 * Deduplicates: keeps the highest-confidence match per signal type.
 *
 * @param text        - Cleaned plaintext from extractTextFromHtml()
 * @param keywords    - Opportunity keywords from getOpportunityKeywords() (org name, title words)
 * @param identifiers - Specific identifiers from getOpportunityIdentifiers() (notification numbers, exam codes)
 *                      When provided, isOpportunityMatch requires an identifier in the strict zone.
 *                      When omitted (official sources), isOpportunityMatch falls back to isRelevant.
 */
export function detectSignals(text: string, keywords: string[], identifiers: string[] = []): ContentSignal[] {
  const lowerText = text.toLowerCase();
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  // Pre-normalize identifiers once; matching normalizes the strictZone per-signal.
  // normalizeIdentifier handles: hyphens→spaces, spaces-around-slashes→none, whitespace collapse.
  const normalizedIdentifiers = identifiers.map((id) => normalizeIdentifier(id));

  const raw: ContentSignal[] = [];

  for (const def of SIGNAL_PATTERNS) {
    for (const pattern of def.patterns) {
      let pos = 0;
      while (pos < lowerText.length) {
        const idx = lowerText.indexOf(pattern, pos);
        if (idx === -1) break;

        // Ensure whole-word boundary (not mid-word)
        const charBefore = idx > 0 ? lowerText[idx - 1] : " ";
        const charAfter =
          idx + pattern.length < lowerText.length
            ? lowerText[idx + pattern.length]
            : " ";

        if (/\W/.test(charBefore) && /\W/.test(charAfter)) {
          // Build context window
          const winStart = Math.max(0, idx - CONTEXT_WINDOW_CHARS);
          const winEnd = Math.min(text.length, idx + pattern.length + CONTEXT_WINDOW_CHARS);
          const matchedText = text.slice(winStart, winEnd).trim();

          // Broad proximity check (400 chars) for confidence scoring
          const searchZone = lowerText.slice(
            Math.max(0, idx - KEYWORD_PROXIMITY_CHARS),
            Math.min(lowerText.length, idx + pattern.length + KEYWORD_PROXIMITY_CHARS)
          );
          const hasKeyword = lowerKeywords.some((kw) => searchZone.includes(kw));

          const confidence = hasKeyword
            ? def.baseConfidence
            : def.baseConfidence * 0.65; // penalty when no opportunity keyword in broad zone

          // Strict relevance: 4+ char keyword within 150 chars AND enough context words
          // This distinguishes specific articles from generic navigation/header matches.
          const zoneStart = Math.max(0, idx - RELEVANCE_STRICT_WINDOW);
          const strictZone = lowerText.slice(
            zoneStart,
            Math.min(lowerText.length, idx + pattern.length + RELEVANCE_STRICT_WINDOW)
          );
          const kwOffsetInZone = idx - zoneStart; // position of keyword within strictZone
          const hasStrictKeyword = lowerKeywords
            .filter((kw) => kw.length >= RELEVANCE_STRICT_MIN_KW_LEN)
            .some((kw) => strictZone.includes(kw));

          const contextWordCount = matchedText.split(/\s+/).filter(Boolean).length;
          const isRelevant = contextWordCount >= RELEVANCE_MIN_WORDS && hasStrictKeyword;

          // isOpportunityMatch: specific identifier within 150-char strict zone.
          // Matching is normalized so "CEN-05/2024" matches canonical "cen 05/2024",
          // and "72 / 2026" matches "72/2026", etc.
          // When identifiers are provided (secondary sources), this is the gate.
          // When identifiers are omitted (official sources), falls back to isRelevant.
          const normalizedStrictZone = normalizeIdentifier(strictZone);
          let matchedIdentifier: string | undefined;
          const hasIdentifierInZone =
            normalizedIdentifiers.length > 0
              ? (() => {
                  const foundIdx = normalizedIdentifiers.findIndex((id) => normalizedStrictZone.includes(id));
                  if (foundIdx !== -1) {
                    matchedIdentifier = identifiers[foundIdx];
                    return true;
                  }
                  return false;
                })()
              : hasStrictKeyword; // fallback for official sources where no identifiers are passed
          const isOpportunityMatch = contextWordCount >= RELEVANCE_MIN_WORDS && hasIdentifierInZone;

          // Phase 2C: Entity disambiguation — only computed when isOpportunityMatch is true.
          // Determines whether the matched identifier is specifically about our canonical
          // recruitment vs. another recruitment of the same organization.
          let disambiguationScore: DisambiguationScore | undefined;
          let competitorTerm: string | undefined;
          let identifierProximity: number | undefined;
          let effectiveConfidence = confidence;

          if (isOpportunityMatch && matchedIdentifier !== undefined) {
            const disam = computeDisambiguation(
              strictZone, kwOffsetInZone, pattern.length, matchedIdentifier, normalizedIdentifiers
            );
            disambiguationScore = disam.score;
            competitorTerm = disam.competitorTerm;
            identifierProximity = disam.identifierProximity;
            if (disam.score === "AMBIGUOUS")  effectiveConfidence *= DISAMBIGUATION_AMBIGUOUS_FACTOR;
            else if (disam.score === "MODERATE") effectiveConfidence *= DISAMBIGUATION_MODERATE_FACTOR;
          }

          raw.push({
            patternId: def.id,
            matchedText,
            signalType: def.eventType,
            confidence: effectiveConfidence,
            charPosition: idx,
            contextWordCount,
            isRelevant,
            isOpportunityMatch,
            matchedIdentifier,
            disambiguationScore,
            competitorTerm,
            identifierProximity,
          });
        }

        pos = idx + pattern.length;
      }
    }
  }

  // Deduplicate by signal type: keep highest-confidence match per event type
  return deduplicateByType(raw);
}

function deduplicateByType(signals: ContentSignal[]): ContentSignal[] {
  const best = new Map<CandidateEventType, ContentSignal>();

  for (const sig of signals) {
    const existing = best.get(sig.signalType);
    if (!existing || sig.confidence > existing.confidence) {
      best.set(sig.signalType, sig);
    }
  }

  // Sort by confidence descending
  return Array.from(best.values()).sort((a, b) => b.confidence - a.confidence);
}
