// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine Content Comparator
// Phase 2A: Compare extracted signals against canonical state
// ═══════════════════════════════════════════════════════════
//
// Determines whether a detected signal represents:
//   - Something we already know (CONFIRMS_CURRENT_STATE)
//   - Something that differs from what we have (SUGGESTS_CHANGE)
//   - A signal we can't currently reconcile (UNCONFIRMED)
//
// INVARIANT: This module is purely functional — read-only.
//   It never writes to canonical data.
//   It never makes network requests.
//   It only reads canonical records to compare against signals.
//
// Trust rule:
//   Even SIGNAL_SUGGESTS_CHANGE is not a fact.
//   It means: "the official source text contains a keyword
//   that, if accurate, would represent a change from the
//   canonical record."
//   A human must verify before any canonical write.
// ═══════════════════════════════════════════════════════════

import type { Opportunity, GovernmentRecruitment, ExamStageStatus } from "@/types";
import type {
  ContentSignal,
  ContentComparison,
  ComparisonOutcome,
  CandidateEventType,
} from "./types";

// ─── Public API ──────────────────────────────────────────────

/**
 * Compare a list of detected signals against the canonical record.
 * Returns a ContentComparison describing whether the signals
 * confirm, suggest a change from, or are unrelated to the canonical state.
 */
export function compareSignalsToCanonical(
  signals: ContentSignal[],
  opp: Opportunity,
  sourceId: string
): ContentComparison {
  if (signals.length === 0) {
    return {
      opportunityId: opp.id,
      sourceId,
      outcome: "NO_SIGNAL",
      signals: [],
      suggestedEventTypes: [],
    };
  }

  if (opp.type !== "government") {
    // Private jobs and internships: we have no structured stage data to compare
    return {
      opportunityId: opp.id,
      sourceId,
      outcome: "UNCONFIRMED",
      signals,
      suggestedEventTypes: signals.map((s) => s.signalType),
      notes: "Non-government opportunity: no structured stage data for comparison",
    };
  }

  const outcomes: Array<{ signal: ContentSignal; outcome: ComparisonOutcome }> =
    signals.map((signal) => ({
      signal,
      outcome: compareOneSignal(signal, opp as GovernmentRecruitment),
    }));

  // The overall outcome is the highest-priority one:
  // SUGGESTS_CHANGE > UNCONFIRMED > CONFIRMS_CURRENT_STATE > NO_SIGNAL
  const overallOutcome = pickHighestOutcome(outcomes.map((o) => o.outcome));

  const suggestedEventTypes: CandidateEventType[] = outcomes
    .filter((o) => o.outcome === "SIGNAL_SUGGESTS_CHANGE")
    .map((o) => o.signal.signalType);

  return {
    opportunityId: opp.id,
    sourceId,
    outcome: overallOutcome,
    signals,
    suggestedEventTypes,
    notes: buildNotes(outcomes),
  };
}

// ─── Per-signal Comparison ───────────────────────────────────

function compareOneSignal(
  signal: ContentSignal,
  rec: GovernmentRecruitment
): ComparisonOutcome {
  switch (signal.signalType) {
    case "EXAM_POSTPONED":
      return hasExamStageStatus(rec, "POSTPONED")
        ? "SIGNAL_CONFIRMS_CURRENT_STATE"
        : "SIGNAL_SUGGESTS_CHANGE";

    case "EXAM_CANCELLED":
      // ExamStageStatus has no CANCELLED — check update history
      return hasUpdateType(rec, "CANCELLATION")
        ? "SIGNAL_CONFIRMS_CURRENT_STATE"
        : "SIGNAL_SUGGESTS_CHANGE";

    case "EXAM_DATE_CHANGE":
      // If we see "rescheduled" but canonical has no RESCHEDULE update → suggests change
      return hasUpdateType(rec, "RESCHEDULE")
        ? "SIGNAL_CONFIRMS_CURRENT_STATE"
        : "SIGNAL_SUGGESTS_CHANGE";

    case "RE_EXAM":
      // Re-exam is always interesting — there's no canonical field for it
      return "SIGNAL_SUGGESTS_CHANGE";

    case "APPLICATION_DEADLINE_CHANGE":
      // If extendedCloseDate already set OR a DEADLINE_EXTENSION update exists → confirms
      return rec.application.extendedCloseDate !== undefined ||
        hasUpdateType(rec, "DEADLINE_EXTENSION")
        ? "SIGNAL_CONFIRMS_CURRENT_STATE"
        : "SIGNAL_SUGGESTS_CHANGE";

    case "VACANCY_CHANGE":
      // If originalVacancies is set → we already know vacancy was revised
      return rec.originalVacancies !== undefined || hasUpdateType(rec, "VACANCY_REVISION")
        ? "SIGNAL_CONFIRMS_CURRENT_STATE"
        : "SIGNAL_SUGGESTS_CHANGE";

    case "NEW_NOTICE":
      // Hard to tell if it's a new notice we haven't captured — assume suggests change
      return "SIGNAL_SUGGESTS_CHANGE";

    case "CORRIGENDUM":
      return hasUpdateType(rec, "CORRIGENDUM")
        ? "SIGNAL_CONFIRMS_CURRENT_STATE"
        : "SIGNAL_SUGGESTS_CHANGE";

    case "RESULT_RELEASED":
      return hasExamStageStatus(rec, "RESULT_DECLARED")
        ? "SIGNAL_CONFIRMS_CURRENT_STATE"
        : "SIGNAL_SUGGESTS_CHANGE";

    case "ADMIT_CARD_RELEASED":
      return hasExamStageStatus(rec, "ADMIT_CARD_OUT")
        ? "SIGNAL_CONFIRMS_CURRENT_STATE"
        : "SIGNAL_SUGGESTS_CHANGE";

    case "ANSWER_KEY_RELEASED":
      // No answer-key field in canonical type — always UNCONFIRMED
      return "UNCONFIRMED";

    default:
      return "UNCONFIRMED";
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function hasExamStageStatus(rec: GovernmentRecruitment, status: ExamStageStatus): boolean {
  return rec.examStages.some((s) => s.status === status);
}

function hasUpdateType(
  rec: GovernmentRecruitment,
  type: "CANCELLATION" | "RESCHEDULE" | "DEADLINE_EXTENSION" | "VACANCY_REVISION" | "CORRIGENDUM"
): boolean {
  return (rec.updates ?? []).some((u) => u.type === type);
}

const OUTCOME_PRIORITY: Record<ComparisonOutcome, number> = {
  SIGNAL_SUGGESTS_CHANGE:       4,
  UNCONFIRMED:                  3,
  HASH_CHANGED_NO_SIGNAL:       2,
  SIGNAL_CONFIRMS_CURRENT_STATE: 1,
  NO_SIGNAL:                    0,
};

function pickHighestOutcome(outcomes: ComparisonOutcome[]): ComparisonOutcome {
  return outcomes.reduce(
    (best, cur) =>
      OUTCOME_PRIORITY[cur] > OUTCOME_PRIORITY[best] ? cur : best,
    "NO_SIGNAL" as ComparisonOutcome
  );
}

function buildNotes(
  outcomes: Array<{ signal: ContentSignal; outcome: ComparisonOutcome }>
): string {
  const parts = outcomes.map(
    ({ signal, outcome }) =>
      `${signal.signalType}(${signal.confidence.toFixed(2)}): ${outcome}`
  );
  return parts.join("; ");
}
