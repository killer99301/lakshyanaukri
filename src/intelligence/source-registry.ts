// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine Source Registry
// ═══════════════════════════════════════════════════════════
// Authoritative map of sources the engine monitors.
//
// Each source has:
//   - an explicit tier (1–5)
//   - the organization it belongs to
//   - the canonical opportunity IDs it covers
//   - enabled/disabled state (false = defined but not yet active)
//   - polling configuration
//
// Phase 1: Only Tier 3 (official website) sources are enabled.
//           Tier 1 (PDF), Tier 2 (portal), Tier 4, Tier 5 are
//           defined here but disabled — ready for Phase 2.
//
// Trust rule enforced here:
//   Tier 5 sources MUST have enabled: false until Phase 2 is live.
//   When enabled, they trigger official-source checks only;
//   they never directly produce a CandidateChangeEvent with data.
// ═══════════════════════════════════════════════════════════

import type { MonitoredSource } from "./types";

const DEFAULT_TIER3_POLLING = {
  baseIntervalMinutes: 180,         // 3 hours
  maxRequestsPerDayPerDomain: 50,
  rateLimitDelayMs: 5_000,          // 5 seconds between requests to same domain
};

const DEFAULT_TIER2_POLLING = {
  baseIntervalMinutes: 180,
  maxRequestsPerDayPerDomain: 30,
  rateLimitDelayMs: 8_000,
};

const DEFAULT_TIER1_POLLING = {
  baseIntervalMinutes: 180,
  maxRequestsPerDayPerDomain: 20,
  rateLimitDelayMs: 10_000,
};

