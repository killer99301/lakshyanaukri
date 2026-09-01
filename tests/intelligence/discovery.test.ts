// Phase 7: Discovery module tests (DISC1–DISC12)
//
// Tests the org-level notification discovery module.
// No network I/O, no canonical data writes. productionWrites remains 0.

import assert from "node:assert";
import type { GovernmentRecruitment, ExamStageStatus } from "@/types";
import type { MonitoredSource } from "@/intelligence/types";
import {
  extractLinks,
  extractNotificationNumber,
  isNewRecruitmentNotice,
  discoverNewRecruitments,
} from "@/intelligence/discovery";

// ─── Helpers ─────────────────────────────────────────────────

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

const SSC_SOURCE: MonitoredSource = {
  id: "ssc-org-discovery",
  name: "SSC Latest Notices",
  url: "https://ssc.gov.in/home/latestNotices",
  organizationId: "ssc",
  tier: "TIER_1",
  enabled: true,
  mode: "ORG_DISCOVERY",
};

// ─── DISC1-3: extractLinks ────────────────────────────────────

console.log("\nDISC1-3: extractLinks");

const HTML_WITH_LINKS = `
<html><body>
<a href="/docs/cgl-2026.pdf">SSC CGL 2026 Notification</a>
<a href="https://ssc.gov.in/apply">Apply Online for CGL 2026</a>
<a href="mailto:support@ssc.gov.in">Email Support</a>
<a href="#">Skip Navigation</a>
<a href="/result/cgl-2025.pdf">Check Result CGL 2025</a>
<a href="/docs/cgl-2026-dates.pdf">Last Date 15/09/2026 for CGL Apply</a>
</body></html>`;

const links = extractLinks(HTML_WITH_LINKS, "https://ssc.gov.in");
check("DISC1: extracts absolute and relative links", links.length >= 3);
check("DISC2: resolves relative href against base URL", links.some((l) => l.href === "https://ssc.gov.in/docs/cgl-2026.pdf"));
check("DISC2b: keeps absolute URLs as-is", links.some((l) => l.href === "https://ssc.gov.in/apply"));
check("DISC3: skips mailto and # hrefs", !links.some((l) => l.href.startsWith("mailto:") || l.href === "#"));

const dateLink = links.find((l) => l.href.includes("cgl-2026-dates.pdf"));
check("DISC3b: extracts nearby date in ISO format", !!dateLink?.nearbyDate && /^\d{4}-\d{2}-\d{2}$/.test(dateLink.nearbyDate));

// ─── DISC4-6: extractNotificationNumber ──────────────────────

console.log("\nDISC4-6: extractNotificationNumber");

check("DISC4: extracts 'Advt No.' format", extractNotificationNumber("Advt No. 01/2026 – SSC CGL") === "Advt No. 01/2026");
check("DISC5: extracts 'CEN-' format", extractNotificationNumber("RRB CEN-05/2024 Notification") !== undefined);
check("DISC6: returns undefined for no pattern", extractNotificationNumber("SSC CGL Examination 2026") === undefined);

// ─── DISC7-9: isNewRecruitmentNotice ─────────────────────────

console.log("\nDISC7-9: isNewRecruitmentNotice");

check("DISC7: recruitment keyword → true", isNewRecruitmentNotice("SSC CGL 2026 Recruitment Notification"));
check("DISC7b: vacancy keyword → true", isNewRecruitmentNotice("Apply for 5000 Vacancies – SSC CHSL 2026"));
check("DISC8: result keyword → false (operational)", !isNewRecruitmentNotice("SSC CGL 2025 Result Published"));
check("DISC8b: admit card → false", !isNewRecruitmentNotice("SSC CGL 2026 Admit Card Download"));
check("DISC8c: answer key → false", !isNewRecruitmentNotice("SSC CGL Answer Key Released 2026"));
check("DISC9: no keywords → false", !isNewRecruitmentNotice("SSC General Knowledge Update"));

// ─── DISC10-12: discoverNewRecruitments ──────────────────────

