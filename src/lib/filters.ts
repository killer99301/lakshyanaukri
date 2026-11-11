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
  police: ["defence", "constable", "sub inspector"], army: ["defence"], navy: ["defence"], airforce: ["defence"], defense: ["defence"],
  bank: ["banking"], rail: ["railway"], railways: ["railway"],
  psc: ["state psc"], central: ["central govt"],
  // Short forms of post names (search quality, 11 Nov 2026). Each only adds the full words; it never removes a match.
  si: ["sub inspector"], asi: ["assistant sub inspector"], asst: ["assistant"], engg: ["engineer", "engineering"],
  mgr: ["manager"], jr: ["junior"], sr: ["senior"], apprenticeship: ["apprentice"], deo: ["data entry operator"],
};

// Words left out when a body's initials are made from its name ("State Bank of India" → sbi).
const INITIAL_SKIP = new Set(["of", "and", "the", "for"]);
/** A body's initials from its name, when the name has three or more words: "Railway Recruitment Boards" → rrb. */
export function nameInitials(name: string | undefined): string | null {
  const words = (name ?? "").replace(/\([^)]*\)/g, " ").toLowerCase().split(/[^a-z]+/).filter((w) => w && !INITIAL_SKIP.has(w));
  return words.length >= 3 ? words.map((w) => w[0]).join("") : null;
}

/** The words a query is matched on. Filler is dropped unless nothing else is left. */
export function searchWords(query: string): string[] {
  const all = searchText(query).trim().split(" ").filter(Boolean);
  const meaningful = all.filter((w) => !SEARCH_FILLER.has(w));
  return meaningful.length > 0 ? meaningful : all;
}

