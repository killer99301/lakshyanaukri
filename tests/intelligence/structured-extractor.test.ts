// ═══════════════════════════════════════════════════════════
// Phase 13A Layer 2: Structured Extractor Tests
// npx tsx --tsconfig tsconfig.json tests/intelligence/structured-extractor.test.ts
// ═══════════════════════════════════════════════════════════
//
// All tests run without any API key or network calls.
// The mock provider returns fixed fixtures; the evidence verifier
// checks those fixtures against the real section text produced by
// structureDocument() on the same synthetic HTML.
//
// SE01  Valid evidence fills a gap (applicationFeeGeneral)
// SE02  Hallucinated evidence is rejected (wrong fee, wrong quote)
// SE03  Conflict: LLM provides wrong value but real evidence; det wins
// SE04  Confirmed: LLM and deterministic agree on totalVacancies
// SE05  Missing: neither layer has a value
// SE06  LLM fills applicationFeeSCST
// SE07  Vacancy breakdown: all rows independently verified → accepted
// SE08  vacancyBreakdown: one item with fabricated per-row evidence → breakdown rejected
// SE09  Section heading not found → candidate rejected
// SE10  Full pipeline: all fields merged from UIIC-like fixture
// SE11  selectRelevantSections filters to extractable section types
// SE12  verifyEvidence rejects evidence shorter than 3 chars
// SE13  provenance integrity regression
// SE14  Invented post with fabricated evidence → per-row verification fails → llm_rejected
// SE15  Empty per-item evidence → too short → breakdown rejected (fail-closed)
// SE16  Cross-row compressed evidence (text not in section after normalization) → llm_rejected
// SE17  "Opening date of Online Application" table-cell label (no colon) → openDate extracted
// SE18  Aggregator-page contamination: unrelated "from DATE to DATE" does not win
// SE19  No dates section → full-page extraction remains the fallback
// SE20  Section-scoped extraction misses openDate → full-page openDate retained
// SE21  Section-scoped dates confirmed by Gemini evidence → confirmed_by_llm
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import { MockExtractionProvider } from "@/intelligence/extraction-provider";
import type { LlmProvenance } from "@/intelligence/structured-extractor";
import {
  runStructuredExtraction,
  verifyEvidence,
  selectRelevantSections,
} from "@/intelligence/structured-extractor";
import { structureDocument } from "@/intelligence/page-structurer";

suite("Phase 13A — Structured Extractor (Layer 2 Mock)");

// ─── Shared test fixture ──────────────────────────────────────
//
// This HTML is the ground truth for all SE tests.
// Every evidence string in the mock providers below is a real
// substring of the section text that structureDocument() produces.

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

<h2>Administrative Officer - Generalists</h2>
<p>No. of Vacancies: 200 (SC-30, OBC-62, EWS-22, UR-86)</p>
<p>Qualification: Graduate Degree with minimum 60% marks.</p>
<p>Age: 21-30 years as on 01/09/2026.</p>

