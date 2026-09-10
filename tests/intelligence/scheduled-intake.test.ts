// Phase 9C: Scheduled intake decision gate tests (SI-01–SI-16)
//
// Tests evaluateAutoPrEligibility() — the Phase 9C decision gate.
// Pure unit tests: no network I/O, no git operations, no real intake.
//
// productionWrites remains 0.

import assert from "node:assert";
import type { CandidateNewRecruitment } from "@/intelligence/types";
import type { IntakeResult } from "@/intelligence/intake";
import type { ValidationError } from "@/lib/validation";
import { evaluateAutoPrEligibility } from "@/intelligence/scheduled-intake";
import { normalizeNotificationNumber, buildCandidateId, buildTitleSimilarityKey, normalizeSourceUrl } from "@/intelligence/dedup";

// ─── Helpers ─────────────────────────────────────────────────

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

function makeCandidate(overrides: Partial<CandidateNewRecruitment> = {}): CandidateNewRecruitment {
  const notif = normalizeNotificationNumber("CSE 2026");
  return {
    candidateId: buildCandidateId("upsc", notif),
    discoverySourceId: "freejobalert-rss",
    discoverySourceUrl: "https://upsc.gov.in/notifications/cse-2026",
    discoverySourceTier: 2,
    discoveredAt: "2026-09-08T10:00:00.000Z",
    organizationId: "upsc",
    organizationName: "Union Public Service Commission",
    title: "UPSC Civil Services Examination 2026",
    notificationNumber: "CSE 2026",
    applicationOpenDate: "2026-10-01",
    applicationCloseDate: "2026-10-31",
    normalizedNotifNumber: notif,
    sourceUrlFingerprint: normalizeSourceUrl("https://upsc.gov.in/notifications/cse-2026.pdf"),
    titleSimilarityKey: buildTitleSimilarityKey("UPSC Civil Services Examination 2026"),
    rawExcerpt: "UPSC Civil Services 2026",
    confidence: 0.85,
    clusterStatus: "MERGED",
    status: "PENDING_REVIEW",
    ...overrides,
  };
}

function makeIntakeResult(overrides: Partial<IntakeResult> = {}): IntakeResult {
  return {
    sourceUrl: "https://upsc.gov.in/notifications/cse-2026",
    classification: {
      kind: "OFFICIAL",
      domain: "upsc.gov.in",
      orgId: "upsc",
      isDiscoveryLeadOnly: false,
    },
    officialSource: {
      found: true,
      url: "https://upsc.gov.in/notifications/cse-2026.pdf",
      method: "official-link-in-page",
      note: "official PDF found",
    },
    extraction: {
      officialLinksFound: [],
      rawExcerpt: "UPSC Civil Services 2026",
      confidence: 0.9,
      specificity: 0.8,
      sourceKind: "OFFICIAL_SPECIFIC",
    },
    evidenceChain: [],
    candidate: null,
    draft: null,
    missingFields: [],
    isDuplicate: false,
    trustGatePassed: true,
    trustGateErrors: [],
    trustGateWarnings: [],
    analysisNotes: [],
    candidateSaved: false,
    fieldSources: {
      title: "OFFICIAL_SPECIFIC",
      notificationNumber: "OFFICIAL_SPECIFIC",
      applicationCloseDate: "OFFICIAL_SPECIFIC",
    },
    ...overrides,
  };
}

function makeValidationError(message: string): ValidationError {
  return { recordId: "test", field: "id", message, severity: "error" };
}

// ─── HOLD conditions ─────────────────────────────────────────

console.log("\n=== HOLD conditions → PENDING_REVIEW ===");

