// ═══════════════════════════════════════════════════════════
// Phase 8: Recruitment Intake — Test Suite
// ═══════════════════════════════════════════════════════════
//
// All tests use injected fetchFn — NO live network I/O.
// canonicalRecords and existingCandidates are mock-provided.
//
// Test IDs:
//   INT1  Official SSC URL → OFFICIAL classification, orgId=ssc
//   INT2  Official page with embedded PDF link → officialSource via link
//   INT3  Third-party URL → THIRD_PARTY, aggregator identified
//   INT4  Third-party with official link in page → officialSource found
//   INT5  Duplicate canonical recruitment → isDuplicate=true, no save
//   INT6  Unknown domain → UNKNOWN classification
//   INT7  Missing official evidence → Trust Gate fails on primarySourceUrl
//   INT8  Malformed URL → error reported, no crash
//   INT9  Incomplete notice → many missingFields, confidence low
//   INT10 Provenance safety → status always NOT_VERIFIED
//   INT11 Trust Gate rejection → errors surfaced, candidate still returned
//   INT12 Full official submission → all fields, Trust Gate passes
// ═══════════════════════════════════════════════════════════

import {
  classifySourceUrl,
  extractIntakeFields,
  runIntake,
  deriveOrgFromOfficialDomain,
  assessPdfTextQuality,
  type FetchFn,
  type FetchPdfFn,
} from "@/intelligence/intake";

// ─── Test harness ─────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(testId: string, condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testId}: ${message}`);
  } else {
    failed++;
    const msg = `  ✗ ${testId}: ${message}`;
    errors.push(msg);
    console.log(msg);
  }
}

// ─── Mock HTML fixtures ───────────────────────────────────────

const SSC_OFFICIAL_HTML = `
<html><head><title>SSC CGL 2026 Notification</title></head><body>
<h1>Combined Graduate Level Examination 2026</h1>
<p>Advertisement No.: 01/2026 | Notification Date: 01/09/2026</p>
<p>Online Application Starting Date: 15/09/2026</p>
<p>Last Date to Apply Online: 15/10/2026</p>
<p>Total Posts: 17000</p>
<a href="https://ssc.gov.in/documents/CGL-2026-notification.pdf">Download Official Notification PDF</a>
<a href="https://ssc.gov.in/apply">Apply Online</a>
</body></html>`;

const THIRD_PARTY_WITH_OFFICIAL_LINK_HTML = `
<html><head><title>SSC CGL 2026 - GovtJobGuru</title></head><body>
<h1>SSC CGL 2026 Notification</h1>
<p>Staff Selection Commission has released the CGL 2026 notification.</p>
<p>Advt No.: 01/2026 | Total Vacancies: 17000</p>
<p>Apply Online from 15/09/2026 to 15/10/2026</p>
<a href="https://ssc.gov.in/documents/CGL-2026-notification.pdf">Official Notification PDF</a>
<a href="https://govtjobguru.com/ssc-cgl-2026">Back to article</a>
</body></html>`;

const THIRD_PARTY_NO_OFFICIAL_HTML = `
<html><head><title>SSC CGL 2026 - SarkariResult</title></head><body>
<h1>SSC Combined Graduate Level 2026</h1>
<p>SSC CGL 2026 notification released. Advt No. 01/2026</p>
<p>Total Posts: 17000 | Last Date: 15/10/2026</p>
<a href="https://sarkariresult.com/ssc-cgl-2026">More details here</a>
</body></html>`;

const INCOMPLETE_HTML = `
<html><body>
<p>New recruitment notification from government department.</p>
<p>For more details visit official website.</p>
</body></html>`;

const FULL_OFFICIAL_HTML = `
<html><head><title>IBPS PO XIII 2026 Recruitment Notification</title></head><body>
<h1>IBPS PO XIII 2026 Recruitment</h1>
<p>Advt. No.: CRPS-XIII/2026</p>
<p>Notification Date: 01/09/2026</p>
<p>Online Registration Start: 10/09/2026</p>
<p>Last Date for Online Registration: 01/10/2026</p>
<p>Total Vacancies: 4455</p>
<a href="https://ibps.in/wp-content/uploads/CRP-PO-XIII.pdf">Download Notification PDF</a>
</body></html>`;

// ─── Mock fetch helpers ───────────────────────────────────────

function mockFetch(htmlByUrl: Record<string, string>): FetchFn {
  return async (url: string) => {
    const html = htmlByUrl[url];
    if (html === undefined) {
      return { ok: false, html: null, error: "URL not in mock registry" };
    }
    return { ok: true, html };
  };
}

// Minimal mock canonical record to test dedup
function makeCanonicalRecord(overrides: {
  id: string;
  slug: string;
  notificationNumber: string;
  organizationId: string;
}) {
  return {
    id: overrides.id,
    slug: overrides.slug,
    type: "government" as const,
    title: "Test Record",
    organizationId: overrides.organizationId,
    organizationName: "Test Org",
    shortDescription: "Test",
    category: "ssc" as const,
    state: "All India",
    qualification: "Graduate" as const,
    postDate: "2026-01-01",
    notificationNumber: overrides.notificationNumber,
    govType: "Central Govt" as const,
    totalVacancies: 100,
    vacanciesDisplay: "100 Vacancies",
    application: { notificationDate: "2026-01-01", openDate: "2026-01-10", closeDate: "2026-02-10" },
    examStages: [{ name: "Prelims", order: 1, status: "SCHEDULED" as const }],
    links: { apply: "https://ssc.gov.in", website: "https://ssc.gov.in" },
    provenance: {
      status: "VERIFIED" as const,
      lastVerifiedAt: "2026-01-01",
      primarySourceUrl: "https://ssc.gov.in/notification.pdf",
      primarySourceType: "OFFICIAL_NOTIFICATION" as const,
    },
  };
}

// ─── INT1: Official SSC URL ───────────────────────────────────

