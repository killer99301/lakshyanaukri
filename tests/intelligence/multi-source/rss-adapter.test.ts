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
