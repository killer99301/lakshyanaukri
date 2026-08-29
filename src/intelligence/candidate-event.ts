// ═══════════════════════════════════════════════════════════
// Career Campus — Candidate Change Event Factory
// ═══════════════════════════════════════════════════════════
// Builds CandidateChangeEvent objects following the engine's
// verification state machine.
//
// CRITICAL TRUST RULE:
//   A CandidateChangeEvent is a signal, not a fact.
//   It must travel through:
//     DISCOVERED → CANDIDATE → OFFICIAL_SOURCE_FOUND → VERIFIED
//   before any field values are considered for a canonical write.
//
//   A Tier 5 source alone can NEVER produce a CandidateChangeEvent
//   that carries factual field values. It may only reach CANDIDATE.
//
//   humanReviewRequired = true in ALL Phase 1 events.
//   Auto-approval logic is introduced in Phase 3+.
// ═══════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import type {
  CandidateChangeEvent,
  CandidateEventType,
  ContentSignal,
  SourceTier,
  VerificationState,
  StalenessReport,
} from "./types";

// ─── Base factory ────────────────────────────────────────────

interface CreateEventParams {
  runId: string;
  eventType: CandidateEventType;
  opportunityId: string;
  sourceId: string;
  sourceUrl: string;
  sourceTier: SourceTier;
  verificationState?: VerificationState;
  rawSignal?: string;
  sourceSnapshotHash?: string;
  // Phase 2A: populated from content extraction
  confidence?: number;
  extractionMethod?: "HTML" | "PDF_DIGITAL" | "PDF_OCR" | "LLM_NORMALIZED";
}

/**
 * Create a new CandidateChangeEvent in PENDING review status.
 * All Phase 1 events are created with:
 *   - verificationState: "CANDIDATE" (no content extraction yet)
 *   - humanReviewRequired: true (always in Phase 1)
 *   - no confidence or proposed field values (Phase 2+)
 */
export function createCandidateEvent(
  params: CreateEventParams
): CandidateChangeEvent {
  return {
    id: `cce-${randomUUID()}`,
    runId: params.runId,
    eventType: params.eventType,
    opportunityId: params.opportunityId,
    sourceId: params.sourceId,
    sourceUrl: params.sourceUrl,
    sourceTier: params.sourceTier,
    detectedAt: new Date().toISOString(),
    verificationState: params.verificationState ?? "CANDIDATE",
    rawSignal: params.rawSignal,
    sourceSnapshotHash: params.sourceSnapshotHash,
    confidence: params.confidence,
    extractionMethod: params.extractionMethod,
    // proposedField, proposedPreviousValue, proposedNewValue populated by Phase 2B
    humanReviewRequired: true,
    reviewStatus: "PENDING",
  };
}

/**
 * Create a DISCOVERED event from a secondary (Tier 5) source signal.
 *
 * This event represents "a secondary source mentioned something that might
 * be relevant." It must be confirmed by a Tier 1–3 official source before
 * any field data is populated.
 *
 * Tier 5 events may never reach OFFICIAL_SOURCE_FOUND on their own;
 * they trigger a targeted official-source check and are then superseded
 * by the resulting Tier 1–3 event.
 */
export function createDiscoveryEvent(
  runId: string,
  opportunityId: string,
  sourceId: string,
  secondaryUrl: string,
  rawSignal: string
): CandidateChangeEvent {
  return createCandidateEvent({
    runId,
    eventType: "OTHER_OFFICIAL_UPDATE",
    opportunityId,
    sourceId,
    sourceUrl: secondaryUrl,
    sourceTier: 5,
    verificationState: "DISCOVERED",
    rawSignal,
  });
}

/**
 * Reject a candidate event (discard without publishing).
 * Rejection is always logged — events are never silently discarded.
 */
export function rejectEvent(
  event: CandidateChangeEvent,
  reason: string
): CandidateChangeEvent {
  return {
    ...event,
    verificationState: "REJECTED",
    reviewStatus: "REJECTED",
    rejectionReason: reason,
  };
}

// ─── Phase 1 — Staleness-based candidate events ──────────────
// In Phase 1, a stale + reachable record triggers a generic
// OTHER_OFFICIAL_UPDATE event at CANDIDATE state.
// This is the weakest possible signal — it means only:
//   "This record is stale and the official source is online.
//    A human should re-verify it."
// Phase 2 replaces these with specific event types derived from
// actual extracted content.

/**
 * Create a staleness-triggered candidate event.
 * Only created when:
 *   1. The record is stale (days > threshold for its priority)
 *   2. The official source was reachable (HTTP 200)
 *
 * Never created when the source was unreachable — a fetch failure
 * is not a data signal.
 */
// ─── Phase 2A — Signal-based candidate events ─────────────────
// Created when content extraction detects a keyword pattern on
// an official source (Tier 1–3) or a secondary source (Tier 5).
//
// Trust rule enforced here:
//   Tier 5 signals: verificationState MUST be "DISCOVERED"
//   Tier 1–3 signals: verificationState is "OFFICIAL_SOURCE_FOUND"
//
// In both cases: humanReviewRequired = true always.

/**
 * Create a candidate event from an extracted content signal.
 * Call this after extractTextFromHtml() + detectSignals() confirm
 * that the official source page contains a relevant keyword.
 */
export function createSignalEvent(params: {
  runId: string;
  opportunityId: string;
  sourceId: string;
  sourceUrl: string;
  sourceTier: SourceTier;
  signal: ContentSignal;
  snapshotHash?: string;
  verificationState: VerificationState;
}): CandidateChangeEvent {
  // Enforce trust rule: Tier 5 sources cap at DISCOVERED
  const state: VerificationState =
    params.sourceTier === 5 ? "DISCOVERED" : params.verificationState;

  const event = createCandidateEvent({
    runId: params.runId,
    eventType: params.signal.signalType,
    opportunityId: params.opportunityId,
    sourceId: params.sourceId,
    sourceUrl: params.sourceUrl,
    sourceTier: params.sourceTier,
    verificationState: state,
    rawSignal: params.signal.matchedText,
    sourceSnapshotHash: params.snapshotHash,
    confidence: params.signal.confidence,
    extractionMethod: "HTML",
  });
  if (params.signal.matchedIdentifier) {
    event.matchedIdentifier = params.signal.matchedIdentifier;
  }
  if (params.signal.disambiguationScore) {
    event.disambiguationScore = params.signal.disambiguationScore;
    event.competitorTerm = params.signal.competitorTerm;
  }
  return event;
}

export function createStalenessCandidateEvent(
  report: StalenessReport,
  sourceId: string,
  runId: string
): CandidateChangeEvent | null {
  if (!report.isStale) return null;
  if (!report.fetchResult || report.fetchResult.status !== "OK") return null;
  if (!report.primarySourceUrl) return null;

  return createCandidateEvent({
    runId,
    eventType: "OTHER_OFFICIAL_UPDATE",
    opportunityId: report.opportunityId,
    sourceId,
    sourceUrl: report.primarySourceUrl,
    sourceTier: 3,                 // Tier 3: official website
    verificationState: "CANDIDATE",
    rawSignal:
      `Record is ${report.daysSinceVerification} day(s) stale ` +
      `(threshold: ${report.staleThresholdDays} day(s) for ${report.priority} priority). ` +
      `Official source is reachable. Manual re-verification recommended.`,
    sourceSnapshotHash: report.fetchResult.contentHash,
  });
}
