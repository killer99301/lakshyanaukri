// ═══════════════════════════════════════════════════════════
// What the homepage puts first (public website review, 11 Nov 2026)
// ═══════════════════════════════════════════════════════════
//
// Notices still taking applications come first (open and closing soon, newest
// first), then notices whose applications have not opened yet. Closed notices
// are not dropped: they are listed apart, newest first, labelled as closed.
// "New to the site" is never read as "open": only the notice's own dates
// decide, through the same status every job page shows. Pure.

import type { Opportunity } from "@/types";
import { getOpportunityApplicationStatus } from "@/lib/lifecycle";
import { sortOpportunities } from "@/lib/filters";

export interface HomeOpportunities {
  /** Taking applications now (open or closing soon), newest first. */
  open: Opportunity[];
  /** Applications not open yet, newest first. */
  upcoming: Opportunity[];
  /** Applications closed, newest first. */
  closed: Opportunity[];
  /** The cards at the top: open first, then upcoming; never a closed notice. */
  featured: Opportunity[];
}

export function homeOpportunities(opportunities: Opportunity[], now: Date, featuredCount = 3): HomeOpportunities {
  const latest = sortOpportunities(opportunities, "latest", now);
  const open: Opportunity[] = [], upcoming: Opportunity[] = [], closed: Opportunity[] = [];
  for (const opp of latest) {
    const status = getOpportunityApplicationStatus(opp, now);
    if (status === "OPEN" || status === "CLOSING_SOON") open.push(opp);
    else if (status === "UPCOMING") upcoming.push(opp);
    else closed.push(opp);
  }
  return { open, upcoming, closed, featured: [...open, ...upcoming].slice(0, featuredCount) };
}

/** Today's date in India, YYYY-MM-DD: the date a page drawn on the server works open/closed out on. */
export function indiaToday(now = Date.now()): string {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}
