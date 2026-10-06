// The slug is a record's permanent public URL (/jobs/<slug>).
// Client-safe: also used by the create form to derive an organisation ID.

const MAX_TITLE_PART = 60;

export function slugify(text: string, maxLength = MAX_TITLE_PART): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, "");
}

// A long organisation ID (a custom organisation's whole name) is not put in
// front of the title: the title already says who is recruiting, and the address
// would run to a hundred characters.
const MAX_ORG_PREFIX = 12;
// "(Advt. No. 15/2026)" and "(Notice No. 37C/SSSC/PB/2026)" identify the
// notice, not the job, and only lengthen the address. "(CEN 05/2026)" stays.
const NOTICE_REFERENCE = /\([^)]*\bno\.?\s[^)]*\)/gi;
// A cut can leave a dangling joining word: "…head-constable-and".
const DANGLING_WORD = /-(and|or|of|for|the|in|to|with|cum)$/;

// Avoids repeating the organisation or the year when the title already carries them:
// ("ibps", "IBPS Clerk 2026", 2026) → "ibps-clerk-2026", not "ibps-ibps-clerk-2026-2026".
export function buildSlug(orgId: string, title: string, year: number): string {
  // Strip the organisation and year from the FULL title first, then shorten at
  // a word boundary — cutting first can split the year ("…examination-20-2026").
  let part = slugify(title.replace(NOTICE_REFERENCE, " "), 500);
  let titleNamesOrg = false;
  if (part === orgId) { part = ""; titleNamesOrg = true; }
  else if (part.startsWith(`${orgId}-`)) { part = part.slice(orgId.length + 1); titleNamesOrg = true; }

  const y = String(year);
  if (part === y) part = "";
  else if (part.endsWith(`-${y}`)) part = part.slice(0, -(y.length + 1));

  const prefix = titleNamesOrg || orgId.length <= MAX_ORG_PREFIX || part === "" ? orgId : "";

  if (part.length > MAX_TITLE_PART) {
    const cut = part.slice(0, MAX_TITLE_PART);
    const lastHyphen = cut.lastIndexOf("-");
    part = (lastHyphen > 20 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/g, "").replace(DANGLING_WORD, "");
  }

  // "…recruitment-2026-cen-05" already shows the year; do not add it again.
  const showsYear = part.split("-").includes(y);
  return [prefix, part, showsYear ? "" : y].filter(Boolean).join("-");
}

/** True for an address made only of lowercase words and digits joined by single hyphens. */
export function isValidSlug(slug: string): boolean {
  return slug.length >= 8 && slug.length <= 90 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}
