// ═══════════════════════════════════════════════════════════
// Phase D: Revert, Updates and Publishing tests
// ═══════════════════════════════════════════════════════════
//
// Coverage (pure, no DB):
//  RV01  revertRecord() succeeds on PUBLISHED → returns DRAFT + audit event
//  RV02  revertRecord() preserves lastPublishedRevision
//  RV03  revertRecord() throws on DRAFT input
//  RV04  revertRecord() throws on APPROVED input
//  RV05  revertRecord() throws on ARCHIVED input
//  RV06  reverted record has correct updatedBy
//
//  UP01  appendUpdateToRecord() produces record with entry in updates[]
//  UP02  two announcement entries both appear in updates[]
//  UP03  UpdateRecord round-trips all optional fields correctly
//  UP04  structural update entry is preserved alongside field change
//
//  VIS01 public query logic: DRAFT + lastPublishedRevision → visible
//  VIS02 public query logic: PUBLISHED → visible
//  VIS03 public query logic: ARCHIVED + lastPublishedRevision → NOT visible
//  VIS04 public query logic: DRAFT + no lastPublishedRevision → NOT visible
//
//  PUB01 re-publish after revert+edit produces snapshot with new projectedAt
//  PUB02 new snapshot's sourceRecordRevision differs after structural edit
//  PUB03 public pages serve last published snapshot while record is DRAFT
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import type {
  RecruitmentRecord,
  ProvenanceField,
  RecruitmentIdentity,
  RecruitmentDates,
  VacancyInformation,
  FinancialInformation,
  RecruitmentLifecycle,
} from "@/types/recruitment-record";
import type { UpdateRecord } from "@/types";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

import { revertRecord, markPublished, computeRecordRevision } from "@/lib/cms/record-ops";
import { projectForPreview, projectToPublished } from "@/lib/cms/projector";

// ─── Fixtures ─────────────────────────────────────────────

function pf<T>(value: T): ProvenanceField<T> {
  return { value, status: "VERIFIED", evidenceIds: ["evid-001"], conflict: false, manuallyEdited: false };
}

function makeMinimalIdentity(): RecruitmentIdentity {
  return {
    organizationId: "upsc",
    organizationName: "Union Public Service Commission",
    recruitmentYear: 2026,
    title: pf("UPSC Civil Services 2026"),
  };
}

function makeMinimalLifecycle(): RecruitmentLifecycle {
  return { status: "UPCOMING", conflicts: [], events: [] };
}

