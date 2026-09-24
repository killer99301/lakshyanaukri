// ═══════════════════════════════════════════════════════════
// Phase 13B: Gemini Extraction Provider
// ═══════════════════════════════════════════════════════════
//
// Implements ExtractionProvider using the Gemini REST API.
// Receives PageSection[] from the two-layer pipeline and returns
// ProviderExtractionResult — exactly the same shape as MockExtractionProvider.
//
// Safety invariants (all enforced outside this file, unchanged):
//   - verifyEvidence() checks every returned candidate against source text
//   - mergeField() keeps deterministic values on conflict
//   - Gemini never touches the CMS, Trust Gate, or publishing path
//
// Configuration (environment variables):
//   GEMINI_API_KEY  (required to construct; absent → use deterministic-only)
//   GEMINI_MODEL    (optional; defaults to DEFAULT_GEMINI_MODEL)
//
// The fetchFn constructor option is the test seam — inject a mock to
// drive all test scenarios without any real API calls.

import type { PageSection, SectionType } from "./page-structurer";
import type {
  ExtractionProvider,
  ProviderExtractionResult,
  ExtractionCandidate,
  VacancyBreakdownItem,
} from "./extraction-provider";

// ─── Error types ─────────────────────────────────────────────

// Thrown when the Gemini service is temporarily unavailable (HTTP 503)
// or rate-limited (HTTP 429 after all retries). Callers can check for
// this to distinguish "provider unavailable" from "provider found nothing."
export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

// ─── Constants ────────────────────────────────────────────────

export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 512;
const MAX_RETRIES = 2;
const MAX_SECTIONS = 6;
const MAX_SECTION_TEXT_CHARS = 4_000;
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_EVIDENCE_CHARS = 300;

// Section types sent to the provider, ordered by extraction relevance.
// Sections beyond MAX_SECTIONS (after this ordering) are dropped.
const SECTION_PRIORITY: SectionType[] = [
  "financial",
  "vacancy",
  "dates",
  "eligibility",
  "overview",
  "selection",
  "links",
];

// ─── Gemini REST API shape ────────────────────────────────────

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

// ─── Internal helpers ─────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exponentialDelayMs(attempt: number): number {
  return Math.min(1_000 * Math.pow(2, attempt), 30_000);
}

// Priority-sort sections and cap at MAX_SECTIONS.
//
// Links sections are always guaranteed a slot when present — they contain
// provenance-critical source URLs (official notification, application portal).
// Reservation: if a links section exists, reserve 1 of the MAX_SECTIONS slots
// for it and fill the remaining slots with other section types in priority order.
// Only the first links section is included; duplicates are dropped.
export function limitSections(sections: PageSection[]): PageSection[] {
  const linksSections = sections.filter((s) => s.type === "links");
  const otherSections = sections.filter((s) => s.type !== "links");

  const nonLinksLimit = linksSections.length > 0 ? MAX_SECTIONS - 1 : MAX_SECTIONS;

  const sortedOthers = [...otherSections].sort((a, b) => {
    const ai = SECTION_PRIORITY.indexOf(a.type as SectionType);
    const bi = SECTION_PRIORITY.indexOf(b.type as SectionType);
    const aRank = ai === -1 ? 999 : ai;
    const bRank = bi === -1 ? 999 : bi;
    return aRank - bRank;
  });

  const selected = sortedOthers.slice(0, nonLinksLimit);
  if (linksSections.length > 0) {
    selected.push(linksSections[0]);
  }
  return selected;
}

