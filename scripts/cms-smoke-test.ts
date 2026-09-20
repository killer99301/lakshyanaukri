// ═══════════════════════════════════════════════════════════
// Phase D: End-to-End Smoke Test
// ═══════════════════════════════════════════════════════════
//
// Tests the actual CMS → repository → database → revision path.
// Does NOT bypass the writer. Every field edit goes through:
//   routeFieldUpdate() → record-ops typed writer → persistFieldUpdate()
//
// Run: npx tsx --tsconfig tsconfig.json scripts/cms-smoke-test.ts
//
// The test creates one DRAFT record (slug: smoke-test-TIMESTAMP)
// and leaves it ARCHIVED in the DB — clearly identifiable as a test.
// It does NOT touch production recruitment data.
// ═══════════════════════════════════════════════════════════

import { neon } from "@neondatabase/serverless";
import { sql as libSql } from "@/lib/db";

import {
  createRecruitment,
  persistFieldUpdate,
  persistApproval,
  getRecruitmentById,
  getFieldRevisions,
} from "@/lib/cms/repository";

import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { makeProvenanceField, validateProvenanceField } from "@/lib/cms/validation";
import type { ProvenanceField, CmsRecruitmentPost } from "@/types/recruitment-record";
import type { Provenance } from "@/types";

// ─── Output helpers ───────────────────────────────────────

let passed = 0;
let failed = 0;
const FAILURES: string[] = [];

function ok(label: string) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label: string, detail: string) {
  console.log(`  ❌ ${label}`);
  console.log(`       ${detail}`);
  failed++;
  FAILURES.push(`${label}: ${detail}`);
}

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) ok(label);
  else fail(label, detail ?? "assertion failed");
}

