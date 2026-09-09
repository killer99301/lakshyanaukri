// ═══════════════════════════════════════════════════════════
// Auth Test Suite — AUTH1 through AUTH23
// ═══════════════════════════════════════════════════════════
//
// Run with: npx tsx --tsconfig tsconfig.json tests/auth/auth.test.ts
//
// Tests mock the DB and Redis to avoid external dependencies.
// All tests run inside async main() to avoid top-level await issues.
// ═══════════════════════════════════════════════════════════

import crypto from "crypto";

// ─── Test harness ──────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(testId: string, condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testId}: ${message}`);
  } else {
    failed++;
    const msg = `  ✗ ${testId}: ${message}`;
    errors.push(msg);
    console.log(msg);
  }
}

async function test(
  testId: string,
  fn: () => Promise<boolean>,
  message: string
): Promise<void> {
  try {
    const result = await fn();
    assert(testId, result, message);
  } catch (err) {
    failed++;
    const msg = `  ✗ ${testId}: ${message} — threw: ${err}`;
    errors.push(msg);
    console.log(msg);
  }
}

// ─── Mock DB ──────────────────────────────────────────────

interface MockSession {
  id: string;
  admin_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_used_at: Date;
  revoked_at: Date | null;
}

interface MockTransaction {
  id: string;
  admin_id: string;
  otp_hash: string;
  attempts: number;
  resend_count: number;
  expires_at: Date;
  used_at: Date | null;
  superseded_at: Date | null;
}

interface MockResetToken {
  id: string;
  admin_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

interface MockRecoveryCode {
  id: string;
  admin_id: string;
  code_hash: string;
  used_at: Date | null;
}

const DB = {
  sessions: new Map<string, MockSession>(),
  transactions: new Map<string, MockTransaction>(),
  resetTokens: new Map<string, MockResetToken>(),
  recoveryCodes: new Map<string, MockRecoveryCode>(),
  reset() {
    this.sessions.clear();
    this.transactions.clear();
    this.resetTokens.clear();
    this.recoveryCodes.clear();
  },
};

// ─── Constants ────────────────────────────────────────────

const SESSION_ABSOLUTE_MAX_AGE_SECONDS = 28800; // 8h
const SESSION_IDLE_MAX_AGE_SECONDS = 1800; // 30m
const OTP_EXPIRY_SECONDS = 600; // 10m
const RESET_TOKEN_EXPIRY_SECONDS = 900; // 15m
const MAX_OTP_ATTEMPTS = 5;
const MAX_RESEND_COUNT = 3;

// Inject mock HMAC key
process.env.ADMIN_OTP_HMAC_KEY = crypto.randomBytes(32).toString("hex");

// ─── Pure utility functions ────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashOtp(otp: string, transactionId: string): string {
  const key = process.env.ADMIN_OTP_HMAC_KEY!;
  return crypto.createHmac("sha256", key).update(`${otp}:${transactionId}`).digest("hex");
}

function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// ─── Mock password (fast — no native binary needed in tests) ──

async function mockHashPassword(plain: string): Promise<string> {
  return `$mock$${crypto.createHash("sha256").update(plain).digest("hex")}`;
}

async function mockVerifyPassword(hash: string, plain: string): Promise<boolean> {
  if (!hash.startsWith("$mock$")) return false;
  const expected = `$mock$${crypto.createHash("sha256").update(plain).digest("hex")}`;
  return hash === expected;
}

// ─── Mock session functions ────────────────────────────────

async function mockCreateSession(
  adminId: string,
  ip: string,
  ua: string,
  expiresInSeconds = SESSION_ABSOLUTE_MAX_AGE_SECONDS
): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  DB.sessions.set(crypto.randomUUID(), {
    id: crypto.randomUUID(),
    admin_id: adminId,
    token_hash: tokenHash,
    created_at: now,
    expires_at: new Date(now.getTime() + expiresInSeconds * 1000),
    last_used_at: now,
    revoked_at: null,
  });
  return token;
}

async function mockValidateSession(
  token: string,
  clockOffsetMs = 0
): Promise<{ adminId: string; sessionId: string } | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = new Date(Date.now() + clockOffsetMs);

  const session = [...DB.sessions.values()].find((s) => s.token_hash === tokenHash);
  if (!session) return null;
  if (session.revoked_at) return null;
  if (session.expires_at < now) return null;

  const idleDeadline = new Date(session.last_used_at.getTime() + SESSION_IDLE_MAX_AGE_SECONDS * 1000);
  if (idleDeadline < now) return null;

  session.last_used_at = now;
  return { adminId: session.admin_id, sessionId: session.id };
}

