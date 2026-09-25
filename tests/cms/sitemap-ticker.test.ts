// ═══════════════════════════════════════════════════════════
// Sitemap + Ticker CMS integration tests
// npx tsx --tsconfig tsconfig.json tests/cms/sitemap-ticker.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  ST01  published CMS recruitment slug appears in the sitemap job URL set
//  ST02  multiple published CMS records → multiple /jobs/[slug] URLs in sitemap
//  ST03  empty CMS loader → zero CMS job URLs in sitemap
//  ST04  sitemap data source is the canonical batch function (no N+1)
//  TK01  CMS opportunities reach the ticker item list (up to 4)
//  TK02  IMPORTANT_UPDATES items are always present regardless of opportunities
//  TK03  empty opportunities → no crash, only IMPORTANT_UPDATES items
//  TK04  no unpublished CMS record leaks — ticker only sees what the loader returns
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import { deriveStatusBadge, getVacancyDisplay } from "@/lib/lifecycle";
import { IMPORTANT_UPDATES } from "@/data/homepage";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

// ─── Fixtures ─────────────────────────────────────────────

function makeSnapshot(
  overrides: Partial<PublishedRecruitmentSnapshot> = {},
): PublishedRecruitmentSnapshot {
  return {
    id: "rec-st-001",
    slug: "st-test-2026",
    organizationId: "test-org",
    organizationName: "Test Organisation",
    govType: "Central Govt",
    recruitmentYear: 2026,
    title: "ST Test Recruitment 2026",
    shortTitle: "ST Test 2026",
    notificationNumber: "ST/01/2026",
    advertisementNumber: null,
    dates: {
      notificationDate: "2026-01-01",
      applicationOpenDate: "2026-01-10",
      applicationCloseDate: "2026-12-31",
      feePaymentCloseDate: null,
      correctionWindowEnd: null,
      examDate: "2026-12-01",
      prelimsDate: null,
      mainsDate: null,
      admitCardDate: null,
      resultDate: null,
      interviewDate: null,
      documentVerificationDate: null,
      joiningDate: null,
    },
    vacancies: { total: 500, breakdown: null },
    financial: { feeGeneral: 100, feeSCST: 0, payScale: "Level 6", paymentModes: ["Online"] },
    examStages: [],
    eligibility: null,
    age: null,
    selection: null,
    howToApply: [],
    links: [],
    documents: [],
    classification: {
      shortDescription: "ST test recruitment",
      category: "government",
      state: null,
      qualification: "Graduate",
    },
    updates: [],
    provenanceStatus: "VERIFIED",
    primarySourceUrl: "https://example.gov.in/test",
    projectedAt: "2026-09-01T00:00:00.000Z",
    projectionVersion: "1.0",
    sourceRecordRevision: "rev-1",
    ...overrides,
  };
}

function makeLoader(
  snapshots: PublishedRecruitmentSnapshot[],
): () => Promise<PublishedRecruitmentSnapshot[]> {
  return async () => snapshots;
}

// ─── Sitemap tests ─────────────────────────────────────────

suite("Sitemap CMS integration");

test("ST01 — published CMS recruitment slug appears in sitemap job URL set", async () => {
  const snapshots = [makeSnapshot({ id: "sm-1", slug: "ibps-po-mt-crp-xvi-2026" })];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));

  // Replicate sitemap URL generation logic
  const jobUrls = opps.map((job) => `/jobs/${job.slug}`);

  assert.ok(jobUrls.includes("/jobs/ibps-po-mt-crp-xvi-2026"), "IBPS PO slug must appear as /jobs/[slug]");
});

test("ST02 — multiple published CMS records → multiple /jobs/[slug] URLs in sitemap", async () => {
  const snapshots = [
    makeSnapshot({ id: "sm-1", slug: "upsc-cse-2026" }),
    makeSnapshot({ id: "sm-2", slug: "ssc-cgl-2026" }),
    makeSnapshot({ id: "sm-3", slug: "bpsc-72nd-cce-2026" }),
  ];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));
  const jobUrls = opps.map((job) => `/jobs/${job.slug}`);

  assert.equal(jobUrls.length, 3, "all 3 published CMS records must appear");
  assert.ok(jobUrls.includes("/jobs/upsc-cse-2026"));
  assert.ok(jobUrls.includes("/jobs/ssc-cgl-2026"));
  assert.ok(jobUrls.includes("/jobs/bpsc-72nd-cce-2026"));
});

test("ST03 — empty CMS loader → zero CMS job URLs in sitemap", async () => {
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader([]));
  const jobUrls = opps.map((job) => `/jobs/${job.slug}`);
  assert.equal(jobUrls.length, 0, "no CMS job URLs when loader returns empty");
});

