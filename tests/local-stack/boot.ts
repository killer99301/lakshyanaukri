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

export async function boot(opts: { discovery?: boolean } = {}) {
  const pg = await createDb(opts);
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

// Required checks (B2.6): an acceptance suite declares, per section, the checks that must run. A required check
// that did not run (its source was not read, the model proposed nothing to check) is NOT RUN, with its section's
// reason, and the suite is INCOMPLETE — never "ALL PASS". A check that does not apply to a source is said so,
// with why. Suites that declare nothing report as before.
const requiredBySection = new Map<string, string[]>();
const ranBySection = new Map<string, Set<string>>();
const reasonBySection = new Map<string, string>();
const notApplicable: Array<{ section: string; name: string; reason: string }> = [];
let current = "";

export function check(name: string, ok: boolean, detail?: unknown): void {
  ranBySection.get(current)?.add(name);
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

const reasonByCheck = new Map<string, string>();

/**
 * Declares, before anything runs, every check that must run in a section (exactly as check() names them), so a
 * section that is never reached still counts its checks as not run.
 */
export function expectChecks(sectionName: string, required: string[]): void {
  requiredBySection.set(sectionName, [...(requiredBySection.get(sectionName) ?? []), ...required]);
  if (!ranBySection.has(sectionName)) ranBySection.set(sectionName, new Set());
}

export function section(name: string): void {
  current = name;
  console.log(`\n── ${name}`);
}

/** Why a section's remaining required checks cannot run (the source was not read): the current section unless named. */
export function blocked(reason: string, sectionName = current): void {
  reasonBySection.set(sectionName, reason);
  console.log(`  SKIP  the rest of “${sectionName}”: ${reason}`);
}

/** One required check that cannot run, and why (the model proposed nothing to check): it stays NOT RUN. */
export function skipped(name: string, reason: string): void {
  reasonByCheck.set(name, reason);
  console.log(`  SKIP  ${name} — ${reason}`);
}

/** A required check that does not apply to this source, and why: said, never silently left out. */
export function notApplicableHere(name: string, reason: string): void {
  notApplicable.push({ section: current, name, reason });
  ranBySection.get(current)?.add(name);
  console.log(`  N/A   ${name} — ${reason}`);
}

export function summary(): void {
  const notRun = [...requiredBySection].flatMap(([s, names]) => names.filter((n) => !ranBySection.get(s)?.has(n)).map((n) => ({ section: s, name: n })));
  const expected = [...requiredBySection.values()].reduce((a, n) => a + n.length, 0);
  if (requiredBySection.size > 0) {
    console.log(`\nRequired checks: ${expected}; passed ${passed}, failed ${failed}, not run ${notRun.length}, not applicable ${notApplicable.length}`);
    for (const n of notApplicable) console.log(`  not applicable: [${n.section}] ${n.name} — ${n.reason}`);
    for (const n of notRun) console.log(`  NOT RUN: [${n.section}] ${n.name} — ${reasonByCheck.get(n.name) ?? reasonBySection.get(n.section) ?? "not reached: see this section's notes above"}`);
  }
  const verdict = failed > 0 ? "FAILURES" : notRun.length > 0 ? "INCOMPLETE" : "ALL PASS";
  console.log(`\n${verdict}: ${passed} passed, ${failed} failed${requiredBySection.size > 0 ? `, ${notRun.length} not run` : ""}`);
  process.exitCode = verdict === "ALL PASS" ? 0 : 1;
}
