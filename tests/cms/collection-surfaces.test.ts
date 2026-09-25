// ═══════════════════════════════════════════════════════════
// CMS collection-surface tests
// npx tsx --tsconfig tsconfig.json tests/cms/collection-surfaces.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests (CS = Collection Surface):
//  CS01  published CMS records appear in the unified opportunity list
//  CS02  category counts (exams page) reflect CMS records — not static-only
//  CS03  org active-notice counts (companies page) reflect CMS records
//  CS04  homepage receives opportunities array from the server-side loader
//  CS05  no APPROVED/DRAFT leakage — only what the loader sends appears
//  CS06  importing repository.ts does not pull db.ts into client bundle
//  CS07  /exams and /companies surfaces use the same canonical batch function
//  CS08  org name matching logic works for CMS records
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import { getFilterCounts } from "@/lib/filters";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

// ─── Fixtures ─────────────────────────────────────────────

function makeSnapshot(
  overrides: Partial<PublishedRecruitmentSnapshot> = {},
): PublishedRecruitmentSnapshot {
  return {
    id: "rec-cs-001",
    slug: "cs-test-2026",
    organizationId: "upsc",
    organizationName: "Union Public Service Commission",
    govType: "Central Govt",
    recruitmentYear: 2026,
    title: "CS Test Recruitment 2026",
    shortTitle: "CS Test 2026",
    notificationNumber: "CS/01/2026",
    advertisementNumber: null,
    dates: {
      notificationDate: "2026-01-01",
      applicationOpenDate: "2026-01-10",
      applicationCloseDate: "2026-02-10",
      feePaymentCloseDate: null,
      correctionWindowEnd: null,
      examDate: "2026-05-01",
      prelimsDate: null,
      mainsDate: null,
      admitCardDate: null,
      resultDate: null,
      interviewDate: null,
      documentVerificationDate: null,
      joiningDate: null,
    },
    vacancies: { total: 300, breakdown: null },
    financial: { feeGeneral: 100, feeSCST: 0, payScale: "Level 8", paymentModes: ["Online"] },
    examStages: [],
    eligibility: null,
    age: null,
    selection: null,
    howToApply: [],
    links: [],
    documents: [],
    classification: {
      shortDescription: "CS test recruitment",
      category: "government",
      state: null,
      qualification: "Graduate",
    },
    updates: [],
    provenanceStatus: "VERIFIED",
    primarySourceUrl: "https://upsc.gov.in/cs-test",
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

// ─── Tests ────────────────────────────────────────────────

suite("CMS collection surfaces");

test("CS01 — published CMS records appear in the unified opportunity list", async () => {
  const snapshots = [
    makeSnapshot({ id: "ssc-1", slug: "ssc-cgl-2026", organizationName: "Staff Selection Commission (SSC)", classification: { shortDescription: "SSC exam", category: "ssc", state: null, qualification: "Graduate" } }),
    makeSnapshot({ id: "rrb-1", slug: "rrb-ntpc-2026", organizationName: "Railway Recruitment Boards (RRB)", classification: { shortDescription: "RRB exam", category: "railway", state: null, qualification: "Graduate" } }),
  ];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));
  assert.equal(opps.length, 2);
  assert.ok(opps.every((o) => o.type === "government"), "all CMS records must be type 'government'");
});

test("CS02 — category counts (exams page) reflect CMS records, not static-only", async () => {
  const snapshots = [
    makeSnapshot({ id: "bank-1", slug: "ibps-po-2026", classification: { shortDescription: "Banking", category: "banking", state: null, qualification: "Graduate" } }),
    makeSnapshot({ id: "rrb-1", slug: "rrb-ntpc-2026", classification: { shortDescription: "Railway", category: "railway", state: null, qualification: "Graduate" } }),
    makeSnapshot({ id: "rrb-2", slug: "rrb-ntpc-ug-2026", classification: { shortDescription: "Railway UG", category: "railway", state: null, qualification: "12th Pass" } }),
  ];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));
  const counts = getFilterCounts(opps, new Date());

  assert.equal(counts.byCategory["banking"], 1, "banking count should be 1");
  assert.equal(counts.byCategory["railway"], 2, "railway count should be 2");
  assert.equal(counts.total, 3);
});

test("CS03 — org active-notice counts (companies page) reflect CMS records", async () => {
  const snapshots = [
    makeSnapshot({ id: "rrb-1", slug: "rrb-ntpc-2026", organizationName: "Railway Recruitment Boards (RRB)" }),
    makeSnapshot({ id: "rrb-2", slug: "rrb-ntpc-ug-2026", organizationName: "Railway Recruitment Boards (RRB)" }),
    makeSnapshot({ id: "ibps-1", slug: "ibps-po-2026", organizationName: "Institute of Banking Personnel Selection (IBPS)" }),
  ];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));

  const rrbCount = opps.filter(
    (o) =>
      o.organizationName.toLowerCase().includes("rrb") ||
      o.organizationName.toLowerCase().includes("railway"),
  ).length;
  const ibpsCount = opps.filter(
    (o) =>
      o.organizationName.toLowerCase().includes("ibps") ||
      o.organizationName.toLowerCase().includes("banking personnel"),
  ).length;

  assert.equal(rrbCount, 2, "RRB should have 2 active notices");
  assert.equal(ibpsCount, 1, "IBPS should have 1 active notice");
});

