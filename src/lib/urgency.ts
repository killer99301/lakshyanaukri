// ═══════════════════════════════════════════════════════════
// Career Campus — Deadline Urgency UX
// ═══════════════════════════════════════════════════════════
// Translates days-remaining into visual urgency tiers.
// NEVER shows negative days. Passed deadlines = "Applications Closed".
// ═══════════════════════════════════════════════════════════

import type { UrgencyInfo } from "@/types";

/**
 * Convert days remaining into urgency tier, display label, and Tailwind classes.
 * @param daysRemaining — raw number from getDaysRemaining() (can be negative)
 * @param isDeadlineKnown — false if no deadline date exists
 */
export function getDeadlineUrgency(
  daysRemaining: number,
  isDeadlineKnown: boolean = true
): UrgencyInfo {
  if (!isDeadlineKnown) {
    return {
      tier: "unknown",
      daysRemaining: 0,
      label: "Deadline not announced",
      badgeClass: "bg-slate-100 text-slate-600 border-slate-200 font-semibold",
      textClass: "text-slate-500",
      isClosed: false,
    };
  }

  if (daysRemaining < 0) {
    return {
      tier: "passed",
      daysRemaining,
      label: "Applications Closed",
      badgeClass: "bg-slate-100 text-slate-600 border-slate-200 font-extrabold",
      textClass: "text-slate-500",
      isClosed: true,
    };
  }

  if (daysRemaining === 0) {
    return {
      tier: "today",
      daysRemaining: 0,
      label: "Last day today",
      badgeClass: "bg-rose-100 text-rose-700 border-rose-300 animate-pulse font-extrabold",
      textClass: "text-rose-600",
      isClosed: false,
    };
  }

  if (daysRemaining <= 6) {
    return {
      tier: "urgent",
      daysRemaining,
      label: `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`,
      badgeClass: "bg-rose-50 text-rose-700 border-rose-200 font-extrabold",
      textClass: "text-rose-600",
      isClosed: false,
    };
  }

  if (daysRemaining <= 14) {
    return {
      tier: "amber",
      daysRemaining,
      label: `${daysRemaining} days left`,
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200 font-extrabold",
      textClass: "text-amber-700",
      isClosed: false,
    };
  }

  if (daysRemaining <= 29) {
    return {
      tier: "mild",
      daysRemaining,
      label: `${daysRemaining} days left`,
      badgeClass: "bg-blue-50 text-blue-800 border-blue-200 font-bold",
      textClass: "text-blue-700",
      isClosed: false,
    };
  }

  return {
    tier: "normal",
    daysRemaining,
    label: `${daysRemaining} days left`,
    badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200 font-bold",
    textClass: "text-emerald-700",
    isClosed: false,
  };
}

/**
 * Format a deadline date for display.
 */
export function formatDeadlineDate(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
