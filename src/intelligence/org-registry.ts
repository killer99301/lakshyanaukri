// ═══════════════════════════════════════════════════════════
// Organization Registry
// ═══════════════════════════════════════════════════════════
// Single source of truth for all organization metadata and
// domain classification constants used across the intelligence
// pipeline (discovery.ts, intake.ts, new-record-factory.ts,
// and the Phase 9A multi-source discovery layer).
//
// Rules:
//   - Every organization entry must be present in ALL tables.
//   - Add new orgs here only — never in individual modules.
//   - "Central Govt" includes central PSEs that are not PSU banks.
// ═══════════════════════════════════════════════════════════

import type { Category, Qualification } from "@/types";

// ─── Org display names ────────────────────────────────────────

export const ORG_NAMES: Record<string, string> = {
  ssc:       "Staff Selection Commission",
  rrb:       "Railway Recruitment Boards",
  upsc:      "Union Public Service Commission",
  bpsc:      "Bihar Public Service Commission",
  ibps:      "Institute of Banking Personnel Selection",
  sbi:       "State Bank of India",
  rbi:       "Reserve Bank of India",
  nabard:    "National Bank for Agriculture and Rural Development",
  lic:       "Life Insurance Corporation of India",
  indiapost: "India Post",
  // PSU general insurance companies (under Ministry of Finance)
  uiicl:     "United India Insurance Company Limited",
  niacl:     "The New India Assurance Co. Ltd.",
  oicl:      "Oriental Insurance Company Limited",
  nicl:      "National Insurance Company Limited",
};

export function deriveOrgName(orgId: string): string {
  return ORG_NAMES[orgId] ?? orgId.toUpperCase();
}

// ─── Org classification tables ────────────────────────────────

export const ORG_CATEGORY: Record<string, Category> = {
  ssc:       "ssc",
  rrb:       "railway",
  upsc:      "state-psc",
  bpsc:      "state-psc",
  ibps:      "banking",
  sbi:       "banking",
  rbi:       "banking",
  nabard:    "banking",
  lic:       "government",
  indiapost: "government",
  uiicl:     "government",
  niacl:     "government",
  oicl:      "government",
  nicl:      "government",
};

export const ORG_GOV_TYPE: Record<string, "Central Govt" | "State Govt" | "PSU Bank"> = {
  ssc:       "Central Govt",
  rrb:       "Central Govt",
  upsc:      "Central Govt",
  bpsc:      "State Govt",
  ibps:      "PSU Bank",
  sbi:       "PSU Bank",
  rbi:       "Central Govt",
  nabard:    "PSU Bank",
  lic:       "Central Govt",
  indiapost: "Central Govt",
  uiicl:     "Central Govt",
  niacl:     "Central Govt",
  oicl:      "Central Govt",
  nicl:      "Central Govt",
};

// Primary domain for each org — used to construct apply/website links.
// For official-source resolution, see OFFICIAL_DOMAINS (which maps
// domain → orgId, including alternate domains for the same org).
export const ORG_DOMAIN: Record<string, string> = {
  ssc:       "ssc.gov.in",
  rrb:       "indianrailways.gov.in",
  upsc:      "upsc.gov.in",
  bpsc:      "bpsc.bih.nic.in",
  ibps:      "ibps.in",
  sbi:       "sbi.co.in",
  rbi:       "rbi.org.in",
  nabard:    "nabard.org",
  lic:       "licindia.in",
  indiapost: "indiapost.gov.in",
  uiicl:     "uiic.co.in",
  niacl:     "newindia.co.in",
  oicl:      "orientalinsurance.org.in",
  nicl:      "nicl.co.in",
};

export const ORG_QUALIFICATION: Record<string, Qualification> = {
  ssc:       "Graduate",
  rrb:       "Graduate",
  upsc:      "Graduate",
  bpsc:      "Graduate",
  ibps:      "Graduate",
  sbi:       "Graduate",
  rbi:       "Graduate",
  nabard:    "Graduate",
  lic:       "Graduate",
  indiapost: "10th Pass",
  uiicl:     "Graduate",
  niacl:     "Graduate",
  oicl:      "Graduate",
  nicl:      "Graduate",
};

// ─── Official source domain registry ─────────────────────────
// Maps each known official domain (without www.) to its orgId.
// Multiple domains may map to the same org (e.g. rrbapply.gov.in
// and indianrailways.gov.in both map to "rrb").

export const OFFICIAL_DOMAINS: Record<string, string> = {
  "ssc.gov.in":                "ssc",
  "rrbapply.gov.in":           "rrb",
  "indianrailways.gov.in":     "rrb",
  "rrbcdnonline.in":           "rrb",
  "upsc.gov.in":               "upsc",
  "upsconline.nic.in":         "upsc",
  "bpsc.bih.nic.in":           "bpsc",
  "onlinebpsc.bihar.gov.in":   "bpsc",
  "ibps.in":                   "ibps",
  "ibpsonline.ibps.in":        "ibps",
  "bank.sbi":                  "sbi",
  "sbi.co.in":                 "sbi",
  "rbi.org.in":                "rbi",
  "nabard.org":                "nabard",
  "licindia.in":               "lic",
  "indiapost.gov.in":          "indiapost",
  // PSU general insurance companies
  "uiic.co.in":                "uiicl",
  "newindia.co.in":            "niacl",
  "orientalinsurance.org.in":  "oicl",
  "nicl.co.in":                "nicl",
};

