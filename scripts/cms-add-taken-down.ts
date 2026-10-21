#!/usr/bin/env node
// Adds the taken_down column to the recruitments table.
//
// RUN THIS ON PRODUCTION BEFORE DEPLOYING the code that reads it: once
// deployed, the public pages and the admin list name this column, and they
// fail until it exists.
//
// Additive only. The column is nullable JSONB with no default, so no existing
// row is changed, every job stays on the website, and no lock is held for a
// rewrite. Safe to re-run.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/cms-add-taken-down.ts
//
// Add --check to only report whether the column exists, without changing anything.
import { sql } from "@/lib/db";

async function present(): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'recruitments'::regclass
      AND attname = 'taken_down'
      AND attnum > 0
      AND NOT attisdropped
  `;
  return rows.length > 0;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const before = await present();
  console.log(`Before: taken_down column ${before ? "present" : "missing"}.`);

  if (checkOnly) {
    process.exit(before ? 0 : 1);
  }

  await sql`ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS taken_down JSONB`;

  if (!(await present())) {
    console.error("❌ taken_down is still missing after the change");
    process.exit(1);
  }
  console.log("✅ taken_down column is present. No job was changed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
