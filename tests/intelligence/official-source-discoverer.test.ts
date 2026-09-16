// ═══════════════════════════════════════════════════════════
// Phase 11: Official Source Discoverer — Tests
// npx tsx --tsconfig tsconfig.json tests/intelligence/official-source-discoverer.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  S01  Link to known official domain (uiic.co.in) is discovered
//  S02  Link to known aggregator (adda247.com) is not discovered
//  S03  URL already in excludeUrls is not returned
//  S04  PDF link on official domain scores higher than homepage
//  S05  maxResults limit is respected
//  S06  Duplicate links yield one result
//  S07  Non-http link (mailto:) is excluded
//  S08  gov.in domain discovered via OFFICIAL_DOMAIN_PATTERNS
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import { discoverOfficialUrls } from "@/intelligence/official-source-discoverer";
import type { DiscoveredLink } from "@/intelligence/draft-types";

// ─── Fixtures ─────────────────────────────────────────────────

function link(url: string, label = "", type: DiscoveredLink["type"] = "OTHER"): DiscoveredLink {
  return { url, label, type };
}

// ─── Tests ────────────────────────────────────────────────────

suite("Phase 11 — Official Source Discoverer");

test("S01: link to known official domain (uiic.co.in) is discovered", () => {
  const links: DiscoveredLink[] = [
    link("https://uiic.co.in/career/current-opening", "UIIC Recruitment", "OTHER"),
  ];
  const result = discoverOfficialUrls(links, new Set());
  assert.ok(result.includes("https://uiic.co.in/career/current-opening"), "official UIIC link discovered");
});

test("S02: link to known aggregator (adda247.com) is not discovered", () => {
  const links: DiscoveredLink[] = [
    link("https://www.adda247.com/jobs/uiic-ao-recruitment/", "UIIC AO"),
  ];
  const result = discoverOfficialUrls(links, new Set());
  assert.strictEqual(result.length, 0, "aggregator link excluded");
});

test("S03: URL already in excludeUrls is not returned", () => {
  const officialUrl = "https://uiic.co.in/career/current-opening";
  const links: DiscoveredLink[] = [
    link(officialUrl, "UIIC Recruitment"),
  ];
  const result = discoverOfficialUrls(links, new Set([officialUrl]));
  assert.strictEqual(result.length, 0, "excluded URL not returned");
});

test("S04: PDF link on official domain scores higher than a bare homepage", () => {
  const links: DiscoveredLink[] = [
    link("https://uiic.co.in/", "UIIC Home", "OTHER"),
    link("https://uiic.co.in/recruitment-notification.pdf", "Official Notification", "OFFICIAL_NOTIFICATION"),
  ];
  const result = discoverOfficialUrls(links, new Set());
  // The PDF should appear first (higher score)
  assert.ok(result.length >= 1, "at least one result");
  assert.strictEqual(result[0], "https://uiic.co.in/recruitment-notification.pdf", "PDF ranks first");
});

test("S05: maxResults limit is respected", () => {
  const links: DiscoveredLink[] = Array.from({ length: 10 }, (_, i) =>
    link(`https://uiic.co.in/recruit/post-${i}`, `Post ${i}`)
  );
  const result = discoverOfficialUrls(links, new Set(), 3);
  assert.strictEqual(result.length, 3, "max 3 returned");
});

test("S06: duplicate links yield one result", () => {
  const sameUrl = "https://uiic.co.in/career/current-opening";
  const links: DiscoveredLink[] = [
    link(sameUrl, "Link A"),
    link(sameUrl, "Link B"),
  ];
  const result = discoverOfficialUrls(links, new Set());
  assert.strictEqual(result.filter((u) => u === sameUrl).length, 1, "deduplication works");
});

test("S07: non-http link (mailto:) is excluded", () => {
  const links: DiscoveredLink[] = [
    link("mailto:recruit@uiic.co.in", "UIIC Email"),
    link("https://uiic.co.in/career", "UIIC Career"),
  ];
  const result = discoverOfficialUrls(links, new Set());
  assert.ok(!result.some((u) => u.startsWith("mailto:")), "mailto excluded");
  assert.ok(result.some((u) => u.startsWith("https://uiic.co.in")), "https still included");
});

test("S08: gov.in domain discovered via OFFICIAL_DOMAIN_PATTERNS", () => {
  const links: DiscoveredLink[] = [
    link("https://bpsc.bih.nic.in/Advt/advt2026.pdf", "BPSC Notification", "OFFICIAL_NOTIFICATION"),
  ];
  const result = discoverOfficialUrls(links, new Set());
  assert.ok(result.length > 0, "nic.in domain treated as official");
  assert.ok(result[0].includes("bpsc.bih.nic.in"), "correct URL returned");
});
