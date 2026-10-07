#!/usr/bin/env node
// Creates the syllabus_library table.
//
// RUN THIS ON PRODUCTION BEFORE DEPLOYING the code that reads it. Until the
// table exists the library page and the suggestion box say it is not set up;
// nothing else on the site depends on it.
//
// Additive only: one new table, no existing table or row is touched. Safe to re-run.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/cms-add-syllabus-library.ts
//
// Add --check to only report whether the table exists, without changing anything.
import { sql } from "@/lib/db";

async function exists(): Promise<boolean> {
  const rows = await sql`SELECT to_regclass('public.syllabus_library') AS t`;
  return rows[0]?.t != null;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const before = await exists();
  console.log(`Before: syllabus_library ${before ? "present" : "missing"}.`);
  if (checkOnly) process.exit(before ? 0 : 1);

  await sql`
    CREATE TABLE IF NOT EXISTS syllabus_library (
      id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      exam_key    VARCHAR(160) NOT NULL UNIQUE,
      exam        VARCHAR(160) NOT NULL,
      match_terms JSONB        NOT NULL,
      basis       TEXT,
      content     TEXT         NOT NULL,
      updated_by  UUID         REFERENCES admins(id),
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `;

  if (!(await exists())) {
    console.error("❌ syllabus_library is still missing after the change.");
    process.exit(1);
  }
  console.log("✅ syllabus_library table is present.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