console.log("\nDISC10: discoverNewRecruitments — discovers new candidates from HTML");

const DISCOVERY_HTML = `
<html><body>
<ul>
  <li><a href="/docs/cgl-2026.pdf">Recruitment Notification for CGL 2026 – Advt No. 01/2026</a> (15/08/2026)</li>
  <li><a href="/docs/chsl-2026.pdf">Advertisement for CHSL 2026 – Vacancy Notice</a> (20/08/2026)</li>
  <li><a href="/result/cgl-2025-final.pdf">Final Result – CGL 2025</a></li>
  <li><a href="/admit/chsl-2025.pdf">Admit Card – CHSL 2025</a></li>
</ul>
</body></html>`;

const discovered = discoverNewRecruitments(DISCOVERY_HTML, SSC_SOURCE, [], []);
check("DISC10: discovers 2 recruitment notices (CGL and CHSL 2026)", discovered.length === 2);
check("DISC10b: discards result and admit-card links", discovered.every((c) => !c.title.includes("Result") && !c.title.includes("Admit")));
check("DISC10c: all discovered have status PENDING_REVIEW", discovered.every((c) => c.status === "PENDING_REVIEW"));
check("DISC10d: sourceIds are set correctly", discovered.every((c) => c.discoverySourceId === "ssc-org-discovery"));

console.log("\nDISC11: discoverNewRecruitments — skips canonical duplicates");

const canonicalRecord: GovernmentRecruitment = {
  id: "ssc-advtno012026",
  slug: "ssc-cgl-2026",
  type: "government",
  title: "SSC CGL Combined Graduate Level 2026",
  organizationId: "ssc",
  organizationName: "Staff Selection Commission",
  notificationNumber: "Advt No. 01/2026",
  govType: "Central Govt",
  shortDescription: "SSC CGL 2026",
  category: "ssc",
  state: "All India",
  qualification: "Graduate",
  postDate: "2026-01-15",
  totalVacancies: 17000,
  vacanciesDisplay: "17,000 Vacancies",
  examStages: [{ name: "Tier I", order: 1, status: "SCHEDULED" as ExamStageStatus, dateIso: "2026-09-01", dateDisplay: "01 Sep 2026" }],
  application: { notificationDate: "2026-01-15", openDate: "2026-02-01", closeDate: "2026-03-01" },
  links: { notification: "https://ssc.gov.in/docs/cgl-2026.pdf", apply: "https://ssc.gov.in", website: "https://ssc.gov.in" },
  provenance: { status: "VERIFIED", lastVerifiedAt: "2026-01-15", primarySourceUrl: "https://ssc.gov.in/docs/cgl-2026.pdf", primarySourceType: "OFFICIAL_NOTIFICATION" },
};

const discoveredWithCanonical = discoverNewRecruitments(DISCOVERY_HTML, SSC_SOURCE, [canonicalRecord], []);
check("DISC11: CGL (already canonical) is skipped as duplicate", discoveredWithCanonical.length === 1);
check("DISC11b: only CHSL (new) is returned", discoveredWithCanonical[0]?.title.includes("CHSL"));

console.log("\nDISC12: discoverNewRecruitments — cross-candidate dedup within same run");

// Build an in-flight candidate for the CHSL link, then verify a second call skips it
const chslHtml = `<html><body>
<a href="/docs/chsl-2026.pdf">Advertisement for CHSL 2026 – Vacancy Notice</a>
</body></html>`;

const firstRun = discoverNewRecruitments(chslHtml, SSC_SOURCE, [], []);
check("DISC12 setup: first run finds CHSL", firstRun.length === 1);

// Second discovery source returns the same CHSL notice
const secondRun = discoverNewRecruitments(chslHtml, { ...SSC_SOURCE, id: "ssc-org-discovery-2", url: "https://ssc.gov.in/home/notices2" }, [], firstRun);
check("DISC12: same notice from second source is deduped as in-flight", secondRun.length === 0);

console.log("\n✅ All DISC tests passed.\n");
