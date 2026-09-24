// ═══════════════════════════════════════════════════════════
// Phase 13A Layer 2: Structured Extractor + Merge Logic
// ═══════════════════════════════════════════════════════════
//
// Orchestrates the two-layer pipeline:
//   Layer 1  structureDocument()     → PageDocument (deterministic)
//   Layer 2  provider.extractFrom…() → ProviderExtractionResult (LLM/mock)
//
// Each Layer-2 candidate is evidence-verified against the Layer-1 sections
// before it influences the output. The merge rules:
//
//   deterministic value + no LLM → source: "deterministic"
//   no value anywhere            → source: "missing"
//   LLM candidate, invalid evidence → source: "llm_rejected"
//   LLM fills a gap (det=none)   → source: "llm_fill"
//   LLM confirms det value       → source: "confirmed_by_llm"
//   LLM disagrees with det       → source: "conflict" (det value kept)
//
// The "conflict" case is intentionally surfaced rather than silently
// resolved — it means a human reviewer should look at both values.

import { structureDocument, normalizeForMatching } from "./page-structurer";
import type { PageSection } from "./page-structurer";
import type {
  ExtractionCandidate,
  ExtractionProvider,
  ProviderExtractionResult,
  VacancyBreakdownItem,
} from "./extraction-provider";
import { extractIntakeFields, extractApplicationDates } from "./intake";

// ─── Merge disposition types ───────────────────────────────────

// Identifies which provider produced a value and with which model.
// Present on every disposition that involved an LLM decision — even
// rejected ones — so production telemetry can distinguish "rejected
// by mock in tests" from "rejected by claude-haiku in prod".
export interface LlmProvenance {
  provider: string; // e.g. "mock", "anthropic"
  model: string | undefined; // exact model ID, e.g. "claude-haiku-4-5-20251001"
}

export type FieldDisposition =
  // Only the deterministic extractor found a value
  | { source: "deterministic" }
  // Both deterministic and LLM agree on the same value
  | { source: "confirmed_by_llm"; evidence: string; provenance: LlmProvenance }
  // LLM found a value that deterministic missed; evidence verified
  | { source: "llm_fill"; evidence: string; provenance: LlmProvenance }
  // LLM and deterministic disagree; deterministic value is kept
  | { source: "conflict"; deterministicValue: unknown; llmValue: unknown; evidence: string; provenance: LlmProvenance }
  // LLM candidate failed evidence verification (hallucinated or wrong section)
  | { source: "llm_rejected"; reason: string; llmValue: unknown; provenance: LlmProvenance }
  // Neither layer found a value
  | { source: "missing" };

export interface MergedField<T> {
  value: T | undefined;
  disposition: FieldDisposition;
}

export interface MergedDraft {
  url: string;
  title: string | undefined;
  // Fields deterministic extractor covers (LLM can confirm or conflict)
  notificationNumber: MergedField<string>;
  totalVacancies: MergedField<number>;
  applicationOpenDate: MergedField<string>;
  applicationCloseDate: MergedField<string>;
  // Fields only LLM can fill (deterministic never extracts these)
  applicationFeeGeneral: MergedField<number>;
  applicationFeeSCST: MergedField<number>;
  vacancyBreakdown: MergedField<VacancyBreakdownItem[]>;
}

// ─── Evidence verification ─────────────────────────────────────
//
// Checks that the candidate's evidence quote actually exists in the
// named section's text (using normalized matching, same as evidencePresent).
// An evidence string that can't be found in its stated section is treated
// as hallucinated and the candidate is rejected.

export function verifyEvidence(
  candidate: ExtractionCandidate<unknown>,
  sections: PageSection[],
): { valid: boolean; reason?: string } {
  const section = sections.find((s) => s.heading === candidate.sectionHeading);
  if (!section) {
    return {
      valid: false,
      reason: `section "${candidate.sectionHeading}" not found in document`,
    };
  }
  const normEvidence = normalizeForMatching(candidate.evidence);
  if (normEvidence.length < 3) {
    return { valid: false, reason: "evidence string too short to verify" };
  }
  const normSection = normalizeForMatching(section.text);
  if (!normSection.includes(normEvidence)) {
    return {
      valid: false,
      reason: `evidence not found in section "${candidate.sectionHeading}"`,
    };
  }
  return { valid: true };
}

// Per-row evidence verification for vacancy breakdowns.
// Each item must carry its own evidence that appears in the named section.
// Fail-closed: if any single row fails, the entire breakdown is rejected.
export function verifyBreakdownEvidence(
  candidate: ExtractionCandidate<VacancyBreakdownItem[]>,
  sections: PageSection[],
): { valid: boolean; reason?: string } {
  const section = sections.find((s) => s.heading === candidate.sectionHeading);
  if (!section) {
    return {
      valid: false,
      reason: `section "${candidate.sectionHeading}" not found in document`,
    };
  }
  const normSection = normalizeForMatching(section.text);

  for (const item of candidate.value) {
    const normEvidence = normalizeForMatching(item.evidence ?? "");
    if (normEvidence.length < 3) {
      return {
        valid: false,
        reason: `evidence for "${item.post}" is too short to verify`,
      };
    }
    if (!normSection.includes(normEvidence)) {
      return {
        valid: false,
        reason: `evidence for "${item.post}" not found in section "${candidate.sectionHeading}"`,
      };
    }
  }
  return { valid: true };
}

// ─── Single-field merge ────────────────────────────────────────

