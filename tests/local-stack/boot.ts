// Boots the in-memory test database and routes the app's Neon client to it.
//
// IMPORT THIS FIRST, and load project modules that touch the database with
// `await import(...)` AFTER calling boot(). DATABASE_URL is overwritten here
// so a test can never reach the database named in .env.local.

import { neonConfig } from "@neondatabase/serverless";
import { createDb, makeFetch } from "./emulator";

export const ORIGIN = "http://localhost:3000";
export const LOCAL_DATABASE_URL = "postgresql://test:test@localhost/test";

process.env.DATABASE_URL = LOCAL_DATABASE_URL;
process.env.ADMIN_ALLOWED_ORIGINS = ORIGIN;
process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
process.env.ADMIN_OTP_HMAC_KEY ??= "local-test-hmac-key-not-a-secret";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RESEND_API_KEY;

export async function boot() {
  const pg = await createDb();
  let queries = 0;
  neonConfig.fetchFunction = makeFetch(pg, () => { queries++; });

  const admin = await pg.query<{ id: string }>(
    "INSERT INTO admins (username, email, password_hash) VALUES ('test-admin', 'test-admin@example.test', 'not-a-real-hash') RETURNING id",
  );
  const adminId = admin.rows[0].id;

  const { createSession } = await import("@/lib/auth/session");
  const token = await createSession(adminId, "127.0.0.1", "local-stack");
  if (queries === 0) {
    throw new Error("The app's database client is not routed to the in-memory database — aborting");
  }
  return { pg, adminId, token };
}

// ─── Minimal reporting ────────────────────────────────────

let passed = 0;
let failed = 0;

export function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`);
  }
}

export function note(message: string): void {
  console.log(`  ....  ${message}`);
}

export function section(name: string): void {
  console.log(`\n── ${name}`);
}

export function summary(): void {
  console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}
