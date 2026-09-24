// ═══════════════════════════════════════════════════════════
// Phase 13A Layer 2: Extraction Provider Interface + Mock
// ═══════════════════════════════════════════════════════════
//
// ExtractionProvider is the stable interface between the structured
// extraction pipeline and any LLM backend. The mock implementation
// lets the full pipeline (structuring → extraction → evidence →
// merge) be developed and tested without an API key.
//
// When ANTHROPIC_API_KEY is available, drop in an AnthropicProvider
// that implements the same interface — no other changes needed.

import type { PageSection } from "./page-structurer";
import type { VacancyCategoryBreakdown } from "@/types";

// ─── Core types ────────────────────────────────────────────────

// A single field extracted by a provider.
// `evidence` is a verbatim excerpt from the source page that directly
// supports the extracted value. The evidence verifier checks this
// excerpt actually exists in the named section — hallucinated evidence
// quotes fail the check and the candidate is discarded.
export interface ExtractionCandidate<T> {
  value: T;
  // Verbatim text from the page (30–150 chars) supporting this value
  evidence: string;
  // Which PageSection this evidence was drawn from (must match section.heading)
  sectionHeading: string;
  confidence: "high" | "medium" | "low";
}

export interface VacancyBreakdownItem {
  post: string;
  count: number;         // total for this post
  evidence: string;      // verbatim text from source supporting this row's post + count
  breakdown?: VacancyCategoryBreakdown;
}

// All fields a provider may return.
// Fields the deterministic extractor already handles (notificationNumber,
// totalVacancies, dates) can be returned for confirmation; new fields
// (fees, vacancy breakdown) are gaps the LLM is expected to fill.
export interface ProviderExtractionResult {
  notificationNumber?: ExtractionCandidate<string>;
  totalVacancies?: ExtractionCandidate<number>;
  applicationOpenDate?: ExtractionCandidate<string>; // ISO YYYY-MM-DD
  applicationCloseDate?: ExtractionCandidate<string>; // ISO YYYY-MM-DD
  applicationFeeGeneral?: ExtractionCandidate<number>; // rupees, integers only
  applicationFeeSCST?: ExtractionCandidate<number>; // rupees, integers only
  vacancyBreakdown?: ExtractionCandidate<VacancyBreakdownItem[]>;
}

// ─── Provider interface ────────────────────────────────────────

// Implement this interface to plug in any backend (Anthropic, mock,
// OpenAI, local LLM, …). The structured extractor calls only this.
export interface ExtractionProvider {
  readonly name: string;
  // Populated by real LLM providers with the exact model ID used
  // (e.g. "claude-haiku-4-5-20251001"). Absent for mock and deterministic-only
  // runs. Written into FieldDisposition.provenance on every LLM-involved field
  // so auditors can see which model produced which value.
  readonly model?: string;
  // Receives the relevant page sections (filtered to types that carry
  // extractable data). Must not fetch any URL — works from sections only.
  extractFromSections(
    sections: PageSection[],
    url: string,
  ): Promise<ProviderExtractionResult>;
}

// ─── Configurable mock ─────────────────────────────────────────
//
// Returns whatever ProviderExtractionResult you give it.
// Use in tests to configure specific scenarios without any API calls.

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = "mock";
  readonly model = undefined;

  constructor(private readonly result: ProviderExtractionResult) {}

  async extractFromSections(
    _sections: PageSection[],
    _url: string,
  ): Promise<ProviderExtractionResult> {
    return this.result;
  }
}
