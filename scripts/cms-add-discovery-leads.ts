#!/usr/bin/env node
// Adds the discovery lead tables (New Jobs Found, N1): discovery_leads and
// discovery_lead_sources, with their indexes.
//
// RUN ONLY WITH THE OWNER'S EXPLICIT APPROVAL, before deploying code that
// reads these tables, and only after a Neon recovery point has been recorded.
//
// Additive only: two new tables and three indexes. No existing table, row or
// index is changed. The whole file runs as ONE transaction: either every
// object is created or none is. Safe to re-run.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/cms-add-discovery-leads.ts
//
// --check only reports, changing nothing; exit code 0 when every table,
// column and index is present, 1 otherwise.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "@/lib/db";
import { splitSqlStatements } from "@/lib/cms/importer/sql-split";
import { DISCOVERY_OBJECTS, discoveryProblems } from "@/lib/cms/discovery/schema-manifest";

async function inspect() {
  const columns = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${Object.keys(DISCOVERY_OBJECTS.tables)})
  `;
  const indexes = await sql`SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY(${DISCOVERY_OBJECTS.indexes})`;
  return discoveryProblems(columns as Array<{ table_name: string; column_name: string }>, (indexes as Array<{ name: string }>).map((r) => r.name));
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const before = await inspect();
  console.log(before.length === 0 ? "Before: every discovery lead object is present." : `Before: ${before.length} problem(s):\n  - ${before.join("\n  - ")}`);
  if (checkOnly) process.exit(before.length === 0 ? 0 : 1);

  const statements = splitSqlStatements(readFileSync(join(process.cwd(), "src/lib/cms/discovery/schema.sql"), "utf8"));
  await sql.transaction(statements.map((s) => sql.query(s)));
  console.log(`Ran ${statements.length} statements in one transaction.`);

  const after = await inspect();
  if (after.length > 0) {
    console.error(`❌ After: ${after.length} problem(s):\n  - ${after.join("\n  - ")}\nDo not deploy; look at the tables first.`);
    process.exit(1);
  }
  console.log("✅ After: every discovery lead object is present.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