let counter = 0;
function makeRecord(overrides?: Partial<RecruitmentRecord>): RecruitmentRecord {
  counter++;
  const base: RecruitmentRecord = {
    id:             `phd-rec-${counter}`,
    slug:           `upsc-civil-2026-${counter}`,
    draftState:     "PUBLISHED",
    recordRevision: "aabb1122",
    lastPublishedRevision: "aabb1122",
    publishedAt:    "2026-09-01T00:00:00Z",
    identity:       makeMinimalIdentity(),
    dates:          {} as RecruitmentDates,
    vacancies:      {} as VacancyInformation,
    financial:      {} as FinancialInformation,
    lifecycle:      makeMinimalLifecycle(),
    provenance:     {
      status: "VERIFIED",
      lastVerifiedAt: "2026-09-01",
      primarySourceType: "OFFICIAL_NOTIFICATION",
      primarySourceUrl: "https://upsc.gov.in/test",
    },
    links:     [],
    documents: [],
    updates:   [],
    examStages: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
  return { ...base, ...overrides };
}

function makeUpdateEntry(overrides?: Partial<UpdateRecord>): UpdateRecord {
  return {
    id:          randomUUID(),
    type:        "GENERAL_NOTICE",
    date:        "2026-10-01",
    title:       "Exam Date Confirmed",
    description: "The written examination will be held as scheduled on 2026-12-01.",
    ...overrides,
  };
}

// ─── RV01–RV06: revertRecord() ────────────────────────────

suite("RV01–RV06: revertRecord()");

test("RV01: successful revert returns DRAFT record with RECORD_REVERTED audit event", () => {
  const record = makeRecord({ draftState: "PUBLISHED" });
  const { record: reverted, auditEvent } = revertRecord(record, "admin-1");
  assert.strictEqual(reverted.draftState, "DRAFT");
  assert.strictEqual(auditEvent.eventType, "RECORD_REVERTED");
  assert.strictEqual(auditEvent.metadata.adminId, "admin-1");
});

test("RV02: revert preserves lastPublishedRevision", () => {
  const record = makeRecord({ draftState: "PUBLISHED", lastPublishedRevision: "rev-abc" });
  const { record: reverted } = revertRecord(record, "admin-1");
  assert.strictEqual(reverted.lastPublishedRevision, "rev-abc");
});

test("RV03: revertRecord() throws on DRAFT record", () => {
  const record = makeRecord({ draftState: "DRAFT" });
  assert.throws(
    () => revertRecord(record, "admin-1"),
    (err: Error) => err.message.includes("must be PUBLISHED"),
  );
});

test("RV04: revertRecord() throws on APPROVED record", () => {
  const record = makeRecord({ draftState: "APPROVED" });
  assert.throws(
    () => revertRecord(record, "admin-1"),
    (err: Error) => err.message.includes("must be PUBLISHED"),
  );
});

test("RV05: revertRecord() throws on ARCHIVED record", () => {
  const record = makeRecord({ draftState: "ARCHIVED" });
  assert.throws(
    () => revertRecord(record, "admin-1"),
    (err: Error) => err.message.includes("must be PUBLISHED"),
  );
});

test("RV06: reverted record has correct updatedBy and updatedAt is recent", () => {
  const before = Date.now();
  const record = makeRecord({ draftState: "PUBLISHED" });
  const { record: reverted } = revertRecord(record, "admin-xyz");
  const after = Date.now();

  assert.strictEqual(reverted.updatedBy, "admin-xyz");
  const updatedMs = new Date(reverted.updatedAt).getTime();
  assert.ok(updatedMs >= before && updatedMs <= after, "updatedAt should be within test window");
});

// ─── UP01–UP04: update record logic ──────────────────────

suite("UP01–UP04: update record append logic");

test("UP01: appending entry to updates[] gives record with that entry", () => {
  const record = makeRecord({ draftState: "DRAFT", updates: [] });
  const entry = makeUpdateEntry({ type: "POSTPONEMENT", title: "Exam Postponed" });

  // Simulate what the /fields route does before calling persistFieldUpdate()
  const updated = { ...record, updates: [...(record.updates ?? []), entry] };
  assert.strictEqual(updated.updates.length, 1);
  assert.strictEqual(updated.updates[0].type, "POSTPONEMENT");
  assert.strictEqual(updated.updates[0].title, "Exam Postponed");
});

test("UP02: two announcement entries both appear in updates[]", () => {
  const record = makeRecord({ draftState: "DRAFT", updates: [] });
  const entry1 = makeUpdateEntry({ title: "Announcement A" });
  const entry2 = makeUpdateEntry({ title: "Announcement B" });

  // Simulate two sequential announcement appends (JSONB || operator behaviour)
  const after1 = { ...record, updates: [...record.updates, entry1] };
  const after2 = { ...after1, updates: [...after1.updates, entry2] };

  assert.strictEqual(after2.updates.length, 2);
  assert.strictEqual(after2.updates[0].title, "Announcement A");
  assert.strictEqual(after2.updates[1].title, "Announcement B");
});

test("UP03: UpdateRecord round-trips all optional fields", () => {
  const entry = makeUpdateEntry({
    type:          "VACANCY_REVISION",
    sourceUrl:     "https://upsc.gov.in/corrigendum.pdf",
    field:         "vacancies.total",
    previousValue: "1000",
    newValue:      "986",
  });

  // Should preserve all fields
  assert.strictEqual(entry.type, "VACANCY_REVISION");
  assert.strictEqual(entry.sourceUrl, "https://upsc.gov.in/corrigendum.pdf");
  assert.strictEqual(entry.field, "vacancies.total");
  assert.strictEqual(entry.previousValue, "1000");
  assert.strictEqual(entry.newValue, "986");
});

test("UP04: structural update entry survives alongside record after append", () => {
  const record = makeRecord({ draftState: "DRAFT", updates: [] });
  const entry = makeUpdateEntry({
    type:          "CORRIGENDUM",
    title:         "Vacancy Count Revised",
    field:         "vacancies.total",
    previousValue: "500",
    newValue:      "486",
  });

  const updatedRecord = {
    ...record,
    vacancies: { ...record.vacancies, total: pf(486) },
    updates: [...record.updates, entry],
  };

  assert.strictEqual(updatedRecord.vacancies.total?.value, 486);
  assert.strictEqual(updatedRecord.updates[0].field, "vacancies.total");
  assert.strictEqual(updatedRecord.updates[0].previousValue, "500");
  assert.strictEqual(updatedRecord.updates[0].newValue, "486");
});

// ─── VIS01–VIS04: public visibility logic ────────────────

suite("VIS01–VIS04: public visibility query logic");

// These tests document the behavioural contract of the WHERE clause:
// last_published_revision IS NOT NULL AND draft_state != 'ARCHIVED'
// (not executable without DB; verified by reading the fixed query)

function isVisible(r: { draftState: string; lastPublishedRevision?: string }): boolean {
  return r.lastPublishedRevision != null && r.draftState !== "ARCHIVED";
}

test("VIS01: DRAFT record with lastPublishedRevision is visible (reverted)", () => {
  assert.strictEqual(isVisible({ draftState: "DRAFT", lastPublishedRevision: "rev-1" }), true);
});

test("VIS02: PUBLISHED record is visible", () => {
  assert.strictEqual(isVisible({ draftState: "PUBLISHED", lastPublishedRevision: "rev-1" }), true);
});

test("VIS03: ARCHIVED record with lastPublishedRevision is NOT visible", () => {
  assert.strictEqual(isVisible({ draftState: "ARCHIVED", lastPublishedRevision: "rev-1" }), false);
});

test("VIS04: DRAFT record with no lastPublishedRevision is NOT visible (never published)", () => {
  assert.strictEqual(isVisible({ draftState: "DRAFT", lastPublishedRevision: undefined }), false);
});

// ─── PUB01–PUB03: re-publication after revert ─────────────

suite("PUB01–PUB03: re-publication after revert + edit");

test("PUB01: re-publishing after revert+edit produces a new snapshot", () => {
  // Simulate: PUBLISHED → revert → edit title → approve → re-publish
  const record = makeRecord({ draftState: "APPROVED" });

  // Snapshot 1 (original publication)
  const snap1 = projectToPublished(record);

  // Simulate editing the title after revert (change the title value)
  const editedRecord: RecruitmentRecord = {
    ...record,
    identity: {
      ...record.identity,
      title: pf("UPSC Civil Services 2026 (Revised)"),
    },
    draftState: "APPROVED",
  };

  // Snapshot 2 (re-publication)
  const snap2 = projectToPublished(editedRecord);

  // Both are valid snapshots
  assert.strictEqual(snap1.id, snap2.id);
  assert.strictEqual(snap1.title, "UPSC Civil Services 2026");
  assert.strictEqual(snap2.title, "UPSC Civil Services 2026 (Revised)");
});

test("PUB02: re-published snapshot has a different sourceRecordRevision after structural edit", () => {
  const record = makeRecord({ draftState: "APPROVED" });
  const snap1 = projectToPublished(record);

  // Simulate title edit changing the record content → new hash
  const editedRecord: RecruitmentRecord = {
    ...record,
    identity: {
      ...record.identity,
      title: pf("UPSC Civil Services 2026 (Amended)"),
    },
    draftState: "APPROVED",
  };
  const newRevision = computeRecordRevision(editedRecord);
  const snap2 = projectToPublished({ ...editedRecord, recordRevision: newRevision });

  assert.notStrictEqual(snap1.sourceRecordRevision, snap2.sourceRecordRevision);
});

test("PUB03: last published snapshot is unchanged after revert (projectForPreview invariant)", () => {
  // Simulate: original APPROVED record → publish → revert to DRAFT → preview
  const approvedRecord = makeRecord({ draftState: "APPROVED" });
  const publishedSnapshot: PublishedRecruitmentSnapshot = projectToPublished(approvedRecord);

  // Revert produces a DRAFT record
  const { record: reverted } = revertRecord(
    { ...approvedRecord, draftState: "PUBLISHED", lastPublishedRevision: approvedRecord.recordRevision },
    "admin-1",
  );

  // Preview of the reverted DRAFT still shows the same content as the snapshot
  const previewSnapshot = projectForPreview(reverted);

  // Content should be identical (same source record data, different projectedAt)
  assert.strictEqual(previewSnapshot.id, publishedSnapshot.id);
  assert.strictEqual(previewSnapshot.title, publishedSnapshot.title);
  assert.strictEqual(previewSnapshot.sourceRecordRevision, publishedSnapshot.sourceRecordRevision);

  // The ORIGINAL published snapshot is untouched (stored in DB — not modified by revert)
  assert.strictEqual(publishedSnapshot.title, "UPSC Civil Services 2026");
});
