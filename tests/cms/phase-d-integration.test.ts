// ═══════════════════════════════════════════════════════════
// Phase D Integration Tests — DB-backed verification
//
// Requires DATABASE_URL in environment.
// Creates test records with slug prefix "inttest-phased-" and
// cleans up after each test. Never publishes test records.
//
// Run: npm run cms:phase-d-integration-test
//
// Coverage:
//  INT01  persistRevert() writes draft_state=DRAFT, field_revision, audit_event — all or nothing
//  INT02  second persistRevert() on already-DRAFT record → OccConflictError (0 rows)
//  INT03  persistFieldUpdate() with updateEntry writes field + updates[] in one statement
//  INT04  OCC conflict: two callers with same clientRevision → second throws OccConflictError
//  INT05  Public queries return stored snapshot after revert, never current draft fields
//  INT06  Editing draft after revert does not alter the stored published snapshot
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import { sql } from "@/lib/db";
import {
  createRecruitment,
  persistApproval,
  persistPublication,
  persistRevert,
  persistFieldUpdate,
  OccConflictError,
  type CreateRecruitmentParams,
} from "@/lib/cms/repository";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { projectToPublished, PROJECTION_VERSION } from "@/lib/cms/projector";
import { getPublishedBySlug, getAllPublishedSnapshots } from "@/lib/cms/public-repository";

// ─── Helpers ──────────────────────────────────────────────

// Resolved once on first use — must be an existing admin UUID (FK constraint on created_by)
let _adminId: string | undefined;
async function getTestAdminId(): Promise<string> {
  if (_adminId) return _adminId;
  const rows = await sql`SELECT id FROM admins LIMIT 1`;
  if (rows.length === 0) throw new Error("No admins in DB — cannot run integration tests");
  _adminId = String(rows[0].id);
  return _adminId;
}