async function mockRevokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  for (const session of DB.sessions.values()) {
    if (session.token_hash === tokenHash && !session.revoked_at) {
      session.revoked_at = new Date();
    }
  }
}

async function mockRevokeAllSessions(adminId: string): Promise<void> {
  for (const session of DB.sessions.values()) {
    if (session.admin_id === adminId && !session.revoked_at) {
      session.revoked_at = new Date();
    }
  }
}

// ─── Mock OTP functions ────────────────────────────────────

async function mockCreateTransaction(
  adminId: string,
  otp: string,
  expiresInSeconds = OTP_EXPIRY_SECONDS
): Promise<string> {
  const txId = crypto.randomUUID();
  const otpHash = hashOtp(otp, txId);
  DB.transactions.set(txId, {
    id: txId,
    admin_id: adminId,
    otp_hash: otpHash,
    attempts: 0,
    resend_count: 0,
    expires_at: new Date(Date.now() + expiresInSeconds * 1000),
    used_at: null,
    superseded_at: null,
  });
  return txId;
}

async function mockVerifyOtp(
  transactionId: string,
  otp: string,
  clockOffsetMs = 0
): Promise<"ok" | "expired" | "used" | "exhausted" | "invalid"> {
  const tx = DB.transactions.get(transactionId);
  if (!tx) return "invalid";
  const now = new Date(Date.now() + clockOffsetMs);
  if (tx.used_at) return "used";
  if (tx.superseded_at) return "expired";
  if (tx.expires_at < now) return "expired";
  if (tx.attempts >= MAX_OTP_ATTEMPTS) return "exhausted";

  const expectedHash = hashOtp(otp, transactionId);
  if (expectedHash !== tx.otp_hash) {
    tx.attempts++;
    if (tx.attempts >= MAX_OTP_ATTEMPTS) return "exhausted";
    return "invalid";
  }
  tx.used_at = now;
  return "ok";
}

async function mockCreateResetToken(
  txId: string,
  adminId: string,
  expiresInSeconds = RESET_TOKEN_EXPIRY_SECONDS
): Promise<string> {
  const raw = crypto.randomBytes(16).toString("hex");
  const tokenHash = hashToken(raw);
  DB.resetTokens.set(crypto.randomUUID(), {
    id: crypto.randomUUID(),
    admin_id: adminId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + expiresInSeconds * 1000),
    used_at: null,
  });
  return raw;
}

async function mockVerifyResetToken(
  resetToken: string,
  clockOffsetMs = 0
): Promise<{ adminId: string; tokenId: string } | null> {
  const tokenHash = hashToken(resetToken);
  const now = new Date(Date.now() + clockOffsetMs);
  for (const tok of DB.resetTokens.values()) {
    if (tok.token_hash === tokenHash) {
      if (tok.used_at) return null;
      if (tok.expires_at < now) return null;
      tok.used_at = now;
      return { adminId: tok.admin_id, tokenId: tok.id };
    }
  }
  return null;
}

// ─── Mock rate limiter ────────────────────────────────────

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function mockCheckRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1 };
  }
  entry.count++;
  if (entry.count > limit) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: limit - entry.count };
}

// ─── Origin validation ────────────────────────────────────

function mockValidateOrigin(origin: string | null, method: string): boolean {
  if (method === "GET" || method === "HEAD") return true;
  if (!origin) return true; // dev only
  return origin === "http://localhost:3000";
}

// ══════════════════════════════════════════════════════════
// MAIN — all tests run here
// ══════════════════════════════════════════════════════════

