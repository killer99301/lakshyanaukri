#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// Intelligence Draft Schema Setup
// ═══════════════════════════════════════════════════════════
//
// Applies the intelligence draft tables to the database.
// Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
// Does NOT create admin accounts or touch auth tables.
//
// Prerequisites: auth schema must already be applied
//   (the intelligence tables reference admins.id).
//
// Run with:
//   npx tsx --tsconfig tsconfig.json scripts/intelligence-setup.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "fs";
import { join } from "path";

// ─── Env validation ────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "\nERROR: DATABASE_URL is not set.\n" +
    "Add it to .env.local:\n" +
    "  DATABASE_URL=postgresql://user:pass@host/db?sslmode=require\n",
  );
  process.exit(1);
}

// ─── DB client ─────────────────────────────────────────────

import { neon } from "@neondatabase/serverless";
const sql = neon(DATABASE_URL);

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════");
  console.log("  LakshyaNaukri Intelligence Schema Setup");
  console.log("════════════════════════════════════════\n");

  const schemaPath = join(process.cwd(), "src", "lib", "intelligence", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    if (stmt.trim()) {
      await sql.unsafe(stmt);
    }
  }

  console.log("Intelligence draft schema applied.\n");
  console.log("Tables created (or already existed):");
  console.log("  • intelligence_drafts");
  console.log("  • intelligence_draft_revisions\n");
  console.log("Safe to re-run — CREATE TABLE IF NOT EXISTS throughout.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