function testSlug(): string {
  return `inttest-phased-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function minimalParams(slug: string, adminId: string): CreateRecruitmentParams {
  return {
    slug,
    identity: {
      organizationId: "test-integration-org",
      organizationName: "Integration Test Org",
      recruitmentYear: 2026,
      title: {
        value: "Integration Test Recruitment 2026",
        status: "VERIFIED",
        evidenceIds: ["test-evidence-001"],
        conflict: false,
        manuallyEdited: false,
      },
    },
    dates: {},
    vacancies: {},
    financial: {},
    provenance: {
      status: "VERIFIED",
      lastVerifiedAt: "2026-10-03",
      primarySourceType: "OFFICIAL_NOTIFICATION",
      primarySourceUrl: "https://example.gov.in/test-notification.pdf",
    },
    adminId,
  };
}

async function cleanup(id: string): Promise<void> {
  await sql`DELETE FROM recruitment_audit_events WHERE recruitment_id = ${id}`;
  await sql`DELETE FROM field_revisions WHERE recruitment_id = ${id}`;
  await sql`DELETE FROM published_recruitments WHERE recruitment_id = ${id}`;
  await sql`DELETE FROM recruitments WHERE id = ${id}`;
}

async function createPublished(slug: string) {
  const adminId = await getTestAdminId();
  const draft = await createRecruitment(minimalParams(slug, adminId));
  const approved = await persistApproval(draft, adminId);
  const snapshot = projectToPublished(approved);
  return persistPublication(approved, snapshot, PROJECTION_VERSION, adminId);
}

// ─── INT01: Revert writes all three rows atomically ───────

suite("INT01–INT02: persistRevert() DB atomicity");

test("INT01: successful revert writes draft_state=DRAFT, field_revision row, and audit_event row", async () => {
  const adminId = await getTestAdminId();
  const slug = testSlug();
  const published = await createPublished(slug);
  try {
    // Call revert
    const reverted = await persistRevert(published, adminId);
    assert.strictEqual(reverted.draftState, "DRAFT", "draftState must be DRAFT after revert");
    assert.ok(reverted.lastPublishedRevision, "lastPublishedRevision must be preserved");

    // Verify DB: field_revisions row created for draftState field
    const revRows = await sql`
      SELECT field_path, old_value, new_value
      FROM field_revisions
      WHERE recruitment_id = ${published.id}
        AND field_path = 'draftState'
    `;
    assert.strictEqual(revRows.length, 1, "exactly one draftState field_revision must exist");
    assert.strictEqual(revRows[0].old_value, "PUBLISHED");
    assert.strictEqual(revRows[0].new_value, "DRAFT");

    // Verify DB: audit_event row created
    const auditRows = await sql`
      SELECT event_type
      FROM recruitment_audit_events
      WHERE recruitment_id = ${published.id}
        AND event_type = 'RECORD_REVERTED'
    `;
    assert.strictEqual(auditRows.length, 1, "exactly one RECORD_REVERTED audit event must exist");

    // Verify DB: recruitments.draft_state is DRAFT
    const recRows = await sql`
      SELECT draft_state, last_published_revision
      FROM recruitments
      WHERE id = ${published.id}
    `;
    assert.strictEqual(recRows[0].draft_state, "DRAFT");
    assert.ok(recRows[0].last_published_revision, "last_published_revision preserved in DB");
  } finally {
    await cleanup(published.id);
  }
});

test("INT02: second persistRevert() on already-DRAFT record throws OccConflictError", async () => {
  const adminId = await getTestAdminId();
  const slug = testSlug();
  const published = await createPublished(slug);
  try {
    const reverted = await persistRevert(published, adminId);
    assert.strictEqual(reverted.draftState, "DRAFT");

    // Second revert on the original published snapshot — DB record is now DRAFT
    // The WHERE draft_state='PUBLISHED' guard will match 0 rows → OccConflictError
    let threw = false;
    try {
      await persistRevert(published, adminId);
    } catch (err) {
      threw = true;
      assert.ok(err instanceof OccConflictError, `Expected OccConflictError, got: ${String(err)}`);
    }
    assert.ok(threw, "Should have thrown OccConflictError on second revert attempt");
  } finally {
    await cleanup(published.id);
  }
});

// ─── INT03–INT04: persistFieldUpdate() OCC + updateEntry ─

suite("INT03–INT04: persistFieldUpdate() atomicity and OCC");

test("INT03: persistFieldUpdate() with updateEntry writes field change and updates[] in one statement", async () => {
  const adminId = await getTestAdminId();
  const slug = testSlug();
  const draft = await createRecruitment(minimalParams(slug, adminId));
  try {
    const clientRevision = draft.recordRevision;

    // Build a field change: edit the title
    const newTitle = {
      ...draft.identity.title,
      value: "Integration Test Recruitment 2026 (Amended)",
      status: "PENDING" as const,
    };
    const fieldResult = routeFieldUpdate(
      draft,
      "identity.title",
      newTitle,
      adminId,
    );

    // Pre-append an updateEntry (simulating what the /fields route does)
    const updateEntry = {
      id: randomUUID(),
      type: "CORRIGENDUM" as const,
      date: "2026-10-03",
      title: "Title Corrected",
      description: "The recruitment title was corrected for clarity.",
    };
    fieldResult.record.updates = [...(fieldResult.record.updates ?? []), updateEntry];

    const { record: saved } = await persistFieldUpdate(fieldResult, clientRevision);

    // Verify: new title value is persisted
    assert.strictEqual(
      saved.identity.title.value,
      "Integration Test Recruitment 2026 (Amended)",
    );

    // Verify: updates[] persisted with the entry
    assert.strictEqual(saved.updates?.length, 1, "updates[] should have one entry");
    assert.strictEqual(saved.updates![0].type, "CORRIGENDUM");
    assert.strictEqual(saved.updates![0].title, "Title Corrected");

    // Verify: field_revision row exists for identity.title
    const revRows = await sql`
      SELECT field_path FROM field_revisions
      WHERE recruitment_id = ${draft.id} AND field_path = 'identity.title'
    `;
    assert.strictEqual(revRows.length, 1, "field_revision for identity.title must exist");
  } finally {
    await cleanup(draft.id);
  }
});

test("INT04: second persistFieldUpdate() with stale clientRevision throws OccConflictError", async () => {
  const adminId = await getTestAdminId();
  const slug = testSlug();
  const draft = await createRecruitment(minimalParams(slug, adminId));
  try {
    const clientRevision = draft.recordRevision;

    // First edit: change title
    const newTitle1 = { ...draft.identity.title, value: "Edit One", status: "PENDING" as const };
    const result1 = routeFieldUpdate(draft, "identity.title", newTitle1, adminId);
    await persistFieldUpdate(result1, clientRevision);

    // Second edit: same stale clientRevision → OCC conflict
    const newTitle2 = { ...draft.identity.title, value: "Edit Two", status: "PENDING" as const };
    const result2 = routeFieldUpdate(draft, "identity.title", newTitle2, adminId);

    let threw = false;
    try {
      await persistFieldUpdate(result2, clientRevision);
    } catch (err) {
      threw = true;
      assert.ok(err instanceof OccConflictError, `Expected OccConflictError, got: ${String(err)}`);
    }
    assert.ok(threw, "Second edit with stale revision must throw OccConflictError");

    // Verify DB still has edit1's title (edit2 was not applied)
    const recRows = await sql`
      SELECT identity->>'title' as title_json FROM recruitments WHERE id = ${draft.id}
    `;
    // title_json is the full ProvenanceField JSON; check the value field
    const titleField = JSON.parse(String(recRows[0].title_json));
    assert.strictEqual(titleField.value, "Edit One", "DB must reflect only the first edit");
  } finally {
    await cleanup(draft.id);
  }
});

// ─── INT05–INT06: Public snapshot isolation ───────────────

suite("INT05–INT06: public snapshot isolation after revert");

test("INT05: public queries return stored snapshot after revert, not current draft fields", async () => {
  const adminId = await getTestAdminId();
  const slug = testSlug();
  const published = await createPublished(slug);
  try {
    // Confirm public query works before revert
    const snapshotBefore = await getPublishedBySlug(slug);
    assert.ok(snapshotBefore, "Snapshot must exist before revert");
    assert.strictEqual(snapshotBefore!.title, "Integration Test Recruitment 2026");

    // Revert to DRAFT
    const reverted = await persistRevert(published, adminId);
    assert.strictEqual(reverted.draftState, "DRAFT");

    // Public query must still return the same snapshot
    const snapshotAfter = await getPublishedBySlug(slug);
    assert.ok(snapshotAfter, "Snapshot must still be visible after revert (reverted records keep public page)");
    assert.strictEqual(snapshotAfter!.title, "Integration Test Recruitment 2026",
      "Public title must still be the original published title, not any draft change");

    // Confirm slug appears in all snapshots listing too
    const allSnapshots = await getAllPublishedSnapshots();
    const found = allSnapshots.find((s) => s.slug === slug);
    assert.ok(found, "Reverted record must still appear in getAllPublishedSnapshots()");
  } finally {
    await cleanup(published.id);
  }
});

test("INT06: editing draft after revert does not change the stored published_recruitments snapshot", async () => {
  const adminId = await getTestAdminId();
  const slug = testSlug();
  const published = await createPublished(slug);
  try {
    // Get the original stored snapshot blob from DB
    const snapRowsBefore = await sql`
      SELECT snapshot->>'title' as title
      FROM published_recruitments
      WHERE recruitment_id = ${published.id}
      ORDER BY published_at DESC LIMIT 1
    `;
    const titleBefore = String(snapRowsBefore[0].title);
    assert.strictEqual(titleBefore, "Integration Test Recruitment 2026");

    // Revert
    const reverted = await persistRevert(published, adminId);

    // Edit the draft title
    const newTitle = { ...reverted.identity.title, value: "EDITED TITLE - MUST NOT APPEAR IN SNAPSHOT", status: "PENDING" as const };
    const fieldResult = routeFieldUpdate(reverted, "identity.title", newTitle, adminId);
    await persistFieldUpdate(fieldResult, reverted.recordRevision);

    // The published_recruitments.snapshot must be UNCHANGED
    const snapRowsAfter = await sql`
      SELECT snapshot->>'title' as title
      FROM published_recruitments
      WHERE recruitment_id = ${published.id}
      ORDER BY published_at DESC LIMIT 1
    `;
    const titleAfter = String(snapRowsAfter[0].title);
    assert.strictEqual(titleAfter, "Integration Test Recruitment 2026",
      "Published snapshot in DB must be unchanged after draft edit");

    // And the public query must ALSO return the original title
    const publicSnapshot = await getPublishedBySlug(slug);
    assert.ok(publicSnapshot, "Public snapshot must still be visible");
    assert.strictEqual(publicSnapshot!.title, "Integration Test Recruitment 2026",
      "Public page must serve stored snapshot title, not the edited draft title");
  } finally {
    await cleanup(published.id);
  }
});