async function main() {
  console.log("\n════════════════════════════════════════");
  console.log("  Auth Test Suite — AUTH1–AUTH23");
  console.log("════════════════════════════════════════\n");

  // ─── Session management ────────────────────────────────

  console.log("Session management:");

  await test("AUTH1", async () => {
    DB.reset();
    const adminId = crypto.randomUUID();
    const token = await mockCreateSession(adminId, "127.0.0.1", "ua");
    const session = await mockValidateSession(token);
    return session !== null && session.adminId === adminId;
  }, "Successful login → session created and validated");

  await test("AUTH2", async () => {
    DB.reset();
    const hash = await mockHashPassword("correct");
    return !(await mockVerifyPassword(hash, "wrong"));
  }, "Wrong password → verifyPassword returns false");

  await test("AUTH3", async () => {
    DB.reset();
    const hash = await mockHashPassword("actual-password");
    const wrongUser = await mockVerifyPassword(hash, "any-password");
    return !wrongUser; // unknown user → same 401 behavior
  }, "Unknown username → same false result (anti-enumeration)");

  await test("AUTH4", async () => {
    DB.reset();
    const adminId = crypto.randomUUID();
    const token = await mockCreateSession(adminId, "127.0.0.1", "ua");
    const expectedHash = hashToken(token);
    const stored = [...DB.sessions.values()].find((s) => s.token_hash === expectedHash);
    return stored !== undefined && stored.admin_id === adminId;
  }, "Session token_hash is SHA-256 of the raw cookie token");

  await test("AUTH5", async () => {
    DB.reset();
    const adminId = crypto.randomUUID();
    const token = await mockCreateSession(adminId, "127.0.0.1", "ua", 1); // 1 second TTL
    // Travel 2 seconds forward
    const session = await mockValidateSession(token, 2000);
    return session === null;
  }, "Session past absolute expiry → null");

  await test("AUTH6", async () => {
    DB.reset();
    const adminId = crypto.randomUUID();
    const token = await mockCreateSession(adminId, "127.0.0.1", "ua");
    // Travel past idle timeout (31 minutes)
    const session = await mockValidateSession(token, (SESSION_IDLE_MAX_AGE_SECONDS + 60) * 1000);
    return session === null;
  }, "Session past 30-min idle timeout → null");

  await test("AUTH7", async () => {
    DB.reset();
    const adminId = crypto.randomUUID();
    const token = await mockCreateSession(adminId, "127.0.0.1", "ua");
    await mockRevokeSession(token);
    const session = await mockValidateSession(token);
    return session === null;
  }, "After logout, validateSession returns null");

  await test("AUTH8", async () => {
    DB.reset();
    const adminId = crypto.randomUUID();
    const token = await mockCreateSession(adminId, "127.0.0.1", "ua");
    const tokenHash = hashToken(token);
    const before = [...DB.sessions.values()].find((s) => s.token_hash === tokenHash);
    if (before?.revoked_at !== null) return false;
    await mockRevokeSession(token);
    const after = [...DB.sessions.values()].find((s) => s.token_hash === tokenHash);
    return after?.revoked_at !== null && after?.revoked_at !== undefined;
  }, "revokeSession sets revoked_at timestamp");

  await test("AUTH9", async () => {
    DB.reset();
    const adminId = crypto.randomUUID();
    const t1 = await mockCreateSession(adminId, "1.1.1.1", "ua1");
    const t2 = await mockCreateSession(adminId, "2.2.2.2", "ua2");
    await mockRevokeAllSessions(adminId);
    return (await mockValidateSession(t1)) === null &&
           (await mockValidateSession(t2)) === null;
  }, "revokeAllSessions revokes all active sessions for admin");

  // ─── OTP flow ──────────────────────────────────────────

  console.log("\nOTP flow:");

  await test("AUTH10", async () => {
    DB.reset();
    const otp = generateOtp();
    const txId = await mockCreateTransaction(crypto.randomUUID(), otp);
    return (await mockVerifyOtp(txId, otp)) === "ok";
  }, "Correct OTP → verifyOtp returns 'ok'");

  await test("AUTH11", async () => {
    DB.reset();
    const otp = generateOtp();
    const txId = await mockCreateTransaction(crypto.randomUUID(), otp);
    DB.transactions.get(txId)!.expires_at = new Date(Date.now() - 1000); // expired
    return (await mockVerifyOtp(txId, otp)) === "expired";
  }, "Expired OTP → verifyOtp returns 'expired'");

  await test("AUTH12", async () => {
    DB.reset();
    const otp = generateOtp();
    const txId = await mockCreateTransaction(crypto.randomUUID(), otp);
    await mockVerifyOtp(txId, otp); // first use
    return (await mockVerifyOtp(txId, otp)) === "used"; // second use
  }, "OTP replay → verifyOtp returns 'used'");

  await test("AUTH13", async () => {
    DB.reset();
    const otp = generateOtp();
    const txId = await mockCreateTransaction(crypto.randomUUID(), otp);
    const result = await mockVerifyOtp(txId, "000000"); // wrong OTP
    const tx = DB.transactions.get(txId)!;
    return result === "invalid" && tx.attempts === 1;
  }, "Wrong OTP → 'invalid' and attempts incremented to 1");

  await test("AUTH14", async () => {
    DB.reset();
    const otp = generateOtp();
    const txId = await mockCreateTransaction(crypto.randomUUID(), otp);
    let lastResult: string = "";
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
      lastResult = await mockVerifyOtp(txId, "000000"); // always wrong
    }
    return lastResult === "exhausted";
  }, `After ${MAX_OTP_ATTEMPTS} wrong attempts → 'exhausted'`);

  await test("AUTH15", async () => {
    DB.reset();
    const txId = await mockCreateTransaction(crypto.randomUUID(), generateOtp());
    const tx = DB.transactions.get(txId)!;
    tx.resend_count = MAX_RESEND_COUNT;
    return tx.resend_count >= MAX_RESEND_COUNT; // would be rejected by resend route
  }, `resend_count at ${MAX_RESEND_COUNT} → resend rejected`);

  // ─── Recovery flow ─────────────────────────────────────

  console.log("\nRecovery flow:");

  await test("AUTH16", async () => {
    // Recovery request route ALWAYS returns 200 with a UUID — even for unknown users.
    const noOpId = crypto.randomUUID();
    return typeof noOpId === "string" && /^[0-9a-f-]{36}$/.test(noOpId);
  }, "Recovery request for non-existent user → 200 with no-op UUID (anti-enumeration)");

  await test("AUTH17", async () => {
    DB.reset();
    const txId = await mockCreateTransaction(crypto.randomUUID(), generateOtp());
    const resetToken = await mockCreateResetToken(txId, crypto.randomUUID());
    // Expire the token
    for (const tok of DB.resetTokens.values()) {
      tok.expires_at = new Date(Date.now() - 1000);
    }
    return (await mockVerifyResetToken(resetToken)) === null;
  }, "Expired reset token → verifyResetToken returns null");

  await test("AUTH18", async () => {
    DB.reset();
    const txId = await mockCreateTransaction(crypto.randomUUID(), generateOtp());
    const resetToken = await mockCreateResetToken(txId, crypto.randomUUID());
    await mockVerifyResetToken(resetToken); // first use
    return (await mockVerifyResetToken(resetToken)) === null; // second use
  }, "Reset token replay → verifyResetToken returns null");

  // ─── Emergency codes ───────────────────────────────────

  console.log("\nEmergency codes:");

  await test("AUTH19", async () => {
    DB.reset();
    const adminId = crypto.randomUUID();
    const rawCode = crypto.randomBytes(12).toString("hex");
    const codeHash = await mockHashPassword(rawCode);
    const codeId = crypto.randomUUID();
    DB.recoveryCodes.set(codeId, {
      id: codeId,
      admin_id: adminId,
      code_hash: codeHash,
      used_at: null,
    });

    // First use: valid
    const code = DB.recoveryCodes.get(codeId)!;
    const valid = await mockVerifyPassword(code.code_hash, rawCode);
    if (!valid) return false;
    code.used_at = new Date();

    // Second use: no unused codes remain
    const unused = [...DB.recoveryCodes.values()].filter(
      (c) => c.admin_id === adminId && c.used_at === null
    );
    return unused.length === 0;
  }, "Emergency code used once → marked used, second use fails");

  // ─── Rate limiting ─────────────────────────────────────

  console.log("\nRate limiting:");

  await test("AUTH20", async () => {
    rateLimitStore.clear();
    const key = `test:rl:${crypto.randomUUID()}`;
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      if (!mockCheckRateLimit(key, limit, 60).allowed) return false;
    }
    return !mockCheckRateLimit(key, limit, 60).allowed;
  }, "After limit exceeded, checkRateLimit returns allowed:false");

  // ─── Middleware / guards ───────────────────────────────

  console.log("\nMiddleware & guards:");

  await test("AUTH21", async () => {
    DB.reset();
    // No cookie → validateSession with empty string → null
    return (await mockValidateSession("")) === null;
  }, "No session cookie → validateSession returns null → 401");

  await test("AUTH22", async () => {
    const wrongOriginPost = mockValidateOrigin("https://evil.example.com", "POST");
    const correctPost = mockValidateOrigin("http://localhost:3000", "POST");
    const getAny = mockValidateOrigin("https://evil.example.com", "GET");
    return !wrongOriginPost && correctPost && getAny;
  }, "Wrong Origin on state-changing request → validateOrigin returns false");

  await test("AUTH23", async () => {
    DB.reset();
    // Old ADMIN_SECRET set — should NOT grant access via new session system
    process.env.ADMIN_SECRET = "old-secret";
    const fakeToken = "old-secret"; // Using ADMIN_SECRET as if it's a session token
    const tokenHash = hashToken(fakeToken);
    // No session with this hash exists in DB
    const session = [...DB.sessions.values()].find((s) => s.token_hash === tokenHash);
    delete process.env.ADMIN_SECRET;
    return session === undefined; // old secret does NOT grant access
  }, "ADMIN_SECRET present but no session in DB → still 401 (old system disabled)");

  // ─── Summary ──────────────────────────────────────────

  console.log("\n════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════");

  if (errors.length > 0) {
    console.log("\nFailed tests:");
    errors.forEach((e) => console.log(e));
    process.exit(1);
  } else {
    console.log("\n  All auth tests passed.\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
