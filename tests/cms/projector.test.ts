// ═══════════════════════════════════════════════════════════
// Phase C: Projector Tests
// ═══════════════════════════════════════════════════════════
//
// Tests projectToPublished() and projectForPreview() invariants.
// Pure — no DB required.
//
// Run: npx tsx --tsconfig tsconfig.json tests/cms/projector.test.ts
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";

import type {
  RecruitmentRecord,
  ProvenanceField,
  RecruitmentIdentity,
  RecruitmentDates,
  VacancyInformation,
  FinancialInformation,
  RecruitmentLifecycle,
} from "@/types/recruitment-record";

import { projectToPublished, projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";

// ─── Fixtures ─────────────────────────────────────────────

function pf<T>(value: T): ProvenanceField<T> {
  return { value, status: "VERIFIED", evidenceIds: ["evid-001"], conflict: false, manuallyEdited: false };
}

function makeMinimalIdentity(): RecruitmentIdentity {
  return {
    organizationId: "rrb",
    organizationName: "Railway Recruitment Board",
    recruitmentYear: 2026,
    title: pf("RRB NTPC CEN 05/2026"),
  };
}

function makeMinimalLifecycle(): RecruitmentLifecycle {
  return { status: "UPCOMING", conflicts: [], events: [] };
}

let counter = 0;
function makeRecord(overrides?: Partial<RecruitmentRecord>): RecruitmentRecord {
  counter++;
  const base: RecruitmentRecord = {
    id:             `proj-rec-${counter}`,
    slug:           `rrb-ntpc-cen-05-2026-${counter}`,
    draftState:     "DRAFT",
    recordRevision: "aabbccdd",
    identity:       makeMinimalIdentity(),
    dates:          {} as RecruitmentDates,
    vacancies:      {} as VacancyInformation,
    financial:      {} as FinancialInformation,
    lifecycle:      makeMinimalLifecycle(),
    provenance:     { status: "VERIFIED", lastVerifiedAt: "2026-09-01", primarySourceType: "OFFICIAL_NOTIFICATION", primarySourceUrl: "https://rrb.gov.in/ntpc" },
    links:          [],
    documents:      [],
    updates:        [],
    createdAt:      "2026-09-01T00:00:00Z",
    updatedAt:      "2026-09-01T00:00:00Z",
  };
  return { ...base, ...overrides };
}

// ─── PROJ01: projectToPublished guards ───────────────────

suite("PROJ01–PROJ02: draftState guards");

test("PROJ01: projectToPublished throws on DRAFT record", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  assert.throws(
    () => projectToPublished(record),
    (err: Error) => err.message.includes("APPROVED"),
  );
});

test("PROJ01b: projectToPublished throws on PUBLISHED record", () => {
  const record = makeRecord({ draftState: "PUBLISHED" });
  assert.throws(() => projectToPublished(record));
});

test("PROJ01c: projectToPublished throws on ARCHIVED record", () => {
  const record = makeRecord({ draftState: "ARCHIVED" });
  assert.throws(() => projectToPublished(record));
});

test("PROJ01d: projectToPublished succeeds on APPROVED record", () => {
  const record = makeRecord({ draftState: "APPROVED" });
  const snapshot = projectToPublished(record);
  assert.strictEqual(snapshot.id, record.id);
});

test("PROJ02: projectForPreview does NOT throw on DRAFT record", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.id, record.id);
});

test("PROJ02b: projectForPreview works on APPROVED record", () => {
  const record = makeRecord({ draftState: "APPROVED" });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.slug, record.slug);
});

test("PROJ02c: projectForPreview works on PUBLISHED record", () => {
  const record = makeRecord({ draftState: "PUBLISHED" });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.sourceRecordRevision, record.recordRevision);
});

// ─── PROJ03: Snapshot shape correctness ──────────────────

suite("PROJ03: Snapshot shape");

test("PROJ03a: snapshot contains all required top-level fields", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);

  assert.ok(snapshot.id);
  assert.ok(snapshot.slug);
  assert.ok(snapshot.organizationId);
  assert.ok(snapshot.organizationName);
  assert.strictEqual(typeof snapshot.recruitmentYear, "number");
  assert.ok("dates" in snapshot);
  assert.ok("vacancies" in snapshot);
  assert.ok("financial" in snapshot);
  assert.ok(Array.isArray(snapshot.examStages));
  assert.ok(Array.isArray(snapshot.links));
  assert.ok(Array.isArray(snapshot.documents));
  assert.ok(Array.isArray(snapshot.updates));
  assert.ok(snapshot.projectedAt);
  assert.ok(snapshot.projectionVersion);
  assert.ok(snapshot.sourceRecordRevision);
});

test("PROJ03b: snapshot title comes from ProvenanceField.value", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.title, "RRB NTPC CEN 05/2026");
});

test("PROJ03c: sourceRecordRevision matches record.recordRevision", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.sourceRecordRevision, "aabbccdd");
});

// ─── PROJ04: Missing optional fields ─────────────────────

suite("PROJ04: Missing optional fields");

