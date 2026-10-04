// The slug is a record's permanent public URL (/jobs/<slug>).
// Client-safe: also used by the create form to derive an organisation ID.

export function slugify(text: string, maxLength = 60): string {
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
  let part = slugify(title);
  if (part === orgId) part = "";
  else if (part.startsWith(`${orgId}-`)) part = part.slice(orgId.length + 1);

  const y = String(year);
  if (part === y) part = "";
  else if (part.endsWith(`-${y}`)) part = part.slice(0, -(y.length + 1));

  return [orgId, part, y].filter(Boolean).join("-");
}
