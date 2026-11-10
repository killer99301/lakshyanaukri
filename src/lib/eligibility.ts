// ═══════════════════════════════════════════════════════════
// "Am I eligible?" — the age part, worked out from the notice
// ═══════════════════════════════════════════════════════════
//
// Pure functions, run in the visitor's browser. Nothing they type is stored
// or sent anywhere.
//
// The answer is only ever as good as the age limit on the record, so:
//   - no cut-off date on record → no answer, never "as of today"
//   - only relaxations printed on the record are used, and only those for the
//     category the visitor picked; nothing is assumed from general rules
//   - a visitor who has completed the upper age but not the next birthday is
//     told to check the notice, because notices word this two different ways

import type { AgeLimit, AgeRelaxation, CategoryMaxAge, PostAgeRange } from "@/types";

export type CasteCategory = "GEN" | "EWS" | "OBC" | "SC" | "ST";

export const CATEGORY_LABELS: Record<CasteCategory, string> = {
  GEN: "General (UR)",
  EWS: "EWS",
  OBC: "OBC",
  SC: "SC",
  ST: "ST",
};

export interface ExactAge { years: number; months: number; days: number }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date from "YYYY-MM-DD", or null. */
function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE.exec(iso.trim());
  if (!match) return null;
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * A date of birth from separate day, month and year fields, as "YYYY-MM-DD", or "" until all three are given
 * (the year as four digits). An impossible day (31 February) is returned as typed, for the date check to name.
 */