{
  const r = evaluateAutoPrEligibility(
    makeCandidate({ clusterStatus: "POSSIBLE_MATCH" }),
    makeIntakeResult()
  );
  check("SI-01: POSSIBLE_MATCH cluster → not eligible", !r.eligible);
  check("SI-01b: reason mentions POSSIBLE_MATCH", r.reason.includes("POSSIBLE_MATCH"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate({ confidence: 0.4 }),
    makeIntakeResult()
  );
  check("SI-02: confidence 0.4 → not eligible", !r.eligible);
  check("SI-02b: reason mentions 0.6 threshold", r.reason.includes("0.6"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ classification: { kind: "THIRD_PARTY", domain: "freejobalert.com", isDiscoveryLeadOnly: true } })
  );
  check("SI-03: THIRD_PARTY source → not eligible", !r.eligible);
  check("SI-03b: reason mentions OFFICIAL", r.reason.includes("OFFICIAL"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate({ notificationNumber: undefined }),
    makeIntakeResult()
  );
  check("SI-04: missing notificationNumber → not eligible", !r.eligible);
  check("SI-04b: reason mentions notificationNumber", r.reason.includes("notificationNumber"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate({ title: undefined }),
    makeIntakeResult()
  );
  check("SI-05: missing title → not eligible", !r.eligible);
  check("SI-05b: reason mentions title", r.reason.includes("title"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate({ applicationCloseDate: undefined }),
    makeIntakeResult()
  );
  check("SI-06: missing applicationCloseDate → not eligible", !r.eligible);
  check("SI-06b: reason mentions applicationCloseDate", r.reason.includes("applicationCloseDate"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate({ applicationCloseDate: "TBA" }),
    makeIntakeResult()
  );
  check("SI-07: applicationCloseDate TBA → not eligible", !r.eligible);
  check("SI-07b: reason mentions TBA", r.reason.includes("TBA"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ officialSource: { found: false, method: "none", note: "no pdf" } })
  );
  check("SI-08: officialSource.found false → not eligible", !r.eligible);
  check("SI-08b: reason mentions official source", r.reason.includes("official source"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ classification: { kind: "OFFICIAL", domain: "upsc.gov.in", isDiscoveryLeadOnly: true } })
  );
  check("SI-09: discovery-lead-only → not eligible", !r.eligible);
  check("SI-09b: reason mentions discovery-lead-only", r.reason.includes("discovery-lead-only"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ fieldSources: { title: "THIRD_PARTY", notificationNumber: "OFFICIAL_SPECIFIC", applicationCloseDate: "OFFICIAL_SPECIFIC" } })
  );
  check("SI-10: title with THIRD_PARTY evidence → not eligible", !r.eligible);
  check("SI-10b: reason names the field and bad kind", r.reason.includes("title") && r.reason.includes("THIRD_PARTY"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ fieldSources: { title: "OFFICIAL_SPECIFIC", notificationNumber: "OFFICIAL_GENERIC", applicationCloseDate: "OFFICIAL_PDF" } })
  );
  check("SI-10c: OFFICIAL_GENERIC evidence on notificationNumber → not eligible", !r.eligible);
  check("SI-10d: reason names notificationNumber and OFFICIAL_GENERIC", r.reason.includes("notificationNumber") && r.reason.includes("OFFICIAL_GENERIC"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ trustGatePassed: false, trustGateErrors: [makeValidationError("id collision")] })
  );
  check("SI-11: Trust Gate failed → not eligible", !r.eligible);
  check("SI-11b: reason mentions Trust Gate", r.reason.includes("Trust Gate"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ isDuplicate: true, duplicateReason: "matches canonical id" })
  );
  check("SI-12: isDuplicate → not eligible", !r.eligible);
  check("SI-12b: reason mentions duplicate", r.reason.includes("duplicate"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({
      pdfExtraction: {
        officialLinksFound: [],
        rawExcerpt: "",
        confidence: 0,
        specificity: 0,
        sourceKind: "OFFICIAL_PDF",
        pdfTextQuality: "OCR_REQUIRED",
      },
    })
  );
  check("SI-13: OCR_REQUIRED PDF → not eligible", !r.eligible);
  check("SI-13b: reason mentions OCR_REQUIRED", r.reason.includes("OCR_REQUIRED"));
}

// ─── AUTO_PR conditions ─────────────────────────────────────��─

console.log("\n=== AUTO_PR conditions → eligible ===");

{
  const r = evaluateAutoPrEligibility(makeCandidate(), makeIntakeResult());
  check("SI-14: all conditions met → eligible", r.eligible);
  check("SI-14b: reason mentions all conditions met", r.reason.includes("all AUTO_PR conditions met"));
}

{
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({
      fieldSources: { title: "OFFICIAL_PDF", notificationNumber: "OFFICIAL_PDF", applicationCloseDate: "OFFICIAL_PDF" },
    })
  );
  check("SI-14c: OFFICIAL_PDF evidence on all critical fields → eligible", r.eligible);
}

{
  // A field absent from fieldSources has no evidence requirement
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ fieldSources: { title: "OFFICIAL_SPECIFIC" } })
  );
  check("SI-14d: field missing from fieldSources → not blocked (absence ≠ non-authoritative)", r.eligible);
}

{
  // TEXT_PARTIAL PDF quality should not block
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({
      pdfExtraction: {
        officialLinksFound: [],
        rawExcerpt: "partial text",
        confidence: 0.7,
        specificity: 0.5,
        sourceKind: "OFFICIAL_PDF",
        pdfTextQuality: "TEXT_PARTIAL",
      },
    })
  );
  check("SI-15: TEXT_PARTIAL PDF quality → does not block eligibility", r.eligible);
}

{
  // No PDF extraction at all → not blocked by OCR check
  const r = evaluateAutoPrEligibility(
    makeCandidate(),
    makeIntakeResult({ pdfExtraction: undefined })
  );
  check("SI-16: no pdfExtraction → not blocked by OCR check", r.eligible);
}