<h2>Administrative Officer - Hindi Officers</h2>
<p>No. of Vacancies: 25</p>
<p>Qualification: Master's Degree in Hindi from a recognized University.</p>
<p>Age: 21-30 years as on 01/09/2026.</p>
</article>
</body></html>`;

const SE_URL = "https://govtjobguru.in/uiic-ao-2026/";

// ─── SE01: valid evidence fills a gap ────────────────────────

test("SE01: valid evidence fills applicationFeeGeneral (det never extracts fees)", async () => {
  const provider = new MockExtractionProvider({
    applicationFeeGeneral: {
      value: 850,
      evidence: "General/OBC ₹850",
      sectionHeading: "Application Fee",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.applicationFeeGeneral.value, 850);
  assert.equal(draft.applicationFeeGeneral.disposition.source, "llm_fill");
  const d1 = draft.applicationFeeGeneral.disposition as {
    source: "llm_fill"; evidence: string; provenance: LlmProvenance;
  };
  assert.ok(d1.evidence.includes("₹850"), "disposition.evidence should include the fee amount");
  assert.equal(d1.provenance.provider, "mock");
  assert.equal(d1.provenance.model, undefined, "mock provider has no model ID");
});

// ─── SE02: hallucinated evidence rejected ─────────────────────

test("SE02: hallucinated fee (₹2000 not on page) → llm_rejected", async () => {
  const provider = new MockExtractionProvider({
    applicationFeeGeneral: {
      value: 2000,
      evidence: "General/OBC ₹2000",   // ₹2000 does not appear anywhere
      sectionHeading: "Application Fee",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.applicationFeeGeneral.value, undefined, "hallucinated value must be dropped");
  assert.equal(draft.applicationFeeGeneral.disposition.source, "llm_rejected");
  const d2 = draft.applicationFeeGeneral.disposition as {
    source: "llm_rejected"; reason: string; llmValue: unknown; provenance: LlmProvenance;
  };
  assert.ok(d2.reason.includes("not found"), `reason should explain evidence failure: "${d2.reason}"`);
  assert.equal(d2.llmValue, 2000, "rejected LLM value should still be visible");
  assert.equal(d2.provenance.provider, "mock", "rejected candidate must still carry provider provenance");
});

// ─── SE03: conflict — LLM wrong value, real evidence, det wins ─

test("SE03: LLM says 226 vacancies with real '225' evidence → conflict, det 225 wins", async () => {
  const provider = new MockExtractionProvider({
    totalVacancies: {
      value: 226,                        // wrong number
      evidence: "Total Number of Vacancies 225",  // evidence is real text from the page
      sectionHeading: "Vacancies Detail",
      confidence: "medium",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  // Deterministic should extract 225 from the same text
  assert.equal(draft.totalVacancies.value, 225, "deterministic value must win conflict");
  assert.equal(draft.totalVacancies.disposition.source, "conflict");
  const d3 = draft.totalVacancies.disposition as {
    source: "conflict";
    deterministicValue: unknown;
    llmValue: unknown;
    evidence: string;
    provenance: LlmProvenance;
  };
  assert.equal(d3.deterministicValue, 225);
  assert.equal(d3.llmValue, 226, "conflicting LLM value must be preserved for human review");
  assert.equal(d3.provenance.provider, "mock");
});

// ─── SE04: confirmed — LLM and deterministic agree ────────────

test("SE04: LLM confirms totalVacancies=225 with real evidence → confirmed_by_llm", async () => {
  const provider = new MockExtractionProvider({
    totalVacancies: {
      value: 225,
      evidence: "Total Number of Vacancies 225",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.totalVacancies.value, 225);
  assert.equal(draft.totalVacancies.disposition.source, "confirmed_by_llm");
  const d4 = draft.totalVacancies.disposition as {
    source: "confirmed_by_llm"; evidence: string; provenance: LlmProvenance;
  };
  assert.equal(d4.provenance.provider, "mock");
});

// ─── SE05: missing — neither layer has a value ────────────────

test("SE05: applicationFeeGeneral with no LLM candidate → missing", async () => {
  const provider = new MockExtractionProvider({
    // applicationFeeGeneral intentionally absent
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.applicationFeeGeneral.value, undefined);
  assert.equal(draft.applicationFeeGeneral.disposition.source, "missing");
});

// ─── SE06: LLM fills applicationFeeSCST ──────────────────────

test("SE06: LLM fills applicationFeeSCST from real table content", async () => {
  const provider = new MockExtractionProvider({
    applicationFeeSCST: {
      value: 100,
      evidence: "SC/ST/PwD ₹100",
      sectionHeading: "Application Fee",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.applicationFeeSCST.value, 100);
  assert.equal(draft.applicationFeeSCST.disposition.source, "llm_fill");
  const d6 = draft.applicationFeeSCST.disposition as {
    source: "llm_fill"; evidence: string; provenance: LlmProvenance;
  };
  assert.equal(d6.provenance.provider, "mock");
});

// ─── SE07: vacancy breakdown ──────────────────────────────────

test("SE07: vacancy breakdown — all rows independently verified → accepted", async () => {
  // Both items' per-row evidence substrings appear in "Vacancies Detail":
  //   "Total Number of Vacancies 225 (200 Generalists + 25 Hindi Officers)"
  const provider = new MockExtractionProvider({
    vacancyBreakdown: {
      value: [
        { post: "AO Generalists", count: 200, evidence: "200 Generalists" },
        { post: "AO Hindi Officers", count: 25, evidence: "25 Hindi Officers" },
      ],
      evidence: "200 Generalists",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.vacancyBreakdown.disposition.source, "llm_fill");
  const d7 = draft.vacancyBreakdown.disposition as {
    source: "llm_fill"; evidence: string; provenance: LlmProvenance;
  };
  assert.equal(d7.provenance.provider, "mock");
  assert.ok(Array.isArray(draft.vacancyBreakdown.value), "breakdown should be an array");
  const breakdown = draft.vacancyBreakdown.value!;
  assert.equal(breakdown.length, 2);
  assert.equal(breakdown[0].post, "AO Generalists");
  assert.equal(breakdown[0].count, 200);
  assert.equal(breakdown[1].post, "AO Hindi Officers");
  assert.equal(breakdown[1].count, 25);
});

// ─── SE08: breakdown evidence not in section → rejected ───────

test("SE08: vacancyBreakdown — one item with fabricated per-row evidence → entire breakdown rejected", async () => {
  // Item 1 passes; item 2's evidence "Hindi Officers 999 posts" does not appear
  // in the "Vacancies Detail" section → verifyBreakdownEvidence fails → llm_rejected.
  const provider = new MockExtractionProvider({
    vacancyBreakdown: {
      value: [
        { post: "AO Generalists", count: 200, evidence: "200 Generalists" },
        { post: "AO Hindi Officers", count: 999, evidence: "Hindi Officers 999 posts" },
      ],
      evidence: "200 Generalists",
      sectionHeading: "Vacancies Detail",
      confidence: "medium",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.vacancyBreakdown.value, undefined, "fabricated per-row evidence must reject whole breakdown");
  assert.equal(draft.vacancyBreakdown.disposition.source, "llm_rejected");
  const d8 = draft.vacancyBreakdown.disposition as {
    source: "llm_rejected"; reason: string; llmValue: unknown; provenance: LlmProvenance;
  };
  assert.ok(d8.reason.includes("AO Hindi Officers"), `reason must name the failing post: "${d8.reason}"`);
  assert.equal(d8.provenance.provider, "mock");
});

// ─── SE09: section heading not found → candidate rejected ─────

test("SE09: candidate with non-existent sectionHeading → llm_rejected", async () => {
  const provider = new MockExtractionProvider({
    applicationFeeGeneral: {
      value: 850,
      evidence: "General/OBC ₹850",
      // Wrong heading — no such section in the document
      sectionHeading: "Fee Structure and Payment",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.applicationFeeGeneral.value, undefined);
  assert.equal(draft.applicationFeeGeneral.disposition.source, "llm_rejected");
  const d9 = draft.applicationFeeGeneral.disposition as {
    source: "llm_rejected"; reason: string; llmValue: unknown; provenance: LlmProvenance;
  };
  assert.ok(d9.reason.includes("not found"), `should report section not found: "${d9.reason}"`);
  assert.equal(d9.provenance.provider, "mock");
});

// ─── SE10: full pipeline with all fields ─────────────────────

test("SE10: full pipeline merges all fields correctly", async () => {
  // Provider returns a complete UIIC extraction
  const provider = new MockExtractionProvider({
    notificationNumber: {
      value: "HO:HRM:REC:AO:1:2026",
      evidence: "Advt No. HO:HRM:REC:AO:1:2026",
      sectionHeading: "",  // overview section has heading ""
      confidence: "high",
    },
    totalVacancies: {
      value: 225,
      evidence: "Total Number of Vacancies 225",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
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
    vacancyBreakdown: {
      value: [
        { post: "AO Generalists", count: 200, evidence: "200 Generalists" },
        { post: "AO Hindi Officers", count: 25, evidence: "25 Hindi Officers" },
      ],
      evidence: "200 Generalists",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  // Basic metadata
  assert.ok(draft.title, "should have title");
  assert.ok(draft.title!.includes("UIIC"), `title should include UIIC: "${draft.title}"`);

  // Notification number: deterministic extracts it; LLM confirms
  assert.ok(draft.notificationNumber.value?.includes("HO:HRM:REC:AO:1:2026"),
    `expected notification number, got: "${draft.notificationNumber.value}"`);
  assert.equal(draft.notificationNumber.disposition.source, "confirmed_by_llm",
    "deterministic + LLM agree → confirmed_by_llm");
  {
    const d = draft.notificationNumber.disposition as {
      source: "confirmed_by_llm"; evidence: string; provenance: LlmProvenance;
    };
    assert.equal(d.provenance.provider, "mock");
    assert.equal(d.provenance.model, undefined);
  }

  // Total vacancies: confirmed
  assert.equal(draft.totalVacancies.value, 225);
  assert.equal(draft.totalVacancies.disposition.source, "confirmed_by_llm");
  {
    const d = draft.totalVacancies.disposition as {
      source: "confirmed_by_llm"; evidence: string; provenance: LlmProvenance;
    };
    assert.equal(d.provenance.provider, "mock");
  }

  // Dates: deterministic extracts these; LLM not asked for them in this test
  assert.equal(draft.applicationOpenDate.value, "2026-09-08");
  assert.equal(draft.applicationOpenDate.disposition.source, "deterministic");
  assert.equal(draft.applicationCloseDate.value, "2026-09-28");
  assert.equal(draft.applicationCloseDate.disposition.source, "deterministic");

  // Fees: only LLM can fill these — check provenance on each
  assert.equal(draft.applicationFeeGeneral.value, 850);
  assert.equal(draft.applicationFeeGeneral.disposition.source, "llm_fill");
  {
    const d = draft.applicationFeeGeneral.disposition as {
      source: "llm_fill"; evidence: string; provenance: LlmProvenance;
    };
    assert.equal(d.provenance.provider, "mock");
    assert.equal(d.provenance.model, undefined);
  }
  assert.equal(draft.applicationFeeSCST.value, 100);
  assert.equal(draft.applicationFeeSCST.disposition.source, "llm_fill");
  {
    const d = draft.applicationFeeSCST.disposition as {
      source: "llm_fill"; evidence: string; provenance: LlmProvenance;
    };
    assert.equal(d.provenance.provider, "mock");
  }

  // Vacancy breakdown: only LLM can fill this
  assert.equal(draft.vacancyBreakdown.disposition.source, "llm_fill");
  {
    const d = draft.vacancyBreakdown.disposition as {
      source: "llm_fill"; evidence: string; provenance: LlmProvenance;
    };
    assert.equal(d.provenance.provider, "mock");
  }
  assert.equal(draft.vacancyBreakdown.value?.length, 2);
});

// ─── SE11: selectRelevantSections ────────────────────────────

test("SE11: selectRelevantSections keeps extractable types, drops other/FAQ/trending", () => {
  const html = `<html><body>
    <article class="entry-content">
    <h2>Vacancies Detail</h2><p>225 posts</p>
    <h2>Application Fee</h2><p>₹850</p>
    <h2>Important Dates</h2><p>28 Sep</p>
    <h2>About This Company</h2><p>Founded in 1972</p>
    <h2>Frequently Asked Questions</h2><p>Q: How to apply?</p>
    </article>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const relevant = selectRelevantSections(doc.sections);

  const types = relevant.map((s) => s.type);
  assert.ok(types.includes("vacancy"), "should include vacancy");
  assert.ok(types.includes("financial"), "should include financial");
  assert.ok(types.includes("dates"), "should include dates");

  // "other" sections (About This Company, FAQ) should be filtered out
  const relevantHeadings = relevant.map((s) => s.heading);
  assert.ok(!relevantHeadings.includes("About This Company"), "should exclude 'other' sections");
  assert.ok(!relevantHeadings.includes("Frequently Asked Questions"), "should exclude FAQ");
});

