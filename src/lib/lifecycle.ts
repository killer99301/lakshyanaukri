// ═══════════════════════════════════════════════════════════
// Career Campus — Lifecycle Derivation Functions
// ═══════════════════════════════════════════════════════════
// Pure functions that derive current state from source facts.
// Every function receives `now` as a parameter.
// No hardcoded dates. No Date.now() calls inside these fns.
// ═══════════════════════════════════════════════════════════

import type {
  ApplicationWindow,
  ApplicationStatus,
  ExamStage,
  DateCertainty,
  Opportunity,
  UpdateRecord,
} from "@/types";

// ─── Date Helpers ────────────────────────────────────────

/**
 * Strip time component from a Date, returning midnight in local timezone.
 */
export function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Calculate calendar-day difference between two dates.
 * Positive = target is in the future; negative = target is in the past.
 */
export function diffCalendarDays(from: Date, to: Date): number {
  const fromMidnight = stripTime(from);
  const toMidnight = stripTime(to);
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Application Lifecycle ──────────────────────────────

/**
 * Derive ApplicationStatus from the ApplicationWindow dates and current time.
 * This is ALWAYS computed at runtime — never stored.
 */
export function deriveApplicationStatus(
  window: ApplicationWindow,
  now: Date
): ApplicationStatus {
  const open = stripTime(new Date(window.openDate));
  const close = stripTime(new Date(window.extendedCloseDate || window.closeDate));
  const today = stripTime(now);

  if (today < open) return "UPCOMING";
  if (today > close) return "APPLICATIONS_CLOSED";
  if (diffCalendarDays(today, close) <= 7) return "CLOSING_SOON";
  return "OPEN";
}

/**
 * Get the effective application close date (accounting for extensions).
 */
export function getEffectiveCloseDate(window: ApplicationWindow): string {
  return window.extendedCloseDate || window.closeDate;
}

/**
 * Get days remaining until application deadline.
 * Returns raw number (can be negative) — urgency layer handles display.
 */
export function getDaysRemaining(deadlineIso: string, now: Date): number {
  return diffCalendarDays(now, new Date(deadlineIso));
}

// ─── Exam Lifecycle ─────────────────────────────────────

/**
 * Determine the date certainty for an exam stage.
 * Distinguishes CONFIRMED, TENTATIVE, POSTPONED, and TBA.
 */
export function getStageCertainty(stage: ExamStage): DateCertainty {
  if (stage.certainty) return stage.certainty;
  if (stage.status === "POSTPONED") return "POSTPONED";
  if (stage.status === "NOT_DECLARED" || (!stage.dateDisplay && !stage.dateIso)) return "TBA";
  if (
    stage.dateDisplay?.toLowerCase().includes("tentative") ||
    stage.notes?.toLowerCase().includes("tentative")
  ) {
    return "TENTATIVE";
  }
  return "CONFIRMED";
}

/**
 * Get a human-readable summary of the current exam status.
 * Derives from the ordered examStages array.
 */
export function getCurrentExamSummary(stages: ExamStage[]): string {
  if (stages.length === 0) return "No exam stages defined";

  // Find the most advanced non-NOT_DECLARED stage
  const activeStages = stages
    .filter((s) => s.status !== "NOT_DECLARED")
    .sort((a, b) => a.order - b.order);

  if (activeStages.length === 0) return "Exam date not declared";

  const latest = activeStages[activeStages.length - 1];

  switch (latest.status) {
    case "POSTPONED":
      return `${latest.name} Postponed`;

    case "CONDUCTED": {
      // Check if there's a next stage declared
      const nextStage = stages.find(
        (s) => s.order > latest.order && s.status !== "NOT_DECLARED"
      );
      if (nextStage) {
        if (nextStage.status === "SCHEDULED" && nextStage.dateDisplay) {
          return `${nextStage.name}: ${nextStage.dateDisplay}`;
        }
        return `${nextStage.name}: ${nextStage.status.replace(/_/g, " ")}`;
      }
      return `${latest.name} Conducted — Awaiting next stage`;
    }

    case "RESULT_DECLARED":
      return `${latest.name} — Result Declared`;

    case "SCHEDULED":
      return latest.dateDisplay
        ? `${latest.name}: ${latest.dateDisplay}`
        : `${latest.name} Scheduled`;

    case "ADMIT_CARD_OUT":
      return `${latest.name} — Admit Card Released`;

    default:
      return latest.status.replace(/_/g, " ");
  }
}

/**
 * Get the current exam status badge text and class for cards.
 */
export function getExamStatusBadge(stages: ExamStage[]): {
  label: string;
  badgeClass: string;
} {
  const summary = getCurrentExamSummary(stages);

  if (summary.includes("Postponed")) {
    return { label: summary, badgeClass: "bg-amber-50 text-amber-800 border-amber-200" };
  }
  if (summary.includes("Conducted")) {
    return { label: summary, badgeClass: "bg-slate-50 text-slate-700 border-slate-200" };
  }
  if (summary.includes("Result Declared")) {
    return { label: summary, badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  }
  if (summary.includes("Admit Card")) {
    return { label: summary, badgeClass: "bg-blue-50 text-blue-700 border-blue-200" };
  }
  if (summary.toLowerCase().includes("tentative")) {
    return { label: summary, badgeClass: "bg-amber-50 text-amber-800 border-amber-200" };
  }
  if (summary.includes("Scheduled") || summary.includes(":")) {
    return { label: summary, badgeClass: "bg-blue-50 text-blue-700 border-blue-200" };
  }
  if (summary.includes("not declared")) {
    return { label: summary, badgeClass: "bg-slate-50 text-slate-500 border-slate-200" };
  }

  return { label: summary, badgeClass: "bg-slate-50 text-slate-600 border-slate-200" };
}

// ─── Opportunity-Level Helpers ──────────────────────────

/**
 * Get the application close date for any opportunity type.
 * For government: uses extendedCloseDate if present.
 */
export function getOpportunityCloseDate(opp: Opportunity): string {
  if (opp.type === "government") {
    return opp.application.extendedCloseDate || opp.application.closeDate;
  }
  return opp.application.closeDate;
}

/**
 * Derive application status for any opportunity type.
 */
export function getOpportunityApplicationStatus(
  opp: Opportunity,
  now: Date
): ApplicationStatus {
  if (opp.type === "government") {
    return deriveApplicationStatus(opp.application, now);
  }
  // For private/internship: simple open/close date comparison
  const open = stripTime(new Date(opp.application.openDate));
  const close = stripTime(new Date(opp.application.closeDate));
  const today = stripTime(now);

  if (today < open) return "UPCOMING";
  if (today > close) return "APPLICATIONS_CLOSED";
  if (diffCalendarDays(today, close) <= 7) return "CLOSING_SOON";
  return "OPEN";
}

// ─── Derived Status Badge ────────────────────────────────

export interface StatusBadgeInfo {
  label: string;
  badgeClass: string;
  isClosed: boolean;
}

/**
 * Derive the displayed status badge for a card or detail page.
 * Entirely derived from source facts — never stored in data.
 *
 * Priority order:
 * 1. Exam POSTPONED (government only)
 * 2. Applications Closed (deadline passed)
 * 3. Closing Soon (≤7 days left)
 * 4. Newly Announced (posted within 7 days of `now`)
 * 5. Open / Active
 * 6. Upcoming (not yet open)
 */
export function deriveStatusBadge(opp: Opportunity, now: Date): StatusBadgeInfo {
  // 1. Exam postponed (government only)
  if (opp.type === "government") {
    const hasPostponedStage = opp.examStages.some((s) => s.status === "POSTPONED");
    if (hasPostponedStage) {
      return {
        label: "Exam Postponed",
        badgeClass: "bg-amber-100 text-amber-900 border-amber-300 font-extrabold",
        isClosed: false,
      };
    }
  }

  const appStatus = getOpportunityApplicationStatus(opp, now);

  // 2. Applications closed — Check for active scheduled/admit card/result exam milestones for government jobs
  if (appStatus === "APPLICATIONS_CLOSED") {
    if (opp.type === "government" && opp.examStages && opp.examStages.length > 0) {
      const activeStages = opp.examStages
        .filter((s) => s.status !== "NOT_DECLARED")
        .sort((a, b) => a.order - b.order);

      const latestStage = activeStages[activeStages.length - 1];

      if (latestStage) {
        if (latestStage.status === "ADMIT_CARD_OUT") {
          return {
            label: "Admit Card Released",
            badgeClass: "bg-blue-100 text-blue-900 border-blue-300 font-extrabold",
            isClosed: true,
          };
        }
        if (latestStage.status === "SCHEDULED") {
          const certainty = getStageCertainty(latestStage);
          const isTentative = certainty === "TENTATIVE";
          let label = "Exam Scheduled";
          if (isTentative) {
            const dateMatch = latestStage.dateDisplay?.match(/\d{1,2}\s+[A-Za-z]{3}(?:\s+\d{4})?/);
            if (dateMatch) {
              label = `Tentative Exam: ${dateMatch[0]}`;
            } else if (latestStage.dateDisplay) {
              const shortWindow = latestStage.dateDisplay.split("(")[0].trim();
              label = `Tentative: ${shortWindow}`;
            } else {
              label = "Tentative Exam Date";
            }
          } else if (latestStage.dateDisplay) {
            label = `Exam: ${latestStage.dateDisplay}`;
          }
          return {
            label,
            badgeClass: isTentative
              ? "bg-amber-50 text-amber-900 border-amber-300 font-extrabold"
              : "bg-blue-50 text-blue-900 border-blue-300 font-extrabold",
            isClosed: true,
          };
        }
        if (latestStage.status === "RESULT_DECLARED") {
          return {
            label: "Result Declared",
            badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300 font-extrabold",
            isClosed: true,
          };
        }
      }
    }

    return {
      label: "Applications Closed",
      badgeClass: "bg-slate-100 text-slate-600 border-slate-200 font-extrabold",
      isClosed: true,
    };
  }

  // 3. Closing soon
  if (appStatus === "CLOSING_SOON") {
    return {
      label: "Closing Soon",
      badgeClass: "bg-rose-50 text-rose-700 border-rose-200 animate-pulse font-extrabold",
      isClosed: false,
    };
  }

  // 4. Upcoming (not yet open)
  if (appStatus === "UPCOMING") {
    return {
      label: "Upcoming",
      badgeClass: "bg-purple-50 text-purple-700 border-purple-200 font-extrabold",
      isClosed: false,
    };
  }

  // 5. Newly announced (posted within last 7 days) — skip if postDate not extracted
  if (!opp.postDate) {
    return { label: "Open", badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200", isClosed: false };
  }
  const postDate = stripTime(new Date(opp.postDate));
  const today = stripTime(now);
  const daysSincePost = diffCalendarDays(postDate, today);
  if (daysSincePost <= 7) {
    return {
      label: "Newly Announced",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 font-extrabold",
      isClosed: false,
    };
  }

  // 6. Open / Active
  return {
    label: "Active",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200 font-extrabold",
    isClosed: false,
  };
}

// ─── Update History Helpers ──────────────────────────────

/**
 * Get the most recent UpdateRecord from an opportunity.
 * Updates are append-only; the most recent is the one with the latest date.
 * Returns null if no updates exist.
 */
export function getLatestUpdate(opp: Opportunity): UpdateRecord | null {
  if (!opp.updates || opp.updates.length === 0) return null;
  return opp.updates.reduce((latest, current) =>
    new Date(current.date) > new Date(latest.date) ? current : latest
  );
}

/**
 * Get all updates sorted descending by date (newest first).
 */
export function getUpdatesSortedByDate(opp: Opportunity): UpdateRecord[] {
  if (!opp.updates || opp.updates.length === 0) return [];
  return [...opp.updates].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

// ─── Provenance Helpers ──────────────────────────────────

export interface ProvenanceSummary {
  statusLabel: string;       // "✓ Verified" | "Partially Verified" | "Not Verified" | "Needs Update"
  statusClass: string;       // Tailwind class for the badge
  lastVerifiedLabel: string; // "Last verified: 16 Aug 2026"
  sourceLabel: string;       // "Official Website" | "Official Notification" | etc.
  sourceUrl?: string;
}

/**
 * Derive a human-readable provenance summary for UI display.
 * Used in cards and detail pages to show data trustworthiness.
 */
export function getProvenanceSummary(opp: Opportunity): ProvenanceSummary {
  const { provenance } = opp;

  const statusMap: Record<string, { label: string; cls: string }> = {
    VERIFIED: {
      label: "✓ Verified",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    PARTIALLY_VERIFIED: {
      label: "Partially Verified",
      cls: "bg-amber-50 text-amber-700 border-amber-200",
    },
    NOT_VERIFIED: {
      label: "Not Verified",
      cls: "bg-slate-50 text-slate-600 border-slate-200",
    },
    NEEDS_UPDATE: {
      label: "Needs Update",
      cls: "bg-rose-50 text-rose-700 border-rose-200",
    },
  };

  const sourceTypeLabels: Record<string, string> = {
    OFFICIAL_NOTIFICATION: "Official Notification",
    OFFICIAL_CORRIGENDUM: "Official Corrigendum",
    OFFICIAL_EXAM_NOTICE: "Official Exam Notice",
    OFFICIAL_PORTAL: "Official Portal",
    OFFICIAL_WEBSITE: "Official Website",
    SECONDARY_SOURCE: "Secondary Source",
    NOT_VERIFIED: "Not Verified",
  };

  const status = statusMap[provenance.status] ?? statusMap.NOT_VERIFIED;

  const lastVerifiedDate = new Date(provenance.lastVerifiedAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return {
    statusLabel: status.label,
    statusClass: status.cls,
    lastVerifiedLabel: `Last verified: ${lastVerifiedDate}`,
    sourceLabel: sourceTypeLabels[provenance.primarySourceType] ?? "Unknown Source",
    sourceUrl: provenance.primarySourceUrl,
  };
}

// ─── Vacancy Display ─────────────────────────────────────

/**
 * Get the vacancy count for display. Returns 0 for private/internship
 * unless the type supports a position count.
 */
export function getVacancyCount(opp: Opportunity): number {
  if (opp.type === "government") return opp.totalVacancies;
  if (opp.type === "private") return opp.positions ?? 0;
  if (opp.type === "internship") return opp.openings ?? 0;
  return 0;
}

/**
 * Get a formatted vacancy display string for cards.
 */
export function getVacancyDisplay(opp: Opportunity): string {
  if (opp.type === "government") {
    return opp.vacanciesDisplay || `${opp.totalVacancies.toLocaleString("en-IN")} Vacancies`;
  }
  if (opp.type === "private") {
    return opp.positions ? `${opp.positions} Positions` : "Vacancies not specified";
  }
  if (opp.type === "internship") {
    return opp.openings ? `${opp.openings} Openings` : "Openings not specified";
  }
  return "Vacancies not specified";
}

// ─── Category Label Helpers ──────────────────────────────

/**
 * Returns the human-readable category label for a given category key.
 */
export function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    "state-psc": "State PSC",
    ssc: "SSC",
    banking: "Banking & Finance",
    railway: "Railways",
    defence: "Defence & Police",
    teaching: "Teaching",
    government: "Government",
    private: "Private",
    internship: "Internship",
  };
  return labels[category] ?? category;
}

/**
 * Returns Tailwind badge classes for a given category key.
 */
export function getCategoryBadgeClass(category: string): string {
  const classes: Record<string, string> = {
    "state-psc": "bg-amber-50 text-amber-700 border-amber-200",
    ssc: "bg-blue-50 text-blue-700 border-blue-200",
    banking: "bg-emerald-50 text-emerald-700 border-emerald-200",
    railway: "bg-rose-50 text-rose-700 border-rose-200",
    defence: "bg-purple-50 text-purple-700 border-purple-200",
    teaching: "bg-sky-50 text-sky-700 border-sky-200",
    government: "bg-slate-50 text-slate-700 border-slate-200",
    private: "bg-indigo-50 text-indigo-700 border-indigo-200",
    internship: "bg-teal-50 text-teal-700 border-teal-200",
  };
  return classes[category] ?? "bg-slate-50 text-slate-700 border-slate-200";
}
