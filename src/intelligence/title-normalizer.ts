// ─── Phase 11: Recruitment Title Normalizer ───────────────────
//
// Strips SEO/aggregator boilerplate from raw page titles to
// produce a clean canonical-quality recruitment title for the
// Intelligence Preview and eventual canonical record.
//
// Input:  "UIIC AO Recruitment 2026 Out For 225 Posts, Download Official PDF For Full Details"
// Output: "UIIC AO Recruitment 2026"
//
// Rules:
//   - Strip only clearly-aggregator patterns (conservative)
//   - Never invent content
//   - If stripping empties the string, return the original
//   - Minimum surviving length = 15 chars (shorter → skip that strip)

// Ordered list of suffix/inline patterns to strip.
// Each is applied once; only accepted if enough title remains.
const BOILERPLATE_PATTERNS: RegExp[] = [
  // "Out For 225 Posts, Download PDF..."  (aggregator headline)
  /,?\s+out\s+for\s+\d[\d,]*\s+posts?.*$/i,
  // "Download Official PDF For Full Details" (aggregator CTA)
  /,?\s+download\s+official\s+pdf(\s+for\s+full\s+details)?.*$/i,
  // "Title – Apply Online for X Posts" (em/en dash separator before Apply Online)
  /\s*[–—]\s*apply\s+online.*$/i,
  // "Apply Online Now / Here / @site.com"
  /,?\s+apply\s+online\s+(?:now|here|link|@\S+).*$/i,
  // "Apply Online" bare (only when it's a standalone suffix)
  /,?\s+apply\s+online\s*$/i,
  // Pipe-separated CTAs: "Title | Apply Online"
  /\s*[|]\s*(?:apply\s+online|download|check\s+here|notification).*$/i,
  // "@sarkariresult.com" style attribution suffix
  /\s+@\s*\S+\.(com|in|org|net).*$/i,
  // "Official PDF Available / Out / Released"
  /,?\s+official\s+pdf\s+(?:available|out|released|here).*$/i,
  // "Complete Details" trailing
  /,?\s+complete\s+details\s*$/i,
  // "Check Here" / "Know Here"
  /,?\s+(?:check|know)\s+(?:here|details\s+here)\s*$/i,
];

const MIN_SURVIVING_LENGTH = 15;

export function normalizeRecruitmentTitle(raw: string): string {
  let title = raw.trim();

  for (const pattern of BOILERPLATE_PATTERNS) {
    const cleaned = title.replace(pattern, "").trim();
    if (cleaned.length >= MIN_SURVIVING_LENGTH) {
      title = cleaned;
    }
  }

  // Strip trailing punctuation artifacts left by stripping
  title = title.replace(/[,;:\s]+$/, "").trim();

  // Fallback: if we somehow emptied the title, return the original
  return title.length >= MIN_SURVIVING_LENGTH ? title : raw.trim();
}