test("PROJ04a: no examStages → empty array (not null/undefined)", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  // examStages not set — default is undefined on record
  const snapshot = projectForPreview(record);
  assert.deepStrictEqual(snapshot.examStages, []);
});

test("PROJ04b: no dates set → all date fields are null", () => {
  const record = makeRecord({ draftState: "DRAFT", dates: {} as RecruitmentDates });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.dates.applicationOpenDate, null);
  assert.strictEqual(snapshot.dates.applicationCloseDate, null);
  assert.strictEqual(snapshot.dates.examDate, null);
});

test("PROJ04c: no vacancies → total is null, breakdown is null", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.vacancies.total, null);
  assert.strictEqual(snapshot.vacancies.breakdown, null);
});

test("PROJ04d: no financial → all fee fields are null, paymentModes is []", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.financial.feeGeneral, null);
  assert.strictEqual(snapshot.financial.feeSCST, null);
  assert.strictEqual(snapshot.financial.payScale, null);
  assert.deepStrictEqual(snapshot.financial.paymentModes, []);
});

test("PROJ04e: no eligibility/age/selection → null (not crash)", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  assert.strictEqual(snapshot.eligibility, null);
  assert.strictEqual(snapshot.age, null);
  assert.strictEqual(snapshot.selection, null);
});

test("PROJ04f: no howToApply → empty array", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  assert.deepStrictEqual(snapshot.howToApply, []);
});

// ─── PROJ05: Admin-only data exclusion ───────────────────

suite("PROJ05: Admin-only data exclusion");

test("PROJ05a: snapshot does not contain evidenceIds", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record) as unknown as Record<string, unknown>;
  // evidenceIds are on ProvenanceFields inside record — must not appear at snapshot top level
  assert.ok(!("evidenceIds" in snapshot));
});

test("PROJ05b: snapshot does not contain conflict/machineValue wrappers", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record) as unknown as Record<string, unknown>;
  assert.ok(!("conflict" in snapshot));
  assert.ok(!("machineValue" in snapshot));
  assert.ok(!("manuallyEdited" in snapshot));
});

test("PROJ05c: snapshot does not contain lifecycle.conflicts (internal)", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record) as unknown as Record<string, unknown>;
  assert.ok(!("lifecycle" in snapshot));
  assert.ok(!("draftState" in snapshot));
  assert.ok(!("recordRevision" in snapshot));
  assert.ok(!("updatedBy" in snapshot));
});

// ─── PROJ06: Adapter chain ────────────────────────────────

suite("PROJ06: Adapter chain — snapshot → GovernmentRecruitment");

test("PROJ06a: snapshotToGovernmentRecruitment from preview snapshot produces valid job", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  const job = snapshotToGovernmentRecruitment(snapshot);

  assert.strictEqual(job.type, "government");
  assert.strictEqual(job.id, record.id);
  assert.strictEqual(job.slug, record.slug);
  assert.strictEqual(job.title, "RRB NTPC CEN 05/2026");
  assert.strictEqual(job.organizationId, "rrb");
});

test("PROJ06b: adapter handles null vacancies without crash", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  const snapshot = projectForPreview(record);
  const job = snapshotToGovernmentRecruitment(snapshot);
  assert.strictEqual(job.totalVacancies, 0);
  assert.strictEqual(job.vacanciesDisplay, "Vacancies TBC");
});

test("PROJ06c: adapter maps links correctly from snapshot", () => {
  const record = makeRecord({
    draftState: "DRAFT",
    links: [
      { type: "OFFICIAL_NOTIFICATION", label: "Notification", url: "https://rrb.gov.in/notif.pdf", official: true },
      { type: "OFFICIAL_WEBSITE", label: "Website", url: "https://rrb.gov.in", official: true },
    ],
  });
  const snapshot = projectForPreview(record);
  const job = snapshotToGovernmentRecruitment(snapshot);

  assert.strictEqual(job.links.notification, "https://rrb.gov.in/notif.pdf");
  assert.strictEqual(job.links.website, "https://rrb.gov.in");
});

// ─── PROJ07: Preview vs publish parity ───────────────────

suite("PROJ07: Preview and publish produce identical snapshots for APPROVED records");

test("PROJ07: projectForPreview and projectToPublished match on APPROVED record (except projectedAt)", () => {
  const record = makeRecord({
    draftState: "APPROVED",
    vacancies: { total: pf(500) } as VacancyInformation,
  });

  const fromPreview = projectForPreview(record);
  const fromPublish = projectToPublished(record);

  // All fields except projectedAt must match
  assert.strictEqual(fromPreview.id, fromPublish.id);
  assert.strictEqual(fromPreview.slug, fromPublish.slug);
  assert.strictEqual(fromPreview.title, fromPublish.title);
  assert.strictEqual(fromPreview.vacancies.total, fromPublish.vacancies.total);
  assert.strictEqual(fromPreview.sourceRecordRevision, fromPublish.sourceRecordRevision);
  assert.strictEqual(fromPreview.projectionVersion, fromPublish.projectionVersion);
});