// Build the extraction prompt from the selected sections.
// Section headings in the prompt exactly match PageSection.heading so that
// Gemini can copy them into sectionHeading fields verbatim — a requirement
// for verifyEvidence() exact-heading lookup in structured-extractor.ts.
export function buildPrompt(sections: PageSection[], url: string): string {
  const sectionsBlock = sections
    .map((s) => {
      const heading = s.heading || "(overview)";
      const text = s.text.slice(0, MAX_SECTION_TEXT_CHARS);
      return `## Section: ${heading}\n${text}`;
    })
    .join("\n\n");

  return `You are extracting structured data from an Indian government recruitment notification page.

Source URL: ${url}

${sectionsBlock}

---

Extract the following fields ONLY when you can quote verbatim supporting text from the sections above.

For each field you return, include ALL of:
- "value"         — the extracted value (type as specified below)
- "evidence"      — a verbatim substring (30–150 chars) from the source text that supports this value
- "sectionHeading"— copy the heading exactly as it appears after "## Section:" above
- "confidence"    — one of "high", "medium", or "low"

Rules:
1. If the field is not present in the text, OMIT it entirely — do not guess.
2. evidence must be a real substring of the section text, not a paraphrase.
3. Dates must be in ISO YYYY-MM-DD format.
4. Fees and vacancies must be plain integers (no currency symbols or commas in the value).
5. For vacancyBreakdown items, each item's "evidence" must be a verbatim substring (10–100 chars) from the section that names that specific post and its count.

Return JSON matching this schema (all fields optional):
{
  "notificationNumber":   { "value": "<string>",  "evidence": "...", "sectionHeading": "...", "confidence": "high"|"medium"|"low" },
  "totalVacancies":       { "value": <integer>,   "evidence": "...", "sectionHeading": "...", "confidence": "high"|"medium"|"low" },
  "applicationOpenDate":  { "value": "YYYY-MM-DD","evidence": "...", "sectionHeading": "...", "confidence": "high"|"medium"|"low" },
  "applicationCloseDate": { "value": "YYYY-MM-DD","evidence": "...", "sectionHeading": "...", "confidence": "high"|"medium"|"low" },
  "applicationFeeGeneral":{ "value": <integer>,   "evidence": "...", "sectionHeading": "...", "confidence": "high"|"medium"|"low" },
  "applicationFeeSCST":   { "value": <integer>,   "evidence": "...", "sectionHeading": "...", "confidence": "high"|"medium"|"low" },
  "vacancyBreakdown":     { "value": [{"post":"<string>","count":<integer>,"evidence":"<verbatim row text>"}], "evidence": "<first item evidence>", "sectionHeading": "...", "confidence": "high"|"medium"|"low" }
}`;
}

// ─── Field-level validation ───────────────────────────────────
//
// Each helper validates the shape of an ExtractionCandidate<T>.
// Evidence length is checked here. The downstream verifyEvidence()
// in structured-extractor.ts then confirms the quote exists in the
// named section's normalized text — this file does not duplicate that check.

function isValidCandidate(v: unknown): v is ExtractionCandidate<unknown> {
  if (typeof v !== "object" || v === null) return false;
  const c = v as ExtractionCandidate<unknown>;
  return (
    typeof c.evidence === "string" &&
    c.evidence.length >= 3 &&
    c.evidence.length <= MAX_EVIDENCE_CHARS &&
    typeof c.sectionHeading === "string" &&
    c.sectionHeading.length > 0 &&
    (c.confidence === "high" || c.confidence === "medium" || c.confidence === "low")
  );
}

function validateStringCandidate(v: unknown): ExtractionCandidate<string> | undefined {
  if (!isValidCandidate(v)) return undefined;
  if (typeof (v as ExtractionCandidate<string>).value !== "string") return undefined;
  return v as ExtractionCandidate<string>;
}

function validateNumberCandidate(v: unknown): ExtractionCandidate<number> | undefined {
  if (!isValidCandidate(v)) return undefined;
  const num = (v as ExtractionCandidate<number>).value;
  if (typeof num !== "number" || !Number.isFinite(num)) return undefined;
  return v as ExtractionCandidate<number>;
}

function validateBreakdownItem(item: unknown): item is VacancyBreakdownItem {
  if (typeof item !== "object" || item === null) return false;
  const it = item as VacancyBreakdownItem;
  return (
    typeof it.post === "string" &&
    it.post.length > 0 &&
    typeof it.count === "number" &&
    Number.isFinite(it.count) &&
    typeof it.evidence === "string" &&
    it.evidence.length >= 3 &&
    it.evidence.length <= MAX_EVIDENCE_CHARS
  );
}

function validateBreakdownCandidate(
  v: unknown,
): ExtractionCandidate<VacancyBreakdownItem[]> | undefined {
  if (!isValidCandidate(v)) return undefined;
  const arr = (v as ExtractionCandidate<unknown[]>).value;
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  if (!arr.every(validateBreakdownItem)) return undefined;
  return v as ExtractionCandidate<VacancyBreakdownItem[]>;
}

// Validate and coerce a raw parsed object into ProviderExtractionResult.
// Unknown/invalid fields are silently dropped — partial results are fine.
export function validateResult(raw: unknown): ProviderExtractionResult {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const result: ProviderExtractionResult = {};

  const notifNum = validateStringCandidate(obj.notificationNumber);
  if (notifNum) result.notificationNumber = notifNum;

  const totalVac = validateNumberCandidate(obj.totalVacancies);
  if (totalVac) result.totalVacancies = totalVac;

  const openDate = validateStringCandidate(obj.applicationOpenDate);
  if (openDate) result.applicationOpenDate = openDate;

  const closeDate = validateStringCandidate(obj.applicationCloseDate);
  if (closeDate) result.applicationCloseDate = closeDate;

  const feeGeneral = validateNumberCandidate(obj.applicationFeeGeneral);
  if (feeGeneral) result.applicationFeeGeneral = feeGeneral;

  const feeSCST = validateNumberCandidate(obj.applicationFeeSCST);
  if (feeSCST) result.applicationFeeSCST = feeSCST;

  const breakdown = validateBreakdownCandidate(obj.vacancyBreakdown);
  if (breakdown) result.vacancyBreakdown = breakdown;

  return result;
}

