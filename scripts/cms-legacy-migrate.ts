#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Phase G6 — Controlled Legacy Migration
// ═══════════════════════════════════════════════════════════
//
// Migrates 6 PARTIALLY_VERIFIED legacy records from government.ts
// to the CMS `recruitments` table as APPROVED records.
//
// Safety requirements:
//   - Transactional INSERT of all 6 records (sql.transaction)
//   - Reads back and validates every inserted row (18+ fields)
//   - On validation failure: DELETEs inserted rows and exits 1
//   - Verifies excluded NOT_VERIFIED slugs remain absent
//   - Never modifies government.ts
//   - Does NOT call createRecruitment() (which hardcodes DRAFT)
//
// Usage:
//   npx tsx scripts/cms-legacy-migrate.ts
// ═══════════════════════════════════════════════════════════

import * as path from "node:path";

// Load .env.local before any DB imports (Node v20.12+ built-in)
try {
  (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
    path.resolve(process.cwd(), ".env.local"),
  );
} catch { /* already set, or file absent */ }

import { sql } from "@/lib/db";
import { GOVERNMENT_RECRUITMENTS } from "@/data/government";
import { legacyToRecord } from "./cms-legacy-import";
import { getRecruitmentBySlug } from "@/lib/cms/repository";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { GovernmentRecruitment } from "@/types";

// ─── Constants ───────────────────────────────────────────

const EXCLUDED_SLUGS = new Set([
  "ibps-common-process-probationary-officers-management-trainees-2025",
  "ibps-common-process-officers-scale-ii-iii-2026",
]);

const ELIGIBLE = GOVERNMENT_RECRUITMENTS.filter(
  (r) => r.provenance.status === "PARTIALLY_VERIFIED",
);

// ─── Read-back validation ─────────────────────────────────

interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function validateReadBack(
  gr: GovernmentRecruitment,
  rec: RecruitmentRecord,
): ValidationResult {
  const errors: string[] = [];

  if (rec.slug !== gr.slug)
    errors.push(`slug: expected "${gr.slug}", got "${rec.slug}"`);
  if (rec.draftState !== "APPROVED")
    errors.push(`draftState: expected "APPROVED", got "${rec.draftState}"`);
  if (rec.identity.organizationId !== gr.organizationId)
    errors.push(`organizationId: expected "${gr.organizationId}", got "${rec.identity.organizationId}"`);
  if (rec.identity.organizationName !== gr.organizationName)
    errors.push(`organizationName: expected "${gr.organizationName}", got "${rec.identity.organizationName}"`);
  if (rec.identity.title.value !== gr.title)
    errors.push(`title: expected "${gr.title}", got "${rec.identity.title.value}"`);

  const expNotif = gr.notificationNumber ?? null;
  const gotNotif = rec.identity.notificationNumber?.value ?? null;
  if (expNotif !== gotNotif)
    errors.push(`notificationNumber: expected "${expNotif}", got "${gotNotif}"`);

  const expOpen = gr.application.openDate ?? null;
  const gotOpen = (rec.dates.applicationOpenDate?.value as string | null | undefined) ?? null;
  if (expOpen !== gotOpen)
    errors.push(`applicationOpenDate: expected "${expOpen}", got "${gotOpen}"`);

  const expClose = gr.application.closeDate ?? null;
  const gotClose = (rec.dates.applicationCloseDate?.value as string | null | undefined) ?? null;
  if (expClose !== gotClose)
    errors.push(`applicationCloseDate: expected "${expClose}", got "${gotClose}"`);

  const expNotifDate = gr.application.notificationDate ?? null;
  const gotNotifDate = (rec.dates.notificationDate?.value as string | null | undefined) ?? null;
  if (expNotifDate !== gotNotifDate)
    errors.push(`notificationDate: expected "${expNotifDate}", got "${gotNotifDate}"`);

  if (rec.vacancies.total.value !== gr.totalVacancies)
    errors.push(`totalVacancies: expected ${gr.totalVacancies}, got ${rec.vacancies.total.value}`);

  const expFeeGen = gr.fee?.rows.find((r) => r.category.includes("General"))?.amount ?? null;
  const gotFeeGen = (rec.financial.feeGeneral?.value as number | null | undefined) ?? null;
  if (expFeeGen !== gotFeeGen)
    errors.push(`feeGeneral: expected ${expFeeGen}, got ${gotFeeGen}`);

  if (rec.lifecycle.status !== "APPLICATIONS_CLOSED")
    errors.push(`lifecycle.status: expected "APPLICATIONS_CLOSED", got "${rec.lifecycle.status}"`);

  if (rec.provenance.status !== gr.provenance.status)
    errors.push(`provenance.status: expected "${gr.provenance.status}", got "${rec.provenance.status}"`);

  const expSrc = gr.provenance.primarySourceUrl ?? null;
  const gotSrc = rec.provenance.primarySourceUrl ?? null;
  if (expSrc !== gotSrc)
    errors.push(`provenance.primarySourceUrl: expected "${expSrc}", got "${gotSrc}"`);

  const expCat = gr.category;
  const gotCat = (rec.classification as { category?: string } | undefined)?.category ?? null;
  if (expCat !== gotCat)
    errors.push(`classification.category: expected "${expCat}", got "${gotCat}"`);

  const expStages = gr.examStages.length;
  const gotStages = (rec.examStages ?? []).length;
  if (expStages !== gotStages)
    errors.push(`examStages.length: expected ${expStages}, got ${gotStages}`);

  if (!Array.isArray(rec.links))
    errors.push(`links: expected array, got ${typeof rec.links}`);
  if (!Array.isArray(rec.documents))
    errors.push(`documents: expected array, got ${typeof rec.documents}`);
  if (!Array.isArray(rec.updates))
    errors.push(`updates: expected array, got ${typeof rec.updates}`);

  return { ok: errors.length === 0, errors };
}