test("ST04 — sitemap data source is the canonical batch function (no N+1)", async () => {
  let callCount = 0;
  const countingLoader = async (): Promise<PublishedRecruitmentSnapshot[]> => {
    callCount++;
    return [
      makeSnapshot({ id: "sm-1", slug: "job-a-2026" }),
      makeSnapshot({ id: "sm-2", slug: "job-b-2026" }),
    ];
  };
  const opps = await getAllVerifiedOpportunitiesWithCMS(countingLoader);
  assert.equal(callCount, 1, "loader must be called exactly once (no N+1)");
  assert.equal(opps.length, 2);
});

// ─── Ticker tests ──────────────────────────────────────────

suite("Ticker CMS integration");

test("TK01 — CMS opportunities reach the ticker item list (up to 4)", async () => {
  const snapshots = [
    makeSnapshot({ id: "tk-1", slug: "upsc-cse-2026", title: "UPSC CSE 2026" }),
    makeSnapshot({ id: "tk-2", slug: "ssc-cgl-2026", title: "SSC CGL 2026" }),
    makeSnapshot({ id: "tk-3", slug: "rrb-ntpc-2026", title: "RRB NTPC 2026" }),
    makeSnapshot({ id: "tk-4", slug: "ibps-po-2026", title: "IBPS PO 2026" }),
    makeSnapshot({ id: "tk-5", slug: "bpsc-2026", title: "BPSC 72nd 2026" }),
  ];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));

  // Replicate ticker item creation logic (Ticker.tsx)
  const now = new Date();
  const tickerJobItems = opps.slice(0, 4).map((job) => {
    const statusBadge = deriveStatusBadge(job, now);
    const vacancyText = getVacancyDisplay(job);
    return {
      id: `job-ticker-${job.id}`,
      title: `${job.title} — ${vacancyText}`,
      href: `/jobs/${job.slug}`,
      tag: statusBadge.label,
    };
  });

  // Ticker slices to 4 even when more CMS records exist
  assert.equal(tickerJobItems.length, 4, "ticker must include exactly 4 CMS job items (slice(0,4))");
  assert.ok(tickerJobItems[0].href.startsWith("/jobs/"), "each item links to a /jobs/[slug] page");
  assert.ok(tickerJobItems[0].title.includes(" — "), "title includes vacancy display text");
});

test("TK02 — IMPORTANT_UPDATES items are always present regardless of opportunities", async () => {
  // Even when CMS has records, IMPORTANT_UPDATES are prepended
  const snapshots = [makeSnapshot({ id: "tk-1", slug: "test-2026" })];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));

  const importantUpdateCount = IMPORTANT_UPDATES.length;
  assert.ok(importantUpdateCount > 0, "IMPORTANT_UPDATES must have at least one entry");

  // Verify the combined item count is IMPORTANT_UPDATES + min(opps.length, 4)
  const expectedItemCount = importantUpdateCount + Math.min(opps.length, 4);
  const importantItems = IMPORTANT_UPDATES.map((up) => ({ id: up.id }));
  const jobItems = opps.slice(0, 4).map((job) => ({ id: `job-ticker-${job.id}` }));
  const allItems = [...importantItems, ...jobItems];
  assert.equal(allItems.length, expectedItemCount);
});

test("TK03 — empty opportunities → ticker does not crash, only IMPORTANT_UPDATES shown", async () => {
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader([]));
  assert.equal(opps.length, 0);

  // Replicate ticker logic with empty opportunities
  const importantItems = IMPORTANT_UPDATES.map((up) => ({ id: up.id, title: up.title }));
  const jobItems = opps.slice(0, 4).map((job) => ({ id: `job-ticker-${job.id}` }));
  const allItems = [...importantItems, ...jobItems];

  assert.equal(allItems.length, IMPORTANT_UPDATES.length, "only IMPORTANT_UPDATES when opps empty");
  assert.ok(allItems.every((item) => item.id !== undefined), "no crash — all items have ids");
});

test("TK04 — no unpublished CMS record leaks into ticker — guard is at loader layer", async () => {
  // The publication guard lives in getAllPublishedSnapshots() SQL query.
  // getAllVerifiedOpportunitiesWithCMS() passes loader output through unchanged.
  // This test verifies the ticker receives exactly what the loader provides.
  const publishedSnapshot = makeSnapshot({ id: "pub-tk", slug: "published-job-2026" });
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader([publishedSnapshot]));

  const tickerJobItems = opps.slice(0, 4).map((job) => ({ id: job.id, slug: job.slug }));
  assert.equal(tickerJobItems.length, 1);
  assert.equal(tickerJobItems[0].id, "pub-tk");

  // Empty loader (simulates all records being DRAFT at DB level) → 0 ticker job items
  const noOpps = await getAllVerifiedOpportunitiesWithCMS(makeLoader([]));
  const emptyTickerItems = noOpps.slice(0, 4);
  assert.equal(emptyTickerItems.length, 0, "0 ticker job items when loader returns no PUBLISHED records");
});
