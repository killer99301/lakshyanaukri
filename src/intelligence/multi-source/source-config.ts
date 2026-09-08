// ═══════════════════════════════════════════════════════════
// Phase 9A: Multi-Source Discovery — Source Registry
// ═══════════════════════════════════════════════════════════
//
// Defines the discovery sources for Phase 9A.
// All third-party (tier 5) sources are discovery/corroboration only.
// They may never be primarySourceUrl on a canonical record.
//
// To add a new source:
//   1. Add an entry to MULTI_SOURCE_CONFIGS
//   2. Set enabled: false until validated on a real dry run
//   3. Add orgFilter if the feed covers multiple orgs and you want to limit scope

import type { MultiSourceConfig } from "./types";

export const MULTI_SOURCE_CONFIGS: MultiSourceConfig[] = [
  // ─── Tier 5: Third-Party Aggregators ─────────────────────
  {
    id: "freejobalert-rss",
    name: "FreeJobAlert RSS",
    type: "RSS",
    url: "https://www.freejobalert.com/feed/",
    tier: 5,
    enabled: true,
    rateLimitDelayMs: 8_000,
    notes: "WordPress RSS. Items cover all major govt orgs. Classified by org keyword.",
  },
  {
    id: "sarkariresult-latest",
    name: "SarkariResult Latest Jobs",
    type: "HTML_LINKS",
    url: "https://www.sarkariresult.com/latestjob.php",
    tier: 5,
    enabled: true,
    rateLimitDelayMs: 8_000,
    notes: "HTML page listing latest notifications. May be rate-limited or captcha-blocked.",
  },
  {
    id: "govtjobguru-latest",
    name: "GovtJobGuru Latest Jobs",
    type: "HTML_LINKS",
    url: "https://www.govtjobguru.in/",
    tier: 5,
    enabled: true,
    rateLimitDelayMs: 8_000,
    notes: "HTML front page with recent recruitment notifications.",
  },

  // ─── Tier 3: Official Org Notification Pages ─────────────
  // These supplement the existing ORG_DISCOVERY sources.
  // They are scanned for any new recruitment not yet in canonical data.
  {
    id: "ibps-notifications-html",
    name: "IBPS Notification Index",
    type: "HTML_LINKS",
    url: "https://www.ibps.in/",
    tier: 3,
    enabled: true,
    orgFilter: ["ibps"],
    rateLimitDelayMs: 10_000,
    notes: "Official IBPS site. Low request frequency to avoid overloading.",
  },
  {
    id: "ssc-notifications-html",
    name: "SSC Latest News",
    type: "HTML_LINKS",
    url: "https://ssc.gov.in/",
    tier: 3,
    enabled: true,
    orgFilter: ["ssc"],
    rateLimitDelayMs: 10_000,
    notes: "Official SSC site.",
  },
];

export function getEnabledSources(): MultiSourceConfig[] {
  return MULTI_SOURCE_CONFIGS.filter((s) => s.enabled);
}
