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

// Avoids repeating the organisation or the year when the title already carries them:
// ("ibps", "IBPS Clerk 2026", 2026) → "ibps-clerk-2026", not "ibps-ibps-clerk-2026-2026".
export function buildSlug(orgId: string, title: string, year: number): string {
  // Strip the organisation and year from the FULL title first, then shorten at
  // a word boundary — cutting first can split the year ("…examination-20-2026").
  let part = slugify(title, 500);
  if (part === orgId) part = "";
  else if (part.startsWith(`${orgId}-`)) part = part.slice(orgId.length + 1);

  const y = String(year);
  if (part === y) part = "";
  else if (part.endsWith(`-${y}`)) part = part.slice(0, -(y.length + 1));

  if (part.length > MAX_TITLE_PART) {
    const cut = part.slice(0, MAX_TITLE_PART);
    const lastHyphen = cut.lastIndexOf("-");
    part = (lastHyphen > 20 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/g, "");
  }

  return [orgId, part, y].filter(Boolean).join("-");
}
