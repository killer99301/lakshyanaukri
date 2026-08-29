// ═══════════════════════════════════════════════════════════
// Career Campus — Search & Filter Engine
// ═══════════════════════════════════════════════════════════
// All counts are ALWAYS derived from the actual dataset.
// No hardcoded "8,542 Government Jobs" — ever.
// ═══════════════════════════════════════════════════════════

import type {
  Opportunity,
  GovernmentRecruitment,
  FilterState,
} from "@/types";
import {
  getOpportunityApplicationStatus,
  getOpportunityCloseDate,
  getDaysRemaining,
} from "./lifecycle";

// ─── Filter Counts ──────────────────────────────────────

export interface FilterCounts {
  total: number;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  byQualification: Record<string, number>;
  byState: Record<string, number>;
  byAppStatus: Record<string, number>;
  byExperience: Record<string, number>;
}

/**
 * Calculate filter counts from the ACTUAL dataset.
 * Every number displayed in the sidebar comes from here.
 * The `now` parameter ensures ApplicationStatus is derived, never hardcoded.
 */
export function getFilterCounts(
  opportunities: Opportunity[],
  now: Date
): FilterCounts {
  const counts: FilterCounts = {
    total: opportunities.length,
    byType: {},
    byCategory: {},
    byQualification: {},
    byState: {},
    byAppStatus: {},
    byExperience: {},
  };

  for (const opp of opportunities) {
    // By type
    counts.byType[opp.type] = (counts.byType[opp.type] || 0) + 1;

    // By category
    counts.byCategory[opp.category] = (counts.byCategory[opp.category] || 0) + 1;

    // By qualification (all opportunity types have qualification)
    counts.byQualification[opp.qualification] =
      (counts.byQualification[opp.qualification] || 0) + 1;

    // By state
    counts.byState[opp.state] = (counts.byState[opp.state] || 0) + 1;

    // By application status (always derived from dates + now)
    const appStatus = getOpportunityApplicationStatus(opp, now);
    counts.byAppStatus[appStatus] = (counts.byAppStatus[appStatus] || 0) + 1;

    // By experience (private jobs only)
    if (opp.type === "private" && opp.experience) {
      counts.byExperience[opp.experience] =
        (counts.byExperience[opp.experience] || 0) + 1;
    }
  }

  return counts;
}

// ─── Text Search ────────────────────────────────────────

/**
 * Substring match search across relevant text fields.
 * Searches title, organization, description, category, state, and notification number.
 */
