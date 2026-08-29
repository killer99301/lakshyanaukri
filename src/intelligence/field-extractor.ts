// ═══════════════════════════════════════════════════════════
// Career Campus — Field Value Extractor (Phase 3)
// ═══════════════════════════════════════════════════════════
//
// Extracts specific field values from official source plain text.
// All extraction is regex-based — no LLM, no inference.
// Returns raw hypotheses for comparison against canonical record fields.
//
// INVARIANT: This module never writes to canonical data.
//            All outputs require human review before any write.
// ═══════════════════════════════════════════════════════════

export interface ExtractedDate {
  raw: string;
  iso?: string;         // "YYYY-MM-DD" if fully parseable, else undefined
  confidence: number;
}

export interface ExtractedVacancies {
  count: number;
  raw: string;
  confidence: number;
}

export interface ExtractedFieldValues {
  dates: ExtractedDate[];
  vacancies: ExtractedVacancies[];
  statusTerms: string[];  // change-type terms found in the text
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_PATTERN =
  "january|february|march|april|may|june|july|august|september|october|november|december|" +
  "jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec";

export function extractFieldValues(text: string): ExtractedFieldValues {
  const lower = text.toLowerCase();
  const rawDates: ExtractedDate[] = [];
  const vacancies: ExtractedVacancies[] = [];
  const statusTerms: string[] = [];

  // ── Dates ─────────────────────────────────────────────────────

  // "22 August 2026" / "1st October 2026" / "15 Nov 2026"
  const dmyRe = new RegExp(
    `(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})[,.]?\\s+(\\d{4})`,
    "gi"
  );
  let m: RegExpExecArray | null;
  while ((m = dmyRe.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const month = MONTH_MAP[m[2].toLowerCase().slice(0, 3)];
    const year = parseInt(m[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 2024 && year <= 2030) {
      rawDates.push({
        raw: m[0],
        iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        confidence: 0.90,
      });
    }
  }

  // "October 2026" / "Nov 2026" — month + year, no day
  const myRe = new RegExp(`(${MONTH_PATTERN})[,.]?\\s+(\\d{4})`, "gi");
  while ((m = myRe.exec(text)) !== null) {
    const month = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
    const year = parseInt(m[2], 10);
    if (month && year >= 2024 && year <= 2030) {
      rawDates.push({ raw: m[0], iso: undefined, confidence: 0.60 });
    }
  }

  // DD/MM/YYYY (Indian date format)
  const slashRe = /(\d{2})\/(\d{2})\/(\d{4})/g;
  while ((m = slashRe.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2024 && year <= 2030) {
      rawDates.push({
        raw: m[0],
        iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        confidence: 0.85,
      });
    }
  }

  // Deduplicate by ISO key (keep highest confidence)
  const dateMap = new Map<string, ExtractedDate>();
  for (const d of rawDates) {
    const key = d.iso ?? d.raw.toLowerCase();
    const existing = dateMap.get(key);
    if (!existing || d.confidence > existing.confidence) dateMap.set(key, d);
  }
  const dates = Array.from(dateMap.values()).sort((a, b) => b.confidence - a.confidence);

  // ── Vacancies ──────────────────────────────────────────────────

  const vacancyPatterns: RegExp[] = [
    /(\d[\d,]+)\s+(?:posts?|vacancies|vacancy|seats?)/gi,
    /(?:total|revised|updated|additional)\s+(?:posts?|vacancies|vacancy|seats?)\s*[:=]?\s*(\d[\d,]+)/gi,
    /(?:posts?|vacancies|vacancy|seats?)\s*[:=]\s*(\d[\d,]+)/gi,
  ];
  for (const re of vacancyPatterns) {
    re.lastIndex = 0;
    while ((m = re.exec(lower)) !== null) {
      const numStr = (m[1] ?? m[2] ?? "").replace(/,/g, "");
      const count = parseInt(numStr, 10);
      if (!isNaN(count) && count > 0 && count < 1_000_000) {
        vacancies.push({ count, raw: m[0], confidence: 0.80 });
      }
    }
  }

  // ── Status terms ───────────────────────────────────────────────

  const STATUS_TERMS = [
    "postponed", "stands postponed", "deferred",
    "cancelled", "stands cancelled", "cancellation",
    "rescheduled", "revised date", "new date",
    "re-examination", "re-exam",
    "result declared", "result announced", "result out", "final result",
    "admit card", "hall ticket",
    "answer key",
    "last date extended", "deadline extended",
    "corrigendum",
    "vacancy revised", "revised vacancy",
  ];
  for (const term of STATUS_TERMS) {
    if (lower.includes(term)) statusTerms.push(term);
  }

  return { dates, vacancies, statusTerms };
}
