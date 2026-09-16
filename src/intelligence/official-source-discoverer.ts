// ─── Phase 11: Official Source Discoverer ─────────────────────
//
// Scans the links already extracted from a secondary/unknown page
// and returns the URLs that point to known official sources and
// are plausibly recruitment-relevant.
//
// Used by buildDraft() to automatically discover the authoritative
// source behind an aggregator page — no external search, no
// fabricated URLs; only follows links that physically appear on
// the provided page.
//
// Design rules:
//   - One level only: secondary → official (never recursive)
//   - Never fabricate or guess URLs
//   - Classify only via classifySourceUrl()
//   - Prefer specific recruitment pages over org homepages
//   - Return at most maxResults candidates (default 5)

import { classifySourceUrl } from "./intake";
import type { DiscoveredLink } from "./draft-types";

// Keywords that suggest a link is recruitment-relevant.
const RECRUITMENT_KEYWORDS = [
  "recruit", "vacanc", "notif", "advertisement", "advt",
  "apply", "career", "opening", "circular", "exam", "selection",
  "officer", "constable", "clerk", "engineer", "job", "post",
];

function isRecruitmentRelevant(link: DiscoveredLink): boolean {
  // Already classified as a useful recruitment link type
  if (link.type !== "OTHER") return true;
  const combined = `${link.url} ${link.label}`.toLowerCase();
  return RECRUITMENT_KEYWORDS.some((kw) => combined.includes(kw));
}

function urlPathDepth(urlString: string): number {
  try {
    return new URL(urlString).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function officialLinkScore(link: DiscoveredLink): number {
  let score = 0;
  // Prefer specific pages (deeper path) over org homepages (path="/")
  score += Math.min(urlPathDepth(link.url) * 2, 8);
  // PDFs are maximally specific
  const urlLower = link.url.toLowerCase();
  if (urlLower.endsWith(".pdf")) score += 10;
  if (link.type === "OFFICIAL_NOTIFICATION") score += 10;
  if (link.type === "APPLY_ONLINE") score += 6;
  // Recruitment keywords in the URL path itself
  try {
    const path = new URL(link.url).pathname.toLowerCase();
    if (RECRUITMENT_KEYWORDS.some((kw) => path.includes(kw))) score += 5;
  } catch {
    // ignore malformed URL
  }
  return score;
}

export function discoverOfficialUrls(
  links: DiscoveredLink[],
  excludeUrls: Set<string>,
  maxResults = 5,
): string[] {
  const scored: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();

  for (const link of links) {
    const url = link.url;
    if (!url.startsWith("http")) continue;
    if (excludeUrls.has(url)) continue;
    if (seen.has(url)) continue;

    let classification;
    try {
      classification = classifySourceUrl(url);
    } catch {
      continue;
    }

    if (classification.kind !== "OFFICIAL") continue;

    // Official homepages (path depth ≤ 1) are allowed through as discovery seeds:
    // they don't need recruitment keywords in the URL/label because they will be
    // retrieved and their links scanned for recruitment-specific pages one hop deeper.
    // All deeper official links still require isRecruitmentRelevant() to avoid
    // retrieving unrelated pages (about-us, contact, tenders, etc.).
    const depth = urlPathDepth(url);
    if (depth > 1 && !isRecruitmentRelevant(link)) continue;

    seen.add(url);
    scored.push({ url, score: officialLinkScore(link) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((e) => e.url);
}
