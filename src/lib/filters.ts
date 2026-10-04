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

/** Lower-case, with punctuation turned into spaces, so "10+2", "(CHSL)" and "po/mt" match plain typing. */
function searchText(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

// Words people add to a search that say nothing about which job they mean.
const SEARCH_FILLER = new Set([
  "job", "jobs", "recruitment", "vacancy", "vacancies", "notification", "bharti",
  "exam", "examination", "apply", "online", "form", "latest", "new", "posts",
  "govt", "government", "sarkari", "naukri", "for", "in", "of", "the", "and", "to", "a",
  "last", "date", "dates", "admit", "card", "result", "results", "syllabus", "salary",
  "eligibility", "age", "limit", "fee", "fees", "how", "link", "official", "pdf",
  "download", "details", "what", "when", "is",
]);

// Other ways people write the same thing. Each entry adds to the typed word.
const SEARCH_SYNONYMS: Record<string, string[]> = {
  matric: ["10th"], matriculation: ["10th"], sslc: ["10th"], tenth: ["10th"],
  inter: ["12th"], intermediate: ["12th"], hsc: ["12th"], twelfth: ["12th"],
  graduation: ["graduate"], degree: ["graduate"], bachelor: ["graduate"],
  pg: ["post graduate"], postgraduate: ["post graduate"], masters: ["post graduate"],
  teacher: ["teaching"], teachers: ["teaching"],
  police: ["defence"], army: ["defence"], navy: ["defence"], airforce: ["defence"], defense: ["defence"],
  bank: ["banking"], rail: ["railway"], railways: ["railway"],
  psc: ["state psc"], central: ["central govt"],
};

/** The words a query is matched on. Filler is dropped unless nothing else is left. */
export function searchWords(query: string): string[] {
  const all = searchText(query).trim().split(" ").filter(Boolean);
  const meaningful = all.filter((w) => !SEARCH_FILLER.has(w));
  return meaningful.length > 0 ? meaningful : all;
}

/** True when the two words differ by one typed, missing, extra or swapped letter. */
function oneTypoApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const restA = a.slice(i), restB = b.slice(i);
  if (restA.length === restB.length) {
    // One letter replaced, or two neighbours swapped.
    return restA.slice(1) === restB.slice(1) ||
      (restA.length >= 2 && restA[0] === restB[1] && restA[1] === restB[0] && restA.slice(2) === restB.slice(2));
  }
  return restA.length > restB.length ? restA.slice(1) === restB : restB.slice(1) === restA;
}

function jobSearchText(opp: Opportunity): string {
  const gov = opp.type === "government" ? (opp as GovernmentRecruitment) : null;
  return searchText(
    [
      opp.title,
      opp.organizationName,
      opp.organizationId,
      opp.slug,
      opp.shortDescription,
      opp.category,
      opp.state,
      opp.qualification,
      gov?.notificationNumber,
      gov?.govType,
      ...(gov?.eligibility ?? []),
    ].join(" "),
  );
}

/** Whether one typed word is found in a job's text: as typed, singular, a known synonym, or one typo off. */
function wordFound(word: string, text: string): boolean {
  if (text.includes(` ${word}`)) return true;
  if (word.length > 3 && word.endsWith("s") && text.includes(` ${word.slice(0, -1)}`)) return true;
  if ((SEARCH_SYNONYMS[word] ?? []).some((alt) => text.includes(` ${alt}`))) return true;
  // Typos are forgiven only on longer words, and never on numbers ("2025" is not "2026").
  if (word.length >= 5 && !/\d/.test(word)) {
    return text.split(" ").some((token) => token.length >= 4 && oneTypoApart(word, token));
  }
  return false;
}

/**
 * Jobs matching every word of the query, in any order: "chsl 2026" finds
 * "SSC CHSL (Combined Higher Secondary Level) Examination 2026".
 */
export function textSearch(
  opportunities: Opportunity[],
  query: string
): Opportunity[] {
  const words = searchWords(query);
  if (words.length === 0) return opportunities;
  return opportunities.filter((opp) => {
    const text = jobSearchText(opp);
    return words.every((w) => wordFound(w, text));
  });
}

/**
 * For a query with no full match: the jobs matching the most of its words.
 * A job must match at least one word that is not just a number, so a bare
 * year never pulls in everything.
 */
export function closestMatches(opportunities: Opportunity[], query: string): Opportunity[] {
  const words = searchWords(query);
  if (words.length < 2) return [];
  let best = 0;
  const scored = opportunities.map((opp) => {
    const text = jobSearchText(opp);
    const hits = words.filter((w) => wordFound(w, text));
    const score = hits.some((w) => !/^\d+$/.test(w)) ? hits.length : 0;
    if (score > best) best = score;
    return { opp, score };
  });
  return best === 0 ? [] : scored.filter((s) => s.score === best).map((s) => s.opp);
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
        (a, b) => {
          const aTime = a.postDate ? new Date(a.postDate).getTime() : 0;
          const bTime = b.postDate ? new Date(b.postDate).getTime() : 0;
          return bTime - aTime;
        }
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
