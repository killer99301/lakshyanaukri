#!/usr/bin/env node
// Adds the exam_pattern and syllabus columns to the recruitments table.
//
// RUN THIS ON PRODUCTION BEFORE DEPLOYING the code that reads and writes these
// columns: once deployed, every record save names them, and saves fail until
// they exist.
//
// Additive only. Both columns are nullable JSONB with no default, so no
// existing row is changed and no lock is held for a rewrite. Safe to re-run.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/cms-add-exam-pattern-syllabus.ts
//
// Add --check to only report whether the columns exist, without changing anything.
import { sql } from "@/lib/db";

const COLUMNS = ["exam_pattern", "syllabus"] as const;

async function existing(): Promise<string[]> {
  const rows = await sql`
    SELECT attname FROM pg_catalog.pg_attribute
    WHERE attrelid = 'recruitments'::regclass
      AND attname IN ('exam_pattern', 'syllabus')
      AND attnum > 0
      AND NOT attisdropped
  `;
  return rows.map((r) => r.attname as string);
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const before = await existing();
  console.log(`Before: ${before.length ? before.join(", ") : "neither column"} present.`);

  if (checkOnly) {
    process.exit(COLUMNS.every((c) => before.includes(c)) ? 0 : 1);
  }

  await sql`ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS exam_pattern JSONB`;
  await sql`ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS syllabus JSONB`;

  const after = await existing();
  const missing = COLUMNS.filter((c) => !after.includes(c));
  if (missing.length > 0) {
    console.error(`❌ Still missing after the change: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("✅ exam_pattern and syllabus columns are present.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
