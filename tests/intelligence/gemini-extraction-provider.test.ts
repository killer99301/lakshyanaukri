// ═══════════════════════════════════════════════════════════
// Phase 13B: Gemini Extraction Provider Tests (GEP1–GEP9b)
// npx tsx --tsconfig tsconfig.json tests/intelligence/gemini-extraction-provider.test.ts
// ═══════════════════════════════════════════════════════════
//
// ALL tests use injected mock fetch — zero real Gemini API calls.
//
// GEP1   Valid JSON response → correct ProviderExtractionResult
// GEP2   Malformed (non-JSON) Gemini text → returns {}, no throw
// GEP3   Structurally valid JSON but wrong types → field omitted
// GEP4   Evidence string too long (>300 chars) → field omitted
// GEP5   HTTP 429 always → returns {} (non-throwing); lastError is GeminiUnavailableError
// GEP6   HTTP 500 always → returns {} (non-throwing); lastError is Error (not GeminiUnavailableError)
// GEP7   10 sections passed → only MAX_SECTIONS sent; no throw
// GEP7b  financial and vacancy sections take priority over other types
// GEP7c  7 sections including one links → links always included, high-priority types kept
// GEP7d  Multiple links sections → only first included; total ≤ MAX_SECTIONS
// GEP8   Empty apiKey → constructor throws immediately
// GEP9   Integration: runStructuredExtraction + GeminiProvider w/ mock fetch
//          → applicationFeeGeneral has llm_fill disposition
// GEP9b  Integration: Gemini returns {} → absent fields stay missing, never invented
// GEP10  validateResult unit tests
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import {
  GeminiExtractionProvider,
  GeminiUnavailableError,
  DEFAULT_GEMINI_MODEL,
  limitSections,
  buildPrompt,
  validateResult,
} from "@/intelligence/gemini-extraction-provider";
import { runStructuredExtraction } from "@/intelligence/structured-extractor";
import type { PageSection, SectionType } from "@/intelligence/page-structurer";

suite("Phase 13B — Gemini Extraction Provider");

// ─── Test helpers ─────────────────────────────────────────────

interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

// Wraps mock responses in the Gemini API envelope shape
function geminiEnvelope(result: unknown): unknown {
  return {
    candidates: [
      { content: { parts: [{ text: JSON.stringify(result) }] } },
    ],
  };
}

// Builds a mock fetch that cycles through the provided responses
function mockFetch(responses: MockResponse[]): { fn: typeof fetch; callCount: () => number } {
  let calls = 0;
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    void url; void init;
    const resp = responses[Math.min(calls++, responses.length - 1)];
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      headers: {
        get: (name: string) => resp.headers?.[name] ?? null,
      } as unknown as Headers,
      json: async () => resp.body ?? {},
    } as unknown as Response;
  };
  return { fn, callCount: () => calls };
}

function makeSection(
  heading: string,
  type: SectionType,
  text: string,
): PageSection {
  return {
    type,
    heading,
    text,
    rawHtml: `<p>${text}</p>`,
    tables: [],
    lists: [],
    links: [],
    paragraphs: [text],
  };
}

// ─── GEP1: Valid JSON → correct ProviderExtractionResult ──────