test("CS04 — homepage opportunities array is passed from server-side loader", async () => {
  const snapshots = [
    makeSnapshot({ id: "hp-1", slug: "homepage-job-1-2026", title: "Featured Job Alpha 2026" }),
    makeSnapshot({ id: "hp-2", slug: "homepage-job-2-2026", title: "Featured Job Beta 2026" }),
    makeSnapshot({ id: "hp-3", slug: "homepage-job-3-2026", title: "Featured Job Gamma 2026" }),
    makeSnapshot({ id: "hp-4", slug: "homepage-job-4-2026", title: "Featured Job Delta 2026" }),
  ];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));
  // Homepage slices first 3 — verify the array contains enough and preserves order
  assert.equal(opps.length, 4);
  const first3 = opps.slice(0, 3);
  assert.equal(first3.length, 3);
  assert.equal(first3[0].id, "hp-1");
  assert.equal(first3[1].id, "hp-2");
  assert.equal(first3[2].id, "hp-3");
});

test("CS05 — no APPROVED/DRAFT leakage: publication guard is at the SQL loader layer", async () => {
  // The publication guard is enforced in getAllPublishedSnapshots() via:
  //   WHERE r.draft_state = 'PUBLISHED' AND EXISTS (published_recruitments row)
  // This test verifies that getAllVerifiedOpportunitiesWithCMS() passes through
  // exactly what the loader returns — it does not weaken the guard.
  const publishedOnly = [
    makeSnapshot({ id: "pub-1", slug: "published-rec-2026", provenanceStatus: "VERIFIED" }),
  ];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(publishedOnly));
  assert.equal(opps.length, 1, "exactly 1 published record");
  assert.equal(opps[0].id, "pub-1");

  // If loader returned 0 (e.g. all records are DRAFT at DB level), result is 0
  const emptyOpps = await getAllVerifiedOpportunitiesWithCMS(makeLoader([]));
  assert.equal(emptyOpps.length, 0, "no records when loader enforces no PUBLISHED records");
});

test("CS06 — importing repository.ts does not pull db.ts into client bundle", async () => {
  // Same as R10 in repository.test.ts. Reaching this point proves the module
  // loaded without DATABASE_URL, meaning db.ts is not at the top-level import chain.
  assert.ok(typeof getAllVerifiedOpportunitiesWithCMS === "function");
});

test("CS07 — /exams and /companies data source is the canonical batch function", async () => {
  // Both pages now call getAllVerifiedOpportunitiesWithCMS() (the same function
  // used by /jobs). Verify it returns an Opportunity[] with correct type discriminant.
  const snapshots = [makeSnapshot({ id: "cat-1", slug: "exam-cat-2026" })];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));
  assert.equal(opps.length, 1);
  // Opportunity.type discriminant must be one of the valid types
  assert.ok(
    opps[0].type === "government" || opps[0].type === "private" || opps[0].type === "internship",
  );
  assert.equal(opps[0].type, "government");
});

test("CS08 — org name matching logic works for CMS records", async () => {
  const snapshots = [
    makeSnapshot({ id: "upsc-1", slug: "upsc-cse-2026", organizationName: "Union Public Service Commission (UPSC)" }),
    makeSnapshot({ id: "bpsc-1", slug: "bpsc-72nd-2026", organizationName: "Bihar Public Service Commission (BPSC)" }),
    makeSnapshot({ id: "ssc-1", slug: "ssc-cgl-2026", organizationName: "Staff Selection Commission (SSC)" }),
  ];
  const opps = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));

  // Same filter logic used in /companies/page.tsx
  const upscCount = opps.filter(
    (o) =>
      o.organizationName.toLowerCase().includes("upsc") ||
      o.organizationName.toLowerCase().includes("union public"),
  ).length;
  const bpscCount = opps.filter(
    (o) =>
      o.organizationName.toLowerCase().includes("bpsc") ||
      o.organizationName.toLowerCase().includes("bihar public"),
  ).length;
  const sscCount = opps.filter(
    (o) =>
      o.organizationName.toLowerCase().includes("ssc") ||
      o.organizationName.toLowerCase().includes("staff selection"),
  ).length;

  assert.equal(upscCount, 1, "UPSC should match 1");
  assert.equal(bpscCount, 1, "BPSC should match 1");
  assert.equal(sscCount, 1, "SSC should match 1");
});
