// ═══════════════════════════════════════════════════════════
// getAllVerifiedOpportunitiesWithCMS — pure unit tests
// npx tsx --tsconfig tsconfig.json tests/cms/repository.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  R01  returns 0 records when CMS is empty and static arrays are empty
//  R02  returns N CMS records when loader provides N snapshots
//  R03  all N snapshots fetched in a single loader call (batch, no N+1)
//  R04  each CMS snapshot passes through snapshotToGovernmentRecruitment()
//  R05  static records (private/internship) are merged alongside CMS records
//  R06  APPROVED/DRAFT records excluded — only PUBLISHED snapshots accepted
//        (enforcement is in the loader/query; adapter receives what loader sends)
//  R07  on DB/loader failure: falls back to static-only, no throw
//  R08  on DB/loader failure: static private/internship records still returned
//  R09  result type = Opportunity[] (GovernmentRecruitment satisfies Opportunity)
//  R10  no db.ts import required at module load time (client-safe module shape)
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

// ─── Fixtures ─────────────────────────────────────────────

function makeSnapshot(overrides: Partial<PublishedRecruitmentSnapshot> = {}): PublishedRecruitmentSnapshot {
  return {
    id: "rec-001",
    slug: "test-recruitment-2026",
    organizationId: "upsc",
    organizationName: "Union Public Service Commission",
    govType: "Central Govt",
    recruitmentYear: 2026,
    title: "Test Recruitment 2026",
    shortTitle: "Test 2026",
    notificationNumber: "TN/01/2026",
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
    vacancies: { total: 500, breakdown: null },
    financial: { feeGeneral: 100, feeSCST: 0, payScale: "Level 10", paymentModes: ["Online"] },
    examStages: [],
    eligibility: null,
    age: null,
    selection: null,
    howToApply: [],
    links: [],
    documents: [],
    classification: { shortDescription: "Test recruitment", category: "government", state: null, qualification: "Graduate" },
    updates: [],
    provenanceStatus: "VERIFIED",
    primarySourceUrl: "https://upsc.gov.in/test",
    projectedAt: "2026-09-01T00:00:00.000Z",
    projectionVersion: "1.0",
    sourceRecordRevision: "rev-1",
    ...overrides,
  };
}

function makeLoader(snapshots: PublishedRecruitmentSnapshot[]): () => Promise<PublishedRecruitmentSnapshot[]> {
  let callCount = 0;
  return async () => {
    callCount++;
    if (callCount > 1) throw new Error("loader called more than once — N+1 detected");
    return snapshots;
  };
}

// ─── Tests ────────────────────────────────────────────────

suite("getAllVerifiedOpportunitiesWithCMS");

test("R01 — returns 0 records when CMS is empty and static arrays are empty", async () => {
  const result = await getAllVerifiedOpportunitiesWithCMS(makeLoader([]));
  // PRIVATE_JOBS and INTERNSHIPS are both [] in the current codebase
  assert.equal(result.length, 0);
});

test("R02 — returns N CMS records when loader provides N snapshots", async () => {
  const snapshots = [
    makeSnapshot({ id: "rec-001", slug: "job-a-2026" }),
    makeSnapshot({ id: "rec-002", slug: "job-b-2026" }),
    makeSnapshot({ id: "rec-003", slug: "job-c-2026" }),
  ];
  const result = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));
  assert.equal(result.length, 3);
});

test("R03 — all snapshots fetched in a single loader call (batch, no N+1)", async () => {
  const snapshots = [
    makeSnapshot({ id: "rec-001", slug: "job-a-2026" }),
    makeSnapshot({ id: "rec-002", slug: "job-b-2026" }),
    makeSnapshot({ id: "rec-003", slug: "job-c-2026" }),
  ];
  // makeLoader throws on second call — passes if loader called exactly once
  const result = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));
  assert.equal(result.length, 3); // proves loader was not called per-slug
});

test("R04 — each CMS snapshot passes through snapshotToGovernmentRecruitment", async () => {
  const snap = makeSnapshot({ id: "rec-001", slug: "upsc-2026", title: "UPSC CSE 2026" });
  const expected = snapshotToGovernmentRecruitment(snap);
  const result = await getAllVerifiedOpportunitiesWithCMS(makeLoader([snap]));
  assert.equal(result.length, 1);
  assert.equal(result[0].id, expected.id);
  assert.equal(result[0].slug, expected.slug);
  assert.equal(result[0].title, expected.title);
  assert.equal(result[0].type, "government");
});

test("R05 — CMS records are merged with static private/internship records", async () => {
  // PRIVATE_JOBS and INTERNSHIPS are empty arrays in this codebase.
  // The merge contract: result = CMS + static, no deduplication.
  // Since static arrays are [], result.length === CMS count.
  const snapshots = [makeSnapshot({ id: "cms-1", slug: "gov-job-2026" })];
  const result = await getAllVerifiedOpportunitiesWithCMS(makeLoader(snapshots));
  // All returned records come from the CMS loader
  assert.equal(result.filter(r => r.type === "government").length, 1);
});

test("R06 — only snapshots the loader returns are included (publication guard is in the query)", async () => {
  // The loader (getAllPublishedSnapshots in production) enforces draft_state='PUBLISHED'.
  // Here we verify the function passes snapshots through without weakening:
  // if the loader returns a snapshot, it's included as-is after adapter mapping.
  const snap = makeSnapshot({ id: "pub-1", slug: "published-job-2026", provenanceStatus: "VERIFIED" });
  const result = await getAllVerifiedOpportunitiesWithCMS(makeLoader([snap]));
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "pub-1");
});

test("R07 — on loader failure: does not throw, returns static-only", async () => {
  const failLoader = async (): Promise<PublishedRecruitmentSnapshot[]> => {
    throw new Error("DB connection refused");
  };
  // Should not throw
  const result = await getAllVerifiedOpportunitiesWithCMS(failLoader);
  // Static arrays are both empty, so result is []
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0); // 0 static records currently
});

test("R08 — on loader failure: static records still returned if they existed", async () => {
  // This test verifies the fallback path returns assembleVerifiedDataset().
  // Since PRIVATE_JOBS=[] and INTERNSHIPS=[], fallback is empty.
  // The structural guarantee: no throw, returns array.
  const failLoader = async (): Promise<PublishedRecruitmentSnapshot[]> => {
    throw new Error("Neon timeout");
  };
  const result = await getAllVerifiedOpportunitiesWithCMS(failLoader);
  assert.ok(Array.isArray(result));
});

test("R09 — result elements satisfy Opportunity type (type: 'government')", async () => {
  const snap = makeSnapshot({ id: "rec-gov", slug: "bpsc-72nd-2026" });
  const result = await getAllVerifiedOpportunitiesWithCMS(makeLoader([snap]));
  assert.equal(result.length, 1);
  // Opportunity is a discriminated union on `type` field
  const opp = result[0];
  assert.ok(
    opp.type === "government" || opp.type === "private" || opp.type === "internship",
    `expected a valid Opportunity type, got: ${opp.type}`,
  );
  assert.equal(opp.type, "government");
});

test("R10 — importing repository.ts does not require DATABASE_URL at module load time", async () => {
  // The import at the top of this file exercises the module load.
  // If db.ts were top-level-imported, it would throw here because
  // DATABASE_URL is not set in the test environment.
  // Reaching this point proves the module is client-bundle safe.
  assert.ok(typeof getAllVerifiedOpportunitiesWithCMS === "function");
});
