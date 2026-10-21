#!/usr/bin/env node
// Adds the taken_down column to the recruitments table.
//
// RUN THIS ON PRODUCTION BEFORE DEPLOYING the code that reads it: once
// deployed, the public pages and the admin list name this column, and they
// fail until it exists.
//
// Additive only. The column is nullable JSONB with no default, so no existing
// row is changed, every job stays on the website (NULL means "on the site"),
// and the table is not rewritten: Postgres holds its lock for a moment only.
// Safe to re-run.
//
// The final check also requires the column to be JSONB and nullable. A column
// of the same name with another shape would be skipped by IF NOT EXISTS, so
// that case is reported and the script fails instead of passing quietly.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/cms-add-taken-down.ts
//
// Add --check to only report on the column, without changing anything.
import { sql } from "@/lib/db";

type Column = { type: string; nullable: boolean } | null;

async function column(): Promise<Column> {
  const rows = await sql`
    SELECT format_type(atttypid, atttypmod) AS type, NOT attnotnull AS nullable
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'recruitments'::regclass
      AND attname = 'taken_down'
      AND attnum > 0
      AND NOT attisdropped
  `;
  return rows.length ? { type: rows[0].type as string, nullable: rows[0].nullable as boolean } : null;
}

const describe = (c: Column) => (c ? `present, ${c.type}, ${c.nullable ? "nullable" : "NOT NULL"}` : "missing");
const correct = (c: Column) => c !== null && c.type === "jsonb" && c.nullable;

async function main() {
  const checkOnly = process.argv.includes("--check");
  const before = await column();
  console.log(`Before: taken_down column ${describe(before)}.`);

  if (checkOnly) {
    process.exit(correct(before) ? 0 : 1);
  }

  await sql`ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS taken_down JSONB`;

  const after = await column();
  console.log(`After: taken_down column ${describe(after)}.`);
  if (!correct(after)) {
    console.error("❌ taken_down must be a nullable JSONB column. Do not deploy; look at the column first.");
    process.exit(1);
  }
  const hidden = await sql`SELECT count(*)::int AS n FROM recruitments WHERE taken_down IS NOT NULL`;
  console.log(`✅ taken_down is a nullable JSONB column. Jobs marked as taken off the site: ${hidden[0].n}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
