// ═══════════════════════════════════════════════════════════
// Career Campus — Official Source Confirmation Pipeline (Phase 3)
// ═══════════════════════════════════════════════════════════
//
// Takes a DISCOVERED CandidateChangeEvent (from a Tier 5 secondary source)
// and the already-fetched official source text for the same opportunity.
// Determines whether the official source confirms the change using
// deterministic regex matching — no LLM, no inference.
//
// For each confirmed change, produces structured FieldDiffs comparing
// the observed value (extracted from official text) against the canonical record.
//
// State transition (when outcome = CONFIRMED_CHANGE):
//   CandidateChangeEvent.verificationState: DISCOVERED → OFFICIAL_SOURCE_FOUND
// This transition is performed by the runner after receiving the result.
//
// INVARIANTS:
//   - This module reads canonical data and official source text.
//   - It NEVER writes to canonical data. productionWrites = 0 always.
//   - No LLM is used. All decisions are deterministic.
//   - Reuses normalizeIdentifier() and getOpportunityIdentifiers() from extractor.ts.
//   - Does not create a second trust system — uses the same identifier
//     normalization and proximity logic as Phase 2B/2C.
// ═══════════════════════════════════════════════════════════

import type { Opportunity, GovernmentRecruitment } from "@/types";
import type {
  CandidateChangeEvent,
  CandidateEventType,
  ConfirmationResult,
  FieldDiff,
} from "./types";
import { getOpportunityIdentifiers, normalizeIdentifier } from "./extractor";
import { extractFieldValues } from "./field-extractor";

// Wider proximity window than Phase 2B (150 chars) — official source text
// is more structured and the identifier may appear in a heading while
// the change notice is in a body paragraph below.
const CONFIRMATION_PROXIMITY_CHARS = 200;

// ─── Change-type keyword sets ─────────────────────────────────
// Maps CandidateEventType → phrases that constitute confirmation on an official page.
// Must appear within CONFIRMATION_PROXIMITY_CHARS of the recruitment identifier.

const CHANGE_KEYWORDS: Partial<Record<CandidateEventType, string[]>> = {
  EXAM_POSTPONED:              ["postponed", "deferred", "stands postponed"],
  EXAM_CANCELLED:              ["cancelled", "cancellation", "stands cancelled"],
  EXAM_DATE_CHANGE:            ["rescheduled", "revised date", "new date", "new schedule", "date changed"],
  RE_EXAM:                     ["re-examination", "re-exam", "fresh examination"],
  VACANCY_CHANGE:              ["revised vacancy", "revised vacancies", "vacancy revised", "additional posts", "additional vacancies"],
  APPLICATION_DEADLINE_CHANGE: ["last date extended", "date extended", "deadline extended", "extended till"],
  RESULT_RELEASED:             ["result declared", "result has been declared", "result announced", "result published", "result out", "final result", "merit list"],
  ADMIT_CARD_RELEASED:         ["admit card", "hall ticket", "call letter"],
  ANSWER_KEY_RELEASED:         ["answer key", "provisional answer key", "final answer key"],
  CORRIGENDUM:                 ["corrigendum", "erratum"],
  NEW_NOTICE:                  ["new notification", "fresh notification", "new advertisement"],
  OTHER_OFFICIAL_UPDATE:       ["notice", "notification", "update", "announcement"],
};

// ─── confirmChange ────────────────────────────────────────────