export function isoFromParts(day: string, month: string, year: string): string {
  const d = Number(day), m = Number(month);
  if (!/^\d{4}$/.test(year.trim()) || !(d >= 1 && d <= 31) || !(m >= 1 && m <= 12)) return "";
  return `${year.trim()}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Completed years, months and days between a date of birth and a cut-off date. */
export function ageOn(dobIso: string, asOfIso: string): ExactAge | null {
  const dob = parseIsoDate(dobIso);
  const on = parseIsoDate(asOfIso);
  if (!dob || !on) return null;
  // Whole months first, then the days left over from that monthly anniversary.
  let totalMonths = (on.y - dob.y) * 12 + (on.m - dob.m);
  if (on.d < dob.d) totalMonths -= 1;
  if (totalMonths < 0) return null;
  const annMonthIndex = dob.m - 1 + totalMonths;
  const annYear = dob.y + Math.floor(annMonthIndex / 12);
  const annMonth = (annMonthIndex % 12) + 1;
  // Born on the 31st: the anniversary in a shorter month is its last day.
  const annDay = Math.min(dob.d, daysInMonth(annYear, annMonth));
  const days = Math.round((Date.UTC(on.y, on.m - 1, on.d) - Date.UTC(annYear, annMonth - 1, annDay)) / 86_400_000);
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, days };
}

// Hindi notices (BPSC) name categories in Hindi: दिव्यांग, महिला, भूतपूर्व सैनिक, अनारक्षित… (B2.6).
const DISABILITY = /pwbd|pwd|\bph\b|benchmark|disab|handicap|divyang|दिव्यांग|निःशक्त/i;
// Relaxations that depend on things the checker does not ask about.
const OTHER_GROUNDS = /ex-?\s?service|widow|divorc|women|female|department|in-?service|employee|sports|apprentice|domicile|resident|j\s?&\s?k|kashmir|riot|contract|महिला|भूतपूर्व सैनिक|विधवा|तलाकशुदा|सरकारी सेवक|कर्मी/i;
/** "(Male and Female)" opens a row to both: it does not make it a women's row. */
const BOTH = /\(?\s*(?:male\s*(?:and|&)\s*female|men\s*(?:and|&)\s*women|पुरुष\s*(?:एवं|और|व)\s*महिला)\s*\)?/gi;

const CATEGORY_PATTERNS: Record<CasteCategory, RegExp> = {
  GEN: /\bur\b|unreserved|un-reserved|general|अनारक्षित|सामान्य/i,
  EWS: /\bews\b|economically weaker|आर्थिक\s*रूप\s*से\s*कमजोर/i,
  // Karnataka names its backward classes "Category-1, 2A, 2B, 3A and 3B"; Bihar पिछड़ा वर्ग / अत्यंत पिछड़ा वर्ग.
  OBC: /\bobc\b|\bbc\b|\bmbc\b|\bebc\b|backward|\bcategory[\s-]*(?:1|i)\b|\b[23][ab]\b|पिछ(?:ड़|ड़)ा/i,
  // "अनुसूचित जनजाति" (ST) contains "जाति": SC is the whole phrase "अनुसूचित जाति".
  SC: /\bsc\b|scheduled castes?|अनुसूचित\s*जाति/i,
  ST: /\bst\b|scheduled tribes?|अनुसूचित\s*जन\s*जाति/i,
};

const namesAnyCategory = (text: string) =>
  (Object.keys(CATEGORY_PATTERNS) as CasteCategory[]).some((c) => CATEGORY_PATTERNS[c].test(text));

/**
 * The relaxation row that applies to this visitor, if the record has one.
 * A disability row is used only for a visitor who ticked the box, and a plain
 * category row only for one who did not — the two are never added together.
 */
export function findRelaxation(
  relaxations: AgeRelaxation[] | undefined,
  category: CasteCategory,
  pwbd: boolean,
): AgeRelaxation | undefined {
  const rows = (relaxations ?? []).filter((r) => typeof r.years === "number" && r.years > 0 && !OTHER_GROUNDS.test(r.category));
  const forCategory = (r: AgeRelaxation) => CATEGORY_PATTERNS[category].test(r.category);

  if (pwbd) {
    const disability = rows.filter((r) => DISABILITY.test(r.category));
    return (
      disability.find(forCategory) ??
      // "PwBD: 10 years" with no category named applies to every category.
      disability.find((r) => !namesAnyCategory(r.category))
    );
  }
  return rows.find((r) => !DISABILITY.test(r.category) && forCategory(r));
}

/**
 * The upper age printed for this visitor's category, if the record has one
 * row that clearly applies. Rows for other grounds (women, ex-servicemen…)
 * are not used, and two rows that disagree are no answer: nothing is chosen.
 */
export function findCategoryMax(
  rows: CategoryMaxAge[] | undefined,
  category: CasteCategory,
  pwbd: boolean,
): CategoryMaxAge | undefined {
  // A row may name several groups ("अनारक्षित (महिला), पिछड़ा वर्ग … (पुरुष एवं महिला)"): each part is judged on its own,
  // a women-only or other-grounds part is left out, and "(Male and Female)" opens a part to both.
  const parts = (r: CategoryMaxAge) => r.category.split(/[,;]/).map((p) => p.replace(BOTH, " ").trim()).filter(Boolean);
  const usable = (rows ?? []).filter((r) => parts(r).some((p) => !OTHER_GROUNDS.test(p)));
  const forCategory = (r: CategoryMaxAge) => parts(r).some((p) => !OTHER_GROUNDS.test(p) && CATEGORY_PATTERNS[category].test(p));
  const found = pwbd
    ? (() => {
        const disability = usable.filter((r) => DISABILITY.test(r.category));
        const own = disability.filter(forCategory);
        return own.length ? own : disability.filter((r) => !namesAnyCategory(r.category));
      })()
    : usable.filter((r) => !DISABILITY.test(r.category) && forCategory(r));
  return new Set(found.map((r) => r.max)).size === 1 ? found[0] : undefined;
}

const sameCategory = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The age limit for one post of a recruitment that sets ages post by post:
 * the post's own range or date-of-birth window, its own cut-off date if it
 * has one, and the recruitment's relaxations with the post's own added (a
 * post row replaces the recruitment's row for the same category). Category
 * maximums are the post's own only: one printed for the recruitment as a
 * whole is not assumed to hold for every post.
 */
export function limitForPost(limit: AgeLimit, post: PostAgeRange): AgeLimit {
  const own = post.relaxations ?? [];
  const relaxation = [...(limit.relaxation ?? []).filter((r) => !own.some((o) => sameCategory(o.category, r.category))), ...own];
  return {
    min: post.min, max: post.max, bornFrom: post.bornFrom, bornTo: post.bornTo,
    asOf: post.asOf ?? limit.asOf,
    ...(relaxation.length ? { relaxation } : {}),
    ...(post.categoryMax?.length ? { categoryMax: post.categoryMax } : {}),
  };
}

export type AgeVerdict =
  | "WITHIN"            // inside the printed limits
  | "WITHIN_RELAXED"    // inside only because of a printed relaxation
  | "CHECK_NOTICE"      // has already turned the upper age: over the limit under most notices
  | "TOO_YOUNG"
  | "TOO_OLD"
  | "UNKNOWN";          // the record cannot answer

export interface AgeCheck {
  verdict: AgeVerdict;
  age?: ExactAge;
  /** Upper limit after the relaxation, or as printed for the category, when one was used. */
  effectiveMax?: number;
  relaxation?: AgeRelaxation;
  /** The upper age printed for the visitor's category, when that was used. */
  categoryMax?: CategoryMaxAge;
  /** Why there is no answer, for UNKNOWN. */
  reason?: string;
}

/** "2005-11-01" moved N years earlier, keeping the day (29 Feb falls back to 28 Feb). */
function yearsEarlier(iso: string, years: number): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  const y = d.y - years;
  const day = Math.min(d.d, daysInMonth(y, d.m));
  return `${String(y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * For notices that print a date-of-birth window ("born between 1 Nov 2005 and
 * 1 May 2009, both dates inclusive"). The date of birth is compared with the
 * window directly, so there is no rounding of ages and no borderline case.
 * A relaxation moves only the earliest date back.
 */
function checkBornWindow(limit: AgeLimit, dobIso: string, category: CasteCategory, pwbd: boolean): AgeCheck {
  if (!parseIsoDate(dobIso)) return { verdict: "UNKNOWN", reason: "Enter your date of birth." };
  const age = limit.asOf ? ageOn(dobIso, limit.asOf) ?? undefined : undefined;
  const withAge = age ? { age } : {};

  if (limit.bornTo && dobIso > limit.bornTo) return { verdict: "TOO_YOUNG", ...withAge };
  // Half a window (one date of birth on record): the printed age on the other side still applies (B2.6).
  if (!limit.bornTo && limit.min != null) {
    if (!age) return { verdict: "UNKNOWN", reason: "The latest date of birth allowed is not on record, and neither is the date age is counted on." };
    if (age.years < limit.min) return { verdict: "TOO_YOUNG", age };
  }
  if (!limit.bornFrom && limit.max != null) return checkAge({ ...limit, bornFrom: undefined, bornTo: undefined }, dobIso, category, pwbd);
  if (!limit.bornFrom || dobIso >= limit.bornFrom) return { verdict: "WITHIN", ...withAge };

  const relaxation = findRelaxation(limit.relaxation, category, pwbd);
  if (relaxation?.years && dobIso >= yearsEarlier(limit.bornFrom, relaxation.years)) {
    return { verdict: "WITHIN_RELAXED", relaxation, ...withAge };
  }
  return { verdict: "TOO_OLD", ...(relaxation ? { relaxation } : {}), ...withAge };
}

export function checkAge(limit: AgeLimit | undefined, dobIso: string, category: CasteCategory, pwbd: boolean): AgeCheck {
  if (limit && (limit.bornFrom || limit.bornTo)) return checkBornWindow(limit, dobIso, category, pwbd);
  if (!limit || (limit.min == null && limit.max == null && !limit.categoryMax?.length)) {
    return { verdict: "UNKNOWN", reason: "The age limit for this recruitment is not on record yet." };
  }
  if (!limit.asOf) {
    return { verdict: "UNKNOWN", reason: "The notice’s cut-off date for age is not on record yet, so the age cannot be worked out." };
  }
  const age = ageOn(dobIso, limit.asOf);
  if (!age) {
    return { verdict: "UNKNOWN", reason: "Enter a date of birth that is before the cut-off date." };
  }

  if (limit.min != null && age.years < limit.min) return { verdict: "TOO_YOUNG", age };

  // An upper age printed for the visitor's own category is used as printed:
  // nothing is added to it and nothing is worked out from it.
  const printed = findCategoryMax(limit.categoryMax, category, pwbd);
  if (printed) {
    const over = limit.max != null && printed.max > limit.max;
    if (age.years < printed.max) return { verdict: over ? "WITHIN_RELAXED" : "WITHIN", age, categoryMax: printed, effectiveMax: printed.max };
    if (age.years === printed.max) return { verdict: "CHECK_NOTICE", age, categoryMax: printed, effectiveMax: printed.max };
    return { verdict: "TOO_OLD", age, categoryMax: printed, effectiveMax: printed.max };
  }
  if (limit.max == null) {
    return limit.categoryMax?.length
      ? { verdict: "UNKNOWN", age, reason: "The notice prints upper ages by category, and none on record clearly matches yours. Check the notification." }
      : { verdict: "WITHIN", age };
  }

  // "18 to 27 as on 1 June" is printed by SSC, RRB, UPSC, IBPS and most others
  // as a date-of-birth range that stops one day short of the 27th birthday: the
  // candidate must not have turned 27 by that date. So only someone who has not
  // yet completed the upper age is clearly inside; someone who turns it on the
  // cut-off date itself is not.
  const under = (max: number) => age.years < max;

  if (under(limit.max)) return { verdict: "WITHIN", age };

  const relaxation = findRelaxation(limit.relaxation, category, pwbd);
  const effectiveMax = relaxation?.years ? limit.max + relaxation.years : limit.max;
  if (relaxation && under(effectiveMax)) return { verdict: "WITHIN_RELAXED", age, relaxation, effectiveMax };

  // Completed the upper age, not yet the next birthday: "up to 27" and
  // "must not have attained 27" give different answers here.
  if (age.years === effectiveMax) {
    return { verdict: "CHECK_NOTICE", age, ...(relaxation ? { relaxation, effectiveMax } : {}) };
  }
  return { verdict: "TOO_OLD", age, ...(relaxation ? { relaxation, effectiveMax } : {}) };
}

export function describeAge(age: ExactAge): string {
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return [part(age.years, "year"), part(age.months, "month"), part(age.days, "day")].join(", ");
}