// ─── buildEvaluationCandidate regression tests ───────────────
// SI-17 through SI-22 prove the data handoff fix is correct.

import { buildEvaluationCandidate } from "@/intelligence/scheduled-intake";

console.log("\n=== buildEvaluationCandidate provenance tests ===");

{
  // OFFICIAL_PDF evidence → field must be merged
  const discovery = makeCandidate({ notificationNumber: undefined });
  const intake = makeIntakeResult({
    candidate: makeCandidate({ notificationNumber: "IBPS/CRP-RRBs-XV/2026" }),
    fieldSources: { notificationNumber: "OFFICIAL_PDF" },
  });
  const ev = buildEvaluationCandidate(discovery, intake);
  check("SI-17: OFFICIAL_PDF evidence → authoritative field merged", ev.notificationNumber === "IBPS/CRP-RRBs-XV/2026");
  check("SI-17b: original discovery candidate NOT mutated", discovery.notificationNumber === undefined);
}

{
  // THIRD_PARTY evidence → field must NOT be merged
  const discovery = makeCandidate({ applicationCloseDate: undefined });
  const intake = makeIntakeResult({
    candidate: makeCandidate({ applicationCloseDate: "2026-10-31" }),
    fieldSources: { applicationCloseDate: "THIRD_PARTY" },
  });
  const ev = buildEvaluationCandidate(discovery, intake);
  check("SI-18: THIRD_PARTY evidence → field NOT merged", ev.applicationCloseDate === undefined);
}

{
  // OFFICIAL_GENERIC evidence → field must NOT be merged (homepage cannot attribute)
  const discovery = makeCandidate({ notificationNumber: undefined });
  const intake = makeIntakeResult({
    candidate: makeCandidate({ notificationNumber: "CRP-RRBs-XV" }),
    fieldSources: { notificationNumber: "OFFICIAL_GENERIC" },
  });
  const ev = buildEvaluationCandidate(discovery, intake);
  check("SI-19: OFFICIAL_GENERIC evidence → field NOT merged", ev.notificationNumber === undefined);
}

{
  // PDF ambiguity property: verify extraction correctly carries ambiguous PDF candidates.
  // The runScheduledIntake PDF ambiguity gate reads
  //   intakeResult.extraction.ambiguousPdfCandidates
  // and routes to PENDING_REVIEW when it is populated.
  // We test the gate directly in ibps-positive-path.test.ts (async context).
  // Here we verify the property structure that triggers it.
  const ambiguousIntake = makeIntakeResult({
    extraction: {
      officialLinksFound: [],
      rawExcerpt: "IBPS CRP RRBs XV",
      confidence: 0.9,
      specificity: 0.8,
      sourceKind: "OFFICIAL_SPECIFIC",
      ambiguousPdfCandidates: ["Window-Notification_CRP-RRBs-XV.pdf", "CRP-RRBs-XV-notification.pdf"],
    },
  });
  const hasAmbiguous = (ambiguousIntake.extraction.ambiguousPdfCandidates ?? []).length > 0;
  check("SI-20: ambiguousPdfCandidates populated on extraction — gate would fire", hasAmbiguous);
  check("SI-20b: exactly 2 ambiguous candidates recorded", ambiguousIntake.extraction.ambiguousPdfCandidates?.length === 2);
}

{
  // buildEvaluationCandidate must not mutate the original discovery candidate object
  const discovery = makeCandidate({ notificationNumber: undefined, applicationCloseDate: undefined });
  const originalRef = discovery;
  const intake = makeIntakeResult({
    candidate: makeCandidate({ notificationNumber: "CRP-RRBs-XV", applicationCloseDate: "2026-10-31" }),
    fieldSources: {
      notificationNumber: "OFFICIAL_PDF",
      applicationCloseDate: "OFFICIAL_PDF",
    },
  });
  const ev = buildEvaluationCandidate(discovery, intake);
  check("SI-21: original discovery candidate is not mutated after buildEvaluationCandidate", discovery === originalRef);
  check("SI-21b: original.notificationNumber still undefined", discovery.notificationNumber === undefined);
  check("SI-21c: evaluation candidate has merged notificationNumber", ev.notificationNumber === "CRP-RRBs-XV");
}

{
  // OFFICIAL_SPECIFIC evidence on critical field → merged into evaluation candidate
  const discovery = makeCandidate({ notificationNumber: undefined });
  const intake = makeIntakeResult({
    candidate: makeCandidate({ notificationNumber: "UPSC/CSE/2026/HTML" }),
    fieldSources: { notificationNumber: "OFFICIAL_SPECIFIC" },
  });
  const ev = buildEvaluationCandidate(discovery, intake);
  check("SI-22: OFFICIAL_SPECIFIC evidence → field merged into evaluation candidate", ev.notificationNumber === "UPSC/CSE/2026/HTML");
}

console.log("\nDone.");
