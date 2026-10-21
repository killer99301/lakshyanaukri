#!/usr/bin/env node
// Adds the recruitment importer's tables, triggers and functions.
//
// RUN ONLY WITH THE OWNER'S EXPLICIT APPROVAL, before deploying the importer
// code, and only after a Neon recovery point has been recorded
// (docs/importer-design.md §13).
//
// Additive only: five new tables, their indexes, triggers and functions. No
// existing table, row or index is changed. The whole file runs as ONE
// transaction: either every object is created or none is. Safe to re-run.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/cms-add-importer-tables.ts
//
// --check only reports, changing nothing; exit code 0 when everything is present
// and exactly as expected, 1 otherwise. On this machine a run that changed
// something may end with a libuv assertion and exit code 127 after printing its
// result; judge by the printed lines and follow with --check.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "@/lib/db";
import { splitSqlStatements } from "@/lib/cms/importer/sql-split";
import { IMPORTER_OBJECTS, describeProblems } from "@/lib/cms/importer/schema-manifest";

async function inspect() {
  const tables = await sql`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${Object.keys(IMPORTER_OBJECTS.tables)})
  `;
  const triggers = await sql`
    SELECT t.tgname AS name, c.relname AS table_name, t.tgenabled AS enabled
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relname = ANY(${Object.keys(IMPORTER_OBJECTS.tables)})
  `;
  const functions = await sql`
    SELECT p.proname AS name, p.prosecdef AS security_definer, coalesce(array_to_string(p.proconfig, ','), '') AS config
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(${IMPORTER_OBJECTS.functions})
  `;
  const indexes = await sql`
    SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY(${IMPORTER_OBJECTS.indexes})
  `;
  return describeProblems({
    columns: tables as Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>,
    triggers: triggers as Array<{ name: string; table_name: string; enabled: string }>,
    functions: functions as Array<{ name: string; security_definer: boolean; config: string }>,
    indexes: (indexes as Array<{ name: string }>).map((r) => r.name),
  });
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const before = await inspect();
  console.log(before.length === 0 ? "Before: every importer object is present and as expected." : `Before: ${before.length} problem(s):\n  - ${before.join("\n  - ")}`);
  if (checkOnly) process.exit(before.length === 0 ? 0 : 1);

  const statements = splitSqlStatements(readFileSync(join(process.cwd(), "src/lib/cms/importer/schema.sql"), "utf8"));
  await sql.transaction(statements.map((s) => sql.query(s)));
  console.log(`Ran ${statements.length} statements in one transaction.`);

  const after = await inspect();
  if (after.length > 0) {
    console.error(`❌ Still wrong after the change:\n  - ${after.join("\n  - ")}\nDo not deploy; look at the database first.`);
    process.exit(1);
  }
  console.log("✅ Every importer table, column, index, trigger and function is present and as expected. No existing table was changed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed, nothing was changed (one transaction):", err instanceof Error ? err.message : err);
  process.exit(1);
});