function mergeField<T>(
  deterministicValue: T | undefined | null,
  candidate: ExtractionCandidate<T> | undefined,
  sections: PageSection[],
  provenance: LlmProvenance,
): MergedField<T> {
  const hasDet = deterministicValue !== undefined && deterministicValue !== null;

  if (!candidate) {
    return {
      value: hasDet ? deterministicValue : undefined,
      disposition: hasDet ? { source: "deterministic" } : { source: "missing" },
    };
  }

  const { valid, reason } = verifyEvidence(candidate, sections);

  if (!valid) {
    return {
      value: hasDet ? deterministicValue : undefined,
      disposition: {
        source: "llm_rejected",
        reason: reason ?? "evidence invalid",
        llmValue: candidate.value,
        provenance,
      },
    };
  }

  // Evidence verified — now compare with deterministic
  if (!hasDet) {
    return {
      value: candidate.value,
      disposition: { source: "llm_fill", evidence: candidate.evidence, provenance },
    };
  }

  // Both have values: compare using stable serialization
  const detSer = JSON.stringify(deterministicValue);
  const llmSer = JSON.stringify(candidate.value);

  if (detSer === llmSer) {
    return {
      value: deterministicValue,
      disposition: { source: "confirmed_by_llm", evidence: candidate.evidence, provenance },
    };
  }

  // Deterministic wins on conflict
  return {
    value: deterministicValue,
    disposition: {
      source: "conflict",
      deterministicValue,
      llmValue: candidate.value,
      evidence: candidate.evidence,
      provenance,
    },
  };
}

// Breakdown-specific merge: uses verifyBreakdownEvidence instead of verifyEvidence.
// Deterministic extraction never produces a vacancy breakdown, so there is no
// conflict/confirm path — the breakdown is either an llm_fill or llm_rejected.
function mergeBreakdownField(
  candidate: ExtractionCandidate<VacancyBreakdownItem[]> | undefined,
  sections: PageSection[],
  provenance: LlmProvenance,
): MergedField<VacancyBreakdownItem[]> {
  if (!candidate) {
    return { value: undefined, disposition: { source: "missing" } };
  }

  const { valid, reason } = verifyBreakdownEvidence(candidate, sections);

  if (!valid) {
    return {
      value: undefined,
      disposition: {
        source: "llm_rejected",
        reason: reason ?? "per-row evidence verification failed",
        llmValue: candidate.value,
        provenance,
      },
    };
  }

  return {
    value: candidate.value,
    disposition: { source: "llm_fill", evidence: candidate.evidence, provenance },
  };
}

// ─── Section selection ─────────────────────────────────────────
//
// Limits what goes to the provider. Sections that carry extractable
// recruitment data; excludes "other", FAQ, trending jobs, etc.

const EXTRACTION_RELEVANT_TYPES = new Set([
  "overview",
  "vacancy",
  "eligibility",
  "financial",
  "dates",
  "selection",
  "links",
]);

export function selectRelevantSections(sections: PageSection[]): PageSection[] {
  return sections.filter((s) => EXTRACTION_RELEVANT_TYPES.has(s.type));
}

// ─── Main entry point ──────────────────────────────────────────

export async function runStructuredExtraction(
  html: string,
  url: string,
  provider: ExtractionProvider,
): Promise<MergedDraft> {
  // Layer 1: deterministic DOM structuring
  const doc = structureDocument(html, url);
  const relevant = selectRelevantSections(doc.sections);

  // Deterministic baseline (existing pipeline, unmodified)
  const det = extractIntakeFields(html, url, undefined, undefined, "THIRD_PARTY");

  // Section-scoped date override: re-run date extraction on the first structured
  // "dates" section (e.g. "Important Dates") to prevent aggregator-page contamination.
  // Aggregator sites embed unrelated recruitments whose "from DATE to DATE" ranges
  // fire before the labeled rows in the full HTML. The structured section contains
  // only the target recruitment's date table and is free of that noise.
  // Override is fail-safe: only replaces a det value when the section produces one.
  const datesSection = doc.sections.find(s => s.type === "dates");
  let detOpenDate = det.applicationOpenDate;
  let detCloseDate = det.applicationCloseDate;
  if (datesSection) {
    const sd = extractApplicationDates(datesSection.text);
    if (sd.openDate) detOpenDate = sd.openDate;
    if (sd.closeDate) detCloseDate = sd.closeDate;
  }

  // Layer 2: provider extraction (mock or real LLM)
  const provResult: ProviderExtractionResult = await provider.extractFromSections(relevant, url);

  // Provenance is captured once per run and written into every LLM-involved
  // disposition, so auditors can identify which provider+model produced any
  // given field value — even rejected ones.
  const provenance: LlmProvenance = {
    provider: provider.name,
    model: provider.model,
  };

  return {
    url,
    title: doc.title ?? det.title,
    notificationNumber: mergeField(det.notificationNumber, provResult.notificationNumber, doc.sections, provenance),
    totalVacancies: mergeField(det.totalVacancies, provResult.totalVacancies, doc.sections, provenance),
    applicationOpenDate: mergeField(detOpenDate, provResult.applicationOpenDate, doc.sections, provenance),
    applicationCloseDate: mergeField(detCloseDate, provResult.applicationCloseDate, doc.sections, provenance),
    // Fees and breakdown: deterministic never extracts these
    applicationFeeGeneral: mergeField(undefined, provResult.applicationFeeGeneral, doc.sections, provenance),
    applicationFeeSCST: mergeField(undefined, provResult.applicationFeeSCST, doc.sections, provenance),
    vacancyBreakdown: mergeBreakdownField(provResult.vacancyBreakdown, doc.sections, provenance),
  };
}
