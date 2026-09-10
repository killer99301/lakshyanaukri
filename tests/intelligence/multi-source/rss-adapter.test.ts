// Tests for Phase 9A RSS adapter: org detection, keyword filter, date parsing.
// Uses synthetic RSS XML — does NOT make real HTTP calls.

import { isRecruitmentItem, parseRssDate } from "../../../src/intelligence/multi-source/adapters/rss-adapter";
import { detectOrgFromText as detectOrgId } from "../../../src/intelligence/multi-source/org-classifier";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

// ─── detectOrgId ─────────────────────────────────────────────

console.log("\n=== detectOrgId ===");

assert("IBPS in title → ibps", detectOrgId("IBPS PO Recruitment 2026") === "ibps");
assert("sbi (lowercase) → sbi", detectOrgId("sbi clerk 2026 notification") === "sbi");
assert("RBI → rbi", detectOrgId("RBI Grade B 2026") === "rbi");
assert("Staff Selection Commission → ssc", detectOrgId("Staff Selection Commission MTS 2026") === "ssc");
assert("CGL → ssc", detectOrgId("CGL Combined Graduate Level 2026 recruitment") === "ssc");
assert("Railway Recruitment → rrb", detectOrgId("Railway Recruitment Board NTPC 2026") === "rrb");
assert("India Post → indiapost", detectOrgId("India Post GDS Recruitment 2026") === "indiapost");
assert("NABARD → nabard", detectOrgId("National Bank for Agriculture recruitment") === "nabard");
assert("private sector → undefined", detectOrgId("TCS Fresher Hiring 2026") === undefined);
assert("unrecognized org → undefined", detectOrgId("ISRO Scientist Recruitment 2026") === undefined);
assert("'police' must NOT match lic (word-boundary check)", detectOrgId("UP Police Constable Recruitment 2026") === undefined);
assert("'lic' as whole word → lic", detectOrgId("LIC ADO Recruitment 2026") === "lic");

// ─── Org identity: title-only (Phase 9A hardening) ───────────────────────────
// Regression for Bank of Baroda LBO → rbi false positive.
// Bank of Baroda's eligibility criteria mention "Reserve Bank of India" as a reference,
// but Bank of Baroda is NOT in our registry and must not be assigned to rbi.
// The html-link-adapter truncates link.text to first 150 chars before calling detectOrgFromText,
// so "Reserve Bank of India" in the eligibility body never reaches the classifier.
// These tests document the correct behavior at the classifier and title-prefix level.

console.log("\n=== detectOrgId — org-identity regressions ===");

assert(
  "Bank of Baroda Recruitment title → undefined (BOB not in registry)",
  detectOrgId("Bank of Baroda BOB LBO Recruitment 2026 – Apply Online for 2482 Local Bank Officer Posts") === undefined
);
assert(
  "BOB title prefix (150 chars) → undefined even though eligibility mentions Reserve Bank of India",
  detectOrgId(
    "Bank of Baroda BOB LBO Recruitment 2026 – Apply Online for 2482 Local Bank Officer Posts (Last Date".slice(0, 150)
  ) === undefined
);
assert(
  "NMDFC Recruitment title → undefined (NMDFC not in registry)",
  detectOrgId("NMDFC Recruitment of Company Secretary cum Chief Manager Registration From 25-Aug-2026") === undefined
);
assert(
  "IOB Recruitment title → undefined (IOB not in registry)",
  detectOrgId("IOB Recruitment of Security Guards Registration From 25-Aug-2026") === undefined
);
assert(
  "RCF Recruitment title → undefined (RCF not in registry)",
  detectOrgId("RCF Recruitment of Management Trainees Registration From 08-Aug-2025") === undefined
);
assert(
  "ibps.in hostname alone must not classify NMDFC as ibps — title-only org detection",
  (() => {
    // ibpsreg.ibps.in hosts third-party registrations; only the document title is used.
    // "NMDFC Recruitment" → no ibps keyword → undefined
    return detectOrgId("NMDFC Recruitment of Company Secretary cum Chief Manager") !== "ibps";
  })()
);
assert(
  "IBPS notification title → ibps (positive: IBPS still detected from title)",
  detectOrgId("Notification for CRP-RRB-XV — IBPS Regional Rural Bank Recruitment 2026") === "ibps"
);

// ─── isRecruitmentItem ────────────────────────────────────────

console.log("\n=== isRecruitmentItem ===");

assert(
  "notification keyword → true",
  isRecruitmentItem("IBPS PO 2026 Notification Released")
);
assert(
  "recruitment keyword → true",
  isRecruitmentItem("SSC CGL 2026 Recruitment Vacancy")
);
assert(
  "apply keyword → true",
  isRecruitmentItem("SBI Clerk 2026 Apply Online")
);
assert(
  "result keyword → false (operational)",
  !isRecruitmentItem("IBPS PO 2026 Final Result Declared")
);
assert(
  "admit card → false (operational)",
  !isRecruitmentItem("SSC CGL 2026 Admit Card Download Link")
);
assert(
  "answer key → false (operational)",
  !isRecruitmentItem("SSC CGL 2026 Answer Key Released")
);
assert(
  "notification + result → false (operational wins)",
  !isRecruitmentItem("IBPS PO Recruitment 2026 Result Released — Notification Error")
);
assert(
  "generic text → false",
  !isRecruitmentItem("Latest news update from the government")
);

// ─── Procurement / vendor tender filter (Phase 9A hardening) ─────────────────

console.log("\n=== isRecruitmentItem — procurement filter ===");

assert(
  "RFP document → false",
  !isRecruitmentItem("Request for Proposal (RFP) For Development of Online Applications Portal for Candidates Registration with Grievance Redressal System")
);
assert(
  "pre-bid document → false",
  !isRecruitmentItem("Pre Bid reply for RFP for Development of Online Applications Portal for Candidates Registration")
);
assert(
  "tender notice → false",
  !isRecruitmentItem("Tender Notice for Website Maintenance and Hosting Services")
);
assert(
  "tender for → false",
  !isRecruitmentItem("Tender for Supply of Computer Hardware and Peripherals 2026")
);
assert(
  "rfp standalone → false",
  !isRecruitmentItem("IBPS RFP for Online Application Portal 2026")
);
assert(
  "recruitment notification still passes (not blocked by procurement filter)",
  isRecruitmentItem("IBPS CRP RRBs-XV Notification 2026 Apply Online")
);
assert(
  "recruitment apply still passes",
  isRecruitmentItem("SSC CGL 2026 Recruitment Apply Online Before 07 Oct")
);

// ─── parseRssDate ─────────────────────────────────────────────

console.log("\n=== parseRssDate ===");

assert(
  "RFC 2822 → ISO date",
  parseRssDate("Mon, 07 Sep 2026 10:00:00 +0000") === "2026-09-07"
);
assert(
  "ISO 8601 → ISO date",
  parseRssDate("2026-09-08T14:30:00Z") === "2026-09-08"
);
assert(
  "empty string → undefined",
  parseRssDate("") === undefined
);
assert(
  "invalid string → undefined",
  parseRssDate("not a date at all") === undefined
);
assert(
  "different month → correct",
  parseRssDate("15 Jan 2026 00:00:00 GMT") === "2026-01-15"
);

// ─── Summary ─────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