export function textSearch(
  opportunities: Opportunity[],
  query: string
): Opportunity[] {
  if (!query.trim()) return opportunities;
  const q = query.toLowerCase().trim();

  return opportunities.filter((opp) => {
    const searchable = [
      opp.title,
      opp.organizationName,
      opp.shortDescription,
      opp.category,
      opp.state,
      opp.type === "government" ? (opp as GovernmentRecruitment).notificationNumber : "",
      opp.qualification,
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(q);
  });
}

// ─── Location Filter ────────────────────────────────────

/**
 * Filter by a selected location string from the LocationPopover.
 * "All India" is the default and returns all opportunities.
 * Any other value filters to exact state match OR nationwide postings.
 */
export function applyLocationFilter(
  opportunities: Opportunity[],
  selectedLocation: string
): Opportunity[] {
  if (!selectedLocation || selectedLocation === "All India") return opportunities;

  const loc = selectedLocation.toLowerCase();

  return opportunities.filter((opp) => {
    const oppState = opp.state.toLowerCase();
    const isNationwide =
      opp.state === "All India" ||
      opp.state === "Pan India" ||
      opp.state === "all india";
    const isExactMatch = oppState === loc;
    return isExactMatch || isNationwide;
  });
}

// ─── Filter Application ─────────────────────────────────

/**
 * Apply all sidebar filter selections to an opportunity list.
 */
export function applyFilters(
  opportunities: Opportunity[],
  filters: FilterState,
  now: Date
): Opportunity[] {
  let filtered = opportunities;

  // Text search
  if (filters.searchQuery) {
    filtered = textSearch(filtered, filters.searchQuery);
  }

  // Type filter
  if (filters.types.length > 0) {
    filtered = filtered.filter((opp) => filters.types.includes(opp.type));
  }

  // Category filter
  if (filters.categories.length > 0) {
    filtered = filtered.filter((opp) =>
      filters.categories.includes(opp.category)
    );
  }

  // Qualification filter
  if (filters.qualifications.length > 0) {
    filtered = filtered.filter((opp) =>
      filters.qualifications.includes(opp.qualification)
    );
  }

  // Experience filter (private jobs only; other types pass through)
  if (filters.experiences.length > 0) {
    filtered = filtered.filter((opp) => {
      if (opp.type === "private") {
        return filters.experiences.includes(opp.experience);
      }
      return true;
    });
  }

  // State filter
  if (filters.states.length > 0) {
    filtered = filtered.filter((opp) => filters.states.includes(opp.state));
  }

  // Application status filter (always derived — never hardcoded)
  if (filters.applicationStatuses.length > 0) {
    filtered = filtered.filter((opp) => {
      const status = getOpportunityApplicationStatus(opp, now);
      return filters.applicationStatuses.includes(status);
    });
  }

  return filtered;
}

// ─── Sorting ────────────────────────────────────────────

export type SortOption = "latest" | "deadline" | "vacancies";

/**
 * Sort opportunities by the given criteria.
 * Returns a new sorted array; does not mutate input.
 */
export function sortOpportunities(
  opportunities: Opportunity[],
  sortBy: SortOption,
  now: Date
): Opportunity[] {
  const sorted = [...opportunities];

  switch (sortBy) {
    case "latest":
      return sorted.sort(
        (a, b) => new Date(b.postDate).getTime() - new Date(a.postDate).getTime()
      );

    case "deadline":
      return sorted.sort((a, b) => {
        const daysA = getDaysRemaining(getOpportunityCloseDate(a), now);
        const daysB = getDaysRemaining(getOpportunityCloseDate(b), now);
        // Active (positive days) first, then by urgency
        if (daysA >= 0 && daysB < 0) return -1;
        if (daysA < 0 && daysB >= 0) return 1;
        return daysA - daysB;
      });

    case "vacancies":
      return sorted.sort((a, b) => {
        const vacA =
          a.type === "government"
            ? a.totalVacancies
            : a.type === "private"
            ? a.positions || 0
            : a.type === "internship"
            ? a.openings || 0
            : 0;
        const vacB =
          b.type === "government"
            ? b.totalVacancies
            : b.type === "private"
            ? b.positions || 0
            : b.type === "internship"
            ? b.openings || 0
            : 0;
        return vacB - vacA;
      });

    default:
      return sorted;
  }
}

// ─── Composite Search Entry Point ───────────────────────

/**
 * Single entry point for the Jobs marketplace search pipeline.
 * Chain: textSearch → locationFilter → sidebarFilters → sort
 *
 * The `now` parameter is passed explicitly so this function is pure
 * and testable without mocking Date.
 */
export function searchOpportunities(
  opportunities: Opportunity[],
  query: string,
  selectedLocation: string,
  filters: FilterState,
  sortBy: SortOption,
  now: Date
): Opportunity[] {
  let result = opportunities;

  // 1. Text search
  if (query.trim()) {
    result = textSearch(result, query);
  }

  // 2. Location filter (LocationPopover selection)
  result = applyLocationFilter(result, selectedLocation);

  // 3. Sidebar filters
  result = applyFilters(result, { ...filters, searchQuery: "" }, now);
  // Note: searchQuery already applied above — pass empty to avoid double-search

  // 4. Sort
  result = sortOpportunities(result, sortBy, now);

  return result;
}

// ─── Default Filter State ───────────────────────────────

export function getDefaultFilterState(): FilterState {
  return {
    searchQuery: "",
    types: [],
    categories: [],
    qualifications: [],
    experiences: [],
    states: [],
    applicationStatuses: [],
  };
}
