#!/usr/bin/env node
// Adds the "link not released yet" decision (ADMIN_NOT_YET_OPEN) to the importer's claims table.
// docs/apply-link-not-yet-open-design.md, revision 3, §6.
//
// RUN ONLY WITH THE OWNER'S EXPLICIT APPROVAL, before deploying the code that records the decision, and only
// after a Neon recovery point has been recorded. Production migration is a separate owner decision (D8).
//
// Additive only: the claim kind check and the public-note check are replaced by named ones that also allow
// the new kind, the new kind's own rule is added, and the decision trigger function is replaced. No row is
// changed. The whole importer schema file runs as ONE transaction (as scripts/cms-add-importer-tables.ts
// does): either everything is applied or nothing. Safe to re-run.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/cms-add-link-later.ts [--check]
//
// --check only reports, changing nothing; exit code 0 when everything is present and as expected, 1 otherwise.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "@/lib/db";
import { splitSqlStatements } from "@/lib/cms/importer/sql-split";
import { describeLinkLaterProblems } from "@/lib/cms/importer/schema-manifest";

export async function inspectLinkLater(run: typeof sql = sql): Promise<string[]> {
  const checks = await run`
    SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS def FROM pg_constraint con
    WHERE con.conrelid = 'public.recruitment_field_claims'::regclass AND con.contype = 'c'`;
  const fn = await run`
    SELECT p.prosrc AS src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cms_importer_check_claim'`;
  return describeLinkLaterProblems({
    checks: (checks as Array<{ name: string; def: string }>).map((c) => ({ name: String(c.name), def: String(c.def) })),
    claimFunctionSource: (fn[0]?.src as string | undefined) ?? null,
  });
}

/** Runs the importer schema file (with this change) as one transaction. Re-runnable. */
export async function migrateLinkLater(run: typeof sql = sql): Promise<number> {
  const statements = splitSqlStatements(readFileSync(join(process.cwd(), "src/lib/cms/importer/schema.sql"), "utf8"));
  await run.transaction(statements.map((s) => run.query(s)));
  return statements.length;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const before = await inspectLinkLater();
  console.log(before.length === 0 ? "Before: the link-not-released decision is already in place." : `Before: ${before.length} problem(s):\n  - ${before.join("\n  - ")}`);
  if (checkOnly) process.exit(before.length === 0 ? 0 : 1);
  console.log(`Ran ${await migrateLinkLater()} statements in one transaction.`);
  const after = await inspectLinkLater();
  if (after.length > 0) {
    console.error(`❌ Still wrong after the change:\n  - ${after.join("\n  - ")}\nDo not deploy; look at the database first.`);
    process.exit(1);
  }
  console.log("✅ The link-not-released decision is in place. No row was changed.");
  process.exit(0);
}

if (process.argv[1] && /cms-add-link-later/.test(process.argv[1])) {
  main().catch((err) => {
    console.error("Migration failed, nothing was changed (one transaction):", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