async function testINT1() {
  console.log("\nINT1 — Official SSC URL → OFFICIAL classification, orgId=ssc");

  const result = await runIntake("https://ssc.gov.in/cgl-2026", {
    fetchFn: mockFetch({ "https://ssc.gov.in/cgl-2026": SSC_OFFICIAL_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("INT1.1", result.classification.kind === "OFFICIAL", "kind = OFFICIAL");
  assert("INT1.2", result.classification.orgId === "ssc", "orgId = ssc");
  assert("INT1.3", result.officialSource.found === true, "officialSource.found = true");
  assert("INT1.4", result.officialSource.method === "submitted-url", "method = submitted-url");
  assert("INT1.5", result.candidate !== null, "candidate is not null");
  assert("INT1.6", result.candidate?.organizationId === "ssc", "candidate.organizationId = ssc");
  assert("INT1.7", result.isDuplicate === false, "not a duplicate");
  assert("INT1.8", !result.error, "no error");
}

// ─── INT2: Third-party page with embedded official PDF link ───

async function testINT2() {
  console.log("\nINT2 — Third-party page with official PDF link in page content");

  const result = await runIntake("https://govtjobguru.com/ssc-cgl-2026/", {
    fetchFn: mockFetch({ "https://govtjobguru.com/ssc-cgl-2026/": THIRD_PARTY_WITH_OFFICIAL_LINK_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("INT2.1", result.classification.kind === "THIRD_PARTY", "kind = THIRD_PARTY");
  assert("INT2.2", result.classification.aggregatorName === "GovtJobGuru", "aggregator = GovtJobGuru");
  assert("INT2.3", result.officialSource.found === true, "official source found via in-page link");
  assert("INT2.4", result.officialSource.method === "official-link-in-page", "method = official-link-in-page");
  assert("INT2.5", result.officialSource.url?.includes("ssc.gov.in"), "official URL is ssc.gov.in");
  assert("INT2.6", result.classification.isDiscoveryLeadOnly === true, "isDiscoveryLeadOnly = true");
  assert("INT2.7", result.candidate !== null, "candidate is not null");
}

// ─── INT3: Third-party URL classification ─────────────────────

async function testINT3() {
  console.log("\nINT3 — Third-party URL → THIRD_PARTY, aggregator identified");

  const cls = classifySourceUrl("https://sarkariresult.com/ssc-chsl-2026/");
  assert("INT3.1", cls.kind === "THIRD_PARTY", "kind = THIRD_PARTY");
  assert("INT3.2", cls.aggregatorName === "SarkariResult", "aggregator = SarkariResult");
  assert("INT3.3", cls.isDiscoveryLeadOnly === true, "isDiscoveryLeadOnly = true");
  assert("INT3.4", cls.orgId === undefined, "no orgId (not official)");
}

// ─── INT4: Third-party without official link → officialSource not found ─

async function testINT4() {
  console.log("\nINT4 — Third-party URL, no official links in page");

  const result = await runIntake("https://sarkariresult.com/ssc-cgl-2026/", {
    fetchFn: mockFetch({ "https://sarkariresult.com/ssc-cgl-2026/": THIRD_PARTY_NO_OFFICIAL_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("INT4.1", result.officialSource.found === false, "officialSource.found = false");
  assert("INT4.2", result.officialSource.method === "none", "method = none");
  assert("INT4.3", result.candidate !== null, "candidate still created (for queue)");
  assert("INT4.4", result.missingFields.includes("provenance.primarySourceUrl"), "primarySourceUrl in missingFields");
  assert("INT4.5", result.trustGatePassed === false, "Trust Gate fails (no official source)");
}

// ─── INT5: Duplicate canonical recruitment ────────────────────

async function testINT5() {
  console.log("\nINT5 — Duplicate detection against canonical record");

  // extractNotificationNumber("SSC CGL 2026 Notification") → "CGL 2026" (via NOTIF_RE[4])
  // normalizeNotificationNumber("CGL 2026") → "CGL2026"
  // The canonical record must use "CGL 2026" so the dedup Signal 2 fires
  const canonical = makeCanonicalRecord({
    id: "ssc-notif-cgl-2026",
    slug: "ssc-cgl-2026",
    notificationNumber: "CGL 2026",
    organizationId: "ssc",
  });

  const result = await runIntake("https://ssc.gov.in/cgl-2026", {
    fetchFn: mockFetch({ "https://ssc.gov.in/cgl-2026": SSC_OFFICIAL_HTML }),
    canonicalRecords: [canonical],
    existingCandidates: [],
  });

  assert("INT5.1", result.isDuplicate === true, "isDuplicate = true");
  assert("INT5.2", result.duplicateReason !== undefined, "duplicateReason provided");
  assert("INT5.3", result.draft === null, "no draft built for duplicate");
  assert("INT5.4", result.candidateSaved === false, "candidate not saved");
}

// ─── INT6: Unknown domain ──────────────────────────────────────

async function testINT6() {
  console.log("\nINT6 — Unknown domain → UNKNOWN classification");

  const cls = classifySourceUrl("https://randomjobsite.xyz/rrb-ntpc-2026/");
  assert("INT6.1", cls.kind === "UNKNOWN", "kind = UNKNOWN");
  assert("INT6.2", cls.isDiscoveryLeadOnly === true, "isDiscoveryLeadOnly = true");
  assert("INT6.3", cls.orgId === undefined, "no orgId");
  assert("INT6.4", cls.aggregatorName === undefined, "no aggregatorName");
}

// ─── INT7: Missing official evidence → Trust Gate fails ───────

async function testINT7() {
  console.log("\nINT7 — Missing official evidence → Trust Gate fails on primarySourceUrl");

  const result = await runIntake("https://sarkariresult.com/ssc-cgl-2026/", {
    fetchFn: mockFetch({ "https://sarkariresult.com/ssc-cgl-2026/": THIRD_PARTY_NO_OFFICIAL_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("INT7.1", result.officialSource.found === false, "no official source");
  assert("INT7.2", result.trustGatePassed === false, "Trust Gate fails");
  assert("INT7.3", result.trustGateErrors.length > 0, "Trust Gate errors present");
  assert("INT7.4", result.candidate !== null, "candidate returned (for editing)");
  assert("INT7.5", result.draft !== null, "draft returned (so user can inspect)");
}

// ─── INT8: Malformed URL ──────────────────────────────────────

async function testINT8() {
  console.log("\nINT8 — Malformed URL → error reported, no crash");

  const result = await runIntake("not-a-valid-url", {
    fetchFn: mockFetch({}),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("INT8.1", result.error !== undefined, "error is set");
  assert("INT8.2", result.candidate === null, "candidate is null");
  assert("INT8.3", result.draft === null, "draft is null");
  assert("INT8.4", result.trustGatePassed === false, "trustGatePassed = false");
}

// ─── INT9: Incomplete notice ──────────────────────────────────

async function testINT9() {
  console.log("\nINT9 — Incomplete notice → many missingFields, low confidence");

  const result = await runIntake("https://upsc.gov.in/some-notice", {
    fetchFn: mockFetch({ "https://upsc.gov.in/some-notice": INCOMPLETE_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("INT9.1", result.classification.kind === "OFFICIAL", "classified as OFFICIAL (upsc.gov.in)");
  assert("INT9.2", result.extraction.confidence < 0.5, "confidence < 0.5 (insufficient data)");
  assert("INT9.3", result.missingFields.includes("notificationNumber"), "notificationNumber in missingFields");
  assert("INT9.4", result.missingFields.includes("application.openDate"), "openDate in missingFields");
  assert("INT9.5", result.missingFields.includes("application.closeDate"), "closeDate in missingFields");
}

// ─── INT10: Provenance preservation ──────────────────────────

async function testINT10() {
  console.log("\nINT10 — Provenance: status is always NOT_VERIFIED");

  const result = await runIntake("https://ibps.in/po-2026", {
    fetchFn: mockFetch({ "https://ibps.in/po-2026": FULL_OFFICIAL_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("INT10.1", result.draft !== null, "draft created");
  assert("INT10.2", result.draft?.provenance.status === "NOT_VERIFIED", "provenance.status = NOT_VERIFIED");
  assert("INT10.3", result.draft?.provenance.status !== "VERIFIED", "never VERIFIED");
  assert("INT10.4", result.draft?.provenance.status !== "PARTIALLY_VERIFIED", "never PARTIALLY_VERIFIED");
}

// ─── INT11: Trust Gate rejection (empty notificationNumber) ───

async function testINT11() {
  console.log("\nINT11 — Trust Gate rejection when notificationNumber is missing");

  const result = await runIntake("https://upsc.gov.in/notice", {
    fetchFn: mockFetch({ "https://upsc.gov.in/notice": INCOMPLETE_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // officialSource is found (upsc.gov.in is official) but notificationNumber is empty
  assert("INT11.1", result.officialSource.found === true, "official source found");
  assert("INT11.2", result.trustGatePassed === false, "Trust Gate fails (empty notificationNumber)");
  assert("INT11.3", result.candidate !== null, "candidate returned for editing");
  assert("INT11.4", result.trustGateErrors.length > 0, "errors are surfaced");
}

// ─── INT12: Full official submission ─────────────────────────

async function testINT12() {
  console.log("\nINT12 — Full IBPS official page: fields extracted, provenance correct");

  const result = await runIntake("https://ibps.in/po-2026-notification", {
    fetchFn: mockFetch({ "https://ibps.in/po-2026-notification": FULL_OFFICIAL_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("INT12.1", result.classification.kind === "OFFICIAL", "OFFICIAL classification");
  assert("INT12.2", result.classification.orgId === "ibps", "orgId = ibps");
  assert("INT12.3", result.officialSource.found === true, "official source found");
  assert("INT12.4", result.extraction.notificationNumber !== undefined, "notificationNumber extracted");
  assert("INT12.5", result.extraction.totalVacancies === 4455, "vacancies = 4455");
  assert("INT12.6", result.extraction.applicationCloseDate !== undefined, "closeDate extracted");
  assert("INT12.7", result.draft?.provenance.status === "NOT_VERIFIED", "draft status NOT_VERIFIED");
  assert("INT12.8", result.candidate?.status === "PENDING_REVIEW", "candidate status PENDING_REVIEW");
  assert("INT12.9", result.isDuplicate === false, "not a duplicate");
}

// ─── Field extraction unit tests ─────────────────────────────

function testFieldExtraction() {
  console.log("\nINT-FE — extractIntakeFields unit tests");

  const ex = extractIntakeFields(SSC_OFFICIAL_HTML, "https://ssc.gov.in/cgl-2026");

  assert("INTFE.1", ex.title?.includes("CGL 2026") ?? false, "title extracted from <title>");
  assert("INTFE.2", ex.notificationNumber !== undefined, "notificationNumber extracted");
  assert("INTFE.3", ex.totalVacancies === 17000, "vacancies = 17000");
  assert("INTFE.4", ex.applicationCloseDate !== undefined, "closeDate extracted");
  assert("INTFE.5", ex.applicationOpenDate !== undefined, "openDate extracted");
  assert("INTFE.6", ex.notifPdfUrl?.includes(".pdf") ?? false, "PDF link found");
  assert("INTFE.7", ex.officialLinksFound.some((u) => u.includes("ssc.gov.in")), "official links found");
}

// ─── TBA date sentinel test ────────────────────────────────────

async function testTBADates() {
  console.log("\nINT-TBA — Missing dates must be 'TBA' not today");

  const result = await runIntake("https://upsc.gov.in/notice", {
    fetchFn: mockFetch({ "https://upsc.gov.in/notice": INCOMPLETE_HTML }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  const today = new Date().toISOString().slice(0, 10);

  assert("INTTBA.1", result.draft?.application.openDate !== today, "openDate is NOT today");
  assert("INTTBA.2", result.draft?.application.closeDate !== today, "closeDate is NOT today");
  assert("INTTBA.3", result.draft?.application.openDate === "TBA", "openDate = TBA");
  assert("INTTBA.4", result.draft?.application.closeDate === "TBA", "closeDate = TBA");
  // notificationDate is undefined when not extracted — not fabricated as today or "TBA"
  assert("INTTBA.5", result.draft?.application.notificationDate === undefined, "notificationDate = undefined (not fabricated)");
}

// ─── Phase 8B: BCECE fixtures ────────────────────────────────
//
// Simulates a govtjobguru.in page that has:
//  - BCECE content in the title/h1/body
//  - Unrelated RRB ads/links in the sidebar (the bug source)
//  - Official links to bceceboard.bihar.gov.in
//
const GOVTJOBGURU_BCECE_HTML = `
<html>
<head><title>BCECE BSFC Recruitment 2026 - GovtJobGuru</title></head>
<body>
<nav>
  <a href="/rrb-ntpc-2024">RRB NTPC 2024</a>
  <a href="/ssc-cgl-2026">SSC CGL 2026</a>
</nav>
<main>
  <h1>BCECE BSFC Recruitment 2026</h1>
  <p>Bihar State Food &amp; Civil Supplies Corporation Ltd (BSFC) has released recruitment notification 2026. Total 259 posts available.</p>
  <p>Apply online from 25 Aug 2026 to 24 Sep 2026.</p>
  <a href="https://bceceboard.bihar.gov.in">Official Website</a>
  <a href="https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf">Download Official PDF</a>
</main>
<aside class="sidebar">
  <h3>Related Jobs</h3>
  <a href="/rrb-group-d">Railway Recruitment Board Group D</a>
  <a href="https://indianrailways.gov.in">Indian Railways Official</a>
  <p>Railway Recruitment Board RRB NTP 2024 Notification Released.</p>
</aside>
<footer>
  <a href="/rrb-ntpc-2024">RRB NTPC 2024 Application</a>
</footer>
</body>
</html>`;

// The official BCECE Board page with full recruitment details
const BCECEBOARD_OFFICIAL_HTML = `
<html>
<head><title>BCECE Board - BSFC Recruitment 2026</title></head>
<body>
<h1>BCECE Board Recruitment Notification</h1>
<p>Advertisement No.: BCECEB(BSFC)-2026/01</p>
<p>Advertisement Date: 24/08/2026</p>
<p>Total Posts: 259</p>
<p>Online Registration Start Date: 25/08/2026</p>
<p>Last Date for Online Registration: 24/09/2026</p>
<table>
  <tr><td>Assistant Manager</td><td>81</td></tr>
  <tr><td>Assistant Account Officer</td><td>6</td></tr>
  <tr><td>Accountant</td><td>11</td></tr>
  <tr><td>Quality Controller</td><td>38</td></tr>
  <tr><td>Lower Division Clerk</td><td>123</td></tr>
</table>
<a href="https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf">Download Official Notification PDF</a>
</body>
</html>`;

// ─── Phase 8B: Aggregator classification tests ───────────────

function testAGG() {
  console.log("\nAGG — All 5 new aggregator domains → THIRD_PARTY");

  // Domains added in Phase 8B
  const domains = [
    { url: "https://govtjobguru.in/jobs/bcece-bsfc-2026/", name: "GovtJobGuru" },
    { url: "https://freejobalert.com/bcece-board/",        name: "FreeJobAlert" },
    { url: "https://adda247.com/exams/bcece/",             name: "Adda247" },
    { url: "https://sarkarinaukariofficial.com/bcece/",    name: "SarkariNaukriOfficial" },
    { url: "https://govtjobs.io/bcece-bsfc/",             name: "GovtJobsIO" },
  ];

  for (const { url, name } of domains) {
    const cls = classifySourceUrl(url);
    assert(`AGG-${name}.1`, cls.kind === "THIRD_PARTY", `${name}: kind = THIRD_PARTY`);
    assert(`AGG-${name}.2`, cls.aggregatorName === name,  `${name}: aggregatorName = ${name}`);
    assert(`AGG-${name}.3`, cls.isDiscoveryLeadOnly === true, `${name}: isDiscoveryLeadOnly = true`);
    assert(`AGG-${name}.4`, cls.orgId === undefined, `${name}: no orgId (not official)`);
  }

  // govtjobguru.com also still works (pre-existing)
  const old = classifySourceUrl("https://govtjobguru.com/ssc-cgl-2026/");
  assert("AGG-govtjobguru-com", old.kind === "THIRD_PARTY", "govtjobguru.com still THIRD_PARTY");
}

// ─── Phase 8B: BCECE org identification regression ───────────

async function testBCECE_ORG() {
  console.log("\nBCECE-ORG — Org must NOT be RRB despite RRB links in sidebar");

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("BCECE-ORG.1", result.classification.kind === "THIRD_PARTY", "govtjobguru.in = THIRD_PARTY");
  assert("BCECE-ORG.2", result.candidate?.organizationId !== "rrb", "org is NOT rrb");
  assert("BCECE-ORG.3", result.candidate?.organizationId === "bceceboard", "org = bceceboard");
  assert("BCECE-ORG.4", result.candidate?.organizationName === "BCECE Board", "orgName = BCECE Board");
  assert("BCECE-ORG.5", !result.error, "no error");
}

// ─── Phase 8B: Official BCECE link discovered ────────────────

async function testBCECE_LINK() {
  console.log("\nBCECE-LINK — Official BCECE link discovered from govtjobguru page");

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("BCECE-LINK.1", result.officialSource.found === true, "official source found");
  assert("BCECE-LINK.2", result.officialSource.method === "official-link-in-page", "found via in-page link");
  assert("BCECE-LINK.3", result.officialSource.url?.includes("bceceboard.bihar.gov.in") ?? false, "official URL = bceceboard");
  assert("BCECE-LINK.4", result.extraction.officialLinksFound.some((u) => u.includes("bceceboard")), "bceceboard in officialLinksFound");
}

// ─── Phase 8B: Two-stage extraction (Stage B overrides Stage A) ──

async function testBCECE_TWOSTAGE() {
  console.log("\nBCECE-2STAGE — Stage B (official page) fields override Stage A (third-party)");

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Official page has 259 vacancies — should come from Stage B
  assert("BCECE-2STAGE.1", result.extraction.totalVacancies === 259, "vacancies = 259 (from official page)");
  // OFFICIAL_GENERIC (root-path homepage) must not supply postDate — Stage A had none.
  // postDate will be filled by Stage C (PDF) in a full pipeline, but not by Stage B alone.
  assert("BCECE-2STAGE.2", result.extraction.postDate === undefined,
    "postDate = undefined — OFFICIAL_GENERIC cannot supply recruitment-specific dates");
  // Official page has application open 25/08/2026
  assert("BCECE-2STAGE.3", result.extraction.applicationOpenDate === "2026-08-25", "open date = 2026-08-25");
  // Official page has close date 24/09/2026
  assert("BCECE-2STAGE.4", result.extraction.applicationCloseDate === "2026-09-24", "close date = 2026-09-24");
  // PDF URL found
  assert("BCECE-2STAGE.5", result.extraction.notifPdfUrl?.includes("PROS_BSFC26.pdf") ?? false, "PDF URL found");
  // officialPageExtraction populated
  assert("BCECE-2STAGE.6", result.officialPageExtraction !== undefined, "officialPageExtraction populated");
}

// ─── Phase 8B: Evidence chain preserved ─────────────────────

async function testBCECE_CHAIN() {
  console.log("\nBCECE-CHAIN — Evidence chain: THIRD_PARTY → OFFICIAL → OFFICIAL_PDF");

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("BCECE-CHAIN.1", result.evidenceChain.length >= 2, "evidence chain has ≥2 steps");
  assert("BCECE-CHAIN.2", result.evidenceChain[0].sourceKind === "THIRD_PARTY", "step 0 = THIRD_PARTY");
  assert("BCECE-CHAIN.3", result.evidenceChain.some((s) => (s.sourceKind as string).startsWith("OFFICIAL")), "chain includes OFFICIAL step (OFFICIAL_GENERIC or OFFICIAL_SPECIFIC)");
  assert("BCECE-CHAIN.4", result.evidenceChain.some((s) => s.sourceKind === "OFFICIAL_PDF"), "chain includes OFFICIAL_PDF");
}

// ─── Phase 8B: No production writes ─────────────────────────

async function testNO_WRITES() {
  console.log("\nNO-WRITES — candidateSaved = false always (production write guard)");

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // runIntake never sets candidateSaved = true (only scripts/intake.ts does, after explicit save)
  assert("NO-WRITES.1", result.candidateSaved === false, "candidateSaved = false");
  // Draft is NOT_VERIFIED — cannot reach production
  assert("NO-WRITES.2", result.draft?.provenance.status === "NOT_VERIFIED", "draft status = NOT_VERIFIED");
}

// ─── Phase 8B: Third-party primary source blocked ────────────

async function testPROVENANCE_GUARD() {
  console.log("\nPROV-GUARD — Third-party URL never becomes primarySourceUrl");

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      // No official page mock — Stage B fails gracefully
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  const primary = result.draft?.provenance.primarySourceUrl;
  // Must be official (bceceboard.bihar.gov.in) or undefined — never govtjobguru.in
  assert("PROV-GUARD.1",
    primary === undefined || !primary.includes("govtjobguru"),
    "primarySourceUrl is not govtjobguru"
  );
  // The official link is set even when Stage B fetch fails
  assert("PROV-GUARD.2", result.officialSource.found === true, "official source still found from link");
}

// ─── Phase 8B: deriveOrgFromOfficialDomain unit tests ────────

function testDERIVE_ORG() {
  console.log("\nDERIVE-ORG — deriveOrgFromOfficialDomain unit tests");

  const bcece = deriveOrgFromOfficialDomain("bceceboard.bihar.gov.in");
  assert("DERIVE-ORG.1", bcece !== undefined, "bceceboard.bihar.gov.in → defined");
  assert("DERIVE-ORG.2", bcece?.orgId === "bceceboard", "orgId = bceceboard");
  assert("DERIVE-ORG.3", bcece?.orgName === "BCECE Board", "orgName = BCECE Board");
  assert("DERIVE-ORG.4", bcece?.govType === "State Govt", "govType = State Govt");

  const ssc = deriveOrgFromOfficialDomain("ssc.gov.in");
  assert("DERIVE-ORG.5", ssc?.orgId === "ssc", "ssc.gov.in → ssc");
  assert("DERIVE-ORG.6", ssc?.govType === "Central Govt", "ssc govType = Central Govt");

  const unknown = deriveOrgFromOfficialDomain("govtjobguru.in");
  assert("DERIVE-ORG.7", unknown === undefined, "govtjobguru.in → undefined (not official)");
}

// ─── Phase 8C: PDF extraction fixtures ───────────────────────
//
// Simulates the plain text that pdf-parse would extract from the
// BCECE BSFC 2026 official notification PDF at:
//   https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf
//
// Fields present in PDF (highest authority):
//   • Advertisement No. BCECEB(BSFC)-2026/01
//   • Advertisement Date: 24/08/2026
//   • Total Posts: 259
//   • Post-wise breakdown: AM=81, AAO=6, Acct=11, QC=38, LDC=123
//   • Registration Start: 25/08/2026
//   • Last Date: 24/09/2026
//   • Fee deadline: 25/09/2026
//   • Correction window: 26/09/2026 to 28/09/2026
const BCECE_PDF_TEXT = `
BIHAR COMBINED ENTRANCE COMPETITIVE EXAMINATION BOARD (BCECEB)
BSFC RECRUITMENT 2026

Advertisement No.: BCECEB(BSFC)-2026/01
Advertisement Date: 24/08/2026

BIHAR STATE FOOD & CIVIL SUPPLIES CORPORATION LTD (BSFC)
Online applications are invited for the following posts:

Post-wise Vacancies:
1. Assistant Manager (General/Technical) : 81
2. Assistant Account Officer             : 6
3. Accountant                            : 11
4. Quality Controller                    : 38
5. Lower Division Clerk (LDC)            : 123
Total Posts: 259

IMPORTANT DATES:
Online Registration Start Date : 25/08/2026
Last Date for Online Registration : 24/09/2026
Last Date for Online Fee Payment : 25/09/2026
Correction Window : 26/09/2026 to 28/09/2026
`;

// Helper to build a mock FetchPdfFn that returns text for a given URL
function mockFetchPdf(textByUrl: Record<string, string>): FetchPdfFn {
  return async (url: string) => {
    const text = textByUrl[url];
    if (text === undefined) return { ok: false, text: null, error: "URL not in mock PDF registry" };
    return { ok: true, text };
  };
}

// ─── Phase 8C: testPDF_NOTIF_NUMBER ──────────────────────────
// Verify that extractNotificationNumber (via extractIntakeFields) correctly
// extracts the compound BCECEB(BSFC)-2026/01 format from plain text.

function testPDF_NOTIF_NUMBER() {
  console.log("\nPDF-NOTIF — extractIntakeFields extracts BCECEB(BSFC)-2026/01 from PDF text");

  const extraction = extractIntakeFields(BCECE_PDF_TEXT, "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf");

  assert("PDF-NOTIF.1", extraction.notificationNumber !== undefined, "notificationNumber extracted");
  assert("PDF-NOTIF.2",
    extraction.notificationNumber?.includes("BCECEB") === true,
    `notificationNumber includes BCECEB (got: ${extraction.notificationNumber})`
  );
  assert("PDF-NOTIF.3",
    extraction.totalVacancies === 259,
    `totalVacancies = 259 (got: ${extraction.totalVacancies})`
  );
  assert("PDF-NOTIF.4",
    extraction.applicationOpenDate === "2026-08-25",
    `applicationOpenDate = 2026-08-25 (got: ${extraction.applicationOpenDate})`
  );
  assert("PDF-NOTIF.5",
    extraction.applicationCloseDate === "2026-09-24",
    `applicationCloseDate = 2026-09-24 (got: ${extraction.applicationCloseDate})`
  );
  assert("PDF-NOTIF.6",
    extraction.postDate === "2026-08-24",
    `postDate (advertisement date) = 2026-08-24 (got: ${extraction.postDate})`
  );
}

// ─── Phase 8C: testPDF_STAGEС ─────────────────────────────────
// End-to-end: third-party URL → Stage A → Stage B (official page) →
// Stage C (PDF) → PDF fields override HTML fields in final extraction.

async function testPDF_STAGEC() {
  console.log("\nPDF-STAGEC — Stage C PDF extraction overrides Stage B HTML fields");

  const PDF_URL = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

  // Stage B HTML has some fields but the PDF should win
  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: BCECE_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("PDF-STAGEC.1", result.pdfExtraction !== undefined, "pdfExtraction is present");
  assert("PDF-STAGEC.2",
    result.extraction.notificationNumber?.includes("BCECEB") === true,
    `final notificationNumber includes BCECEB (got: ${result.extraction.notificationNumber})`
  );
  assert("PDF-STAGEC.3",
    result.extraction.totalVacancies === 259,
    `final totalVacancies = 259 (got: ${result.extraction.totalVacancies})`
  );
  assert("PDF-STAGEC.4",
    result.extraction.applicationOpenDate === "2026-08-25",
    `final applicationOpenDate = 2026-08-25 (got: ${result.extraction.applicationOpenDate})`
  );
  assert("PDF-STAGEC.5",
    result.extraction.applicationCloseDate === "2026-09-24",
    `final applicationCloseDate = 2026-09-24 (got: ${result.extraction.applicationCloseDate})`
  );
  assert("PDF-STAGEC.6",
    result.extraction.postDate === "2026-08-24",
    `final postDate = 2026-08-24 (got: ${result.extraction.postDate})`
  );
}

// ─── Phase 8C: testPDF_CHAIN ──────────────────────────────────
// Evidence chain must have THIRD_PARTY → OFFICIAL → OFFICIAL_PDF steps.
// OFFICIAL_PDF step must list fields it contributed.

async function testPDF_CHAIN() {
  console.log("\nPDF-CHAIN — evidence chain includes OFFICIAL_PDF step with fieldsContributed");

  const PDF_URL = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: BCECE_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  const chain = result.evidenceChain;
  const pdfStep = chain.find((s) => s.sourceKind === "OFFICIAL_PDF");

  assert("PDF-CHAIN.1", chain.some((s) => s.sourceKind === "THIRD_PARTY"), "chain has THIRD_PARTY step");
  assert("PDF-CHAIN.2", chain.some((s) => (s.sourceKind as string).startsWith("OFFICIAL") && s.sourceKind !== "OFFICIAL_PDF"), "chain has OFFICIAL step (OFFICIAL_GENERIC or OFFICIAL_SPECIFIC)");
  assert("PDF-CHAIN.3", pdfStep !== undefined, "chain has OFFICIAL_PDF step");
  assert("PDF-CHAIN.4",
    pdfStep !== undefined && pdfStep.url.includes("PROS_BSFC26.pdf"),
    "OFFICIAL_PDF step URL is the BCECE PDF"
  );
  assert("PDF-CHAIN.5",
    pdfStep !== undefined && pdfStep.fieldsContributed.length > 0,
    `OFFICIAL_PDF step has fieldsContributed (got: [${pdfStep?.fieldsContributed.join(", ")}])`
  );
}

// ─── Phase 8C: testPDF_GRACEFUL_FAIL ─────────────────────────
// When PDF fetch returns { ok: false }, intake falls back to
// Stage A+B data without crashing. candidateSaved remains false.

async function testPDF_GRACEFUL_FAIL() {
  console.log("\nPDF-GRACEFUL — PDF fetch failure falls back to HTML data gracefully");

  const failPdfFn: FetchPdfFn = async () => ({
    ok: false,
    text: null,
    error: "Connection timeout (simulated for test)",
  });

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: failPdfFn,
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Stage C must not crash — result is still valid
  assert("PDF-GRACEFUL.1", !result.error, "no fatal error when PDF fails");
  assert("PDF-GRACEFUL.2", result.pdfExtraction === undefined, "pdfExtraction is undefined on failure");
  // Stage A (third-party) vacancies survive (OFFICIAL_GENERIC stage B cannot supply them)
  assert("PDF-GRACEFUL.3",
    result.extraction.totalVacancies === 259,
    `Stage A vacancies preserved on PDF failure (got: ${result.extraction.totalVacancies})`
  );
  assert("PDF-GRACEFUL.4", result.candidateSaved === false, "candidateSaved remains false");
  // At least one analysis note mentions the PDF failure
  assert("PDF-GRACEFUL.5",
    result.analysisNotes.some((n) => n.toLowerCase().includes("stage c") && n.toLowerCase().includes("fail")),
    "analysisNotes mentions Stage C PDF failure"
  );
}

// ─── Phase 8C: testPDF_NO_WRITES ─────────────────────────────
// PDF extraction must never trigger a write to government.ts or
// set candidateSaved = true.

async function testPDF_NO_WRITES() {
  console.log("\nPDF-NO-WRITES — PDF extraction is read-only, candidateSaved never set by runIntake");

  const PDF_URL = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: BCECE_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("PDF-NO-WRITES.1", result.candidateSaved === false, "candidateSaved = false (read-only)");
  assert("PDF-NO-WRITES.2",
    result.draft?.provenance.status === "NOT_VERIFIED",
    "provenance.status = NOT_VERIFIED"
  );
}

// ─── Phase 8C: testPDF_PROVENANCE ────────────────────────────
// primarySourceUrl must be the official bceceboard.bihar.gov.in
// domain — never the PDF-parse library URL or the aggregator URL.

async function testPDF_PROVENANCE() {
  console.log("\nPDF-PROV — primarySourceUrl is official bceceboard domain, not aggregator or PDF parse artifact");

  const PDF_URL = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: BCECE_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  const primary = result.draft?.provenance.primarySourceUrl ?? "";
  assert("PDF-PROV.1",
    primary.includes("bceceboard.bihar.gov.in"),
    `primarySourceUrl is bceceboard domain (got: ${primary})`
  );
  assert("PDF-PROV.2",
    !primary.includes("govtjobguru"),
    "primarySourceUrl does not contain govtjobguru"
  );
}

// ─── Phase 8D: Source Specificity Regression Fixtures ────────
//
// These fixtures specifically test the architectural fix that prevents
// a generic org homepage (specificity ≈ 0) from overwriting recruitment-
// specific data extracted from a more specific source (specificity > 0).

// Third-party page specifically about "ABC Board Recruitment 2026".
// Links directly to the correct official PDF on abcboard.gov.in.
const SPECIFIC_THIRD_PARTY_HTML_SD = `
<html>
<head><title>ABC Board Recruitment 2026 Notification</title></head>
<body>
<h1>ABC Board Recruitment 2026</h1>
<p>ABC Board announces 150 posts.</p>
<p>Online Registration Start Date: 01/10/2026. Last Date: 31/10/2026.</p>
<a href="https://abcboard.gov.in">Official Website</a>
<a href="https://abcboard.gov.in/pdfs/ABC-RECRUIT-2026.pdf">Official Notification PDF</a>
</body></html>`;

// Generic official homepage — different (unrelated) PDF, no recruitment-specific data.
const GENERIC_OFFICIAL_HOMEPAGE_SD = `
<html>
<head><title>ABC Board — Official Portal</title></head>
<body>
<h1>ABC Board</h1>
<p>Welcome to the official portal.</p>
<a href="https://abcboard.gov.in/pdfs/ANNUAL-REPORT-2025.pdf">Annual Report 2025</a>
</body></html>`;

// Homepage where "2026 posts" text would previously produce totalVacancies=2026.
const YEAR_AS_VACANCY_HTML = `
<html>
<head><title>Official Portal 2026</title></head>
<body>
<h1>Official Board Portal</h1>
<p>This portal manages 2026 posts notifications for the 2026-27 academic year.</p>
</body></html>`;

// Page with multiple official PDFs — NTPC PDF should rank first for NTPC context.
const MULTI_PDF_RANKING_HTML = `
<html>
<head><title>RRB NTPC 2026 Recruitment Notification</title></head>
<body>
<h1>RRB NTPC 2026</h1>
<p>Railway Recruitment Board NTPC 2026. Total 8113 vacancies. Last Date: 15/10/2026.</p>
<a href="https://rrbapply.gov.in/pdfs/NTPC-2026-notification.pdf">NTPC 2026 Official PDF</a>
<a href="https://rrbapply.gov.in/pdfs/GDCAT-2024-old.pdf">Old Group D Notification</a>
<a href="https://rrbapply.gov.in/pdfs/RRB-Annual-Report.pdf">Annual Report</a>
</body></html>`;

// ─── Phase 8D: Case A+B — recruitment-specific PDF preserved over homepage PDF ──

async function testSPEC_PDF_SPECIFICITY() {
  console.log("\nSPEC-PDF — Stage A recruitment-specific PDF preserved over generic homepage PDF");

  const result = await runIntake("https://jobsite.com/abc-board-2026/", {
    fetchFn: mockFetch({
      "https://jobsite.com/abc-board-2026/":  SPECIFIC_THIRD_PARTY_HTML_SD,
      "https://abcboard.gov.in":              GENERIC_OFFICIAL_HOMEPAGE_SD,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Stage A notifPdfUrl (ABC-RECRUIT-2026.pdf) must survive Stage B merge
  assert("SPEC-PDF.1",
    result.extraction.notifPdfUrl?.includes("ABC-RECRUIT-2026") === true,
    `recruitment-specific PDF preserved from Stage A (got: ${result.extraction.notifPdfUrl})`
  );
  assert("SPEC-PDF.2",
    result.extraction.notifPdfUrl?.includes("ANNUAL-REPORT") !== true,
    "generic homepage PDF not used"
  );
  assert("SPEC-PDF.3",
    result.extraction.totalVacancies === 150,
    `vacancies = 150 from Stage A, not overwritten (got: ${result.extraction.totalVacancies})`
  );
  assert("SPEC-PDF.4",
    result.extraction.applicationCloseDate === "2026-10-31",
    `closeDate from Stage A preserved (got: ${result.extraction.applicationCloseDate})`
  );
}

// ─── Phase 8D: Case C — year text must never become totalVacancies ──

function testSPEC_YEAR_VACANCY() {
  console.log("\nSPEC-YEAR — Year text '2026 posts' never extracted as totalVacancies");

  const extraction = extractIntakeFields(YEAR_AS_VACANCY_HTML, "https://official.gov.in");

  assert("SPEC-YEAR.1",
    extraction.totalVacancies === undefined,
    `year 2026 not extracted as vacancies (got: ${extraction.totalVacancies})`
  );
  assert("SPEC-YEAR.2",
    extraction.specificity === 0,
    `specificity = 0 for page with no recruitment signals (got: ${extraction.specificity})`
  );
}

// ─── Phase 8D: Case D — multiple official PDFs ranked by relevance ──

function testSPEC_PDF_RANKING() {
  console.log("\nSPEC-RANK — Multiple official PDFs: NTPC PDF wins for NTPC page context");

  const extraction = extractIntakeFields(MULTI_PDF_RANKING_HTML, "https://rrbapply.gov.in/ntpc-2026");

  assert("SPEC-RANK.1",
    extraction.notifPdfUrl?.includes("NTPC") === true,
    `NTPC PDF ranked first (got: ${extraction.notifPdfUrl})`
  );
  assert("SPEC-RANK.2",
    extraction.notifPdfUrl?.includes("Annual") !== true,
    "Annual Report PDF not selected"
  );
  assert("SPEC-RANK.3",
    extraction.totalVacancies === 8113,
    `vacancies = 8113 (got: ${extraction.totalVacancies})`
  );
}

// ─── Phase 8D: Case E — fieldSources provenance per field ─────

async function testSPEC_FIELD_SOURCES() {
  console.log("\nSPEC-FLDS — fieldSources maps each extracted field to its evidence step");

  const PDF_URL = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in":                          BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: BCECE_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("SPEC-FLDS.1",
    Object.keys(result.fieldSources).length > 0,
    `fieldSources is non-empty (got ${Object.keys(result.fieldSources).length} entries)`
  );
  assert("SPEC-FLDS.2",
    "notificationNumber" in result.fieldSources,
    "notificationNumber has a tracked source"
  );
  assert("SPEC-FLDS.3",
    result.fieldSources["notificationNumber"] === "OFFICIAL_PDF",
    `notificationNumber source = OFFICIAL_PDF (got: ${result.fieldSources["notificationNumber"]})`
  );
}

// ─── Phase 8D: Case F — generic page: recruitment fields stay undefined ──

async function testSPEC_GENERIC_PAGE() {
  console.log("\nSPEC-GEN — Generic page + generic official: no recruitment-specific fields extracted");

  const genericThirdParty = `
  <html><head><title>Govt Jobs Portal</title></head><body>
  <h1>Government Jobs</h1>
  <p>Check official website for latest recruitment notifications.</p>
  <a href="https://abcboard.gov.in">Official Website</a>
  </body></html>`;

  const genericOfficial = `
  <html><head><title>ABC Board Official Portal</title></head><body>
  <h1>ABC Board</h1>
  <p>Official Government Board portal. Visit our notification section.</p>
  </body></html>`;

  const result = await runIntake("https://freejobalert.com/abc-board-notice/", {
    fetchFn: mockFetch({
      "https://freejobalert.com/abc-board-notice/": genericThirdParty,
      "https://abcboard.gov.in":                    genericOfficial,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("SPEC-GEN.1",
    result.extraction.totalVacancies === undefined,
    "generic page: no vacancies extracted"
  );
  assert("SPEC-GEN.2",
    result.extraction.notificationNumber === undefined,
    "generic page: no notification number"
  );
  assert("SPEC-GEN.3",
    result.draft?.application.openDate === "TBA",
    "generic page: openDate = TBA"
  );
  assert("SPEC-GEN.4",
    result.draft?.application.closeDate === "TBA",
    "generic page: closeDate = TBA"
  );
  assert("SPEC-GEN.5",
    result.missingFields.includes("notificationNumber"),
    "notificationNumber in missingFields"
  );
}

// ─── Phase 8E: Cross-stage recruitment context fixtures ─────────
//
// These fixtures test the cross-stage PDF ranking injection:
// Stage A URL slug tokens are used as fallback context for Stage B PDF
// ranking, but only when Stage B's own page context cannot discriminate.

// Stage A: GovtJobGuru page — has an official domain link but NO direct
// official PDF link. Represents the real BCECE BSFC dry-run scenario.
const XS_STAGE_A_NO_PDF_URL = "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/";
const XS_STAGE_A_NO_PDF_HTML = `
<html><head><title>BCECE BSFC Recruitment 2026</title></head>
<body>
<h1>BCECE BSFC Recruitment 2026</h1>
<p>Total: 259 posts. Apply online 25 Aug 2026 to 24 Sep 2026.</p>
<a href="https://bceceboard.bihar.gov.in">Official BCECE Board Website</a>
</body></html>`;

// Stage B: generic official homepage with TWO official PDFs.
// The WRONG one (2SR26) is listed FIRST — this is the ordering that
// broke before Phase 8E. The BSFC one is second.
const XS_STAGE_B_MULTI_PDF_HTML = `
<html><head><title>BCECE Board — Official Portal</title></head>
<body>
<h1>Bihar Combined Entrance Competitive Examination Board</h1>
<p>Welcome to the official BCECE Board website.</p>
<a href="https://bceceboard.bihar.gov.in/pdf_Pros/PROS_2SR26.pdf">2-Year Science Reserve Prospectus</a>
<a href="https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf">BSFC Prospectus 2026</a>
</body></html>`;

// Stage B used for Case D: generic page with TWO official PDFs neither
// of which contains tokens from the Stage A slug ("ntpc", "railway").
const XS_CASE_D_STAGE_B_HTML = `
<html><head><title>ABC Board Official Portal</title></head>
<body>
<h1>ABC Board</h1>
<p>Official portal.</p>
<a href="https://abcboard.gov.in/pdfs/BSFC-PROSPECTUS-2026.pdf">BSFC Prospectus</a>
<a href="https://abcboard.gov.in/pdfs/ANNUAL-REPORT-2026.pdf">Annual Report</a>
</body></html>`;

// Stage B for Case E: a SPECIFIC recruitment page (high specificity).
// Its own title/text provides "ntpc" (4 chars) that discriminates the two PDFs.
// Dates use patterns that extractApplicationDates recognises, giving specificity ≥ 0.55.
const XS_CASE_E_STAGE_B_HTML = `
<html><head><title>RRB NTPC 2026 Recruitment Notification</title></head>
<body>
<h1>RRB NTPC Graduate Level 2026</h1>
<p>Advertisement No.: RRB-NTPC-2026/01. Total Vacancies: 8113.</p>
<p>Online Registration Start Date: 01/09/2026</p>
<p>Last Date for Online Registration: 30/09/2026</p>
<a href="https://rrbapply.gov.in/pdfs/NTPC-2026-official.pdf">NTPC 2026 Official Notification</a>
<a href="https://rrbapply.gov.in/pdfs/ANNUAL-REPORT-2025.pdf">Annual Report 2025</a>
</body></html>`;

// ─── Phase 8E: Case A+B — Stage A slug context resolves Stage B PDF ranking ──
// Verifies that "bsfc" from the Stage A URL path causes PROS_BSFC26.pdf to
// outscore PROS_2SR26.pdf even though 2SR26 is listed first on the homepage.

async function testXS_SLUG_CONTEXT_RANKING() {
  console.log("\nXS-RANK — Stage A URL slug context ranks BSFC26 over 2SR26 on generic homepage");

  const result = await runIntake(XS_STAGE_A_NO_PDF_URL, {
    fetchFn: mockFetch({
      [XS_STAGE_A_NO_PDF_URL]:                    XS_STAGE_A_NO_PDF_HTML,
      "https://bceceboard.bihar.gov.in":           XS_STAGE_B_MULTI_PDF_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case A: URL slug tokens extracted and provided to Stage B PDF ranking
  assert("XS-RANK.1",
    result.extraction.notifPdfUrl?.includes("PROS_BSFC26") === true,
    `Case A: BSFC slug context selects PROS_BSFC26.pdf (got: ${result.extraction.notifPdfUrl})`
  );
  // Case B: PROS_2SR26.pdf (listed first on homepage) must NOT win
  assert("XS-RANK.2",
    result.extraction.notifPdfUrl?.includes("PROS_2SR26") !== true,
    "Case B: PROS_2SR26.pdf (homepage first-listed) does not win"
  );
  // Case B cont.: exactly one PDF selected — not ambiguous
  assert("XS-RANK.3",
    result.extraction.ambiguousPdfCandidates === undefined,
    "Case B: no ambiguity when slug context resolves the ranking"
  );
  // Evidence chain must still list THIRD_PARTY → OFFICIAL (no regression)
  assert("XS-RANK.4",
    result.evidenceChain[0].sourceKind === "THIRD_PARTY",
    "evidence chain step 0 = THIRD_PARTY"
  );
  assert("XS-RANK.5",
    result.evidenceChain.some((s) => (s.sourceKind as string).startsWith("OFFICIAL")),
    "evidence chain includes OFFICIAL step (OFFICIAL_GENERIC or OFFICIAL_SPECIFIC)"
  );
}

// ─── Phase 8E: Case C — slug context is discovery evidence only ──
// The slug can influence PDF ranking but must not set authoritative fields
// (notificationNumber, vacancies, dates). All authoritative values must come
// from official PDF/page sources.

async function testXS_SLUG_EVIDENCE_ONLY() {
  console.log("\nXS-EVID — Slug context is discovery-only; authoritative fields from official sources");

  const PDF_URL = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

  const result = await runIntake(XS_STAGE_A_NO_PDF_URL, {
    fetchFn: mockFetch({
      [XS_STAGE_A_NO_PDF_URL]:          XS_STAGE_A_NO_PDF_HTML,
      "https://bceceboard.bihar.gov.in": XS_STAGE_B_MULTI_PDF_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: BCECE_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case C: slug helped pick the correct PDF, but notificationNumber must come from PDF
  assert("XS-EVID.1",
    result.fieldSources["notificationNumber"] === "OFFICIAL_PDF",
    `notificationNumber source = OFFICIAL_PDF, not THIRD_PARTY (got: ${result.fieldSources["notificationNumber"]})`
  );
  // Case C: notificationNumber is the official value, not a slug-derived artifact
  assert("XS-EVID.2",
    result.extraction.notificationNumber?.includes("BCECEB") === true,
    `notificationNumber = official PDF value (got: ${result.extraction.notificationNumber})`
  );
  // Case C: vacancies from Stage A (THIRD_PARTY) — 259 posts in the GovtJobGuru text
  assert("XS-EVID.3",
    result.extraction.totalVacancies === 259,
    `vacancies = 259 from Stage A (got: ${result.extraction.totalVacancies})`
  );
  // Case C: provenance never set to third-party aggregator
  assert("XS-EVID.4",
    !result.draft?.provenance.primarySourceUrl?.includes("govtjobguru"),
    "primarySourceUrl does not contain govtjobguru"
  );
}

// ─── Phase 8E: Case D — wrong/unrelated slug does not force a PDF selection ──
// Stage A URL slug has "ntpc" and "railway" — neither of which appears in the
// Stage B PDFs (BSFC-PROSPECTUS and ANNUAL-REPORT). Both PDFs score 0 →
// ambiguous → notifPdfUrl left unresolved, ambiguousPdfCandidates populated.

async function testXS_WRONG_SLUG_NO_BLIND_PICK() {
  console.log("\nXS-WRONG — Unrelated slug tokens do not blindly force a PDF selection");

  const wrongSlugUrl = "https://govtjobguru.in/jobs/ntpc-railway-2026/";
  const stageAHtml = `
  <html><head><title>NTPC Railway Recruitment 2026</title></head>
  <body>
  <h1>NTPC Railway Recruitment 2026</h1>
  <p>Railway Recruitment Notice 2026.</p>
  <a href="https://abcboard.gov.in">Official Website</a>
  </body></html>`;

  const result = await runIntake(wrongSlugUrl, {
    fetchFn: mockFetch({
      [wrongSlugUrl]:                wrongSlugUrl.endsWith("/") ? stageAHtml : stageAHtml,
      "https://abcboard.gov.in":     XS_CASE_D_STAGE_B_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case D: PDF selection must be ambiguous (neither PDF matched slug tokens)
  assert("XS-WRONG.1",
    result.extraction.notifPdfUrl === undefined,
    `Case D: notifPdfUrl unresolved when slug can't discriminate (got: ${result.extraction.notifPdfUrl})`
  );
  assert("XS-WRONG.2",
    (result.extraction.ambiguousPdfCandidates?.length ?? 0) >= 2,
    `Case D: ambiguousPdfCandidates has ≥2 entries (got: ${result.extraction.ambiguousPdfCandidates?.length ?? 0})`
  );
  // Case D: analysis notes report the ambiguity
  assert("XS-WRONG.3",
    result.analysisNotes.some((n) => n.includes("ambiguous")),
    "Case D: analysisNotes contains ambiguity report"
  );
}

// ─── Phase 8E: Case E — strong official page context outranks slug-only match ──
// Stage B has a specific recruitment page (high specificity, has notifNumber
// and dates). Its own page title includes "ntpc" (4 chars) which discriminates
// the two PDFs before the slug context is even consulted. The slug is ignored.

async function testXS_OFFICIAL_CONTEXT_BEATS_SLUG() {
  console.log("\nXS-OFFL — Strong official page context resolves PDF ranking without needing slug");

  // Stage A URL: generic aggregator slug with no useful tokens (all filtered)
  const genericSlugUrl = "https://freejobalert.com/recruitment-notice-2026/";
  const stageAHtml = `
  <html><head><title>Recruitment Notice 2026</title></head>
  <body>
  <h1>Recruitment 2026</h1>
  <p>Latest government recruitment notice.</p>
  <a href="https://rrbapply.gov.in">Railway Recruitment Board Official</a>
  </body></html>`;

  const result = await runIntake(genericSlugUrl, {
    fetchFn: mockFetch({
      [genericSlugUrl]:               stageAHtml,
      "https://rrbapply.gov.in":      XS_CASE_E_STAGE_B_HTML,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case E: NTPC PDF selected by Stage B's own context ("ntpc" in page title + text)
  assert("XS-OFFL.1",
    result.extraction.notifPdfUrl?.includes("NTPC") === true,
    `Case E: NTPC PDF wins on official page context (got: ${result.extraction.notifPdfUrl})`
  );
  assert("XS-OFFL.2",
    result.extraction.notifPdfUrl?.includes("ANNUAL") !== true,
    "Case E: Annual Report PDF not selected"
  );
  assert("XS-OFFL.3",
    result.extraction.ambiguousPdfCandidates === undefined,
    "Case E: no ambiguity when official page context is strong"
  );
  // Case E: Stage B has high specificity (notifNumber, vacancies, dates extracted)
  assert("XS-OFFL.4",
    (result.officialPageExtraction?.specificity ?? 0) >= 0.55,
    `Case E: Stage B specificity ≥ 0.55 (got: ${result.officialPageExtraction?.specificity ?? 0})`
  );
}

// ─── Phase 8E: Case F — truly ambiguous PDFs left unresolved ─────
// When neither Stage B's own context nor Stage A's slug can discriminate
// between official PDFs (all score 0), notifPdfUrl stays undefined.
// The ambiguousPdfCandidates list lets the human operator pick.

async function testXS_AMBIGUOUS_UNRESOLVED() {
  console.log("\nXS-AMBI — Tied official PDFs with no context: notifPdfUrl unresolved");

  // Stage A URL: generic slug, no useful tokens (all words are ≤3 chars or noise)
  const genericUrl = "https://freejobalert.com/jobs-2026/";
  const stageAHtml = `
  <html><head><title>Govt Jobs 2026</title></head>
  <body>
  <h1>Government Jobs 2026</h1>
  <p>Latest govt job notification.</p>
  <a href="https://abcboard.gov.in">Official Website</a>
  </body></html>`;

  // Stage B: generic homepage with two PDFs whose filenames share no tokens
  // with the page context or slug — ensures both score 0.
  const stageBHtml = `
  <html><head><title>ABC Board Portal</title></head>
  <body>
  <h1>ABC Board</h1>
  <p>Welcome to the official portal.</p>
  <a href="https://abcboard.gov.in/pdfs/ZZZQ-2026.pdf">Document Q</a>
  <a href="https://abcboard.gov.in/pdfs/ZZZR-2026.pdf">Document R</a>
  </body></html>`;

  const result = await runIntake(genericUrl, {
    fetchFn: mockFetch({
      [genericUrl]:               stageAHtml,
      "https://abcboard.gov.in":  stageBHtml,
    }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case F: both PDFs score 0 in both contexts → must NOT guess
  assert("XS-AMBI.1",
    result.extraction.notifPdfUrl === undefined,
    `Case F: notifPdfUrl unresolved (got: ${result.extraction.notifPdfUrl})`
  );
  // Case F: candidates reported so human can choose
  assert("XS-AMBI.2",
    (result.extraction.ambiguousPdfCandidates?.length ?? 0) === 2,
    `Case F: 2 ambiguous candidates reported (got: ${result.extraction.ambiguousPdfCandidates?.length ?? 0})`
  );
  // Case F: analysis notes surface the ambiguity
  assert("XS-AMBI.3",
    result.analysisNotes.some((n) => n.toLowerCase().includes("ambiguous")),
    "Case F: ambiguity surfaced in analysisNotes"
  );
  // Case F: candidateSaved must remain false
  assert("XS-AMBI.4",
    result.candidateSaved === false,
    "Case F: candidateSaved = false"
  );
}

// ─── Phase 8F: Source authority regression fixtures ─────────────
//
// These fixtures simulate the real-world BCECE scenario where:
//  • Stage B (generic org homepage) has HIGH specificity from a DIFFERENT
//    recruitment listed on the same page (e.g. TUTOR-2026 on BCECE homepage)
//  • Stage C (official PDF) has the CORRECT data for the target recruitment
//
// Without the Phase 8F authority fix, Stage B's high-specificity wrong data
// blocked Stage C from winning in mergeExtractions (specificity guard only).
// With OFFICIAL_PDF authority, Stage C unconditionally wins for guarded fields.

// Generic org homepage that prominently shows a DIFFERENT recruitment (TUTOR-2026).
// High specificity (notifNum + dates + vacancies) — this is the critical adversarial case.
const F8_GENERIC_HOMEPAGE_WRONG_NOTIF_HTML = `
<html>
<head><title>XYZ Board Official Portal</title></head>
<body>
<h1>XYZ Board</h1>
<p>Latest Notification: Advertisement No.: XYZB-2026/03 Total Posts: 450</p>
<p>Online Registration Start Date: 01/11/2026</p>
<p>Last Date for Online Registration: 30/11/2026</p>
<a href="https://xyzboard.gov.in/pdfs/CORRECT-RECRUIT-2026.pdf">Download Notification PDF</a>
</body></html>`;

// Official PDF for the TARGET recruitment — different from what's on the homepage.
// Authority (OFFICIAL_PDF) must ensure these values override the homepage's wrong data.
const F8_CORRECT_RECRUIT_PDF_TEXT = `
XYZ BOARD RECRUITMENT NOTIFICATION
CORRECT PROGRAMME 2026

Advertisement No.: XYZB(CORRECT)-2026/01
Advertisement Date: 01/09/2026

Total Posts: 200
Online Registration Start Date: 05/09/2026
Last Date for Online Registration: 05/10/2026
`;

// Stage A aggregator page — has a recruitment-specific title for the target programme.
// This title must survive when Stage B is a generic homepage (OFFICIAL_GENERIC).
const F8_STAGE_A_AGGREGATOR_HTML = `
<html>
<head><title>XYZ Correct Programme 2026 Recruitment - GovtJobGuru</title></head>
<body>
<h1>XYZ Correct Programme 2026</h1>
<p>XYZ Board announces recruitment for Correct Programme 2026.</p>
<a href="https://xyzboard.gov.in">Official XYZ Board Website</a>
</body></html>`;

// ─── Phase 8F: Case A/B/C/G — OFFICIAL_PDF beats OFFICIAL_GENERIC (even high specificity) ──
// Verifies that the authoritative PDF overrides a generic homepage that accidentally has
// high specificity (from a different recruitment listed on the same page).

async function testF8_PDF_AUTHORITY_BEATS_HOMEPAGE() {
  console.log("\nF8-AUTH — OFFICIAL_PDF beats OFFICIAL_GENERIC regardless of specificity");

  const stageAUrl = "https://govtjobguru.in/jobs/xyz-correct-programme-2026/";
  const PDF_URL = "https://xyzboard.gov.in/pdfs/CORRECT-RECRUIT-2026.pdf";

  const result = await runIntake(stageAUrl, {
    fetchFn: mockFetch({
      [stageAUrl]:                      F8_STAGE_A_AGGREGATOR_HTML,
      "https://xyzboard.gov.in":        F8_GENERIC_HOMEPAGE_WRONG_NOTIF_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: F8_CORRECT_RECRUIT_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case A: OFFICIAL_PDF notificationNumber must override OFFICIAL_GENERIC's wrong value
  assert("F8-AUTH.1",
    result.extraction.notificationNumber?.includes("CORRECT") === true,
    `Case A: notifNumber = PDF value (got: ${result.extraction.notificationNumber})`
  );
  assert("F8-AUTH.2",
    result.extraction.notificationNumber?.includes("XYZB-2026/03") !== true,
    "Case A: homepage wrong notifNumber (XYZB-2026/03) did not win"
  );
  // Case B: OFFICIAL_PDF totalVacancies (200) must override OFFICIAL_GENERIC's wrong value (450)
  assert("F8-AUTH.3",
    result.extraction.totalVacancies === 200,
    `Case B: totalVacancies = 200 from PDF (got: ${result.extraction.totalVacancies})`
  );
  // Case C: OFFICIAL_PDF dates must override OFFICIAL_GENERIC's wrong dates
  assert("F8-AUTH.4",
    result.extraction.applicationOpenDate === "2026-09-05",
    `Case C: applicationOpenDate = 2026-09-05 from PDF (got: ${result.extraction.applicationOpenDate})`
  );
  assert("F8-AUTH.5",
    result.extraction.applicationCloseDate === "2026-10-05",
    `Case C: applicationCloseDate = 2026-10-05 from PDF (got: ${result.extraction.applicationCloseDate})`
  );
  // Case G: fieldSources correctly attribute to OFFICIAL_PDF
  assert("F8-AUTH.6",
    result.fieldSources["notificationNumber"] === "OFFICIAL_PDF",
    `Case G: notifNumber source = OFFICIAL_PDF (got: ${result.fieldSources["notificationNumber"]})`
  );
  assert("F8-AUTH.7",
    result.fieldSources["totalVacancies"] === "OFFICIAL_PDF",
    `Case G: totalVacancies source = OFFICIAL_PDF (got: ${result.fieldSources["totalVacancies"]})`
  );
}

// ─── Phase 8F: Case D — OFFICIAL_GENERIC title does not replace existing title ──
// A generic org homepage title ("XYZ Board Official Portal") must not override
// the more informative recruitment-specific title already present from Stage A
// or Stage C. This prevents the org-name-as-title problem.

async function testF8_GENERIC_TITLE_PRESERVED() {
  console.log("\nF8-TITLE — OFFICIAL_GENERIC title does not override Stage A or Stage C title");

  const stageAUrl = "https://govtjobguru.in/jobs/xyz-correct-programme-2026/";
  const PDF_URL = "https://xyzboard.gov.in/pdfs/CORRECT-RECRUIT-2026.pdf";

  const result = await runIntake(stageAUrl, {
    fetchFn: mockFetch({
      [stageAUrl]:               F8_STAGE_A_AGGREGATOR_HTML,
      "https://xyzboard.gov.in": F8_GENERIC_HOMEPAGE_WRONG_NOTIF_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: F8_CORRECT_RECRUIT_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case D: homepage title "XYZ Board Official Portal" must NOT become the final title
  assert("F8-TITLE.1",
    result.extraction.title?.includes("Official Portal") !== true,
    `Case D: generic homepage title not used (got: ${result.extraction.title})`
  );
  // Case D: title must be set to something (Stage A or Stage C — both are more specific)
  assert("F8-TITLE.2",
    result.extraction.title !== undefined,
    "Case D: title is extracted from a non-generic source"
  );
}

// ─── Phase 8F: Case E — lower-authority source fills genuinely missing fields ──
// When OFFICIAL_PDF has no value for a field, a lower-authority source may fill it.
// Lower authority must NOT be able to OVERWRITE an OFFICIAL_PDF value.

async function testF8_LOWER_AUTH_FILLS_MISSING() {
  console.log("\nF8-FILL — Lower-authority source fills missing fields; cannot overwrite OFFICIAL_PDF");

  // PDF has notifNumber and dates but NO vacancy count
  const pdfWithNoVacancies = `
XYZ BOARD
RECRUITMENT 2026

Advertisement No.: XYZB(FILL)-2026/01
Advertisement Date: 10/09/2026
Online Registration Start Date: 15/09/2026
Last Date for Online Registration: 15/10/2026
`;

  // Stage A (THIRD_PARTY) has vacancies — should fill since PDF has none
  const stageAWithVacancies = `
<html><head><title>XYZ Fill Recruitment 2026</title></head>
<body>
<h1>XYZ Fill Recruitment 2026</h1>
<p>Total 300 Posts. Apply from 15 Sep 2026 to 15 Oct 2026.</p>
<a href="https://xyzboard.gov.in">Official Website</a>
</body></html>`;

  const stageAUrl = "https://govtjobguru.in/jobs/xyz-fill-2026/";
  const PDF_URL = "https://xyzboard.gov.in/pdfs/FILL-RECRUIT-2026.pdf";

  // Stage B: generic homepage, minimal — contributes PDF link only
  const stageBHtml = `
<html><head><title>XYZ Board Official</title></head>
<body><h1>XYZ Board</h1>
<a href="https://xyzboard.gov.in/pdfs/FILL-RECRUIT-2026.pdf">Notification PDF</a>
</body></html>`;

  const result = await runIntake(stageAUrl, {
    fetchFn: mockFetch({
      [stageAUrl]:               stageAWithVacancies,
      "https://xyzboard.gov.in": stageBHtml,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: pdfWithNoVacancies }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case E part 1: OFFICIAL_PDF notifNumber wins
  assert("F8-FILL.1",
    result.extraction.notificationNumber?.includes("FILL") === true,
    `Case E: notifNumber from PDF (got: ${result.extraction.notificationNumber})`
  );
  // Case E part 2: THIRD_PARTY vacancies fill the gap (PDF has none)
  assert("F8-FILL.2",
    result.extraction.totalVacancies === 300,
    `Case E: vacancies filled from THIRD_PARTY (got: ${result.extraction.totalVacancies})`
  );
  // Case E part 3: fieldSources correctly reflect the split
  assert("F8-FILL.3",
    result.fieldSources["notificationNumber"] === "OFFICIAL_PDF",
    `Case E: notifNumber source = OFFICIAL_PDF (got: ${result.fieldSources["notificationNumber"]})`
  );
  // totalVacancies came from THIRD_PARTY (Stage A) since PDF had none
  assert("F8-FILL.4",
    result.fieldSources["totalVacancies"] === "THIRD_PARTY",
    `Case E: vacancies source = THIRD_PARTY (gap-fill, got: ${result.fieldSources["totalVacancies"]})`
  );
}

// ─── Phase 8F: Case F — Stage C uses the FINAL selected PDF (post Phase 8E merge) ──
// When Phase 8E resolved a PDF selection via URL slug context, Stage C must
// extract from THAT resolved PDF — not from an earlier intermediate selection.

async function testF8_FINAL_PDF_IS_AUTHORITATIVE() {
  console.log("\nF8-FPDF — Stage C extracts from the final Phase 8E-selected PDF");

  // Stage A: no direct PDF link (triggers Phase 8E slug-based selection)
  const stageAUrl = "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/";
  const PDF_URL = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

  const result = await runIntake(stageAUrl, {
    fetchFn: mockFetch({
      [stageAUrl]:                         XS_STAGE_A_NO_PDF_HTML,
      "https://bceceboard.bihar.gov.in":   XS_STAGE_B_MULTI_PDF_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: BCECE_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Case F: pdfExtraction must be present (Stage C ran)
  assert("F8-FPDF.1",
    result.pdfExtraction !== undefined,
    "Case F: pdfExtraction is present — Stage C ran"
  );
  // Case F: Stage C URL must be the Phase 8E-selected BSFC PDF, not 2SR26
  const pdfStep = result.evidenceChain.find(s => s.sourceKind === "OFFICIAL_PDF");
  assert("F8-FPDF.2",
    pdfStep?.url.includes("PROS_BSFC26") === true,
    `Case F: Stage C used the slug-selected PDF (got: ${pdfStep?.url})`
  );
  // Case F: OFFICIAL_PDF authority means PDF fields dominate the final extraction
  assert("F8-FPDF.3",
    result.fieldSources["notificationNumber"] === "OFFICIAL_PDF",
    `Case F: notifNumber source = OFFICIAL_PDF (got: ${result.fieldSources["notificationNumber"]})`
  );
  // Case F: the correct BSFC notification number is present
  assert("F8-FPDF.4",
    result.extraction.notificationNumber?.includes("BCECEB") === true,
    `Case F: BSFC notifNumber from authoritative PDF (got: ${result.extraction.notificationNumber})`
  );
}

// ─── Phase 8G: Extraction quality fixtures ─────────────────────
//
// Accurate representation of what pdf-parse extracts from the real
// PROS_BSFC26.pdf (bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf).
//
// The PDF is primarily in Hindi (Devanagari). pdf-parse extracts only
// English text fragments. Critical data — advertisement number, vacancy
// table headers, date labels, post names — are in Hindi and are ABSENT
// from the extracted text. Two English strings survive that must NOT be
// selected as recruitment fields:
//   • "24.09.2026" (page 1) — the application close date, but its
//     Hindi "Last Date" label is lost; must NOT become the title.
//   • "no. 0612-2220230" (page 7) — preceded by "Helpdesk phone";
//     must NOT become the notification number.
//
// The real PDF cannot be committed to the repository (2.9 MB, copyrighted
// government document). This fixture is derived from actual pdf-parse
// output and documents the extraction limitation for regression purposes.
const F8G_BSFC_REAL_PDF_LIKE = `(CBT)
2026
24.09.2026

-- 1 of 20 --

2
1
(CBT)

-- 2 of 20 --

3
AICTE
--------------------------------------------------------------------------------------------------------------
01 	02 	03 	04 	05
81 	6 	11 	38 	123
--------------------------------------------------------------------------------------------------------------
(VI)
(DD)
(OH)
(MM)

-- 3 of 20 --

4
Medical Fitness Certificate

-- 5 of 20 --

Every appropriate Government shall appoint in every Government
establishment, not less than four percent of the total number of vacancies in
the cadre strength in each group of posts meant to be filled with persons with
benchmark disabilities

-- 6 of 20 --

Website:bceceboard.bihar.gov.in "Online
Portal of BSFCSC Ltd." Link Click "Apply Online" Link Click
Step-One (Registration):

-- 7 of 20 --

Online application portal   email ID :
bangalorepgsd@billdesk.com email    Helpdesk phone
no. 0612-2220230

-- 8 of 20 --
`;

// A well-formed PDF with an explicit labeled advertisement number in English.
// Tests that the labeled extractor finds it and the OFFICIAL_PDF authority wins.
const F8G_LABELED_ADVT_PDF_TEXT = `
GOVERNMENT RECRUITMENT NOTIFICATION

Advertisement No.: XYZ-RECRUIT-2026/01
Date of Advertisement: 15.08.2026

Total Vacancies: 400
Application Start Date: 20.08.2026
Last Date: 20.09.2026
`;

// Tests DD.MM.YYYY date parsing with explicit English labels.
const F8G_DOTDATE_LABELED_PDF_TEXT = `
RECRUITMENT NOTICE

Application Start Date: 01.09.2026
Last Date: 30.09.2026
Date of Advertisement: 24.08.2026
Total Posts: 300
`;

// ─── Phase 8G: Extraction quality tests ────────────────────────

async function testF8G_EXTRACTION_QUALITY() {
  console.log("\nF8G — Extraction quality (plain-text PDF heuristics)");

  // Case A: DD.MM.YYYY date string is never selected as title
  {
    const ex = extractIntakeFields(F8G_BSFC_REAL_PDF_LIKE, "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf",
      undefined, undefined, "OFFICIAL_PDF");
    assert("F8G-A.1", ex.title !== "24.09.2026",
      "24.09.2026 is NOT selected as title (got: " + (ex.title ?? "undefined") + ")");
    assert("F8G-A.2", !ex.title || !/^\d{1,2}[./\-]\d{1,2}[./\-]20\d{2}$/.test(ex.title),
      "title is not a date-format string (got: " + (ex.title ?? "undefined") + ")");
  }

  // Case B: Helpdesk phone number is not selected as notification number
  {
    const ex = extractIntakeFields(F8G_BSFC_REAL_PDF_LIKE, "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf",
      undefined, undefined, "OFFICIAL_PDF");
    assert("F8G-B.1", ex.notificationNumber !== "0612-2220230" && ex.notificationNumber !== "no. 0612-2220230",
      "no. 0612-2220230 (helpdesk phone) NOT selected as notifNumber");
    assert("F8G-B.2", ex.notificationNumber === undefined,
      "notificationNumber is undefined when only phone context found (got: " + (ex.notificationNumber ?? "undefined") + ")");
  }

  // Case C: Explicit "Advertisement No.: XYZ-RECRUIT-2026/01" beats unlabeled numbers
  {
    const ex = extractIntakeFields(F8G_LABELED_ADVT_PDF_TEXT, "https://example.gov.in/pdfs/notif.pdf",
      undefined, undefined, "OFFICIAL_PDF");
    assert("F8G-C.1", ex.notificationNumber !== undefined,
      "labeled advt number extracted (got: " + (ex.notificationNumber ?? "undefined") + ")");
    assert("F8G-C.2", ex.notificationNumber === "XYZ-RECRUIT-2026/01",
      "labeled advt number = XYZ-RECRUIT-2026/01 (got: " + ex.notificationNumber + ")");
  }

  // Case D: Official PDF vacancy value beats third-party vacancy value
  {
    const stageAUrl = "https://govtjobguru.in/xyz-recruit-2026/";
    const officialPdfUrl = "https://example.gov.in/pdfs/notif.pdf";
    const stageAHtml = `<html><head><title>XYZ Recruit 2026 - GovtJobGuru</title></head>
<body><p>XYZ Board announces 150 posts. <a href="https://example.gov.in">Official</a></p></body></html>`;
    const stageAFetch = mockFetch({
      [stageAUrl]: stageAHtml,
      ["https://example.gov.in"]: `<html><head><title>XYZ Board</title></head>
<body><a href="${officialPdfUrl}">Notification PDF</a></body></html>`,
    });
    const pdfFn = mockFetchPdf({ [officialPdfUrl]: F8G_LABELED_ADVT_PDF_TEXT });
    const result = await runIntake(stageAUrl, { fetchFn: stageAFetch, fetchPdfFn: pdfFn });
    assert("F8G-D.1", result.extraction.totalVacancies === 400,
      "totalVacancies = 400 from PDF (not 150 from aggregator) (got: " + result.extraction.totalVacancies + ")");
    assert("F8G-D.2", result.fieldSources["totalVacancies"] === "OFFICIAL_PDF",
      "vacancies source = OFFICIAL_PDF (got: " + result.fieldSources["totalVacancies"] + ")");
  }

  // Case E: Application dates extracted with DD.MM.YYYY when labeled
  {
    const ex = extractIntakeFields(F8G_DOTDATE_LABELED_PDF_TEXT, "https://example.gov.in/pdfs/notif.pdf",
      undefined, undefined, "OFFICIAL_PDF");
    assert("F8G-E.1", ex.applicationOpenDate === "2026-09-01",
      "applicationOpenDate extracted from DD.MM.YYYY label (got: " + (ex.applicationOpenDate ?? "undefined") + ")");
    assert("F8G-E.2", ex.applicationCloseDate === "2026-09-30",
      "applicationCloseDate extracted from DD.MM.YYYY label (got: " + (ex.applicationCloseDate ?? "undefined") + ")");
    assert("F8G-E.3", ex.postDate === "2026-08-24",
      "postDate extracted from Date of Advertisement label (got: " + (ex.postDate ?? "undefined") + ")");
  }

  // Case F: Publication date is not confused with application start date
  {
    const publishedOnlyText = `
RECRUITMENT BOARD
Published: 01.08.2026
Notified on: 01.08.2026
Total Posts: 200
`;
    const ex = extractIntakeFields(publishedOnlyText, "https://example.gov.in/notif.pdf",
      undefined, undefined, "OFFICIAL_PDF");
    assert("F8G-F.1", ex.postDate === "2026-08-01",
      "publication date goes to postDate (got: " + (ex.postDate ?? "undefined") + ")");
    assert("F8G-F.2", ex.applicationOpenDate === undefined,
      "applicationOpenDate is NOT set from publication date (got: " + (ex.applicationOpenDate ?? "undefined") + ")");
  }

  // Case G: No labeled number and phone context → notificationNumber undefined
  {
    const ambiguousText = `
Reference: 0612-2220230
File No. 1234
Page 1 of 5
`;
    const ex = extractIntakeFields(ambiguousText, "https://example.gov.in/pdfs/notif.pdf",
      undefined, undefined, "OFFICIAL_PDF");
    assert("F8G-G.1", ex.notificationNumber === undefined,
      "no notification number extracted from ambiguous/phone-only context (got: " + (ex.notificationNumber ?? "undefined") + ")");
  }

  // Case H: Real BCECE-like PDF does not poison the merge with wrong values
  {
    const stageAUrl = "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/";
    const officialPageUrl = "https://bceceboard.bihar.gov.in";
    const pdfUrl = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

    const stageAHtml = `<html><head><title>BCECE BSFC 2026 - GovtJobGuru</title></head>
<body>
<p>BCECE Board BSFC 2026 recruitment: 259 posts.</p>
<a href="https://bceceboard.bihar.gov.in">Official</a>
<a href="${pdfUrl}">Notification PDF</a>
</body></html>`;

    // Stage B: generic homepage with a DIFFERENT recruitment's notification (TUTOR-2026).
    // The vacancy count (90) is NOT in English — it would be in Hindi on the real page —
    // so the vacancy regex cannot match it. This reflects the real bceceboard.bihar.gov.in
    // where the vacancy table is rendered in Hindi and pdf-parse loses it entirely.
    const stageBHtml = `<html><head><title>BCECE Board Official Portal</title></head>
<body>
<h1>BCECE Board</h1>
<p>Latest: TUTOR-2026 Notification No. BCECEB-TUTOR-2026/03</p>
<a href="${pdfUrl}">BSFC 2026 Prospectus</a>
</body></html>`;

    const fetchFn = mockFetch({ [stageAUrl]: stageAHtml, [officialPageUrl]: stageBHtml });
    // Stage C returns the real-like PDF text (Hindi doc, English fragments only)
    const pdfFn = mockFetchPdf({ [pdfUrl]: F8G_BSFC_REAL_PDF_LIKE });

    const result = await runIntake(stageAUrl, { fetchFn, fetchPdfFn: pdfFn });

    // OFFICIAL_PDF extraction returns undefined for title and notifNumber
    // (PDF is in Hindi — these fields are not in the English fragments).
    // The merge must NOT propagate wrong values; lower-authority sources are preserved.
    assert("F8G-H.1", result.extraction.title !== "24.09.2026",
      "title is NOT the date string 24.09.2026 (got: " + (result.extraction.title ?? "undefined") + ")");
    assert("F8G-H.2",
      result.extraction.notificationNumber !== "0612-2220230" &&
      result.extraction.notificationNumber !== "no. 0612-2220230",
      "notificationNumber is NOT the helpdesk phone (got: " + (result.extraction.notificationNumber ?? "undefined") + ")");
    assert("F8G-H.3", result.extraction.totalVacancies === 259,
      "totalVacancies = 259 preserved from Stage A (got: " + result.extraction.totalVacancies + ")");
    assert("F8G-H.4", result.pdfExtraction !== undefined,
      "pdfExtraction ran (Stage C executed)");
    assert("F8G-H.5", result.candidateSaved === false,
      "candidateSaved = false (production write guard)");
  }
}

// ─── Phase 8H: OFFICIAL_GENERIC isolation ─────────────────────
//
// A generic org homepage (root-path URL) must NOT supply recruitment-specific
// canonical fields even when the base has no value. notifPdfUrl is exempt —
// homepages correctly list PDF repositories used for Stage C discovery.

async function testOFFICIAL_GENERIC_ISOLATION() {
  console.log("\nOGI — OFFICIAL_GENERIC cannot supply recruitment-specific canonical fields");

  // Third-party page with NO recruitment data — only an official link
  const ogiThirdPartyHtml = `
<html><head><title>OGI Board 2026 Recruitment - NoticeJob</title></head>
<body>
<h1>OGI Board Recruitment 2026</h1>
<p>Apply now. Visit official website for details.</p>
<a href="https://ogiboard.gov.in">Official Website</a>
</body></html>`;

  // Official generic homepage (root path) that HAS wrong recruitment data
  // from a different notification listed on the same page.
  const ogiGenericHomepageHtml = `
<html><head><title>OGI Board Official Portal</title></head>
<body>
<h1>OGI Board</h1>
<p>Advertisement No.: OGI-2026/UNRELATED Total Posts: 777</p>
<p>Online Registration Start Date: 01/11/2026</p>
<p>Last Date: 01/12/2026</p>
<p>Advertisement Date: 15/10/2026</p>
<a href="https://ogiboard.gov.in/pdfs/OGI-NOTIF-2026.pdf">Notification PDF</a>
</body></html>`;

  // Official sub-path page (OFFICIAL_SPECIFIC) with correct recruitment data
  const ogiSpecificPageHtml = `
<html><head><title>OGI Specific Recruitment Notification 2026</title></head>
<body>
<h1>OGI Board — Specific Recruitment 2026</h1>
<p>Advertisement No.: OGIB(SPECIFIC)-2026/01</p>
<p>Advertisement Date: 05/09/2026</p>
<p>Total Posts: 999</p>
<p>Online Registration Start Date: 15/09/2026</p>
<p>Last Date for Online Registration: 15/10/2026</p>
</body></html>`;

  const ogiThirdPartyWithSubpathLinkHtml = `
<html><head><title>OGI Specific Recruitment 2026 - NoticeJob</title></head>
<body>
<h1>OGI Board Specific Recruitment 2026</h1>
<p>Apply now.</p>
<a href="https://ogiboard.gov.in/recruitment/specific-2026">Official Recruitment Page</a>
</body></html>`;

  // ── OGI-1 through OGI-6: OFFICIAL_GENERIC cannot supply blocked fields ──
  {
    const result = await runIntake("https://noticejob.in/ogi-2026/", {
      fetchFn: mockFetch({
        "https://noticejob.in/ogi-2026/":  ogiThirdPartyHtml,
        "https://ogiboard.gov.in":          ogiGenericHomepageHtml,
      }),
      canonicalRecords: [],
      existingCandidates: [],
    });

    assert("OGI-1",
      result.extraction.notificationNumber === undefined,
      `notificationNumber = undefined from OFFICIAL_GENERIC (got: ${result.extraction.notificationNumber})`
    );
    assert("OGI-2",
      result.extraction.totalVacancies === undefined,
      `totalVacancies = undefined from OFFICIAL_GENERIC (got: ${result.extraction.totalVacancies})`
    );
    assert("OGI-3",
      result.extraction.postDate === undefined,
      `postDate = undefined from OFFICIAL_GENERIC (got: ${result.extraction.postDate})`
    );
    assert("OGI-4",
      result.extraction.applicationOpenDate === undefined,
      `applicationOpenDate = undefined from OFFICIAL_GENERIC (got: ${result.extraction.applicationOpenDate})`
    );
    assert("OGI-5",
      result.extraction.applicationCloseDate === undefined,
      `applicationCloseDate = undefined from OFFICIAL_GENERIC (got: ${result.extraction.applicationCloseDate})`
    );
    assert("OGI-6",
      result.extraction.title !== "OGI Board Official Portal",
      `title is NOT the generic portal title (got: ${result.extraction.title})`
    );
    // notifPdfUrl IS allowed from OFFICIAL_GENERIC (discovery data for Stage C)
    assert("OGI-7",
      result.extraction.notifPdfUrl?.includes("OGI-NOTIF-2026.pdf") === true,
      `notifPdfUrl IS supplied from OFFICIAL_GENERIC (got: ${result.extraction.notifPdfUrl})`
    );
  }

  // ── OGI-8: OFFICIAL_SPECIFIC (sub-path) CAN supply all recruitment-specific fields ──
  {
    const result = await runIntake("https://noticejob.in/ogi-specific-2026/", {
      fetchFn: mockFetch({
        "https://noticejob.in/ogi-specific-2026/":           ogiThirdPartyWithSubpathLinkHtml,
        "https://ogiboard.gov.in/recruitment/specific-2026": ogiSpecificPageHtml,
      }),
      canonicalRecords: [],
      existingCandidates: [],
    });

    assert("OGI-8",
      result.extraction.notificationNumber?.includes("SPECIFIC") === true,
      `notificationNumber supplied from OFFICIAL_SPECIFIC (got: ${result.extraction.notificationNumber})`
    );
    assert("OGI-9",
      result.extraction.totalVacancies === 999,
      `totalVacancies supplied from OFFICIAL_SPECIFIC (got: ${result.extraction.totalVacancies})`
    );
    assert("OGI-10",
      result.extraction.postDate === "2026-09-05",
      `postDate supplied from OFFICIAL_SPECIFIC (got: ${result.extraction.postDate})`
    );
  }
}

// ─── Phase 8H: PDF text quality assessment ────────────────────

function testPDF_QUALITY_ASSESSMENT() {
  console.log("\nPQA — PDF text quality: OCR_REQUIRED / TEXT_PARTIAL / TEXT_SUFFICIENT");

  // PQA-1: empty text → OCR_REQUIRED (likely scanned with no text layer)
  assert("PQA-1", assessPdfTextQuality("", 1) === "OCR_REQUIRED",
    "empty text → OCR_REQUIRED");

  // PQA-2: too sparse (< 200 chars/page) → OCR_REQUIRED
  assert("PQA-2", assessPdfTextQuality("Short text only.", 1) === "OCR_REQUIRED",
    "< 200 chars/page → OCR_REQUIRED");

  // PQA-3: BSFC-like — moderate ASCII density, 0 non-ASCII → TEXT_PARTIAL
  // Simulates a bilingual PDF where Devanagari was silently dropped.
  const bsfcLike = "x".repeat(33950); // ~1697 chars/page over 20 pages
  assert("PQA-3", assessPdfTextQuality(bsfcLike, 20) === "TEXT_PARTIAL",
    "1697 chars/page, 0 non-ASCII → TEXT_PARTIAL (dropped multilingual content)");

  // PQA-4: dense ASCII (> 2000 chars/page) → TEXT_SUFFICIENT (English-only doc)
  const densePdf = "x".repeat(60000); // 3000 chars/page over 20 pages
  assert("PQA-4", assessPdfTextQuality(densePdf, 20) === "TEXT_SUFFICIENT",
    "3000 chars/page, 0 non-ASCII → TEXT_SUFFICIENT (dense English doc)");

  // PQA-5: non-ASCII text survived (multilingual content partially preserved)
  // nonAsciiRatio > 0.01 → TEXT_SUFFICIENT regardless of density
  const withDevanagari = "English text: " + "हिन्दी ".repeat(50) + " more text " + "x".repeat(500);
  assert("PQA-5", assessPdfTextQuality(withDevanagari, 1) === "TEXT_SUFFICIENT",
    "non-ASCII ratio > 1% → TEXT_SUFFICIENT (script survived extraction)");
}

// ─── Phase 8I — IBPS CRP extraction, title/slug/vacancy fixes ──

// Simulates text from the opening pages of an IBPS CRP PO/MT-XV PDF.
// The PDF opens with the generic heading "NOTIFICATION" before the specific title.
const IBPS_CRP_PO_XV_PDF_TEXT = `NOTIFICATION
Common Recruitment Process for Probationary Officers / Management Trainees
(CRP PO/MTs XV)

Institute of Banking Personnel Selection (IBPS)
IBPS House, Plot No.C-7, G Block, Bandra-Kurla Complex, Bandra (East), Mumbai - 400 051

CRP-PO/MTs-XV

Important Dates:
Online Registration Including Edit/Modification of Application Start Date: 01.07.2025
Online Registration Including Edit/Modification of Application Close Date: 21.07.2025
`;

// Simulates text from the opening pages of an IBPS CRP RRBs-XV PDF.
const IBPS_CRP_RRBS_XV_PDF_TEXT = `NOTIFICATION
Common Recruitment Process for Recruitment of Officers (Scale-I, II & III) and Office Assistants
CRP RRBs XV

Institute of Banking Personnel Selection (IBPS)
IBPS House, Mumbai - 400 051

Important Dates:
Online Registration Start Date: 01.09.2025
Last Date for Online Registration: 21.09.2025
`;

function testIBPS_CRP_EXTRACTION() {
  console.log("\nIBPS-8I — CRP identifier extraction, title/slug/vacancy fixes");

  // IBPS-EXT-1: CRP-PO/MT-XV extracted from IBPS official PDF
  const ex1 = extractIntakeFields(
    IBPS_CRP_PO_XV_PDF_TEXT,
    "https://www.ibps.in/wp-content/uploads/Detailed-Notification_CRP-PO-XV.pdf",
    undefined, undefined, "OFFICIAL_PDF",
  );
  assert("IBPS-EXT-1.1", ex1.notificationNumber !== undefined,
    "CRP-PO/MTs-XV extracted from IBPS official PDF (not undefined)");
  assert("IBPS-EXT-1.2", (ex1.notificationNumber ?? "").toUpperCase().includes("CRP"),
    `CRP identifier present (got: ${ex1.notificationNumber})`);
  assert("IBPS-EXT-1.3", ex1.title !== "NOTIFICATION",
    `NOTIFICATION rejected as title (got: ${ex1.title})`);
  assert("IBPS-EXT-1.4",
    (ex1.title ?? "").toLowerCase().includes("common") || (ex1.title ?? "").toUpperCase().includes("CRP"),
    `specific title extracted beyond generic heading (got: ${ex1.title})`);

  // IBPS-EXT-2: CRP-RRBs-XV extracted from IBPS official PDF
  const ex2 = extractIntakeFields(
    IBPS_CRP_RRBS_XV_PDF_TEXT,
    "https://www.ibps.in/wp-content/uploads/CRP-RRBs-XV-notification.pdf",
    undefined, undefined, "OFFICIAL_PDF",
  );
  assert("IBPS-EXT-2.1", ex2.notificationNumber !== undefined,
    "CRP-RRBs-XV extracted from IBPS official PDF");
  assert("IBPS-EXT-2.2", (ex2.notificationNumber ?? "").toUpperCase().includes("CRP"),
    `CRP RRBs identifier present (got: ${ex2.notificationNumber})`);

  // IBPS-EXT-3: CRP text from third-party domain does NOT trigger IBPS-specific pattern
  const thirdPartyPlainText = "CRP-PO/MTs-XV notification released. Apply before 21.07.2025.";
  const ex3 = extractIntakeFields(
    thirdPartyPlainText,
    "https://govtjobguru.com/ibps-po-xv-2025/",
    undefined, undefined, "THIRD_PARTY",
  );
  assert("IBPS-EXT-3.1", ex3.notificationNumber === undefined,
    `CRP pattern not applied for third-party domain (got: ${ex3.notificationNumber})`);

  // TITLE-REJ-1: "NOTIFICATION" alone is rejected; next specific title is used
  const textNotif = "NOTIFICATION\nCommon Recruitment for Officers";
  const exT1 = extractIntakeFields(textNotif,
    "https://ibps.in/notif.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("TITLE-REJ-1", exT1.title !== "NOTIFICATION",
    `NOTIFICATION heading rejected (got: ${exT1.title})`);

  // TITLE-REJ-2: "NOTICE" alone is rejected
  const textNotice = "NOTICE\nSSC CGL Recruitment 2026";
  const exT2 = extractIntakeFields(textNotice,
    "https://ssc.gov.in/notice.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("TITLE-REJ-2", exT2.title !== "NOTICE",
    `NOTICE heading rejected (got: ${exT2.title})`);

  // TITLE-REJ-3: "ADVERTISEMENT" alone is rejected
  const textAdvt = "ADVERTISEMENT\nRecruitment for Sub-Inspector Posts 2025";
  const exT3 = extractIntakeFields(textAdvt,
    "https://crpf.gov.in/advt.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("TITLE-REJ-3", exT3.title !== "ADVERTISEMENT",
    `ADVERTISEMENT heading rejected (got: ${exT3.title})`);

  // TITLE-REJ-4: "IMPORTANT NOTICE" alone is rejected
  const textImportant = "IMPORTANT NOTICE\nRecruit Notification 2025";
  const exT4 = extractIntakeFields(textImportant,
    "https://ssc.gov.in/imp.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("TITLE-REJ-4", exT4.title !== "IMPORTANT NOTICE",
    `IMPORTANT NOTICE heading rejected (got: ${exT4.title})`);

  // VAC-PG-1: TOC page-range text "44-53" must NOT be extracted as vacancies
  const tocText = "ANNEXURE I VACANCIES UNDER CRP RRBs XV 44-53\nANNEXURE II DETAILS 54-67";
  const exV1 = extractIntakeFields(tocText,
    "https://ibps.in/crp-rrbs-xv.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("VAC-PG-1", exV1.totalVacancies !== 44,
    `page-range start 44 not extracted as vacancies (got: ${exV1.totalVacancies})`);
  assert("VAC-PG-2", exV1.totalVacancies === undefined,
    `no vacancies extracted from TOC page-range text (got: ${exV1.totalVacancies})`);

  // VAC-PG-3: Real vacancy statement with plain number is still extracted correctly
  const realVacancy = "Total Vacancies: 8612\nApply before 21.07.2025.";
  const exV2 = extractIntakeFields(realVacancy,
    "https://ibps.in/crp-po.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("VAC-PG-3", exV2.totalVacancies === 8612,
    `real vacancy count 8612 still extracted (got: ${exV2.totalVacancies})`);
}

async function testIBPS_YEAR_SLUG() {
  console.log("\nIBPS-8I-SLUG — slug derives year from applicationOpenDate, not new Date()");

  const PDF_URL = "https://www.ibps.in/wp-content/uploads/Detailed-Notification_CRP-PO-XV.pdf";

  const result = await runIntake(PDF_URL, {
    fetchFn: mockFetch({}),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: IBPS_CRP_PO_XV_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  const slug = result.draft?.slug ?? "";
  const currentYear = new Date().getFullYear().toString();

  // The PDF text has applicationOpenDate=2025-07-01, so slug year must be 2025.
  assert("IBPS-SLUG-1",
    !slug.endsWith(`-${currentYear}`),
    `slug does not end with fabricated current year ${currentYear} (got: ${slug})`);
  assert("IBPS-SLUG-2",
    slug.includes("2025"),
    `slug derives year 2025 from applicationOpenDate (got: ${slug})`);
  assert("IBPS-SLUG-3",
    result.extraction.notificationNumber !== undefined,
    `notificationNumber extracted in full pipeline (got: ${result.extraction.notificationNumber})`);
}

// ─── Phase 8J: testTITLE_EXTENSION ─────────────────────────────
// Hanging-preposition extension: titles ending with "FOR", "OF", etc. must
// concatenate the continuation line. Unaffected titles must not be extended.

function testTITLE_EXTENSION() {
  console.log("\nTITLE-EXT — hanging preposition triggers title continuation");

  // TITLE-EXT-1: "COMMON RECRUITMENT PROCESS FOR" extends to next line
  const text1 = "NOTIFICATION\nCOMMON RECRUITMENT PROCESS FOR\nRECRUITMENT OF PROBATIONARY OFFICERS";
  const ex1 = extractIntakeFields(text1,
    "https://ibps.in/notif.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("TITLE-EXT-1",
    (ex1.title ?? "").toUpperCase().includes("OFFICERS"),
    `title extends past hanging preposition "FOR" (got: ${ex1.title})`);
  assert("TITLE-EXT-1b",
    (ex1.title ?? "").toUpperCase().includes("PROCESS FOR"),
    `extended title still contains original preposition phrase (got: ${ex1.title})`);

  // TITLE-EXT-2: title NOT ending with hanging preposition is NOT extended
  const text2 = "NOTIFICATION\nCOMMON RECRUITMENT PROCESS\nDETAILS OF SELECTION";
  const ex2 = extractIntakeFields(text2,
    "https://ibps.in/notif2.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("TITLE-EXT-2",
    !(ex2.title ?? "").toUpperCase().includes("SELECTION"),
    `title without trailing preposition does not swallow next line (got: ${ex2.title})`);

  // TITLE-EXT-3: existing test fixture with full title on one line is unchanged
  const text3 = "NOTIFICATION\nCommon Recruitment Process for Probationary Officers / Management Trainees\n(CRP PO/MTs XV)";
  const ex3 = extractIntakeFields(text3,
    "https://ibps.in/notif3.pdf", undefined, undefined, "OFFICIAL_PDF");
  assert("TITLE-EXT-3",
    (ex3.title ?? "").toLowerCase().includes("management trainees"),
    `single-line title with trailing content word is returned intact (got: ${ex3.title})`);
  assert("TITLE-EXT-3b",
    !(ex3.title ?? "").includes("CRP PO/MTs XV"),
    `parenthetical line starting with "(" is never appended (got: ${ex3.title})`);
}

// ─── Phase 8J: testPOSTDATE_NOT_FABRICATED ─────────────────────
// draft.postDate must be undefined (not today's date) when the PDF
// does not contain an explicit post/advertisement date.

async function testPOSTDATE_NOT_FABRICATED() {
  console.log("\nPOSTDATE-NF — draft.postDate is not fabricated when not in source");

  const PDF_URL = "https://www.ibps.in/wp-content/uploads/Detailed-Notification_CRP-PO-XV.pdf";

  const result = await runIntake(PDF_URL, {
    fetchFn: mockFetch({}),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: IBPS_CRP_PO_XV_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  const today = new Date().toISOString().slice(0, 10);
  assert("POSTDATE-NF-1",
    result.draft?.postDate !== today,
    `draft.postDate is not today's date — not fabricated (got: ${result.draft?.postDate})`);
  assert("POSTDATE-NF-2",
    result.extraction.applicationOpenDate !== undefined,
    `applicationOpenDate still extracted even when postDate is absent (got: ${result.extraction.applicationOpenDate})`);
}

// ─── Phase 9C: Date extraction regression ─────────────────────
//
// Covers the IBPS CRP-RRBs-XV extraction bug where pattern 3 in closePatterns
// matched "on or before 20.09.2027 are eligible to apply" (Ex-Servicemen SPE
// deadline) instead of the application close date from the Important Dates table.
//
// Fix: (1) bare date-range fallback for "DD.MM.YYYY to DD.MM.YYYY" tables,
//      (2) context-narrowed "before/upto" pattern.

function testDATEEXTRACTION_REGRESSION() {
  console.log("\nDATE-REGR — Phase 9C: application date extraction regression tests");

  // A. IBPS CRP-RRBs-XV scenario: Important Dates table + Ex-Servicemen SPE clause
  const IBPS_SCENARIO = [
    "IBPS CRP RRBs XV Notification",
    "Notification No.: CRP RRBs XV",
    "Total Vacancies: 1979",
    "",
    "Important Dates",
    "Activity                         Tentative Schedule",
    "Online Registration              01.09.2026 to 21.09.2026",
    "Payment of Application Fees      01.09.2026 to 21.09.2026",
    "",
    "ELIGIBILITY CRITERIA",
    "Ex-Servicemen: Candidates whose date of completion of specific period of",
    "engagement (SPE) is completed one year from the last date for receipt of",
    "online application i.e. on or before 20.09.2027 are eligible to apply.",
  ].join("\n");

  const exA = extractIntakeFields(
    IBPS_SCENARIO,
    "https://www.ibps.in/wp-content/uploads/CRP-RRBs-XV-notification.pdf"
  );
  assert(
    "DATE-REGR.A1",
    exA.applicationOpenDate === "2026-09-01",
    `A: open = 2026-09-01 from bare range (got: ${exA.applicationOpenDate})`
  );
  assert(
    "DATE-REGR.A2",
    exA.applicationCloseDate === "2026-09-21",
    `A: close = 2026-09-21 from bare range (got: ${exA.applicationCloseDate})`
  );
  assert(
    "DATE-REGR.A3",
    exA.applicationCloseDate !== "2027-09-20",
    `A: Ex-Servicemen SPE date 2027-09-20 NOT used as close date`
  );

  // B. Bare date range only — no label keywords
  const BARE_ONLY = "01.09.2026 to 21.09.2026";
  const exB = extractIntakeFields(BARE_ONLY, "https://ibps.in/test.pdf");
  assert(
    "DATE-REGR.B1",
    exB.applicationOpenDate === "2026-09-01",
    `B: open = 2026-09-01 from bare range (got: ${exB.applicationOpenDate})`
  );
  assert(
    "DATE-REGR.B2",
    exB.applicationCloseDate === "2026-09-21",
    `B: close = 2026-09-21 from bare range (got: ${exB.applicationCloseDate})`
  );

  // C. Ex-Servicemen eligibility clause alone — must NOT become close date
  const ELIGIBILITY_ONLY = [
    "Candidates whose date of completion of specific period of engagement (SPE)",
    "is completed one year from the last date for receipt of online application",
    "i.e. on or before 20.09.2027 are eligible to apply.",
  ].join("\n");
  const exC = extractIntakeFields(ELIGIBILITY_ONLY, "https://ibps.in/test.pdf");
  assert(
    "DATE-REGR.C1",
    exC.applicationCloseDate !== "2027-09-20",
    `C: eligibility SPE date 2027-09-20 NOT extracted as close date`
  );
  assert(
    "DATE-REGR.C2",
    exC.applicationCloseDate === undefined,
    `C: close = undefined from eligibility-only text (got: ${exC.applicationCloseDate})`
  );

  // D. Label-based extraction still works; correction window bare range does not override
  const LABEL_BASED = [
    "Online Registration Start Date: 25/08/2026",
    "Last Date for Online Registration: 24/09/2026",
    "Correction Window: 26/09/2026 to 28/09/2026",
  ].join("\n");
  const exD = extractIntakeFields(LABEL_BASED, "https://bceceboard.bihar.gov.in/test.pdf");
  assert(
    "DATE-REGR.D1",
    exD.applicationOpenDate === "2026-08-25",
    `D: open = 2026-08-25 from label pattern (got: ${exD.applicationOpenDate})`
  );
  assert(
    "DATE-REGR.D2",
    exD.applicationCloseDate === "2026-09-24",
    `D: close = 2026-09-24 from label pattern (got: ${exD.applicationCloseDate})`
  );
  assert(
    "DATE-REGR.D3",
    exD.applicationCloseDate !== "2026-09-28",
    `D: correction window end date NOT used as close date`
  );
}

// ─── Phase 9D: LOCAL_PDF_* tests ──────────────────────────────
// Verifies the "local PDF" intake path (operator-supplied PDF via
// --local-pdf CLI flag). The engine sees a fetchPdfFn built from a
// local buffer; these tests confirm extraction equivalence, graceful
// failure, provenance safety, and no regression to URL-only intake.

// Fixture: IBPS official page with no PDF link (Stage C not triggered)
const IBPS_NO_PDF_HTML_REG = `
<html><head><title>IBPS RRB XV 2026 Recruitment</title></head><body>
<h1>IBPS CRP-RRBs-XV 2026</h1>
<p>Advt. No.: CRP-RRBs-XV | Notification Date: 01/09/2026</p>
<p>Online Registration Start: 01/09/2026</p>
<p>Last Date for Online Registration: 21/09/2026</p>
<p>Total Vacancies: 1979</p>
<a href="https://ibps.in/apply">Apply Online</a>
</body></html>`;

async function testLOCAL_PDF_EQUIV() {
  console.log("\nLOCAL-PDF-EQUIV — local PDF fetchPdfFn gives same extraction as URL fetchPdfFn");

  const PDF_URL = "https://bceceboard.bihar.gov.in/pdf_Pros/PROS_BSFC26.pdf";

  const urlResult = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: mockFetchPdf({ [PDF_URL]: BCECE_PDF_TEXT }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  // Simulate: fetchPdfFn built from local buffer — returns same text regardless of URL
  const localFetchPdfFn: FetchPdfFn = async () => ({ ok: true, text: BCECE_PDF_TEXT });

  const localResult = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: localFetchPdfFn,
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("LOCAL-PDF-EQUIV.1",
    localResult.extraction.applicationCloseDate === urlResult.extraction.applicationCloseDate,
    `applicationCloseDate matches URL path (got: ${localResult.extraction.applicationCloseDate})`
  );
  assert("LOCAL-PDF-EQUIV.2",
    localResult.extraction.totalVacancies === urlResult.extraction.totalVacancies,
    `totalVacancies matches URL path (got: ${localResult.extraction.totalVacancies})`
  );
  assert("LOCAL-PDF-EQUIV.3",
    localResult.pdfExtraction !== undefined,
    "pdfExtraction is present on local path"
  );
}

async function testLOCAL_PDF_FAIL() {
  console.log("\nLOCAL-PDF-FAIL — failed local PDF fetchPdfFn falls back gracefully (no crash)");

  const failLocalFetchPdfFn: FetchPdfFn = async () => ({
    ok: false,
    text: null,
    error: "Could not extract text from local buffer (simulated corrupt PDF)",
  });

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: failLocalFetchPdfFn,
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("LOCAL-PDF-FAIL.1", !result.error, "no fatal error on local PDF failure");
  assert("LOCAL-PDF-FAIL.2", result.pdfExtraction === undefined, "pdfExtraction absent on failure");
  assert("LOCAL-PDF-FAIL.3",
    result.analysisNotes.some((n) => n.toLowerCase().includes("stage c") && n.toLowerCase().includes("fail")),
    "analysisNotes mentions Stage C failure"
  );
  assert("LOCAL-PDF-FAIL.4",
    result.extraction.totalVacancies === 259,
    `Stage A vacancies preserved on local PDF failure (got: ${result.extraction.totalVacancies})`
  );
}

async function testLOCAL_PDF_PROV() {
  console.log("\nLOCAL-PDF-PROV — provenance URL is official domain, never a local file path");

  const localFetchPdfFn: FetchPdfFn = async () => ({ ok: true, text: BCECE_PDF_TEXT });

  const result = await runIntake("https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/", {
    fetchFn: mockFetch({
      "https://govtjobguru.in/jobs/bcece-bsfc-recruitment-2026/": GOVTJOBGURU_BCECE_HTML,
      "https://bceceboard.bihar.gov.in": BCECEBOARD_OFFICIAL_HTML,
    }),
    fetchPdfFn: localFetchPdfFn,
    canonicalRecords: [],
    existingCandidates: [],
  });

  const primary = result.draft?.provenance.primarySourceUrl ?? "";
  assert("LOCAL-PDF-PROV.1",
    primary.includes("bceceboard.bihar.gov.in"),
    `primarySourceUrl is official domain (got: ${primary})`
  );
  assert("LOCAL-PDF-PROV.2",
    !primary.startsWith("/") && !primary.startsWith("C:") && !primary.startsWith("file:"),
    "primarySourceUrl is not a local filesystem path"
  );
  assert("LOCAL-PDF-PROV.3",
    result.extraction.notifPdfUrl?.includes("bceceboard.bihar.gov.in") === true,
    `notifPdfUrl is official PDF URL (got: ${result.extraction.notifPdfUrl})`
  );
}

async function testLOCAL_PDF_REGRESSION() {
  console.log("\nLOCAL-PDF-REG — normal URL-only intake (no fetchPdfFn) still works correctly");

  const result = await runIntake("https://ibps.in/rrb-xv-2026", {
    fetchFn: mockFetch({ "https://ibps.in/rrb-xv-2026": IBPS_NO_PDF_HTML_REG }),
    canonicalRecords: [],
    existingCandidates: [],
  });

  assert("LOCAL-PDF-REG.1", !result.error, "no fatal error without fetchPdfFn");
  assert("LOCAL-PDF-REG.2",
    result.extraction.totalVacancies === 1979,
    `vacancies extracted correctly (got: ${result.extraction.totalVacancies})`
  );
  assert("LOCAL-PDF-REG.3",
    result.pdfExtraction === undefined,
    "pdfExtraction absent when no PDF URL discovered"
  );
}

// ─── Run all tests ─────────────────────────────────────────────

async function main() {
  console.log("═".repeat(72));
  console.log("  Phase 8 / 8B / 8C / 8D / 8E / 8F / 8I / 8J / 9D Intake Tests");
  console.log("═".repeat(72));

  testFieldExtraction();
  await testINT1();
  await testINT2();
  testINT3();
  await testINT4();
  await testINT5();
  testINT6();
  await testINT7();
  await testINT8();
  await testINT9();
  await testINT10();
  await testINT11();
  await testINT12();
  await testTBADates();
  // Phase 8B
  testAGG();
  await testBCECE_ORG();
  await testBCECE_LINK();
  await testBCECE_TWOSTAGE();
  await testBCECE_CHAIN();
  await testNO_WRITES();
  await testPROVENANCE_GUARD();
  testDERIVE_ORG();
  // Phase 8C
  testPDF_NOTIF_NUMBER();
  await testPDF_STAGEC();
  await testPDF_CHAIN();
  await testPDF_GRACEFUL_FAIL();
  await testPDF_NO_WRITES();
  await testPDF_PROVENANCE();
  // Phase 8D — source specificity / evidence precedence
  await testSPEC_PDF_SPECIFICITY();
  testSPEC_YEAR_VACANCY();
  testSPEC_PDF_RANKING();
  await testSPEC_FIELD_SOURCES();
  await testSPEC_GENERIC_PAGE();
  // Phase 8E — cross-stage recruitment context injection
  await testXS_SLUG_CONTEXT_RANKING();
  await testXS_SLUG_EVIDENCE_ONLY();
  await testXS_WRONG_SLUG_NO_BLIND_PICK();
  await testXS_OFFICIAL_CONTEXT_BEATS_SLUG();
  await testXS_AMBIGUOUS_UNRESOLVED();
  // Phase 8F — source authority (OFFICIAL_PDF > OFFICIAL_GENERIC > THIRD_PARTY)
  await testF8_PDF_AUTHORITY_BEATS_HOMEPAGE();
  await testF8_GENERIC_TITLE_PRESERVED();
  await testF8_LOWER_AUTH_FILLS_MISSING();
  await testF8_FINAL_PDF_IS_AUTHORITATIVE();
  // Phase 8G — extraction quality (plain-text PDF heuristics)
  await testF8G_EXTRACTION_QUALITY();
  // Phase 8H — OFFICIAL_GENERIC isolation + PDF quality assessment
  await testOFFICIAL_GENERIC_ISOLATION();
  testPDF_QUALITY_ASSESSMENT();
  // Phase 8I — IBPS CRP extraction, title/slug/vacancy fixes
  testIBPS_CRP_EXTRACTION();
  await testIBPS_YEAR_SLUG();
  // Phase 8J — title extension + no fabricated postDate
  testTITLE_EXTENSION();
  await testPOSTDATE_NOT_FABRICATED();
  // Phase 9C — date extraction regression (bare range + Ex-Servicemen fix)
  testDATEEXTRACTION_REGRESSION();
  // Phase 9D — local PDF intake path
  await testLOCAL_PDF_EQUIV();
  await testLOCAL_PDF_FAIL();
  await testLOCAL_PDF_PROV();
  await testLOCAL_PDF_REGRESSION();

  console.log("\n" + "═".repeat(72));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log("\n  Failures:");
    for (const e of errors) console.log(e);
  }
  console.log("═".repeat(72) + "\n");

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[INTAKE-TEST][FATAL]", e);
  process.exit(1);
});