// ─── GeminiExtractionProvider ─────────────────────────────────

export interface GeminiProviderOptions {
  apiKey: string;
  // Defaults to process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
  model?: string;
  // Overall deadline for a single extractFromSections call (incl. all retries)
  timeoutMs?: number;
  // Maximum tokens Gemini may produce. Defaults to DEFAULT_MAX_OUTPUT_TOKENS (512).
  // Increase for pages with many vacancy rows to avoid MAX_TOKENS truncation.
  maxOutputTokens?: number;
  // Injected for tests — pass a mock to avoid real API calls
  fetchFn?: typeof fetch;
}

export class GeminiExtractionProvider implements ExtractionProvider {
  readonly name = "gemini";
  readonly model: string;

  // Set after each extractFromSections call; null on success, Error on any failure.
  // Callers can inspect this to distinguish "provider unavailable" from "no fields found."
  lastError: Error | null = null;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new Error(
        "GeminiExtractionProvider: apiKey is required. " +
        "Set GEMINI_API_KEY or pass apiKey explicitly.",
      );
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? (process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async extractFromSections(
    sections: PageSection[],
    url: string,
  ): Promise<ProviderExtractionResult> {
    this.lastError = null;
    const limited = limitSections(sections);
    if (limited.length === 0) return {};

    const prompt = buildPrompt(limited, url);

    try {
      const raw = await this.callWithRetry(prompt);
      return validateResult(raw);
    } catch (err) {
      // All failures are non-fatal: deterministic extraction continues unaffected.
      // Store the error so callers can distinguish "unavailable" from "found nothing."
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return {};
    }
  }

  private async callWithRetry(prompt: string): Promise<unknown> {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: this.maxOutputTokens,
      },
    });

    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await this.fetchFn(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if ((err as Error)?.name === "AbortError") {
          throw new Error(`GeminiExtractionProvider: timed out after ${this.timeoutMs}ms`);
        }
        if (attempt < MAX_RETRIES) {
          attempt++;
          await sleep(exponentialDelayMs(attempt));
          continue;
        }
        throw err;
      }
      clearTimeout(timer);

      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const retryAfterHeader = response.headers.get("Retry-After");
          const delayMs = retryAfterHeader
            ? Math.min(parseInt(retryAfterHeader, 10) * 1_000, MAX_RETRY_AFTER_MS)
            : exponentialDelayMs(attempt);
          attempt++;
          await sleep(delayMs);
          continue;
        }
        throw new GeminiUnavailableError(
          `Gemini rate-limited (HTTP 429) after ${attempt + 1} attempt(s)`,
        );
      }

      if (response.status >= 500) {
        if (attempt < MAX_RETRIES) {
          attempt++;
          await sleep(exponentialDelayMs(attempt));
          continue;
        }
        if (response.status === 503) {
          throw new GeminiUnavailableError(
            `Gemini service unavailable (HTTP 503) after ${attempt + 1} attempt(s)`,
          );
        }
        throw new Error(`GeminiExtractionProvider: HTTP ${response.status} after ${attempt + 1} attempt(s)`);
      }

      if (!response.ok) {
        throw new Error(`GeminiExtractionProvider: HTTP ${response.status}`);
      }

      let parsed: GeminiResponse;
      try {
        parsed = (await response.json()) as GeminiResponse;
      } catch {
        throw new Error("GeminiExtractionProvider: failed to parse response body as JSON");
      }

      const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) return {};

      // JSON.parse throws on malformed text — caller's catch returns {}.
      return JSON.parse(text);
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────
//
// Returns a GeminiExtractionProvider when GEMINI_API_KEY is set,
// or null when it isn't (deterministic-only mode). Call sites treat
// null as "no LLM provider" and pass undefined to runStructuredExtraction.

export function createGeminiProvider(
  overrides?: Partial<GeminiProviderOptions>,
): GeminiExtractionProvider | null {
  const apiKey = overrides?.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) return null;
  const envTimeout = process.env.GEMINI_TIMEOUT_MS ? parseInt(process.env.GEMINI_TIMEOUT_MS, 10) : undefined;
  const timeoutMs = overrides?.timeoutMs ?? envTimeout;
  const envMaxTokens = process.env.GEMINI_MAX_OUTPUT_TOKENS ? parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS, 10) : undefined;
  const maxOutputTokens = overrides?.maxOutputTokens ?? envMaxTokens;
  return new GeminiExtractionProvider({
    ...overrides,
    apiKey,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  });
}
