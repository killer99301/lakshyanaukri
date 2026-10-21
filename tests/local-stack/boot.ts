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
// Never the real Telegram bot: a first publish posts to the public channel.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHANNEL_ID;
delete process.env.TELEGRAM_ADMIN_CHAT_ID;
delete process.env.CRON_SECRET;

// And if a test sets fake Telegram settings, nothing it sends may leave the
// machine: Telegram is refused here unless the test answers for it with its
// own stub, which it installs over this one.
const outsideFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input instanceof Request ? input.url : input).includes("api.telegram.org")) {
    throw new Error("Blocked by the test stack: a test tried to reach the real Telegram API");
  }
  return outsideFetch(input, init);
}) as typeof fetch;

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