function section(name: string) {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length - 4))}\n`);
}

// ─── Test data ────────────────────────────────────────────

// SMOKE_ADMIN_ID is resolved from the live admins table at runtime (Step 0).
// The field_revisions.revised_by column is NOT NULL + FK to admins(id),
// so we must use a real UUID that exists in admins.
let SMOKE_ADMIN_ID: string;

const SMOKE_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SMOKE_SLUG = `smoke-test-${SMOKE_TIMESTAMP}`;

const SMOKE_PROVENANCE: Provenance = {
  status: "NOT_VERIFIED",
  lastVerifiedAt: new Date().toISOString().slice(0, 10),
  primarySourceType: "NOT_VERIFIED",
};

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("Phase D — End-to-End Smoke Test");
  console.log(`Slug: ${SMOKE_SLUG}`);
  console.log("═══════════════════════════════════════════════════════════");

  let recordId: string | null = null;

  // ───────────────────────────────────────────────────────
  // STEP 0: Resolve a real admin UUID for FK-safe inserts
  // ───────────────────────────────────────────────────────
  section("Step 0: Resolve admin UUID from admins table");

  try {
    const rawSql = neon(process.env.DATABASE_URL!);
    const rows = await rawSql`SELECT id FROM admins LIMIT 1`;
    if (rows.length === 0) {
      console.error("  ❌  No rows in admins table. Cannot run smoke test.");
      console.error("      Run the admin setup to create at least one admin first.");
      process.exit(1);
    }
    SMOKE_ADMIN_ID = rows[0].id as string;
    ok(`Using admin UUID: ${SMOKE_ADMIN_ID.slice(0, 8)}… (real admins row)`);
  } catch (e) {
    console.error(`  ❌  Could not query admins table: ${String(e)}`);
    process.exit(1);
  }

  // Diagnostic: what does @/lib/db's sql see?
  {
    console.log("\n  @/lib/db connection diagnostics:");
    try {
      const ping = await libSql`SELECT 1 AS ping`;
      ok(`  ping: ${JSON.stringify(ping[0])}`);
    } catch (e) { fail("  @/lib/db ping", String(e).slice(0, 100)); }

    try {
      const db = await libSql`SELECT current_database() AS db, current_schema() AS schema`;
      ok(`  context: db=${JSON.stringify(db[0])}`);
    } catch (e) { fail("  @/lib/db current_database()", String(e).slice(0, 100)); }

    try {
      await libSql`SELECT 1 FROM admins LIMIT 0`;
      ok("  @/lib/db sees admins table");
    } catch (e) { fail("  @/lib/db admins", String(e).slice(0, 100)); }

    try {
      await libSql`SELECT 1 FROM recruitments LIMIT 0`;
      ok("  @/lib/db sees recruitments table ✓");
    } catch (e) {
      fail("  @/lib/db cannot see 'recruitments'", String(e).slice(0, 120));
      // Check if it's a search_path issue
      try {
        const tables = await libSql`
          SELECT schemaname, tablename FROM pg_tables
          WHERE tablename LIKE 'recruit%'
          ORDER BY schemaname, tablename
        `;
        if (tables.length > 0) {
          ok(`  pg_tables shows: ${JSON.stringify(tables)}`);
        } else {
          fail("  No 'recruit*' tables found in pg_tables via @/lib/db", "table literally absent from this DB");
        }
      } catch (e2) { fail("  pg_tables query", String(e2).slice(0, 100)); }
      console.error("\n  Diagnosis: @/lib/db and the direct neon() client may be using different databases.");
      process.exit(1);
    }
  }

  // ───────────────────────────────────────────────────────
  // STEP 1: Create a test record
  // ───────────────────────────────────────────────────────
  section("Step 1: Create test RecruitmentRecord");

  let record;
  try {
    record = await createRecruitment({
      slug: SMOKE_SLUG,
      identity: {
        organizationId: "smoke-org",
        organizationName: "Smoke Test Organisation",
        title: makeProvenanceField({
          value: "Smoke Test Recruitment 2026",
          status: "PENDING",
          evidenceIds: [],
          manuallyEdited: false,
        }),
        recruitmentYear: 2026,
        govType: "Central Govt",
      },
      provenance: SMOKE_PROVENANCE,
      adminId: SMOKE_ADMIN_ID,
    });
    recordId = record.id;
    ok(`Record created (id: ${record.id})`);
    assert("Slug matches", record.slug === SMOKE_SLUG, `got: ${record.slug}`);
    assert("DraftState is DRAFT", record.draftState === "DRAFT", `got: ${record.draftState}`);
    assert("Title PENDING", record.identity.title.status === "PENDING", `got: ${record.identity.title.status}`);
    assert("Title value matches", record.identity.title.value === "Smoke Test Recruitment 2026");
    assert("No revisions yet", (await getFieldRevisions(record.id)).length === 0, "expected 0 revisions on create");
  } catch (e) {
    fail("createRecruitment", String(e));
    console.log("\n⛔ DB not accessible — cannot continue. Ensure .env.local has DATABASE_URL and the schema exists.");
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────
  // STEP 2: Edit identity.title (namespace field)
  // ───────────────────────────────────────────────────────
  section("Step 2: Edit identity.title through the typed writer");

  const originalTitle = record.identity.title.value;

  const newTitleField: ProvenanceField<string> = makeProvenanceField({
    value: "Smoke Test Recruitment 2026 — Edited",
    status: "PENDING",
    evidenceIds: [],
    manuallyEdited: true,
  }) as ProvenanceField<string>;

  let updateResult1;
  try {
    const writerResult = routeFieldUpdate(
      record,
      "identity.title",
      newTitleField as ProvenanceField<unknown>,
      SMOKE_ADMIN_ID,
      "Smoke test edit #1",
    );
    ok("routeFieldUpdate dispatched to updateIdentityField");

    updateResult1 = await persistFieldUpdate(writerResult, record.recordRevision);
    ok("persistFieldUpdate completed (CTE UPDATE+INSERT atomic)");

    assert(
      "Persisted record has new title value",
      updateResult1.record.identity.title.value === "Smoke Test Recruitment 2026 — Edited",
      `got: ${updateResult1.record.identity.title.value}`,
    );
    assert(
      "Persisted record status PENDING",
      updateResult1.record.identity.title.status === "PENDING",
    );
    assert(
      "revision.fieldPath = 'identity.title'",
      updateResult1.revision.fieldPath === "identity.title",
      `got: ${updateResult1.revision.fieldPath}`,
    );
    assert(
      "revision.oldValue = original title field",
      (updateResult1.revision.oldValue as typeof originalTitle) === originalTitle ||
        JSON.stringify(updateResult1.revision.oldValue) === JSON.stringify(record.identity.title),
    );
    assert(
      "revision.revisedBy = adminId",
      updateResult1.revision.revisedBy === SMOKE_ADMIN_ID,
    );
    assert(
      "revision.reason = 'Smoke test edit #1'",
      updateResult1.revision.reason === "Smoke test edit #1",
    );
    assert(
      "revision.revisedAt is a timestamp",
      !!updateResult1.revision.revisedAt && !isNaN(Date.parse(updateResult1.revision.revisedAt)),
    );
    assert(
      "revision.recruitmentId = record.id",
      updateResult1.revision.recruitmentId === record.id,
    );
    record = updateResult1.record;
  } catch (e) {
    fail("identity.title edit + persist", String(e));
    await cleanupAndExit(record.id);
  }

  // ───────────────────────────────────────────────────────
  // STEP 3: Reload from DB and verify survival
  // ───────────────────────────────────────────────────────
  section("Step 3: Reload from DB and verify value + provenance survive");

  try {
    const reloaded = await getRecruitmentById(record.id);
    assert("Record found after reload", reloaded !== null);
    if (reloaded) {
      assert(
        "Reloaded title = edited value",
        reloaded.identity.title.value === "Smoke Test Recruitment 2026 — Edited",
      );
      assert("Reloaded title status = PENDING", reloaded.identity.title.status === "PENDING");
      assert("Reloaded manuallyEdited = true", reloaded.identity.title.manuallyEdited === true);
      record = reloaded;
    }
  } catch (e) {
    fail("reload + verify", String(e));
  }

  // ───────────────────────────────────────────────────────
  // STEP 4: Verify exactly 1 field_revisions row
  // ───────────────────────────────────────────────────────
  section("Step 4: field_revisions — exactly 1 row with correct fields");

  try {
    const revisions = await getFieldRevisions(record.id);
    assert("Exactly 1 revision after 1 edit", revisions.length === 1, `got: ${revisions.length}`);
    if (revisions.length > 0) {
      const rev = revisions[0];
      assert("rev.recruitmentId correct", rev.recruitmentId === record.id);
      assert("rev.fieldPath = 'identity.title'", rev.fieldPath === "identity.title");
      assert("rev.revisedBy = adminId", rev.revisedBy === SMOKE_ADMIN_ID);
      assert("rev.revisedAt is set", !!rev.revisedAt);
      assert("rev.reason is set", rev.reason === "Smoke test edit #1");

      // Check filtered query too
      const filtered = await getFieldRevisions(record.id, "identity.title");
      assert("Filtered getFieldRevisions returns 1 row", filtered.length === 1);
      const filteredOther = await getFieldRevisions(record.id, "dates.examDate");
      assert("Filtered getFieldRevisions for non-edited field = 0 rows", filteredOther.length === 0);
    }
  } catch (e) {
    fail("field_revisions check", String(e));
  }

  // ───────────────────────────────────────────────────────
  // STEP 5: Edit a block-level field — eligibility
  // ───────────────────────────────────────────────────────
  section("Step 5: Edit eligibility (ProvenanceField<CmsRecruitmentPost[]>) — block-level");

  const eligibilityValue: CmsRecruitmentPost[] = [
    {
      post: "Smoke Test Officer Grade A",
      qualification: ["Bachelor's degree in any discipline"],
      experience: [],
    },
    {
      post: "Smoke Test Officer Grade B",
      qualification: ["Master's degree or equivalent"],
      experience: ["2 years in public sector"],
    },
  ];

  const newEligibilityField: ProvenanceField<CmsRecruitmentPost[]> = makeProvenanceField({
    value: eligibilityValue,
    status: "PENDING",
    evidenceIds: [],
    manuallyEdited: true,
  }) as ProvenanceField<CmsRecruitmentPost[]>;

  try {
    const writerResult2 = routeFieldUpdate(
      record,
      "eligibility",
      newEligibilityField as ProvenanceField<unknown>,
      SMOKE_ADMIN_ID,
      "Smoke test eligibility block",
    );
    ok("routeFieldUpdate dispatched to updateEligibility");
    assert("writerResult2.revision.fieldPath = 'eligibility'", writerResult2.revision.fieldPath === "eligibility");

    const updateResult2 = await persistFieldUpdate(writerResult2, record.recordRevision);
    ok("persistFieldUpdate for eligibility block completed");

    assert(
      "Eligibility block has 2 posts",
      updateResult2.record.eligibility?.value?.length === 2,
      `got: ${JSON.stringify(updateResult2.record.eligibility?.value)}`,
    );
    assert(
      "Eligibility status PENDING",
      updateResult2.record.eligibility?.status === "PENDING",
    );
    assert(
      "identity.title still correct after eligibility update",
      updateResult2.record.identity.title.value === "Smoke Test Recruitment 2026 — Edited",
    );
    record = updateResult2.record;
  } catch (e) {
    fail("eligibility block edit + persist", String(e));
  }

  // ───────────────────────────────────────────────────────
  // STEP 6: Verify revision history now shows 2 entries
  // ───────────────────────────────────────────────────────
  section("Step 6: Revision history — 2 entries for 2 edits");

  try {
    const allRevisions = await getFieldRevisions(record.id);
    assert("2 total revisions", allRevisions.length === 2, `got: ${allRevisions.length}`);

    const paths = allRevisions.map((r) => r.fieldPath).sort();
    assert(
      "Revision paths: eligibility + identity.title",
      JSON.stringify(paths) === JSON.stringify(["eligibility", "identity.title"]),
      `got: ${JSON.stringify(paths)}`,
    );

    const eligRev = allRevisions.find((r) => r.fieldPath === "eligibility");
    assert("Eligibility revision has correct recruimentId", eligRev?.recruitmentId === record.id);
    assert("Eligibility revision reason set", eligRev?.reason === "Smoke test eligibility block");
  } catch (e) {
    fail("revision history check", String(e));
  }

  // ───────────────────────────────────────────────────────
  // STEP 7: Invalid provenance state rejection
  // ───────────────────────────────────────────────────────
  section("Step 7: Invalid provenance states are rejected by the writer (I1, I2, I3)");

  // I1 violation: NOT_SPECIFIED + non-null value
  const badI1: ProvenanceField<string> = {
    value: "something",
    status: "NOT_SPECIFIED",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: false,
  };
  const i1errors = validateProvenanceField(badI1 as ProvenanceField<unknown>, "identity.title");
  assert(
    "I1 violation detected by validateProvenanceField",
    i1errors.some((e) => e.invariant === "I1"),
    `errors: ${JSON.stringify(i1errors)}`,
  );

  // I2 (= other side of I1): null value + non-NOT_SPECIFIED status
  // validation.ts labels both sides of the NOT_SPECIFIED↔null invariant as I1
  const badI2: ProvenanceField<string> = {
    value: null as unknown as string,
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: false,
  };
  const i2errors = validateProvenanceField(badI2 as ProvenanceField<unknown>, "identity.title");
  assert(
    "I2 (null+PENDING) detected by validateProvenanceField as I1",
    i2errors.some((e) => e.invariant === "I1"),
    `errors: ${JSON.stringify(i2errors)}`,
  );

  // I3 violation: conflict=true but status=PENDING
  const badI3: ProvenanceField<string> = {
    value: "conflict test",
    status: "PENDING",
    evidenceIds: [],
    conflict: true,
    manuallyEdited: false,
  };
  const i3errors = validateProvenanceField(badI3 as ProvenanceField<unknown>, "identity.title");
  assert(
    "I3 violation detected by validateProvenanceField",
    i3errors.some((e) => e.invariant === "I3"),
    `errors: ${JSON.stringify(i3errors)}`,
  );

  // Full rejection: persistFieldUpdate refuses an invalid field
  try {
    const badResult = routeFieldUpdate(
      record,
      "identity.title",
      badI1 as ProvenanceField<unknown>,
      SMOKE_ADMIN_ID,
    );
    // If routeFieldUpdate doesn't throw, persistFieldUpdate must reject it
    try {
      await persistFieldUpdate(badResult, record.recordRevision);
      fail("I1 violation should have been rejected by persistFieldUpdate", "no error thrown");
    } catch {
      ok("persistFieldUpdate correctly rejects I1 violation (writer boundary holds)");
    }
  } catch {
    ok("routeFieldUpdate correctly rejects I1 violation upstream");
  }

  // ───────────────────────────────────────────────────────
  // STEP 8: Approve flow
  // ───────────────────────────────────────────────────────
  section("Step 8: Approve flow — DRAFT → APPROVED");

  try {
    const approved = await persistApproval(record, SMOKE_ADMIN_ID);
    assert("draftState is now APPROVED", approved.draftState === "APPROVED", `got: ${approved.draftState}`);
    ok("persistApproval succeeded");

    // Reload and verify
    const reloadedApproved = await getRecruitmentById(record.id);
    assert("Reloaded record is APPROVED", reloadedApproved?.draftState === "APPROVED");
    record = reloadedApproved ?? record;
  } catch (e) {
    fail("persistApproval", String(e));
  }

  // ───────────────────────────────────────────────────────
  // STEP 9: Approve an APPROVED record should fail
  // ───────────────────────────────────────────────────────
  section("Step 9: Double-approve is rejected (approveRecord guards draftState)");

  try {
    await persistApproval(record, SMOKE_ADMIN_ID);
    fail("Double-approve should have thrown", "no error thrown");
  } catch (e) {
    ok(`Double-approve correctly rejected: ${String(e).slice(0, 80)}`);
  }

  // ───────────────────────────────────────────────────────
  // STEP 10: Conflicted record cannot be approved
  // ───────────────────────────────────────────────────────
  section("Step 10: Conflicted record approval is blocked (via record-ops)");

  // Create a separate DRAFT record with a conflict to test this guard
  let conflictRecord;
  try {
    conflictRecord = await createRecruitment({
      slug: `${SMOKE_SLUG}-conflict`,
      identity: {
        organizationId: "smoke-org",
        organizationName: "Smoke Test Organisation",
        title: makeProvenanceField({
          value: "Conflicted Smoke Record",
          status: "CONFLICTED",
          evidenceIds: ["evid-conflict-001"],
          manuallyEdited: false,
        }) as ProvenanceField<string>,
        recruitmentYear: 2026,
        govType: "Central Govt",
      },
      provenance: SMOKE_PROVENANCE,
      adminId: SMOKE_ADMIN_ID,
    });

    try {
      await persistApproval(conflictRecord, SMOKE_ADMIN_ID);
      fail("Conflicted record approval should have been blocked", "no error thrown");
    } catch (e) {
      ok(`Conflicted record approval correctly blocked: ${String(e).slice(0, 80)}`);
    }
  } catch (e) {
    fail("Conflicted record setup", String(e));
  }

  // ───────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`Phase D Smoke Test — RESULTS`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (FAILURES.length > 0) {
    console.log("\n  Failures:");
    FAILURES.forEach((f) => console.log(`    • ${f}`));
  }
  console.log(`\n  Test records in DB (identifiable by slug prefix 'smoke-test-'):`);
  console.log(`    ${SMOKE_SLUG}  (APPROVED — from Step 8)`);
  console.log(`    ${SMOKE_SLUG}-conflict  (DRAFT/conflicted)`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
}

async function cleanupAndExit(id: string | null) {
  if (id) {
    console.log(`\n  (Partial test record in DB: id=${id}, slug prefix smoke-test-)`);
  }
  process.exit(1);
}

main().catch((e) => {
  console.error("\n⛔ Unhandled error:", e);
  process.exit(1);
});
