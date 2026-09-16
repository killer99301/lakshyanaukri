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
// SE07  Vacancy breakdown extraction with valid evidence
// SE08  vacancyBreakdown evidence missing from section → rejected
// SE09  Section heading not found → candidate rejected
// SE10  Full pipeline: all fields merged from UIIC-like fixture
// SE11  selectRelevantSections filters to extractable section types
// SE12  verifyEvidence rejects evidence shorter than 3 chars
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

test("SE07: vacancy breakdown extracted from eligibility section content", async () => {
  const provider = new MockExtractionProvider({
    vacancyBreakdown: {
      value: [
        { post: "AO Generalists", count: 200 },
        { post: "AO Hindi Officers", count: 25 },
      ],
      // Evidence text is a real substring of "Administrative Officer - Generalists" section
      evidence: "No. of Vacancies: 200",
      sectionHeading: "Administrative Officer - Generalists",
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

test("SE08: vacancyBreakdown with fabricated evidence quote → llm_rejected", async () => {
  const provider = new MockExtractionProvider({
    vacancyBreakdown: {
      value: [{ post: "AO Generalists", count: 200 }],
      // This exact string does not appear in the section text
      evidence: "Total seats allocated for Generalists: 200",
      sectionHeading: "Administrative Officer - Generalists",
      confidence: "medium",
    },
  });

  const draft = await runStructuredExtraction(SE_HTML, SE_URL, provider);

  assert.equal(draft.vacancyBreakdown.value, undefined);
  assert.equal(draft.vacancyBreakdown.disposition.source, "llm_rejected");
  const d8 = draft.vacancyBreakdown.disposition as {
    source: "llm_rejected"; reason: string; llmValue: unknown; provenance: LlmProvenance;
  };
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
        { post: "AO Generalists", count: 200 },
        { post: "AO Hindi Officers", count: 25 },
      ],
      evidence: "No. of Vacancies: 200",
      sectionHeading: "Administrative Officer - Generalists",
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