/** True when two four-letter words differ only by two neighbouring letters swapped ("ntcp" / "ntpc"). */
function swappedPair(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  let i = 0;
  while (a[i] === b[i]) i++;
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
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

const STAGE_SEARCH_WORDS: Record<string, string> = {
  SCHEDULED: "exam date scheduled",
  ADMIT_CARD_OUT: "admit card released hall ticket call letter",
  POSTPONED: "postponed deferred",
  CONDUCTED: "exam held conducted",
  RESULT_DECLARED: "result declared",
};

/** The fields a searcher most often means: the title, the body (and its initials) and the notice number. */
function jobKeyText(opp: Opportunity): string {
  const gov = opp.type === "government" ? (opp as GovernmentRecruitment) : null;
  return searchText([opp.title, opp.organizationName, opp.organizationId, nameInitials(opp.organizationName), gov?.notificationNumber].filter(Boolean).join(" "));
}

function jobSearchText(opp: Opportunity): string {
  const gov = opp.type === "government" ? (opp as GovernmentRecruitment) : null;
  return searchText(
    [
      opp.title,
      opp.organizationName,
      opp.organizationId,
      nameInitials(opp.organizationName),
      opp.slug,
      opp.shortDescription,
      opp.category,
      opp.state,
      opp.qualification,
      gov?.notificationNumber,
      gov?.govType,
      ...(gov?.eligibility ?? []),
      // Where the recruitment stands, so "admit card", "result" or "postponed" finds it.
      ...(gov?.examStages ?? []).map((stage) => `${stage.name} ${STAGE_SEARCH_WORDS[stage.status] ?? ""}`),
    ].join(" "),
  );
}

// How strongly one typed word is found, best first. 0: not found.
const EXACT_KEY = 6, EXACT = 5, PREFIX_KEY = 4, PREFIX = 3, SYNONYM = 2, TYPO = 1;

/**
 * How one typed word is found in a job: as a whole word in its title, body or notice number; as a whole word
 * elsewhere; as the start of a word; singular; a known synonym; or one typo off. Words of one or two letters
 * ("si", "po") count only as whole words or synonyms, so "si" never finds "Sikkim". Typos are forgiven only on
 * words of five letters or more, plus two swapped neighbours in a four-letter word ("ntcp"), and never on numbers.
 */
function wordStrength(word: string, key: string, text: string): number {
  if (key.includes(` ${word} `)) return EXACT_KEY;
  if (text.includes(` ${word} `)) return EXACT;
  if (word.length >= 3) {
    if (key.includes(` ${word}`)) return PREFIX_KEY;
    if (text.includes(` ${word}`)) return PREFIX;
    if (word.length > 3 && word.endsWith("s") && text.includes(` ${word.slice(0, -1)}`)) return PREFIX;
  }
  if ((SEARCH_SYNONYMS[word] ?? []).some((alt) => text.includes(` ${alt}`))) return SYNONYM;
  if (/\d/.test(word)) return 0;
  if (word.length >= 5) return text.split(" ").some((token) => token.length >= 4 && oneTypoApart(word, token)) ? TYPO : 0;
  if (word.length === 4) return text.split(" ").some((token) => token.length === 4 && swappedPair(word, token)) ? TYPO : 0;
  return 0;
}

/** Whether one typed word is found in a job's text at all. */
function wordFound(word: string, text: string, key = text): boolean {
  return wordStrength(word, key, text) > 0;
}

/**
 * How well a job matches a query, for putting the best match first: every word's strength, plus a bonus when the
 * query's words appear together, in order, in the title, body or notice number. 0 when a word is missing.
 */
export function searchScore(opp: Opportunity, query: string): number {
  const words = searchWords(query);
  if (words.length === 0) return 0;
  const key = jobKeyText(opp), text = jobSearchText(opp);
  let score = 0;
  for (const w of words) {
    const strength = wordStrength(w, key, text);
    if (strength === 0) return 0;
    score += strength;
  }
  const phrase = ` ${words.join(" ")}`;
  if (words.length > 1 && key.includes(phrase)) score += 10;
  else if (words.length > 1 && text.includes(phrase)) score += 4;
  return score;
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
    const key = jobKeyText(opp);
    return words.every((w) => wordFound(w, text, key));
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

/** Edits between two short words (letters typed, missing, extra or replaced), stopping early past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * When a query finds nothing: the same query with its unfound words spelled as the site's own jobs spell them,
 * if that finds something ("rrb ntpcc" → "rrb ntpc"). Only words of four letters or more are respelled, by one
 * edit (two for words of seven or more); numbers never. Null when no such spelling finds a job.
 */
export function spellingSuggestion(opportunities: Opportunity[], query: string): string | null {
  const words = searchWords(query);
  if (words.length === 0 || textSearch(opportunities, query).length > 0) return null;
  const vocabulary = new Set<string>();
  for (const opp of opportunities) for (const t of jobKeyText(opp).trim().split(" ")) if (t.length >= 3 && !/\d/.test(t)) vocabulary.add(t);
  let changed = false;
  const fixed = words.map((w) => {
    if (w.length < 4 || /\d/.test(w) || opportunities.some((opp) => wordFound(w, jobSearchText(opp), jobKeyText(opp)))) return w;
    const max = w.length >= 7 ? 2 : 1;
    let best: string | null = null;
    let bestD = max + 1;
    for (const t of vocabulary) {
      const d = editDistance(w, t, max);
      if (d < bestD || (d === bestD && best !== null && t < best)) { best = t; bestD = d; }
    }
    if (best && bestD <= max) { changed = true; return best; }
    return w;
  });
  if (!changed) return null;
  const suggestion = fixed.join(" ");
  return textSearch(opportunities, suggestion).length > 0 ? suggestion : null;
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
  if (!selectedLocation || isNationwide(selectedLocation)) return opportunities;

  const loc = stateKey(selectedLocation);
  return opportunities.filter((opp) => isNationwide(opp.state ?? "") || stateKey(opp.state ?? "") === loc);
}

/**
 * One spelling for a state or UT, so "Jammu and Kashmir" on a job matches
 * "Jammu & Kashmir" in the picker, and "Delhi" matches "Delhi NCR".
 */
export function stateKey(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/\bncr\b|\bnct of\b|\bnational capital territory of\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** A job open across the country, shown whichever state is picked. */
export function isNationwide(state: string): boolean {
  return /^(all|pan)[\s-]*india$/i.test(state.trim()) || state.trim() === "";
}

/** How many jobs each state or UT has, by its stateKey. Nationwide jobs are counted separately. */
export function stateCounts(opportunities: Opportunity[]): { byState: Map<string, number>; nationwide: number } {
  const byState = new Map<string, number>();
  let nationwide = 0;
  for (const opp of opportunities) {
    if (isNationwide(opp.state ?? "")) { nationwide++; continue; }
    const key = stateKey(opp.state);
    byState.set(key, (byState.get(key) ?? 0) + 1);
  }
  return { byState, nationwide };
}

/**
 * What picking a state shows, in words: its own jobs plus the ones open to all
 * of India. A visitor who clicks "Bihar 3" and gets 24 results sees why.
 */
export function stateChoiceLine(place: string, own: number, nationwide: number): string {
  const jobs = (n: number) => `${n} job${n === 1 ? "" : "s"}`;
  if (nationwide === 0) return `${jobs(own)} in ${place}`;
  if (own === 0) return `No ${place} jobs right now, so you see the ${jobs(nationwide)} open to all of India`;
  return `${own} ${place} job${own === 1 ? "" : "s"} + ${nationwide} open to all of India = ${jobs(own + nationwide)}`;
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

/** When a job arrived: the day it went live here, else its notification date. Unknown sorts last. */
function latestTime(opp: Opportunity): number {
  const when = opp.addedAt ?? opp.postDate;
  const time = when ? new Date(when).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

const NEW_FOR_DAYS = 7;

/**
 * True for a job that went live here in the last week and can still be
 * applied for. A closed job is never shown as new.
 */
export function isNewlyAdded(opp: Opportunity, now: Date): boolean {
  if (!opp.addedAt) return false;
  const added = new Date(opp.addedAt).getTime();
  if (Number.isNaN(added)) return false;
  const ageDays = (now.getTime() - added) / 86_400_000;
  if (ageDays < 0 || ageDays > NEW_FOR_DAYS) return false;
  return getOpportunityApplicationStatus(opp, now) !== "APPLICATIONS_CLOSED";
}

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
          return latestTime(b) - latestTime(a);
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

  // 5. With a search and the usual "Latest" order, the best matches come first (an exact title, body or notice
  // number before an all-words match, a synonym or a typo); jobs that match equally keep the latest-first order.
  // A sort the visitor chose themselves (closing soon, vacancies) is kept as chosen.
  if (query.trim() && sortBy === "latest") {
    const scores = new Map(result.map((opp) => [opp, searchScore(opp, query)] as const));
    result = [...result].sort((a, b) => scores.get(b)! - scores.get(a)!);
  }

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

// ─── Links into /jobs ───────────────────────────────────
//
// /jobs?q=…&location=…&category=…&qualification=… — one reading of those
// parameters, shared by the jobs page and by anything that shows how many jobs
// a link leads to.

const URL_CATEGORIES = ["state-psc", "ssc", "banking", "railway", "teaching", "defence", "judiciary", "psu", "university", "research", "government", "private", "internship"];
const URL_QUALIFICATIONS = ["10th Pass", "12th Pass", "ITI", "Diploma", "Graduate", "Post Graduate"];

/** Who is recruiting: links such as /jobs?govType=central narrow the list to that kind of body. */
export type GovScope = "central" | "state" | "psu";

export const GOV_SCOPE_LABELS: Record<GovScope, string> = {
  central: "Central Govt",
  state: "State Govt",
  psu: "PSU",
};

export function inGovScope(opp: Opportunity, scope: GovScope | null): boolean {
  if (!scope) return true;
  if (opp.type !== "government") return false;
  const govType = ((opp as GovernmentRecruitment).govType ?? "").toLowerCase();
  return govType.startsWith(scope);
}

export interface JobsUrlState {
  query: string;
  location: string;
  filters: FilterState;
  govScope: GovScope | null;
}

export function jobsUrlState(params: { get(name: string): string | null }): JobsUrlState {
  const filters = getDefaultFilterState();
  const category = params.get("category");
  if (category && URL_CATEGORIES.includes(category)) filters.categories = [category as FilterState["categories"][number]];

  // Accepts both "12th Pass" and the link form "12th-pass"; an engineering degree is listed under Graduate.
  const wanted = (params.get("qualification") ?? "").toLowerCase().replace(/-/g, " ").trim();
  const qualification = wanted === "be btech" ? "Graduate" : URL_QUALIFICATIONS.find((q) => q.toLowerCase() === wanted);
  if (qualification) filters.qualifications = [qualification as FilterState["qualifications"][number]];

  // /jobs?status=open: only notices still taking applications (open or closing soon), as the homepage links them.
  if ((params.get("status") ?? "").toLowerCase() === "open") filters.applicationStatuses = ["OPEN", "CLOSING_SOON"];

  const scope = (params.get("govType") ?? "").toLowerCase();
  const govScope = scope === "central" || scope === "state" || scope === "psu" ? scope : null;

  return { query: params.get("q") || "", location: params.get("location") || "All India", filters, govScope };
}

/** How many jobs a /jobs?… link shows. Null for any other link (including plain /jobs). */
export function jobsLinkCount(opportunities: Opportunity[], href: string, now: Date): number | null {
  const [path, search] = href.split("?");
  if (path !== "/jobs" || !search) return null;
  const state = jobsUrlState(new URLSearchParams(search));
  const scoped = opportunities.filter((opp) => inGovScope(opp, state.govScope));
  return searchOpportunities(scoped, state.query, state.location, state.filters, "latest", now).length;
}