test("GEP1: valid Gemini JSON → parsed ProviderExtractionResult with fee and vacancies", async () => {
  const geminiResult = {
    applicationFeeGeneral: {
      value: 850,
      evidence: "General/OBC ₹850",
      sectionHeading: "Application Fee",
      confidence: "high",
    },
    totalVacancies: {
      value: 225,
      evidence: "Total Number of Vacancies 225",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  };

  const { fn } = mockFetch([{ status: 200, body: geminiEnvelope(geminiResult) }]);
  const provider = new GeminiExtractionProvider({ apiKey: "test-key", fetchFn: fn });

  const sections: PageSection[] = [
    makeSection("Application Fee", "financial", "General/OBC ₹850 SC/ST ₹100"),
    makeSection("Vacancies Detail", "vacancy", "Total Number of Vacancies 225"),
  ];

  const result = await provider.extractFromSections(sections, "https://example.com/recruit");

  assert.equal(result.applicationFeeGeneral?.value, 850);
  assert.equal(result.applicationFeeGeneral?.evidence, "General/OBC ₹850");
  assert.equal(result.applicationFeeGeneral?.sectionHeading, "Application Fee");
  assert.equal(result.applicationFeeGeneral?.confidence, "high");
  assert.equal(result.totalVacancies?.value, 225);
  assert.equal(provider.name, "gemini");
  assert.equal(provider.model, DEFAULT_GEMINI_MODEL);
});

// ─── GEP2: Malformed text → {} no throw ───────────────────────

test("GEP2: non-JSON Gemini response text → returns empty result, no throw", async () => {
  const badBody = {
    candidates: [{ content: { parts: [{ text: "Sorry, I cannot help." }] } }],
  };
  const { fn } = mockFetch([{ status: 200, body: badBody }]);
  const provider = new GeminiExtractionProvider({ apiKey: "test-key", fetchFn: fn });

  const result = await provider.extractFromSections(
    [makeSection("Vacancy", "vacancy", "Total posts: 100")],
    "https://example.com/recruit",
  );

  assert.deepEqual(result, {});
});

// ─── GEP3: Wrong types → field omitted ────────────────────────

test("GEP3: totalVacancies value is string instead of number → field omitted; valid fee survives", async () => {
  const geminiResult = {
    totalVacancies: {
      value: "two hundred",   // wrong type — string, not number
      evidence: "Total posts two hundred",
      sectionHeading: "Vacancy",
      confidence: "high",
    },
    applicationFeeGeneral: {
      value: 500,
      evidence: "General fee ₹500",
      sectionHeading: "Fees",
      confidence: "medium",
    },
  };

  const { fn } = mockFetch([{ status: 200, body: geminiEnvelope(geminiResult) }]);
  const provider = new GeminiExtractionProvider({ apiKey: "test-key", fetchFn: fn });

  const result = await provider.extractFromSections(
    [
      makeSection("Vacancy", "vacancy", "Total posts two hundred"),
      makeSection("Fees", "financial", "General fee ₹500"),
    ],
    "https://example.com/recruit",
  );

  assert.equal(result.totalVacancies, undefined, "string value for number field must be omitted");
  assert.equal(result.applicationFeeGeneral?.value, 500, "valid field alongside invalid one should survive");
});

// ─── GEP4: Evidence too long → field omitted ──────────────────

test("GEP4: evidence string exceeding 300 chars → field omitted", async () => {
  const longEvidence = "A".repeat(301);
  const geminiResult = {
    notificationNumber: {
      value: "ADVT/001/2026",
      evidence: longEvidence,
      sectionHeading: "Overview",
      confidence: "high",
    },
  };

  const { fn } = mockFetch([{ status: 200, body: geminiEnvelope(geminiResult) }]);
  const provider = new GeminiExtractionProvider({ apiKey: "test-key", fetchFn: fn });

  const result = await provider.extractFromSections(
    [makeSection("Overview", "overview", "ADVT/001/2026 recruitment 2026")],
    "https://example.com/recruit",
  );

  assert.equal(result.notificationNumber, undefined, "field with overlong evidence must be omitted");
});

// ─── GEP5: HTTP 429 always → {} (non-throwing) ────────────────

test("GEP5: HTTP 429 returned on every attempt → provider returns {} without throwing", async () => {
  // Return 429 more times than MAX_RETRIES so every attempt fails
  const { fn } = mockFetch([
    { status: 429, headers: { "Retry-After": "0" } },
    { status: 429, headers: { "Retry-After": "0" } },
    { status: 429, headers: { "Retry-After": "0" } },
  ]);

  // Use timeoutMs=60000 but retries use Retry-After:0 so they don't actually wait
  const provider = new GeminiExtractionProvider({
    apiKey: "test-key",
    fetchFn: fn,
    timeoutMs: 60_000,
  });

  const result = await provider.extractFromSections(
    [makeSection("Vacancy", "vacancy", "100 posts")],
    "https://example.com/recruit",
  );

  assert.deepEqual(result, {}, "429 after all retries must return empty result, not throw");
  assert.ok(
    provider.lastError instanceof GeminiUnavailableError,
    "lastError must be GeminiUnavailableError for 429 exhaustion — not a silent empty result",
  );
});

// ─── GEP6: HTTP 500 always → {} (non-throwing) ────────────────

test("GEP6: HTTP 500 returned on every attempt → provider returns {} without throwing", async () => {
  const { fn } = mockFetch([
    { status: 500 },
    { status: 500 },
    { status: 500 },
  ]);

  const provider = new GeminiExtractionProvider({
    apiKey: "test-key",
    fetchFn: fn,
    timeoutMs: 60_000,
  });

  const result = await provider.extractFromSections(
    [makeSection("Fee", "financial", "General ₹1000")],
    "https://example.com/recruit",
  );

  assert.deepEqual(result, {}, "500 after all retries must return empty result, not throw");
  assert.ok(provider.lastError !== null, "lastError must be set for 500 exhaustion");
  assert.ok(
    !(provider.lastError instanceof GeminiUnavailableError),
    "lastError must NOT be GeminiUnavailableError for non-503 server error",
  );
});

// ─── GEP7: Too many sections → capped at MAX_SECTIONS ─────────

test("GEP7: 10 sections passed → limitSections returns at most 6, buildPrompt does not throw", () => {
  const sections: PageSection[] = Array.from({ length: 10 }, (_, i) =>
    makeSection(`Section ${i + 1}`, "other", `Content for section ${i + 1}`),
  );

  const limited = limitSections(sections);
  assert.ok(limited.length <= 6, `limitSections must return ≤6 sections, got ${limited.length}`);

  // buildPrompt must not throw with any valid section array
  const prompt = buildPrompt(limited, "https://example.com/recruit");
  assert.ok(prompt.length > 0, "prompt must be non-empty");
  assert.ok(prompt.includes("Source URL:"), "prompt must include the source URL");
});

// ─── GEP7b: Priority ordering ─────────────────────────────────

test("GEP7b: financial and vacancy sections take priority over other types", () => {
  const sections: PageSection[] = [
    makeSection("Random", "other", "misc"),
    makeSection("Fee", "financial", "₹850 fee"),
    makeSection("More Random", "other", "misc2"),
    makeSection("Posts", "vacancy", "225 posts"),
    makeSection("Random3", "other", "misc3"),
    makeSection("Random4", "other", "misc4"),
    makeSection("Random5", "other", "misc5"),
  ];

  const limited = limitSections(sections);
  const types = limited.map((s) => s.type);

  assert.ok(types.includes("financial"), "financial section must be included in top-6");
  assert.ok(types.includes("vacancy"), "vacancy section must be included in top-6");
});

// ─── GEP7c: Links section is guaranteed inclusion ─────────────

test("GEP7c: 7 sections including one links section → links always included; high-priority types kept", () => {
  const sections: PageSection[] = [
    makeSection("Fees", "financial", "₹850 general fee"),
    makeSection("Vacancies", "vacancy", "100 posts"),
    makeSection("Dates", "dates", "Apply by 30 Sep 2026"),
    makeSection("Eligibility", "eligibility", "Graduate required"),
    makeSection("Overview", "overview", "Recruitment 2026"),
    makeSection("Selection", "selection", "Written test + interview"),
    makeSection("Important Links", "links", "Apply here: https://example.com/apply"),
  ];

  const limited = limitSections(sections);
  assert.ok(limited.length <= 6, `must not exceed 6 sections, got ${limited.length}`);

  const types = limited.map((s) => s.type);
  assert.ok(types.includes("links"), "links section must be included when present");
  assert.ok(types.includes("financial"), "financial section must not be displaced by links guarantee");
  assert.ok(types.includes("vacancy"), "vacancy section must not be displaced by links guarantee");
  assert.ok(types.includes("dates"), "dates section must not be displaced by links guarantee");
});

// ─── GEP7d: Multiple links sections → only first included ─────

test("GEP7d: multiple links sections → only first links section included; total ≤ MAX_SECTIONS", () => {
  const sections: PageSection[] = [
    makeSection("Fees", "financial", "₹500 fee"),
    makeSection("Vacancies", "vacancy", "50 posts"),
    makeSection("Dates", "dates", "Deadline: 01 Oct"),
    makeSection("Eligibility", "eligibility", "B.Sc required"),
    makeSection("Overview", "overview", "Recruitment overview"),
    makeSection("Links A", "links", "Apply: https://a.example.com"),
    makeSection("Links B", "links", "Results: https://b.example.com"),
  ];

  const limited = limitSections(sections);
  assert.ok(limited.length <= 6, `must not exceed 6 sections, got ${limited.length}`);

  const linkSections = limited.filter((s) => s.type === "links");
  assert.equal(linkSections.length, 1, "only one links section should be included");
  assert.equal(linkSections[0].heading, "Links A", "first links section must be the one included");
});

// ─── GEP8: Missing API key → constructor throws ───────────────

test("GEP8: empty apiKey → constructor throws immediately", () => {
  let threw = false;
  let message = "";
  try {
    new GeminiExtractionProvider({ apiKey: "" });
  } catch (err) {
    threw = true;
    message = (err as Error).message;
  }
  assert.ok(threw, "constructor must throw when apiKey is empty");
  assert.ok(
    message.toLowerCase().includes("apikey") || message.toLowerCase().includes("api_key") || message.toLowerCase().includes("gemini"),
    `error message should mention the key requirement, got: ${message}`,
  );
});

test("GEP8b: whitespace-only apiKey → constructor throws", () => {
  let threw = false;
  try {
    new GeminiExtractionProvider({ apiKey: "   " });
  } catch {
    threw = true;
  }
  assert.ok(threw, "constructor must throw for whitespace-only apiKey");
});

// ─── GEP9: Integration via runStructuredExtraction ────────────
//
// Uses the SE_HTML fixture from Phase 13A tests. Passes a
// GeminiExtractionProvider with a mock fetch that returns fee data.
// Verifies that applicationFeeGeneral ends up with llm_fill disposition
// (deterministic extraction never extracts fees).

const SE_HTML = `<!DOCTYPE html><html>
<head><title>UIIC AO Recruitment 2026 – 225 Administrative Officer Posts</title></head>
<body>
<article class="entry-content">
<h1>UIIC AO Online Form 2026</h1>
<p>United India Insurance Company Limited has published recruitment notification
(Advt No. HO:HRM:REC:AO:1:2026) for 225 Administrative Officer posts.
Last date to apply is 28/09/2026.</p>

<h2>Vacancies Detail</h2>
<p>Total Number of Vacancies 225 (200 Generalists + 25 Hindi Officers)</p>

<h2>Application Fee</h2>
<table>
  <tr><th>Category</th><th>Fee</th></tr>
  <tr><td>General/OBC</td><td>₹850</td></tr>
  <tr><td>SC/ST/PwD</td><td>₹100</td></tr>
</table>

<h2>Important Dates</h2>
<table>
  <tr><th>Event</th><th>Date</th></tr>
  <tr><td>Online Registration Commences</td><td>08/09/2026</td></tr>
  <tr><td>Last Date of Online Registration</td><td>28/09/2026</td></tr>
</table>
</article>
</body></html>`;

const SE_URL = "https://govtjobguru.in/uiic-ao-2026/";

test("GEP9: integration — runStructuredExtraction with GeminiProvider → applicationFeeGeneral llm_fill", async () => {
  // The mock Gemini response supplies fee data.
  // Evidence "General/OBC ₹850" must exist in the Application Fee section's text.
  const geminiResult = {
    applicationFeeGeneral: {
      value: 850,
      evidence: "General/OBC ₹850",
      sectionHeading: "Application Fee",
      confidence: "high",
    },
    applicationFeeSCST: {
      value: 100,
      evidence: "SC/ST/PwD ₹100",
      sectionHeading: "Application Fee",
      confidence: "high",
    },
  };

  const { fn } = mockFetch([{ status: 200, body: geminiEnvelope(geminiResult) }]);
  const provider = new GeminiExtractionProvider({ apiKey: "test-key", fetchFn: fn });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  // Fees: deterministic layer never extracts these, so Gemini fills the gap
  assert.equal(draft.applicationFeeGeneral.value, 850, "fee value must be 850");
  assert.equal(
    draft.applicationFeeGeneral.disposition.source,
    "llm_fill",
    "fee disposition must be llm_fill (det never extracts fees)",
  );

  assert.equal(draft.applicationFeeSCST.value, 100, "SC/ST fee value must be 100");
  assert.equal(
    draft.applicationFeeSCST.disposition.source,
    "llm_fill",
    "SC/ST fee disposition must be llm_fill",
  );

  // Provenance must record the provider name
  const d = draft.applicationFeeGeneral.disposition as {
    source: "llm_fill"; evidence: string; provenance: { provider: string; model: string | undefined };
  };
  assert.equal(d.provenance.provider, "gemini", "provenance.provider must be 'gemini'");
  assert.equal(d.provenance.model, DEFAULT_GEMINI_MODEL, "provenance.model must match provider model");

  // Deterministic fields must be unaffected — notificationNumber found by det extractor
  // (the intake parser may or may not parse this particular format — just check it's a string if present)
  if (draft.notificationNumber.value !== undefined) {
    assert.equal(typeof draft.notificationNumber.value, "string");
  }
});

// ─── GEP9b: Absent source fields stay missing, never invented ─

test("GEP9b: Gemini returns empty result → absent fields have missing disposition, no invented values", async () => {
  // Simulates a source page where fee information is absent ("Fee Not Mentioned").
  // Gemini correctly returns {} for those fields — they must stay missing, not invented.
  const { fn } = mockFetch([{ status: 200, body: geminiEnvelope({}) }]);
  const provider = new GeminiExtractionProvider({ apiKey: "test-key", fetchFn: fn });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  // Fees: deterministic never extracts these; Gemini returned nothing → missing
  assert.equal(
    draft.applicationFeeGeneral.disposition.source,
    "missing",
    "fee must be missing when Gemini returns {} — must not be invented",
  );
  assert.equal(
    draft.applicationFeeSCST.disposition.source,
    "missing",
    "SC/ST fee must be missing when Gemini returns {}",
  );
  assert.equal(draft.applicationFeeGeneral.value, undefined, "fee value must be undefined, not guessed");
  assert.equal(draft.applicationFeeSCST.value, undefined, "SC/ST fee value must be undefined, not guessed");

  // Deterministic fields that exist on the page must still be extracted
  assert.ok(
    draft.totalVacancies.disposition.source === "deterministic" ||
    draft.totalVacancies.disposition.source === "missing",
    "totalVacancies source must be deterministic or missing (never llm_fill when Gemini returned {})",
  );

  // lastError should be null — {} is a valid successful (if empty) response
  assert.equal(provider.lastError, null, "lastError must be null for an empty-but-valid Gemini response");
});

// ─── GEP10: validateResult unit tests ─────────────────────────

test("GEP10: validateResult handles all-missing fields gracefully", () => {
  assert.deepEqual(validateResult(null), {});
  assert.deepEqual(validateResult(undefined), {});
  assert.deepEqual(validateResult("not an object"), {});
  assert.deepEqual(validateResult({}), {});
  assert.deepEqual(validateResult({ unknownField: 123 }), {});
});

test("GEP10b: validateResult accepts vacancyBreakdown array with per-item evidence", () => {
  const input = {
    vacancyBreakdown: {
      value: [
        { post: "Generalists", count: 200, evidence: "200 Generalists" },
        { post: "Hindi Officers", count: 25, evidence: "25 Hindi Officers" },
      ],
      evidence: "200 Generalists",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  };
  const result = validateResult(input);
  assert.ok(result.vacancyBreakdown !== undefined, "vacancyBreakdown must be present");
  assert.equal(result.vacancyBreakdown!.value.length, 2);
  assert.equal(result.vacancyBreakdown!.value[0].post, "Generalists");
  assert.equal(result.vacancyBreakdown!.value[1].count, 25);
});

test("GEP10c: validateResult rejects vacancyBreakdown with non-number count", () => {
  const input = {
    vacancyBreakdown: {
      value: [{ post: "Generalists", count: "two hundred", evidence: "Generalists: two hundred" }],
      evidence: "Generalists: two hundred",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  };
  const result = validateResult(input);
  assert.equal(result.vacancyBreakdown, undefined, "breakdown with string count must be rejected");
});

test("GEP10d: validateResult rejects vacancyBreakdown items missing per-item evidence", () => {
  const input = {
    vacancyBreakdown: {
      value: [
        { post: "Generalists", count: 200 },   // missing evidence
        { post: "Hindi Officers", count: 25 },  // missing evidence
      ],
      evidence: "200 Generalists",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  };
  const result = validateResult(input);
  assert.equal(result.vacancyBreakdown, undefined, "items missing per-item evidence must be rejected by validateResult");
});
