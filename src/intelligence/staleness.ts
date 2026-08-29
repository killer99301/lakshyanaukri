// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine Staleness Assessment
// ═══════════════════════════════════════════════════════════
// Evaluates how urgently each canonical opportunity needs
// re-verification against its official source.
//
// Priority is determined by:
//   1. Proximity of the next lifecycle event (exam date, deadline)
//   2. Current status of exam stages
//   3. Days since lastVerifiedAt vs the tier threshold
//
// This is READ-ONLY. It never modifies canonical records.
// ═══════════════════════════════════════════════════════════

import type { Opportunity, GovernmentRecruitment } from "@/types";
import type { MonitoringPriority, StalenessReport, FetchResult } from "./types";

// ─── Staleness thresholds per priority tier ──────────────────
// A record is considered stale if daysSinceVerification > threshold.

const STALE_THRESHOLD_DAYS: Record<MonitoringPriority, number> = {
  WATCH:    1,
  HIGH:     3,
  NORMAL:   7,
  LOW:      14,
  MINIMAL:  30,
  ARCHIVED: 90,
};

// ─── Date helpers ────────────────────────────────────────────

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}

function daysUntil(isoDate: string, now: Date): number {
  return daysBetween(now, new Date(isoDate));
}

// ─── Priority logic ──────────────────────────────────────────

interface PriorityDecision {
  priority: MonitoringPriority;
  reason: string;
}

function assessGovernmentPriority(
  rec: GovernmentRecruitment,
  now: Date
): PriorityDecision {
  // Check each scheduled exam stage for proximity
  for (const stage of rec.examStages) {
    if (stage.status !== "SCHEDULED" && stage.status !== "ADMIT_CARD_OUT") continue;

    if (stage.dateIso) {
      const days = daysUntil(stage.dateIso, now);

      if (days <= 1) {
        return {
          priority: "WATCH",
          reason: `${stage.name} ${days === 0 ? "is TODAY" : "is TOMORROW"} (${stage.dateIso})`,
        };
      }
      if (days <= 3) {
        return {
          priority: "HIGH",
          reason: `${stage.name} in ${days} day(s) (${stage.dateIso})`,
        };
      }
      if (days <= 14) {
        return {
          priority: "HIGH",
          reason: `${stage.name} scheduled on ${stage.dateIso} (${days} days away)`,
        };
      }
    }

    // Stage scheduled but no exact date — treat as NORMAL active monitoring
    return {
      priority: "NORMAL",
      reason: `${stage.name} scheduled but exact date not declared`,
    };
  }

  // Check application window proximity
  const effectiveClose =
    rec.application.extendedCloseDate ?? rec.application.closeDate;
  const appCloseDays = daysUntil(effectiveClose, now);

  if (appCloseDays >= 0 && appCloseDays <= 1) {
    return {
      priority: "WATCH",
      reason: `Application deadline is ${appCloseDays === 0 ? "TODAY" : "TOMORROW"} (${effectiveClose})`,
    };
  }
  if (appCloseDays >= 0 && appCloseDays <= 3) {
    return {
      priority: "HIGH",
      reason: `Application closes in ${appCloseDays} day(s) (${effectiveClose})`,
    };
  }

  const appOpenDays = daysUntil(rec.application.openDate, now);
  if (appOpenDays <= 0 && appCloseDays >= 0) {
    return {
      priority: "NORMAL",
      reason: "Application window is currently open",
    };
  }

  // Exam postponed — active monitoring for new date
  const hasPostponed = rec.examStages.some((s) => s.status === "POSTPONED");
  if (hasPostponed) {
    return {
      priority: "NORMAL",
      reason: "Exam postponed — monitoring for new date announcement",
    };
  }

  // All stages conducted/result declared → mostly done
  const allDone = rec.examStages.every(
    (s) => s.status === "CONDUCTED" || s.status === "RESULT_DECLARED"
  );
  if (allDone) {
    return {
      priority: "MINIMAL",
      reason: "All exam stages conducted or result declared",
    };
  }

  // Application closed, waiting for exam
  if (appCloseDays < 0) {
    return {
      priority: "LOW",
      reason: "Application closed, awaiting exam stage",
    };
  }

  return {
    priority: "NORMAL",
    reason: "Active recruitment",
  };
}

function assessOpportunityPriority(
  opp: Opportunity,
  now: Date
): PriorityDecision {
  if (opp.type === "government") {
    return assessGovernmentPriority(opp, now);
  }

  // Private jobs and internships: check application close date
  const closeDate = opp.application.closeDate;
  const days = daysUntil(closeDate, now);

  if (days >= 0 && days <= 1) return { priority: "WATCH", reason: "Application deadline today/tomorrow" };
  if (days >= 0 && days <= 3) return { priority: "HIGH", reason: `Application closes in ${days} day(s)` };
  if (days >= 0) return { priority: "NORMAL", reason: "Application window open" };
  return { priority: "LOW", reason: "Application closed" };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Assess the staleness of a single opportunity.
 * Pass fetchResult after the source check to include reachability data.
 */
export function assessStaleness(
  opp: Opportunity,
  now: Date,
  fetchResult?: FetchResult
): StalenessReport {
  const lastVerifiedDate = new Date(opp.provenance.lastVerifiedAt);
  const daysSince = daysBetween(lastVerifiedDate, now);

  const { priority, reason } = assessOpportunityPriority(opp, now);
  const threshold = STALE_THRESHOLD_DAYS[priority];
  const isStale = daysSince > threshold;

  return {
    opportunityId: opp.id,
    opportunityTitle: opp.title,
    organizationId: opp.organizationId,
    lastVerifiedAt: opp.provenance.lastVerifiedAt,
    daysSinceVerification: daysSince,
    verificationStatus: opp.provenance.status,
    primarySourceUrl: opp.provenance.primarySourceUrl,
    priority,
    priorityReason: reason,
    staleThresholdDays: threshold,
    isStale,
    fetchResult,
  };
}

/**
 * Sort staleness reports from most-urgent to least-urgent.
 * Within the same priority, stale records come before fresh ones.
 */
export function sortByUrgency(reports: StalenessReport[]): StalenessReport[] {
  const ORDER: Record<MonitoringPriority, number> = {
    WATCH:    0,
    HIGH:     1,
    NORMAL:   2,
    LOW:      3,
    MINIMAL:  4,
    ARCHIVED: 5,
  };

  return [...reports].sort((a, b) => {
    const priorityDiff = ORDER[a.priority] - ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    // Within same priority: stale first
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    // Then most days stale first
    return b.daysSinceVerification - a.daysSinceVerification;
  });
}