// ─── Known aggregator / third-party domains ───────────────────
// These are recognized as THIRD_PARTY sources. They are useful for
// discovery and corroboration but must never be the primarySourceUrl
// on a canonical record.

export const KNOWN_AGGREGATORS: Record<string, string> = {
  "govtjobguru.com":            "GovtJobGuru",
  "govtjobguru.in":             "GovtJobGuru",
  "sarkariresult.com":          "SarkariResult",
  "sarkari-result.com":         "SarkariResult",
  "sarkariexam.com":            "SarkariExam",
  "freejobalert.com":           "FreeJobAlert",
  "rojgarresult.com":           "RojgarResult",
  "naukrimessenger.com":        "NaukriMessenger",
  "naukrinama.com":             "NaukriNama",
  "latestgovtjobs.in":          "LatestGovtJobs",
  "jobsarkari.com":             "JobSarkari",
  "sarkari-naukri.com":         "SarkariNaukri",
  "indiaresults.com":           "IndiaResults",
  "marugujarat.in":             "MaruGujarat",
  "currentjobs24.in":           "CurrentJobs24",
  "adda247.com":                "Adda247",
  "sarkarinaukariofficial.com": "SarkariNaukriOfficial",
  "govtjobs.io":                "GovtJobsIO",
  "careerpower.in":             "CareerPower",
};

// ─── Domain pattern matchers ──────────────────────────────────

// Domains matching these patterns are presumed official even if not in
// OFFICIAL_DOMAINS. State-specific gov.in / nic.in portals use this path.
export const OFFICIAL_DOMAIN_PATTERNS: RegExp[] = [
  /^[a-z0-9.-]+\.gov\.in$/,
  /^[a-z0-9.-]+\.nic\.in$/,
];

// State-level domain suffixes used for govType detection.
export const STATE_DOMAIN_SUFFIXES: string[] = [
  "bihar.gov.in", "up.gov.in", "rajasthan.gov.in", "mp.gov.in",
  "maharashtra.gov.in", "gujarat.gov.in", "haryana.gov.in",
  "punjab.gov.in", "karnataka.gov.in", "tamilnadu.gov.in",
  "andhra.gov.in", "telangana.gov.in", "odisha.gov.in",
  "assam.gov.in", "kerala.gov.in", "jharkhand.gov.in",
  "uttarakhand.gov.in", "himachal.gov.in", "cg.gov.in",
];

// Human-readable names derived from the first segment of known official
// subdomains (e.g. "onlinebpsc" → "Bihar Public Service Commission").
export const OFFICIAL_DOMAIN_LABELS: Record<string, string> = {
  "bceceboard":          "BCECE Board",
  "onlinebpsc":          "Bihar Public Service Commission",
  "bpsc":                "Bihar Public Service Commission",
  "ssc":                 "Staff Selection Commission",
  "upsc":                "Union Public Service Commission",
  "rbi":                 "Reserve Bank of India",
  "nabard":              "National Bank for Agriculture and Rural Development",
  "licindia":            "Life Insurance Corporation of India",
  "indiapost":           "India Post",
  "ibps":                "IBPS",
  "rrbapply":            "Railway Recruitment Boards",
  "upsconline":          "Union Public Service Commission",
  "uiic":                "United India Insurance Company Limited",
  "newindia":            "The New India Assurance Co. Ltd.",
  "orientalinsurance":   "Oriental Insurance Company Limited",
  "nicl":                "National Insurance Company Limited",
};

// ─── Keyword filters ──────────────────────────────────────────
// Used by discovery.ts and the Phase 9A multi-source adapters.

export const RECRUITMENT_KEYWORDS: string[] = [
  "notification", "advertisement", "advt", "recruitment", "vacancy",
  "vacancies", "bharti", "engagement", "selection post", "apply",
  "online application", "direct recruitment",
];

// If any operational keyword is present, the notice is NOT a new recruitment —
// it belongs to the existing field-update pipeline.
export const OPERATIONAL_KEYWORDS: string[] = [
  "result", "merit list", "final list", "answer key", "admit card",
  "hall ticket", "cut off", "waiting list", "interview letter",
  "date sheet", "time table", "postpone", "cancelled", "corrigendum",
  "erratum", "extension of date", "joining instructions", "appointment",
  "downloading", "download link", "link activated",
  // Vendor procurement — must never enter the candidate recruitment pipeline
  "request for proposal", "rfp", "pre bid", "tender notice", "tender for",
];
