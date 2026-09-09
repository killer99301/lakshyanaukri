#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// Admin Setup Script
// ═══════════════════════════════════════════════════════════
//
// Run with: npx tsx --tsconfig tsconfig.json scripts/admin-setup.ts
//
// Steps:
//   1. Validates required env vars
//   2. Applies DB schema (CREATE TABLE IF NOT EXISTS — idempotent)
//   3. Checks for existing admin
//   4. Prompts for credentials + creates first admin
//   5. Generates 10 emergency recovery codes (print ONCE, irretrievable)
// ═══════════════════════════════════════════════════════════

import { createInterface } from "readline";
import { readFileSync } from "fs";
import { join } from "path";
import crypto from "crypto";

// ─── Env validation ────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_OTP_HMAC_KEY = process.env.ADMIN_OTP_HMAC_KEY;

if (!DATABASE_URL) {
  console.error(
    "\nERROR: DATABASE_URL is not set.\n" +
    "Add it to .env.local:\n" +
    "  DATABASE_URL=postgresql://user:pass@host/db?sslmode=require\n"
  );
  process.exit(1);
}

if (!ADMIN_OTP_HMAC_KEY) {
  console.error(
    "\nERROR: ADMIN_OTP_HMAC_KEY is not set.\n" +
    "Generate one with:\n" +
    "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
    "Then add it to .env.local:\n" +
    "  ADMIN_OTP_HMAC_KEY=<64 hex chars>\n"
  );
  process.exit(1);
}

// ─── DB client ─────────────────────────────────────────────

import { neon } from "@neondatabase/serverless";
const sql = neon(DATABASE_URL);

// ─── Readline helper ───────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const chunks: string[] = [];

    // Disable echo
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    stdin.resume();

    const onData = (ch: Buffer) => {
      const char = ch.toString("utf8");
      if (char === "\n" || char === "\r" || char === "") {
        process.stdout.write("\n");
        stdin.removeListener("data", onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        stdin.pause();
        resolve(chunks.join(""));
      } else if (char === "" || char === "") {
        // Backspace
        if (chunks.length > 0) chunks.pop();
      } else {
        chunks.push(char);
      }
    };

    stdin.on("data", onData);
  });
}

// ─── Password hashing ──────────────────────────────────────

import { hash } from "@node-rs/argon2";

async function hashPassword(plain: string): Promise<string> {
  // Algorithm.Argon2id = 2 (const enum — use literal for isolatedModules compatibility)
  return hash(plain, {
    algorithm: 2 as const, // Argon2id
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

// ─── Emergency code format ─────────────────────────────────

function formatCode(raw: string): string {
  // Format 24-char hex as XXXX-XXXX-XXXX (groups of 4 hex)
  return raw.match(/.{4}/g)?.join("-") ?? raw;
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════");
  console.log("  LakshyaNaukri Admin Setup");
  console.log("════════════════════════════════════════\n");

  // 1. Apply schema
  console.log("Applying database schema...");
  const schemaPath = join(process.cwd(), "src", "lib", "auth", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  // Split on semicolons and execute each statement
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    if (stmt.trim()) {
      await sql.unsafe(stmt);
    }
  }
  console.log("Schema applied (CREATE TABLE IF NOT EXISTS — safe to re-run).\n");

  // 2. Check for existing admin
  const existing = await sql`SELECT id FROM admins LIMIT 1`;
  if (existing.length > 0) {
    console.log(
      "Admin account already exists.\n" +
      "Use account recovery to reset password.\n"
    );
    rl.close();
    process.exit(0);
  }

  // 3. Prompt for credentials
  console.log("No admin account found. Creating first admin account.\n");

  const username = (await prompt("Username [admin]: ")).trim() || "admin";
  const email = (await prompt("Email: ")).trim();

  if (!email || !email.includes("@")) {
    console.error("Invalid email address.");
    rl.close();
    process.exit(1);
  }

  let password = "";
  for (let i = 0; i < 3; i++) {
    password = await promptSecret("Password (min 12 chars): ");
    if (password.length < 12) {
      console.error("Password must be at least 12 characters. Try again.\n");
      password = "";
    } else {
      const confirm = await promptSecret("Confirm password: ");
      if (confirm !== password) {
        console.error("Passwords do not match. Try again.\n");
        password = "";
      } else {
        break;
      }
    }
  }

  if (!password) {
    console.error("Failed to set password after 3 attempts.");
    rl.close();
    process.exit(1);
  }

  // 4. Insert admin
  console.log("\nHashing password (this takes a moment)...");
  const passwordHash = await hashPassword(password);

  const adminRows = await sql`
    INSERT INTO admins (username, email, password_hash)
    VALUES (${username}, ${email}, ${passwordHash})
    RETURNING id
  `;
  const adminId = adminRows[0].id;
  console.log(`Admin created: ${username} <${email}>\n`);

  // 5. Generate 10 emergency codes
  console.log("Generating 10 emergency recovery codes...\n");

  const rawCodes: string[] = [];
  for (let i = 0; i < 10; i++) {
    rawCodes.push(crypto.randomBytes(12).toString("hex")); // 24-char hex
  }

  // Hash and insert each code
  for (const raw of rawCodes) {
    const codeHash = await hashPassword(raw);
    await sql`
      INSERT INTO recovery_codes (admin_id, code_hash)
      VALUES (${adminId}, ${codeHash})
    `;
  }

  // Print codes ONCE
  console.log("════════════════════════════════════════════════════════════");
  console.log("  EMERGENCY RECOVERY CODES — SAVE THESE NOW");
  console.log("  These codes CANNOT be retrieved again.");
  console.log("  Store them offline in a secure location.");
  console.log("════════════════════════════════════════════════════════════\n");

  rawCodes.forEach((raw, i) => {
    console.log(`  ${String(i + 1).padStart(2, " ")}. ${formatCode(raw)}`);
  });

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  Setup complete. Keep these codes safe.");
  console.log("════════════════════════════════════════════════════════════\n");

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  rl.close();
  process.exit(1);
});