export const SOURCE_REGISTRY: MonitoredSource[] = [

  // ── BPSC ───────────────────────────────────────────────────

  {
    id: "bpsc-official-website",
    name: "BPSC Official Website",
    url: "https://bpsc.bih.nic.in",
    tier: 3,
    documentType: "WEBSITE_PAGE",
    organizationId: "bpsc",
    linkedOpportunityIds: ["bpsc-72nd-cce-2026"],
    enabled: true,                  // Phase 1: active
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Primary BPSC URL. CONSISTENTLY UNREACHABLE as of Phase 3A (2026-08-21): " +
      "fetch fails with ERROR or TIMEOUT (~10–60s) on every run. " +
      "NIC Bihar server is unresponsive — not a bot-block (no HTTP response). " +
      "Kept enabled as a monitoring signal; bpsc-application-portal is the active fallback.",
  },

  {
    id: "bpsc-application-portal",
    name: "BPSC Online Application Portal",
    url: "https://onlinebpsc.bihar.gov.in",
    tier: 2,
    documentType: "PORTAL_PAGE",
    organizationId: "bpsc",
    linkedOpportunityIds: ["bpsc-72nd-cce-2026"],
    enabled: true,                  // Phase 3A: enabled — reachable (310ms, 151 words)
    polling: DEFAULT_TIER2_POLLING,
    notes:
      "Phase 3A probe (2026-08-21): REACHABLE_ORG — 310ms, 151 words. " +
      "Content: registration/login portal ('Bihar Public Service Commission Portal', " +
      "'Online Registration Login'). No exam-specific content (no '72nd', 'advertisement' " +
      "links not inline). In Step 8.5 confirmation: DISCOVERED events for bpsc-72nd-cce-2026 " +
      "will get NOT_CONFIRMED (identifier absent) rather than OFFICIAL_UNAVAILABLE. " +
      "This is correct — reachable but cannot confirm changes without official notice content.",
  },

  {
    id: "bpsc-notification-index",
    name: "BPSC Notifications Index",
    url: "https://bpsc.bih.nic.in/advertisement",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "bpsc",
    linkedOpportunityIds: ["bpsc-72nd-cce-2026"],
    enabled: false,
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Index of all BPSC advertisements. On the same server as bpsc-official-website " +
      "(bpsc.bih.nic.in) which is consistently unreachable — this URL is likely also down. " +
      "Keep disabled until bpsc.bih.nic.in server is confirmed reachable.",
  },

  // ── RRB / Indian Railways ────────────────────────────────

  {
    id: "rrb-official-website",
    name: "Indian Railways Official Website",
    url: "https://indianrailways.gov.in",
    tier: 3,
    documentType: "WEBSITE_PAGE",
    organizationId: "rrb",
    linkedOpportunityIds: [
      "rrb-ntpc-grad-cen-05-2024",
      "rrb-ntpc-ug-cen-06-2024",
    ],
    enabled: true,                  // Phase 1: active
    polling: DEFAULT_TIER3_POLLING,
    notes: "Central RRB portal. Individual RRB zone sites link from here.",
  },

  {
    id: "rrb-apply-portal",
    name: "RRB Apply Portal",
    url: "https://www.rrbapply.gov.in",
    tier: 2,
    documentType: "PORTAL_PAGE",
    organizationId: "rrb",
    linkedOpportunityIds: [
      "rrb-ntpc-grad-cen-05-2024",
      "rrb-ntpc-ug-cen-06-2024",
    ],
    enabled: false,                 // Phase 2
    polling: DEFAULT_TIER2_POLLING,
  },

  // ── SSC ──────────────────────────────────────────────────

  {
    id: "ssc-official-website",
    name: "SSC Official Website",
    url: "https://ssc.gov.in",
    tier: 3,
    documentType: "WEBSITE_PAGE",
    organizationId: "ssc",
    linkedOpportunityIds: ["ssc-cgl-2026"],
    enabled: true,                  // Phase 1: active
    polling: DEFAULT_TIER3_POLLING,
    notes: "ssc.gov.in hosts all notifications, exam schedules, and admit cards.",
  },

  {
    id: "ssc-notification-index",
    name: "SSC Latest Notifications",
    url: "https://ssc.gov.in/home/latestNotices",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "ssc",
    linkedOpportunityIds: ["ssc-cgl-2026"],
    enabled: true,                  // Phase 3A: enabled — richer CGL-specific content than homepage
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "SSC's dedicated notification listing page. More likely than the homepage to contain " +
      "CGL 2026 identifier terms ('combined graduate level', 'cgl', 'tier') alongside " +
      "change-type keywords ('result', 'admit card', 'postponed'). " +
      "Acts as a fallback when ssc-official-website (ssc.gov.in) is unavailable, " +
      "and as a supplementary official source for Step 8.5 confirmation. " +
      "Same domain as ssc-official-website so shares rate-limit domain bucket.",
  },

  {
    id: "ssc-candidate-login",
    name: "SSC Candidate Portal",
    url: "https://ssc.gov.in/login",
    tier: 2,
    documentType: "PORTAL_PAGE",
    organizationId: "ssc",
    linkedOpportunityIds: ["ssc-cgl-2026"],
    enabled: false,                 // Phase 2
    polling: DEFAULT_TIER2_POLLING,
  },

  // ── IBPS ─────────────────────────────────────────────────

  {
    id: "ibps-official-website",
    name: "IBPS Official Website",
    url: "https://www.ibps.in",
    tier: 3,
    documentType: "WEBSITE_PAGE",
    organizationId: "ibps",
    linkedOpportunityIds: ["ibps-po-crp-xvi-2026"],
    enabled: true,                  // Phase 1: active (tracking failure state)
    polling: {
      ...DEFAULT_TIER3_POLLING,
      baseIntervalMinutes: 90,      // HIGH priority: prelims imminent
    },
    notes:
      "Phase 3A probe (2026-08-21): ALL ibps.in endpoints fail at network level. " +
      "www.ibps.in → immediate ERROR (139ms, no connection). " +
      "ibps.in (without www) → immediate ERROR (146ms). " +
      "ibpsonline.ibps.in → REACHABLE but returns test placeholder ('This is a sample test HTML page!'). " +
      "This is a network-level block, not HTTP 403 — the domain does not route from this environment. " +
      "Kept enabled to record FETCH_FAILED in audit log (monitoring the failure IS useful). " +
      "No alternative IBPS official URL is reachable. Review if network policy changes.",
  },

  {
    id: "ibps-online-portal",
    name: "IBPS Online Application Portal",
    url: "https://ibpsonline.ibps.in",
    tier: 2,
    documentType: "PORTAL_PAGE",
    organizationId: "ibps",
    linkedOpportunityIds: ["ibps-po-crp-xvi-2026"],
    enabled: false,
    polling: DEFAULT_TIER2_POLLING,
    notes:
      "Phase 3A probe (2026-08-21): Domain is reachable (298ms) but returns " +
      "'This is a sample test HTML page!' — 7 words, clearly a placeholder/dev server. " +
      "Not real IBPS content. Keep disabled.",
  },

  // ── UPSC ─────────────────────────────────────────────────

  {
    id: "upsc-official-website",
    name: "UPSC Official Website",
    url: "https://upsc.gov.in",
    tier: 3,
    documentType: "WEBSITE_PAGE",
    organizationId: "upsc",
    linkedOpportunityIds: ["upsc-cse-2026"],
    enabled: true,                  // Phase 1: active (tracking failure state)
    polling: {
      ...DEFAULT_TIER3_POLLING,
      baseIntervalMinutes: 90,      // HIGH priority: Mains in progress
    },
    notes:
      "upsc.gov.in. Mains commences 21 Aug 2026. " +
      "Phase 3A probe (2026-08-21): HTTP 403 BLOCKED — bot detection on homepage AND " +
      "on /examinations/active-examinations/ subpage. All upsc.gov.in paths are blocked. " +
      "Kept enabled to record FETCH_BLOCKED in audit log. " +
      "upsc-online-portal (upsconline.nic.in) is the active fallback.",
  },

  {
    id: "upsc-online-portal",
    name: "UPSC Online Portal",
    url: "https://upsconline.nic.in",
    tier: 2,
    documentType: "PORTAL_PAGE",
    organizationId: "upsc",
    linkedOpportunityIds: ["upsc-cse-2026"],
    enabled: true,                  // Phase 3A: enabled — reachable but JS-rendered
    polling: DEFAULT_TIER2_POLLING,
    notes:
      "Admit card download and application status portal for UPSC. " +
      "Phase 3A probe (2026-08-21): REACHABLE_ORG — 334ms, but only 4 words extracted " +
      "('Union Public Service Commission'). Page is heavily JavaScript-rendered; " +
      "basic HTML text extraction sees only the static skeleton. " +
      "Word count (4) fails the 20-word threshold in Step 6, so this source " +
      "will not contribute text to extractedTextBySourceId. " +
      "Keeps Step 8.5 attempting the source (OFFICIAL_UNAVAILABLE rather than skipped). " +
      "If a text-extraction upgrade handles JS rendering, this source becomes viable.",
  },

  // ── Tier 1 PDF sources (Phase 2+) ────────────────────────
  // Defined here so Phase 2 can enable them without source registry changes.
  // URL patterns are per-org notification index pages from which PDFs are linked.

  {
    id: "bpsc-pdf-index",
    name: "BPSC PDF Notification Index",
    url: "https://bpsc.bih.nic.in/advertisement",
    tier: 1,
    documentType: "NOTIFICATION_PDF",
    organizationId: "bpsc",
    linkedOpportunityIds: ["bpsc-72nd-cce-2026"],
    enabled: false,                 // Phase 2: scan for new PDFs
    polling: DEFAULT_TIER1_POLLING,
    notes: "Phase 2 will scan this page for new PDF links matching known notification patterns.",
  },

  {
    id: "ssc-pdf-index",
    name: "SSC PDF Notification Index",
    url: "https://ssc.gov.in/home/latestNotices",
    tier: 1,
    documentType: "NOTIFICATION_PDF",
    organizationId: "ssc",
    linkedOpportunityIds: ["ssc-cgl-2026"],
    enabled: false,                 // Phase 2
    polling: DEFAULT_TIER1_POLLING,
  },

  // ── Tier 5 discovery sources (Phase 2+) ──────────────────
  // DISCOVERY TRIGGER ONLY. Signals capped at DISCOVERED state.
  // Phase 2B: per-org targeted entries replace the old generic homepage.
  // Each entry covers exactly one organization and links to a category/tag
  // page where exam-specific articles appear (not the aggregator homepage).
  //
  // Event gate (Phase 2B): isOpportunityMatch — the signal must have the
  // specific notification number / exam code within 150 chars of the keyword.
  // Signals with only an org name nearby are REJECTED AMBIGUOUS.
  //
  // Phase 2B URL verification results (2026-08-21, scripts/verify-secondary-sources.ts):
  //   sarkari-result-bpsc     → RELEVANT   (3204 words, "72nd" found in content)
  //   sarkari-result-railway  → RELEVANT   (5190 words, "ntpc", "cen", "graduate level" found)
  //   sarkari-result-ssc      → ORG_ONLY   (522 words, "ssc" found but "cgl" not in excerpt)
  //   sarkari-result-banking  → SUSPICIOUS (same content hash as railway page — /banking/
  //                             returns the general site page, not a banking-specific page;
  //                             changed to /ibps/ on 2026-08-21)
  //   sarkari-result-upsc     → RELEVANT   (498 words, "civil services", "mains" found)

  {
    id: "sarkari-result-discovery",
    name: "Sarkari Result — Homepage (Deprecated)",
    url: "https://www.sarkariresult.com",
    tier: 5,
    documentType: "SECONDARY_PAGE",
    organizationId: "bpsc",
    linkedOpportunityIds: [],  // no linked opportunities — replaced by per-org entries
    enabled: false,            // DISABLED in Phase 2B: too broad, replaced by targeted entries
    polling: {
      baseIntervalMinutes: 60,
      maxRequestsPerDayPerDomain: 24,
      rateLimitDelayMs: 30_000,
    },
    notes:
      "Disabled in Phase 2B. Homepage covers all exams simultaneously, causing false positives " +
      "even with identifier matching. Replaced by per-org targeted entries below.",
  },

  {
    id: "sarkari-result-bpsc",
    name: "Sarkari Result — BPSC",
    url: "https://www.sarkariresult.com/bpsc/",
    tier: 5,
    documentType: "SECONDARY_PAGE",
    organizationId: "bpsc",
    linkedOpportunityIds: ["bpsc-72nd-cce-2026"],
    enabled: true,
    polling: {
      baseIntervalMinutes: 120,
      maxRequestsPerDayPerDomain: 12,
      rateLimitDelayMs: 30_000,
    },
    notes:
      "BPSC-specific category page. Verified RELEVANT 2026-08-21 (3204 words, '72nd' in content). " +
      "Identifiers: 72/2026 (formal), 72nd (title-derived, matches aggregator title format).",
  },

  {
    id: "sarkari-result-railway",
    name: "Sarkari Result — Railway Recruitment",
    url: "https://www.sarkariresult.com/railway-recruitment/",
    tier: 5,
    documentType: "SECONDARY_PAGE",
    organizationId: "rrb",
    linkedOpportunityIds: [
      "rrb-ntpc-grad-cen-05-2024",
      "rrb-ntpc-ug-cen-06-2024",
    ],
    enabled: true,
    polling: {
      baseIntervalMinutes: 120,
      maxRequestsPerDayPerDomain: 12,
      rateLimitDelayMs: 30_000,
    },
    notes:
      "Railway category page. Verified RELEVANT 2026-08-21 (5190 words, 'ntpc', 'cen', 'graduate level'). " +
      "Identifiers: cen 05/2024 (Grad), cen 06/2024 (UG). Normalizer handles CEN-05/2024 → cen 05/2024.",
  },

  {
    id: "sarkari-result-ssc",
    name: "Sarkari Result — SSC",
    url: "https://www.sarkariresult.com/ssc/",
    tier: 5,
    documentType: "SECONDARY_PAGE",
    organizationId: "ssc",
    linkedOpportunityIds: ["ssc-cgl-2026"],
    enabled: true,
    polling: {
      baseIntervalMinutes: 120,
      maxRequestsPerDayPerDomain: 12,
      rateLimitDelayMs: 30_000,
    },
    notes:
      "SSC category page. Verified ORG_ONLY 2026-08-21 (522 words, 'ssc' found, 'cgl' NOT in excerpt). " +
      "Page is very short; CGL 2026 articles may not yet appear on this category page. " +
      "Identifier 'cgl 2026' should match when SSC CGL articles are present. " +
      "If no matches after 30 days, consider disabling or changing URL.",
  },

  {
    id: "sarkari-result-banking",
    name: "Sarkari Result — IBPS",
    // Previous URL /banking/ returned the same content as /railway-recruitment/ (same hash).
    // Changed to /ibps/ which is more likely to be an IBPS-specific category page.
    url: "https://www.sarkariresult.com/ibps/",
    tier: 5,
    documentType: "SECONDARY_PAGE",
    organizationId: "ibps",
    linkedOpportunityIds: ["ibps-po-crp-xvi-2026"],
    enabled: true,
    polling: {
      baseIntervalMinutes: 120,
      maxRequestsPerDayPerDomain: 12,
      rateLimitDelayMs: 30_000,
    },
    notes:
      "IBPS category page. Previous URL (/banking/) shared same content hash as /railway-recruitment/ — " +
      "returned general site content, not banking-specific. Changed to /ibps/ on 2026-08-21. " +
      "Not yet re-verified; will be classified on next live run. " +
      "Identifiers: crp xvi, crp po/mt xvi (normalized form handles CRP-XVI hyphen variant).",
  },

  {
    id: "sarkari-result-upsc",
    name: "Sarkari Result — UPSC",
    url: "https://www.sarkariresult.com/upsc/",
    tier: 5,
    documentType: "SECONDARY_PAGE",
    organizationId: "upsc",
    linkedOpportunityIds: ["upsc-cse-2026"],
    enabled: true,
    polling: {
      baseIntervalMinutes: 120,
      maxRequestsPerDayPerDomain: 12,
      rateLimitDelayMs: 30_000,
    },
    notes:
      "UPSC category page. Verified RELEVANT 2026-08-21 (498 words, 'civil services', 'mains' found). " +
      "Identifiers: cse 2026 (formal), 'cse' (Pattern 6 title+notif code). " +
      "Note: UPSC.gov.in returns HTTP 403; this secondary source provides early warning.",
  },

  // ══════════════════════════════════════════════════════════
  // Phase 7A: ORG_DISCOVERY sources — Wave 1
  // ══════════════════════════════════════════════════════════
  //
  // These sources scan for NEW recruitments from an organization,
  // not for updates to known canonical records.
  // mode: "ORG_DISCOVERY", linkedOpportunityIds: []
  //
  // Reachability from GitHub Actions (Ubuntu runner) is to be
  // confirmed via the source-probe workflow before enabling.
  // Sources marked PROBE_REQUIRED are disabled until probed.
  //
  // Wave 2 sources (IBPS, SBI, RBI, NABARD, LIC, India Post)
  // are defined below with enabled: false — architecture is
  // ready for them; reachability must be established first.
  // ══════════════════════════════════════════════════════════

  // ── SSC org-discovery ────────────────────────────────────
  // ssc.gov.in/home/latestNotices was confirmed reachable locally (Phase 6).
  // GitHub Actions reachability: assumed — to be confirmed via source-probe.

  {
    id: "ssc-org-discovery",
    name: "SSC Notification Index (org-discovery)",
    url: "https://ssc.gov.in/home/latestNotices",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "ssc",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],      // scans for any new SSC recruitment
    enabled: false,               // PROBE 2026-09-01: HTTP 200 but only 7 words — JS-rendered
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Phase 7A: ORG_DISCOVERY source for SSC. " +
      "Source-probe 2026-09-01: HTTP 200 from GH Actions Ubuntu but only 7 words extracted. " +
      "Page content is JavaScript-rendered; our HTML fetcher cannot see notification links. " +
      "Disabled until an alternative static URL is found or a headless-browser approach is added.",
  },

  // ── RRB org-discovery ────────────────────────────────────
  // indianrailways.gov.in was confirmed reachable locally (Phase 6).
  // CEN notifications are listed at the railway board's recruitment page.

  {
    id: "rrb-org-discovery",
    name: "Indian Railways Recruitment (org-discovery)",
    url: "https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,1,304,366,554",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "rrb",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],
    enabled: false,               // CONFIRMED IP-BLOCK 2026-09-01 — see notes
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Phase 7A: ORG_DISCOVERY source for RRB. " +
      "Source-probe 2026-09-01 (run 33527021843): CONFIRMED reachable — HTTP 200, 678 words, 8.4s. " +
      "Reliability investigation 2026-09-01 (run 33530387966): ALL 5 fetch experiments failed with " +
      "'TypeError: fetch failed' in <800ms each. E1 (isolated, no prior state) also failed — " +
      "ruling out sequential-fetch rate-limiting as the cause. " +
      "Root cause: indianrailways.gov.in is hosted on NIC (National Informatics Centre) " +
      "infrastructure, which blocks outbound connections from Azure cloud IP ranges. " +
      "GitHub Actions ubuntu-latest runners use an Azure East US IP pool; most of these IPs " +
      "are blocked at the TCP layer. The source-probe succeeded because it drew an unblocked IP " +
      "from the pool — behavior is non-deterministic across runs (~50-80% failure rate). " +
      "No code change (delay, dedup, timeout increase, retry) can fix an IP-layer block. " +
      "MANUAL DISCOVERY PATH: when a new CEN is announced, add it manually via " +
      "appendNewRecord() / PR workflow. Check: " +
      "https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,1,304,366,554",
  },

  // ── UPSC org-discovery ───────────────────────────────────
  // upsc.gov.in returns HTTP 403 from local environment (Phase 6).
  // Disabled pending source-probe from GitHub Actions — may differ from local.

  {
    id: "upsc-org-discovery",
    name: "UPSC Active Examinations (org-discovery)",
    url: "https://upsc.gov.in/examinations/active-examinations/",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "upsc",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],
    enabled: false,               // BLOCKED locally (HTTP 403) — enable after GH Actions probe
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Phase 7A: ORG_DISCOVERY source for UPSC. upsc.gov.in returned HTTP 403 locally. " +
      "Source-probe 2026-09-01: timed out after 56s from GH Actions Ubuntu (no response). " +
      "Keep disabled. Try alternative UPSC URL in a future probe.",
  },

  // ══════════════════════════════════════════════════════════
  // Phase 7A: ORG_DISCOVERY sources — Wave 2 (architecture ready, disabled)
  // ══════════════════════════════════════════════════════════
  // Reachability from GitHub Actions must be established via source-probe
  // before enabling any of these. Do not enable without a confirmed probe result.

  {
    id: "ibps-org-discovery",
    name: "IBPS Latest Notifications (org-discovery)",
    url: "https://www.ibps.in",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "ibps",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],
    enabled: false,               // BLOCKED locally (network-level) — probe required
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Phase 7A Wave 2: IBPS org-discovery. ibps.in is network-blocked from local " +
      "environment (Phase 6 audit). Enable only after source-probe confirms reachability.",
  },

  {
    id: "sbi-org-discovery",
    name: "SBI Careers (org-discovery)",
    url: "https://bank.sbi/web/careers",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "sbi",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],
    enabled: false,               // not yet probed
    polling: DEFAULT_TIER3_POLLING,
    notes: "Phase 7A Wave 2: SBI org-discovery. URL to be confirmed via source-probe.",
  },

  {
    id: "rbi-org-discovery",
    name: "RBI Opportunities (org-discovery)",
    url: "https://www.rbi.org.in/Scripts/Opportunities.aspx",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "rbi",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],
    enabled: false,
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Phase 7A Wave 2: RBI org-discovery. " +
      "Source-probe 2026-09-01: REACHABLE from GH Actions Ubuntu — HTTP 200, 337 words, " +
      "keyword 'notification' found. Enable when Wave 2 discovery is activated.",
  },

  {
    id: "nabard-org-discovery",
    name: "NABARD Recruitment (org-discovery)",
    url: "https://www.nabard.org/content1.aspx?id=580&catid=23&mid=24",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "nabard",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],
    enabled: false,
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Phase 7A Wave 2: NABARD org-discovery. " +
      "Source-probe 2026-09-01: timed out after 56s from GH Actions Ubuntu. Keep disabled.",
  },

  {
    id: "lic-org-discovery",
    name: "LIC Recruitment (org-discovery)",
    url: "https://licindia.in/recruitment",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "lic",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],
    enabled: false,
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Phase 7A Wave 2: LIC org-discovery. " +
      "Source-probe 2026-09-01: HTTP 404 from GH Actions Ubuntu — URL is wrong. " +
      "Find the correct LIC recruitment listing URL before enabling.",
  },

  {
    id: "indiapost-org-discovery",
    name: "India Post Recruitment (org-discovery)",
    url: "https://www.indiapost.gov.in/Recruitment",
    tier: 3,
    documentType: "WEBSITE_INDEX",
    organizationId: "indiapost",
    mode: "ORG_DISCOVERY",
    linkedOpportunityIds: [],
    enabled: false,
    polling: DEFAULT_TIER3_POLLING,
    notes:
      "Phase 7A Wave 2: India Post org-discovery. " +
      "Source-probe 2026-09-01: HTTP 404 from GH Actions Ubuntu — URL is wrong. " +
      "Find the correct India Post recruitment listing URL before enabling.",
  },
];

// ─── Registry Accessors ──────────────────────────────────────

export function getEnabledSources(): MonitoredSource[] {
  return SOURCE_REGISTRY.filter((s) => s.enabled);
}

export function getSourceById(id: string): MonitoredSource | undefined {
  return SOURCE_REGISTRY.find((s) => s.id === id);
}

export function getSourcesForOrg(organizationId: string): MonitoredSource[] {
  return SOURCE_REGISTRY.filter((s) => s.organizationId === organizationId);
}

export function getSourcesForOpportunity(opportunityId: string): MonitoredSource[] {
  return SOURCE_REGISTRY.filter((s) =>
    s.linkedOpportunityIds.includes(opportunityId)
  );
}

export function getEnabledSourcesForOpportunity(opportunityId: string): MonitoredSource[] {
  return getSourcesForOpportunity(opportunityId).filter((s) => s.enabled);
}

// Phase 7A: ORG_DISCOVERY accessor
export function getEnabledDiscoverySources(): MonitoredSource[] {
  return SOURCE_REGISTRY.filter((s) => s.enabled && s.mode === "ORG_DISCOVERY");
}