// ─── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Phase G6 — Controlled Legacy Migration");
  console.log(`  Records to migrate: ${ELIGIBLE.length} PARTIALLY_VERIFIED`);
  console.log("═══════════════════════════════════════════════════\n");

  // Preflight: none of the eligible slugs should be in the excluded set
  for (const gr of ELIGIBLE) {
    if (EXCLUDED_SLUGS.has(gr.slug)) {
      console.error(`FATAL: eligible set contains excluded slug: ${gr.slug}`);
      process.exit(1);
    }
  }

  // Preflight: verify expected count
  if (ELIGIBLE.length !== 6) {
    console.error(`FATAL: expected 6 eligible records, found ${ELIGIBLE.length}`);
    process.exit(1);
  }

  console.log("Eligible records:");
  for (const gr of ELIGIBLE) {
    console.log(`  • ${gr.id}  (${gr.slug})`);
  }
  console.log();

  // Get an admin ID for created_by / updated_by (FK is nullable)
  const adminRows = await sql`SELECT id FROM admins ORDER BY created_at LIMIT 1`;
  const adminId: string | null = adminRows.length > 0 ? (adminRows[0].id as string) : null;
  console.log(`Admin ID for attribution: ${adminId ?? "NULL (no admins found)"}\n`);

  // Build in-memory CMS records from legacy source
  const records = ELIGIBLE.map((gr) => legacyToRecord(gr));

  // ── Transactional INSERT ──────────────────────────────
  console.log("Executing transactional INSERT of 6 records...\n");

  let insertedIds: string[] = [];

  try {
    const results = await sql.transaction((txn) =>
      records.map((rec) =>
        txn`
          INSERT INTO recruitments (
            slug, draft_state,
            identity, dates, vacancies, financial,
            eligibility, age, selection,
            exam_stages, how_to_apply,
            lifecycle, provenance, links, documents, updates,
            classification,
            organization_id, organization_name, title_text, gov_type,
            created_by, updated_by
          )
          VALUES (
            ${rec.slug},
            'APPROVED',
            ${JSON.stringify(rec.identity)},
            ${JSON.stringify(rec.dates ?? {})},
            ${JSON.stringify(rec.vacancies)},
            ${JSON.stringify(rec.financial)},
            ${rec.eligibility !== undefined ? JSON.stringify(rec.eligibility) : null},
            ${rec.age !== undefined ? JSON.stringify(rec.age) : null},
            ${rec.selection !== undefined ? JSON.stringify(rec.selection) : null},
            ${rec.examStages && rec.examStages.length > 0 ? JSON.stringify(rec.examStages) : null},
            ${rec.howToApply !== undefined ? JSON.stringify(rec.howToApply) : null},
            ${JSON.stringify(rec.lifecycle)},
            ${JSON.stringify(rec.provenance)},
            ${JSON.stringify(rec.links ?? [])},
            ${JSON.stringify(rec.documents ?? [])},
            ${JSON.stringify(rec.updates ?? [])},
            ${rec.classification !== undefined ? JSON.stringify(rec.classification) : null},
            ${rec.identity.organizationId},
            ${rec.identity.organizationName ?? null},
            ${rec.identity.title.value ?? null},
            ${rec.identity.govType ?? null},
            ${adminId},
            ${adminId}
          )
          RETURNING id, slug, draft_state
        `,
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const rows = results[i] as Array<{ id: string; slug: string; draft_state: string }>;
      if (rows.length === 0) {
        // Should not happen without ON CONFLICT — means a bug in the transaction response
        console.error(`FATAL: INSERT returned 0 rows for ${records[i].slug}`);
        process.exit(1);
      }
      insertedIds.push(rows[0].id);
      console.log(`  ✓ ${rows[0].slug}  draft_state=${rows[0].draft_state}  id=${rows[0].id}`);
    }
  } catch (err) {
    console.error("\nFATAL: Transaction failed — all inserts rolled back automatically.");
    console.error(err);
    process.exit(1);
  }

  console.log(`\n  ${insertedIds.length}/6 records inserted.\n`);

  // ── Read-back validation ──────────────────────────────
  console.log("Validating read-back against legacy source...\n");

  const allErrors: string[] = [];

  for (const gr of ELIGIBLE) {
    const readBack = await getRecruitmentBySlug(gr.slug);
    if (!readBack) {
      allErrors.push(`${gr.slug}: NOT FOUND after insert`);
      console.log(`  ❌ ${gr.slug}  — NOT FOUND`);
      continue;
    }

    const result = validateReadBack(gr, readBack);
    if (result.ok) {
      console.log(`  ✅ ${gr.slug}`);
    } else {
      console.log(`  ❌ ${gr.slug}:`);
      for (const e of result.errors) {
        console.log(`       ${e}`);
        allErrors.push(`${gr.slug}: ${e}`);
      }
    }
  }

  if (allErrors.length > 0) {
    console.error(`\n  ❌ ${allErrors.length} validation error(s) — deleting inserted rows.\n`);
    if (insertedIds.length > 0) {
      try {
        await sql`
          DELETE FROM recruitments
          WHERE id = ANY(${insertedIds}::uuid[])
        `;
        console.log(`  Deleted ${insertedIds.length} row(s) from recruitments.\n`);
      } catch (delErr) {
        console.error("  Could not delete inserted rows — manual cleanup required:", delErr);
      }
    }
    process.exit(1);
  }

  // ── Verify excluded slugs are absent ─────────────────
  console.log("\nVerifying excluded NOT_VERIFIED slugs have no rows...\n");
  for (const exSlug of EXCLUDED_SLUGS) {
    const row = await getRecruitmentBySlug(exSlug);
    if (row) {
      console.error(`  ❌ EXCLUDED slug found in DB: ${exSlug}`);
      allErrors.push(`Excluded slug present: ${exSlug}`);
    } else {
      console.log(`  ✓ ${exSlug}  (absent — correct)`);
    }
  }

  if (allErrors.length > 0) {
    console.error("\n  ❌ Excluded slug verification failed.");
    process.exit(1);
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ✅ Migration complete.");
  console.log("  ✅ 6/6 records validated against legacy source.");
  console.log("  ✅ 2/2 excluded slugs confirmed absent.");
  console.log("═══════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Migration crashed:", err);
  process.exit(1);
});
