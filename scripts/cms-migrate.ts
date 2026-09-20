// ═══════════════════════════════════════════════════════════
// CMS Schema Migration — One-time setup script
// ═══════════════════════════════════════════════════════════
//
// Applies src/lib/cms/schema.sql to the Neon database.
// The schema uses CREATE TABLE IF NOT EXISTS throughout —
// safe to run again if partially applied.
//
// PREREQUISITE: admins table must already exist (created by
// the existing admin auth setup). This script does NOT
// create or modify the admins table.
//
// Run (after approval):
//   npx tsx --tsconfig tsconfig.json scripts/cms-migrate.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

// ─── Setup ───────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL not set. Load .env.local first.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// ─── Helpers ─────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function splitStatements(raw: string): string[] {
  // Strip single-line comments FIRST (before splitting), so semicolons inside
  // comments don't create phantom statements.
  const withoutComments = raw
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return withoutComments
    .split(/;/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("CMS Schema Migration");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("This will create ONLY the following 6 new CMS tables:");
  console.log("  1. recruitments");
  console.log("  2. recruitment_evidence");
  console.log("  3. field_revisions");
  console.log("  4. recruitment_lifecycle_events");
  console.log("  5. published_recruitments");
  console.log("  6. recruitment_audit_events");
  console.log("");
  console.log("All statements use CREATE TABLE IF NOT EXISTS — idempotent.");
  console.log("No existing tables are modified. No data is deleted.");
  console.log("Prerequisite: admins table must already exist (FK references).");
  console.log("");

  // ── Read schema ──────────────────────────────────────────
  const schemaPath = resolve(__dirname, "../src/lib/cms/schema.sql");
  let rawSql: string;
  try {
    rawSql = readFileSync(schemaPath, "utf-8");
  } catch (e) {
    console.error(`❌  Cannot read schema file: ${schemaPath}`);
    console.error(String(e));
    process.exit(1);
  }

  const statements = splitStatements(rawSql);
  console.log(`Parsed ${statements.length} SQL statements from schema.sql.`);

  // ── Verify admins table exists (prerequisite) ─────────────
  console.log("\nChecking prerequisites...");
  try {
    await sql`SELECT 1 FROM admins LIMIT 1`;
    console.log("  ✅  admins table exists");
  } catch (e) {
    console.error(`  ❌  admins table not found: ${String(e)}`);
    console.error("      Cannot apply CMS schema without the admins FK target.");
    process.exit(1);
  }

  // ── Check which tables already exist ─────────────────────
  const EXPECTED_TABLES = [
    "recruitments",
    "recruitment_evidence",
    "field_revisions",
    "recruitment_lifecycle_events",
    "published_recruitments",
    "recruitment_audit_events",
  ];

  const existing = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${EXPECTED_TABLES})
  `;
  const existingNames = new Set(existing.map((r) => r.table_name as string));

  console.log("\nCurrent table state:");
  for (const t of EXPECTED_TABLES) {
    console.log(`  ${existingNames.has(t) ? "✅ already exists" : "⬜ will be created"} — ${t}`);
  }

  if (EXPECTED_TABLES.every((t) => existingNames.has(t))) {
    console.log("\n✅  All 6 tables already exist. Nothing to apply.");
    process.exit(0);
  }

  // ── Execute statements ────────────────────────────────────
  console.log("\nApplying schema...\n");
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const stmt of statements) {
    const preview = stmt.slice(0, 80).replace(/\s+/g, " ");
    try {
      await sql.query(stmt);
      console.log(`  ✅  ${preview}`);
      applied++;
    } catch (e: unknown) {
      const msg = String(e);
      if (msg.includes("already exists")) {
        console.log(`  ⏭   ${preview}  (already exists — skipped)`);
        skipped++;
      } else {
        console.log(`  ❌  ${preview}`);
        console.log(`       ${msg}`);
        errors.push(`${preview}: ${msg}`);
      }
    }
  }

  // ── Verify all 6 tables now exist ─────────────────────────
  console.log("\nVerifying tables...");
  const verified = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${EXPECTED_TABLES})
  `;
  const verifiedNames = new Set(verified.map((r) => r.table_name as string));

  let allPresent = true;
  for (const t of EXPECTED_TABLES) {
    if (verifiedNames.has(t)) {
      console.log(`  ✅  ${t}`);
    } else {
      console.log(`  ❌  ${t} — NOT FOUND after migration`);
      allPresent = false;
    }
  }

  // ── Summary ───────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("Migration Summary");
  console.log(`  Statements applied: ${applied}`);
  console.log(`  Skipped (already existed): ${skipped}`);
  console.log(`  Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log("\n  Errors detail:");
    errors.forEach((e) => console.log(`    • ${e}`));
  }
  console.log(allPresent ? "\n✅  Migration complete." : "\n❌  Migration incomplete — some tables missing.");
  console.log("═══════════════════════════════════════════════════════════\n");

  if (errors.length > 0 || !allPresent) process.exit(1);
}

main().catch((e) => {
  console.error("\n⛔ Unhandled error:", e);
  process.exit(1);
});