// ─── SE12: verifyEvidence edge cases ─────────────────────────

test("SE12: verifyEvidence rejects evidence string shorter than 3 chars", () => {
  const html = `<html><body>
    <h2>Vacancies</h2><p>Total: 225</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");

  const result = verifyEvidence(
    { value: 225, evidence: "25", sectionHeading: "Vacancies", confidence: "low" },
    doc.sections,
  );
  assert.ok(!result.valid, "should reject evidence shorter than 3 chars");
  assert.ok(result.reason?.includes("short"), `reason: "${result.reason}"`);
});

// ─── SE13: provenance integrity regression ─────────────────────
//
// Deterministic-only and missing fields must carry no provenance.
// LLM-involved dispositions must carry the exact provider/model
// strings the provider declared — no truncation, mutation, or default.

test("SE13: deterministic/missing dispositions have no provenance; LLM dispositions preserve exact provider+model", async () => {
  // Use a provider with a distinctive name and model string
  const customProvider = new MockExtractionProvider({
    applicationFeeGeneral: {
      value: 850,
      evidence: "General/OBC ₹850",
      sectionHeading: "Application Fee",
      confidence: "high",
    },
  });
  // Override name/model via object-assign to test exact string preservation
  Object.assign(customProvider, {
    name: "acme-llm",
    model: "acme-turbo-v9.2-2026-09",
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, customProvider);

  // ── Deterministic-only field: no provenance property ──────────
  const detDisp = draft.applicationCloseDate.disposition;
  assert.equal(detDisp.source, "deterministic");
  assert.ok(
    !("provenance" in detDisp),
    "deterministic disposition must not carry a provenance key",
  );

  // ── Missing field (no LLM candidate, no det): no provenance ───
  const missingDisp = draft.vacancyBreakdown.disposition;
  assert.equal(missingDisp.source, "missing");
  assert.ok(
    !("provenance" in missingDisp),
    "missing disposition must not carry a provenance key",
  );

  // ── LLM fill: exact provider name + model ID preserved ────────
  const fillDisp = draft.applicationFeeGeneral.disposition as {
    source: "llm_fill"; evidence: string; provenance: LlmProvenance;
  };
  assert.equal(fillDisp.source, "llm_fill");
  assert.equal(
    fillDisp.provenance.provider,
    "acme-llm",
    "provider name must survive merge unchanged",
  );
  assert.equal(
    fillDisp.provenance.model,
    "acme-turbo-v9.2-2026-09",
    "model ID must survive merge unchanged",
  );
});

// ─── SE14: invented post → per-row evidence fails ─────────────

test("SE14: invented post with fabricated evidence → per-row verification fails → llm_rejected", async () => {
  const provider = new MockExtractionProvider({
    vacancyBreakdown: {
      value: [
        { post: "AO Generalists", count: 200, evidence: "200 Generalists" },
        { post: "Senior Manager", count: 10, evidence: "Senior Manager: 10 vacancies" },
      ],
      evidence: "200 Generalists",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.vacancyBreakdown.value, undefined, "invented post must reject entire breakdown");
  assert.equal(draft.vacancyBreakdown.disposition.source, "llm_rejected");
  const d = draft.vacancyBreakdown.disposition as {
    source: "llm_rejected"; reason: string; llmValue: unknown; provenance: LlmProvenance;
  };
  assert.ok(d.reason.includes("Senior Manager"), `reason should name the failing post: "${d.reason}"`);
});

// ─── SE15: empty per-item evidence → too short → rejected ─────

test("SE15: one item with empty per-row evidence → too short to verify → breakdown rejected", async () => {
  const provider = new MockExtractionProvider({
    vacancyBreakdown: {
      value: [
        { post: "AO Generalists", count: 200, evidence: "200 Generalists" },
        { post: "AO Hindi Officers", count: 25, evidence: "" },
      ],
      evidence: "200 Generalists",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.vacancyBreakdown.value, undefined, "empty per-row evidence must reject entire breakdown");
  assert.equal(draft.vacancyBreakdown.disposition.source, "llm_rejected");
  const d = draft.vacancyBreakdown.disposition as {
    source: "llm_rejected"; reason: string; llmValue: unknown; provenance: LlmProvenance;
  };
  assert.ok(
    d.reason.includes("short") || d.reason.includes("AO Hindi Officers"),
    `reason should mention the failing item: "${d.reason}"`,
  );
});

// ─── SE16: compressed "..." evidence → not in section ─────────

test("SE16: cross-row compressed evidence (row text not in section) → llm_rejected", async () => {
  // Reproduces the live smoke-test pattern: Gemini fabricated per-item evidence
  // by concatenating row labels and counts across multiple rows. The compressed
  // text "AO Generalists: 200 vacancies ... AO Hindi Officers: 25 vacancies"
  // does not appear (after normalization) in the Vacancies Detail section —
  // which only says "200 Generalists + 25 Hindi Officers".
  const provider = new MockExtractionProvider({
    vacancyBreakdown: {
      value: [
        {
          post: "AO Generalists",
          count: 200,
          evidence: "AO Generalists: 200 vacancies ... AO Hindi Officers: 25 vacancies",
        },
      ],
      evidence: "AO Generalists: 200 vacancies ... AO Hindi Officers: 25 vacancies",
      sectionHeading: "Vacancies Detail",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.vacancyBreakdown.value, undefined, "cross-row compressed evidence must be rejected");
  assert.equal(draft.vacancyBreakdown.disposition.source, "llm_rejected");
  const d = draft.vacancyBreakdown.disposition as {
    source: "llm_rejected"; reason: string; llmValue: unknown; provenance: LlmProvenance;
  };
  assert.ok(d.reason.includes("AO Generalists"), `reason should name the failing item: "${d.reason}"`);
});

// ─── SE17: "Opening date" table-cell format ───────────────────
//
// Government Important Dates tables use "Opening date of Online Application"
// as the label — no colon. The new table-cell open pattern must recognise it.

test("SE17: 'Opening date of Online Application' (no colon) → deterministic openDate extracted", async () => {
  const html = `<!DOCTYPE html><html>
  <head><title>RRB Paramedical Recruitment 2026</title></head>
  <body><article class="entry-content">
  <h1>RRB Paramedical Recruitment 2026</h1>
  <h2>Important Dates</h2>
  <table>
    <tr><td>Opening date of Online Application</td><td>15/09/2026</td></tr>
    <tr><td>Closing date for Submission of Online Application</td><td>14/10/2026</td></tr>
  </table>
  <h2>Vacancies Detail</h2>
  <p>Total 1376 posts.</p>
  </article></body></html>`;
  const url = "https://example.com/rrb-paramedical/";

  const draft = await runStructuredExtraction(html, url, new MockExtractionProvider({}));

  assert.equal(draft.applicationOpenDate.value, "2026-09-15",
    `'Opening date of Online Application 15/09/2026' must be recognised as openDate: got "${draft.applicationOpenDate.value}"`);
  assert.equal(draft.applicationCloseDate.value, "2026-10-14",
    `'Closing date for Submission' must be recognised as closeDate: got "${draft.applicationCloseDate.value}"`);
  assert.equal(draft.applicationOpenDate.disposition.source, "deterministic");
  assert.equal(draft.applicationCloseDate.disposition.source, "deterministic");
});

// ─── SE18: aggregator contamination prevented ─────────────────
//
// Aggregator pages embed related-post content outside the article.
// That content can include "from DATE to DATE" ranges for unrelated
// recruitments. Section-scoped date extraction must override the
// contaminated full-page values with the structured dates section.

test("SE18: unrelated 'from DATE to DATE' outside article does not contaminate applicationOpenDate / applicationCloseDate", async () => {
  const html = `<!DOCTYPE html><html>
  <head><title>RRB Paramedical 2026</title></head>
  <body>
  <div class="related-posts">
    <p>BOB Wealth Executive Recruitment Apply from 17/10/2026 to 26/10/2026 for 1100 posts</p>
  </div>
  <article class="entry-content">
  <h1>RRB Paramedical Recruitment 2026</h1>
  <h2>Important Dates</h2>
  <table>
    <tr><td>Opening date of Online Application</td><td>15/09/2026</td></tr>
    <tr><td>Closing date for Submission of Online Application</td><td>14/10/2026</td></tr>
    <tr><td>Modification window for corrections</td><td>(17-10-2026 to 26-10-2026)</td></tr>
  </table>
  <h2>Vacancies Detail</h2>
  <p>Total 1376 posts.</p>
  </article></body></html>`;
  const url = "https://example.com/rrb-paramedical/";

  const draft = await runStructuredExtraction(html, url, new MockExtractionProvider({}));

  assert.equal(draft.applicationOpenDate.value, "2026-09-15",
    `section-scoped extraction must override contaminated full-page openDate: got "${draft.applicationOpenDate.value}"`);
  assert.equal(draft.applicationCloseDate.value, "2026-10-14",
    `section-scoped extraction must override contaminated full-page closeDate: got "${draft.applicationCloseDate.value}"`);
});

// ─── SE19: no dates section → full-page fallback ──────────────
//
// When structureDocument produces no "dates"-typed section, the
// section-scoped override does not run; full-page extraction is
// the fallback (existing behaviour, unchanged).

test("SE19: no Important Dates section → full-page extraction still finds close date", async () => {
  const html = `<!DOCTYPE html><html>
  <head><title>Test Recruitment 2026</title></head>
  <body><article class="entry-content">
  <h1>Test Recruitment 2026</h1>
  <p>Online Registration Commences: 01/09/2026. Last Date: 30/09/2026.</p>
  <h2>Vacancies</h2>
  <p>100 posts.</p>
  </article></body></html>`;
  const url = "https://example.com/test/";

  const draft = await runStructuredExtraction(html, url, new MockExtractionProvider({}));

  // No structured dates section → full-page extraction via extractIntakeFields
  assert.equal(draft.applicationCloseDate.value, "2026-09-30",
    `full-page extraction must still work when no dates section exists: got "${draft.applicationCloseDate.value}"`);
  assert.equal(draft.applicationCloseDate.disposition.source, "deterministic");
});

// ─── SE20: section misses openDate → full-page value retained ─
//
// The section-scoped override is fail-safe: if the dates section
// does not yield an openDate, the full-page deterministic value is kept.

test("SE20: section-scoped extraction lacks openDate → full-page openDate is retained", async () => {
  // Open date appears only in article prose, not in the Important Dates table.
  // Section-scoped extraction → openDate=(none). Full-page → openDate=2026-09-01.
  // Override: only closeDate from section; openDate falls back to full-page value.
  const html = `<!DOCTYPE html><html>
  <head><title>Test Recruitment 2026</title></head>
  <body><article class="entry-content">
  <h1>Test Recruitment 2026</h1>
  <p>Online Registration Commences: 01/09/2026</p>
  <h2>Important Dates</h2>
  <table>
    <tr><td>Last Date of Online Registration</td><td>30/09/2026</td></tr>
  </table>
  <h2>Vacancies</h2>
  <p>100 posts.</p>
  </article></body></html>`;
  const url = "https://example.com/test/";

  const draft = await runStructuredExtraction(html, url, new MockExtractionProvider({}));

  // Section-scoped extraction has no recognised open-date label →
  // falls back to full-page value ("Online Registration Commences: 01/09/2026")
  assert.equal(draft.applicationOpenDate.value, "2026-09-01",
    `full-page openDate must be retained when section lacks it: got "${draft.applicationOpenDate.value}"`);
  assert.equal(draft.applicationCloseDate.value, "2026-09-30",
    `section-scoped closeDate must be used: got "${draft.applicationCloseDate.value}"`);
});

// ─── SE21: section-scoped dates confirmed by LLM ─────────────
//
// After the contamination fix, det dates match Gemini's output →
// both fields should resolve to confirmed_by_llm (not conflict).

test("SE21: corrected det dates match Gemini evidence → confirmed_by_llm (not conflict)", async () => {
  // Same contamination scenario as SE18; Gemini returns the correct RRB dates.
  const html = `<!DOCTYPE html><html>
  <head><title>RRB Paramedical 2026</title></head>
  <body>
  <div class="related-posts">
    <p>BOB Wealth Executive Recruitment Apply from 17/10/2026 to 26/10/2026</p>
  </div>
  <article class="entry-content">
  <h1>RRB Paramedical Recruitment 2026</h1>
  <h2>Important Dates</h2>
  <table>
    <tr><td>Opening date of Online Application</td><td>15/09/2026</td></tr>
    <tr><td>Closing date for Submission of Online Application</td><td>14/10/2026</td></tr>
  </table>
  <h2>Vacancies Detail</h2>
  <p>Total 1376 posts.</p>
  </article></body></html>`;
  const url = "https://example.com/rrb-paramedical/";

  const provider = new MockExtractionProvider({
    applicationOpenDate: {
      value: "2026-09-15",
      evidence: "Opening date of Online Application",
      sectionHeading: "Important Dates",
      confidence: "high",
    },
    applicationCloseDate: {
      value: "2026-10-14",
      evidence: "Closing date for Submission of Online Application",
      sectionHeading: "Important Dates",
      confidence: "high",
    },
  });

  const draft = await runStructuredExtraction(html, url, provider);

  assert.equal(draft.applicationOpenDate.value, "2026-09-15");
  assert.equal(draft.applicationOpenDate.disposition.source, "confirmed_by_llm",
    "corrected det openDate matches Gemini → must be confirmed_by_llm");
  assert.equal(draft.applicationCloseDate.value, "2026-10-14");
  assert.equal(draft.applicationCloseDate.disposition.source, "confirmed_by_llm",
    "corrected det closeDate matches Gemini → must be confirmed_by_llm");
});