export function confirmChange(params: {
  discoveredEvent: CandidateChangeEvent;
  opportunity: Opportunity;
  officialSourceText: string;
  officialSourceId: string;
  officialSourceUrl: string;
}): ConfirmationResult {
  const { discoveredEvent, opportunity, officialSourceText, officialSourceId, officialSourceUrl } = params;

  const lowerText = officialSourceText.toLowerCase();
  const normalizedText = normalizeIdentifier(lowerText);

  const identifiers = getOpportunityIdentifiers(opportunity);
  const normalizedIds = identifiers.map(normalizeIdentifier);

  // ── 1. Identifier check ───────────────────────────────────────
  // Does the official page contain the canonical recruitment identifier?
  let identifierConfirmed = false;
  let idPosition = -1;
  let matchedNormId = "";
  for (const normId of normalizedIds) {
    const pos = normalizedText.indexOf(normId);
    if (pos !== -1) {
      identifierConfirmed = true;
      idPosition = pos;
      matchedNormId = normId;
      break;
    }
  }

  // ── 2. Change-type check ──────────────────────────────────────
  // Does the official page contain language that matches the event's change type?
  const eventType = discoveredEvent.eventType;
  const changeKeywords = CHANGE_KEYWORDS[eventType] ?? CHANGE_KEYWORDS.OTHER_OFFICIAL_UPDATE ?? [];
  let changeTypeConfirmed = false;
  let kwPosition = -1;
  for (const kw of changeKeywords) {
    const pos = lowerText.indexOf(kw);
    if (pos !== -1) {
      changeTypeConfirmed = true;
      kwPosition = pos;
      break;
    }
  }

  // ── 3. Proximity check ────────────────────────────────────────
  // Both identifier and keyword must appear within CONFIRMATION_PROXIMITY_CHARS
  // of each other. Uses normalized text for identifier, lower text for keyword.
  // Position comparison is approximate when normalization changes length (e.g.
  // hyphen → space), but the 200-char window absorbs any small offset.
  let proximityConfirmed = false;
  if (identifierConfirmed && changeTypeConfirmed) {
    outer:
    for (const normId of normalizedIds) {
      let idSearchPos = 0;
      while (idSearchPos < normalizedText.length) {
        const idPos = normalizedText.indexOf(normId, idSearchPos);
        if (idPos === -1) break;
        for (const kw of changeKeywords) {
          let kwSearchPos = 0;
          while (kwSearchPos < lowerText.length) {
            const kwPos = lowerText.indexOf(kw, kwSearchPos);
            if (kwPos === -1) break;
            if (Math.abs(idPos - kwPos) <= CONFIRMATION_PROXIMITY_CHARS) {
              proximityConfirmed = true;
              break outer;
            }
            kwSearchPos = kwPos + kw.length;
          }
        }
        idSearchPos = idPos + normId.length;
      }
    }
  }

  // Track used positions for notes (suppress unused warnings)
  void idPosition;
  void matchedNormId;
  void kwPosition;

  // ── 4. Field-level extraction ─────────────────────────────────
  // Extract specific field values from the official text using regex.
  // Compare against the canonical record to produce structured diffs.
  // Only populated when identifierConfirmed — otherwise we can't be sure
  // the extracted values are about our specific recruitment.
  const extracted = extractFieldValues(officialSourceText);
  const fieldDiffs: FieldDiff[] = [];

  if (opportunity.type === "government" && identifierConfirmed) {
    const gov = opportunity as GovernmentRecruitment;

    // Status diff: infer new status from event type (deterministic, no LLM)
    const statusMap: Partial<Record<CandidateEventType, string>> = {
      EXAM_POSTPONED: "POSTPONED",
      EXAM_CANCELLED: "CANCELLED",
    };
    const observedStatus = statusMap[eventType];
    if (observedStatus && changeTypeConfirmed) {
      for (let i = 0; i < gov.examStages.length; i++) {
        const stage = gov.examStages[i];
        if (stage.status !== observedStatus) {
          fieldDiffs.push({
            field: `examStages[${i}].status`,
            canonicalValue: stage.status,
            observedValue: observedStatus,
            confidence: proximityConfirmed ? 0.85 : 0.60,
            extractionMethod: "REGEX",
          });
          break; // only the first differing stage
        }
      }
    }

    // Date diff: only when a fully parseable ISO date was extracted
    if (extracted.dates.length > 0 && eventType !== "EXAM_CANCELLED") {
      const best = extracted.dates[0]; // sorted by confidence desc
      if (best.iso) {
        for (let i = 0; i < gov.examStages.length; i++) {
          const stage = gov.examStages[i];
          const canonDate = stage.dateIso ?? "not set";
          if (best.iso !== canonDate) {
            fieldDiffs.push({
              field: `examStages[${i}].date`,
              canonicalValue: canonDate,
              observedValue: best.iso,
              confidence: best.confidence * (proximityConfirmed ? 0.90 : 0.65),
              extractionMethod: "REGEX",
            });
            break;
          }
        }
      }
    }

    // Vacancy diff: only for VACANCY_CHANGE events.
    // When multiple vacancy counts appear (e.g. "revised: 17,727 vs earlier 14,582"),
    // pick the first one that differs from the canonical value — that's the new value.
    if (extracted.vacancies.length > 0 && eventType === "VACANCY_CHANGE") {
      const differing = extracted.vacancies.find((v) => v.count !== gov.totalVacancies);
      if (differing) {
        fieldDiffs.push({
          field: "totalVacancies",
          canonicalValue: String(gov.totalVacancies),
          observedValue: String(differing.count),
          confidence: proximityConfirmed ? 0.80 : 0.55,
          extractionMethod: "REGEX",
        });
      }
    }

    // Application deadline diff: only for APPLICATION_DEADLINE_CHANGE events
    if (extracted.dates.length > 0 && eventType === "APPLICATION_DEADLINE_CHANGE") {
      const best = extracted.dates[0];
      if (best.iso) {
        const canonDeadline =
          gov.application.extendedCloseDate ?? gov.application.closeDate;
        if (best.iso !== canonDeadline) {
          fieldDiffs.push({
            field: "application.closeDate",
            canonicalValue: canonDeadline,
            observedValue: best.iso,
            confidence: best.confidence * (proximityConfirmed ? 0.85 : 0.60),
            extractionMethod: "REGEX",
          });
        }
      }
    }
  }

  // ── 5. Outcome ────────────────────────────────────────────────
  let outcome: ConfirmationResult["outcome"];
  if (identifierConfirmed && changeTypeConfirmed && proximityConfirmed) {
    outcome = "CONFIRMED_CHANGE";
  } else if (identifierConfirmed && changeTypeConfirmed && !proximityConfirmed) {
    // Both signals present but too far apart to attribute the change to our exam
    outcome = "AMBIGUOUS_CONFIRMATION";
  } else if (!identifierConfirmed && changeTypeConfirmed) {
    // Change found on official page but cannot tie it to our specific recruitment
    outcome = "AMBIGUOUS_CONFIRMATION";
  } else {
    // Identifier present but change type absent → official source doesn't confirm
    // Also covers: neither present
    outcome = "NOT_CONFIRMED";
  }

  return {
    opportunityId: opportunity.id,
    outcome,
    officialSourceId,
    officialSourceUrl,
    identifierConfirmed,
    changeTypeConfirmed,
    proximityConfirmed,
    fieldDiffs,
    notes: fieldDiffs.length > 0 ? `${fieldDiffs.length} field diff(s) extracted` : undefined,
  };
}

// ─── confirmUnavailable ───────────────────────────────────────
// Called when the official source text is absent for a run
// (source timed out, was blocked, or content was unchanged and deduped).
// Produces an OFFICIAL_UNAVAILABLE result so the audit log reflects why
// the confirmation step could not run.

export function confirmUnavailable(
  discoveredEvent: CandidateChangeEvent,
  opportunity: Opportunity,
  officialSourceId: string,
  officialSourceUrl: string
): ConfirmationResult {
  void discoveredEvent; // opportunityId comes from opportunity.id below
  return {
    opportunityId: opportunity.id,
    outcome: "OFFICIAL_UNAVAILABLE",
    officialSourceId,
    officialSourceUrl,
    identifierConfirmed: false,
    changeTypeConfirmed: false,
    proximityConfirmed: false,
    fieldDiffs: [],
    notes: "Official source not available — source failed, was blocked, or content was deduped this run",
  };
}
