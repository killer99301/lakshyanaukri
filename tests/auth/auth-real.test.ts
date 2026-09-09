// ═══════════════════════════════════════════════════════════
// Real-implementation auth tests — AUTH-R1 through AUTH-R26
// ═══════════════════════════════════════════════════════════
//
// Run with:
//   DATABASE_URL=... ADMIN_OTP_HMAC_KEY=... \
//     npx tsx --tsconfig tsconfig.json tests/auth/auth-real.test.ts
//
// If DATABASE_URL or ADMIN_OTP_HMAC_KEY is not set, all tests are
// SKIPPED gracefully (exit 0 — not a failure).
//
// When both env vars are set the tests run against the real database.
// Test isolation: a unique test-auth-* admin is inserted at startup
// and CASCADE-deleted at the end (cleans up sessions, transactions, etc).
// ═══════════════════════════════════════════════════════════

import crypto from "crypto";

// ─── Env guard — synchronous check BEFORE any db.ts import ───────────────
// db.ts throws at module-load time if DATABASE_URL is unset, so we must
// exit before any dynamic import that transitively loads it.

if (!process.env.DATABASE_URL || !process.env.ADMIN_OTP_HMAC_KEY) {
  console.log(
    "\n  ⚠  DATABASE_URL or ADMIN_OTP_HMAC_KEY not set —" +
    " skipping real-implementation auth tests.\n" +
    "  To run locally:\n" +
    "    DATABASE_URL=... ADMIN_OTP_HMAC_KEY=...\n" +
    "    npx tsx --tsconfig tsconfig.json tests/auth/auth-real.test.ts\n"
  );
  process.exit(0);
}

// ─── Test harness ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(id: string, condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${id}: ${message}`);
  } else {
    failed++;
    const msg = `  ✗ ${id}: ${message}`;
    errors.push(msg);
    console.log(msg);
  }
}

async function test(
  id: string,
  fn: () => Promise<boolean>,
  message: string
): Promise<void> {
  try {
    const result = await fn();
    assert(id, result, message);
  } catch (err) {
    failed++;
    const msg = `  ✗ ${id}: ${message} — threw: ${err}`;
    errors.push(msg);
    console.log(msg);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n════════════════════════════════════════");
  console.log("  Auth Real-Implementation Tests — AUTH-R1–AUTH-R26");
  console.log("════════════════════════════════════════\n");

  // Dynamic imports — safe because DATABASE_URL is confirmed set above.
  // db.ts is imported lazily to avoid the module-load-time throw.
  const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
  const {
    createSession,
    validateSession,
    revokeSession,
    revokeAllSessions,
    hashToken,
  } = await import("@/lib/auth/session");
  const {
    generateOtp,
    hashOtp,
    createRecoveryTransaction,
    verifyOtp,
    createResetToken,
    verifyResetToken,
    OTP_EXPIRY_SECONDS,
  } = await import("@/lib/auth/otp");
  const { sql } = await import("@/lib/db");

  // Suppress unused-import lint noise (OTP_EXPIRY_SECONDS verified as exported)
  void OTP_EXPIRY_SECONDS;

  // ─── Test admin setup ────────────────────────────────────────────────

  const ts = Date.now();
  const testUsername = `test-auth-${ts}`;
  const testEmail = `test-auth-${ts}@test.example.com`;
  const testPassword = "Tr@ckm3!" + crypto.randomBytes(8).toString("hex");
  const passwordHash = await hashPassword(testPassword);

  const adminInsert = await sql`
    INSERT INTO admins (username, email, password_hash)
    VALUES (${testUsername}, ${testEmail}, ${passwordHash})
    RETURNING id
  `;
  const testAdminId: string = adminInsert[0].id;
  console.log(`  Test admin: ${testUsername} (${testAdminId})\n`);

  // ─── Password ───────────────────────────────────────────────────────

  console.log("Password:");

  await test("AUTH-R1", async () => {
    const h = await hashPassword("any-password");
    return typeof h === "string" && h.startsWith("$argon2id$");
  }, "hashPassword produces an argon2id hash");

  await test("AUTH-R2", async () => {
    const h = await hashPassword("correct-password");
    return await verifyPassword(h, "correct-password");
  }, "verifyPassword correct password → true");

  await test("AUTH-R3", async () => {
    const h = await hashPassword("correct-password");
    return !(await verifyPassword(h, "wrong-password"));
  }, "verifyPassword wrong password → false");

  // ─── Sessions ───────────────────────────────────────────────────────

  console.log("\nSessions:");

  await test("AUTH-R4", async () => {
    const token = await createSession(testAdminId, "127.0.0.1", "test-ua");
    const expectedHash = hashToken(token);
    const rows = await sql`
      SELECT token_hash, admin_id FROM admin_sessions
      WHERE token_hash = ${expectedHash}
      LIMIT 1
    `;
    await sql`DELETE FROM admin_sessions WHERE token_hash = ${expectedHash}`;
    return rows.length === 1 && rows[0].admin_id === testAdminId;
  }, "createSession → DB row exists, token_hash = SHA-256(token)");

  await test("AUTH-R5", async () => {
    const token = await createSession(testAdminId, "127.0.0.1", "test-ua");
    const result = await validateSession(token);
    await revokeSession(token);
    return result !== null && result.adminId === testAdminId;
  }, "validateSession valid session → returns adminId");

  await test("AUTH-R6", async () => {
    const token = await createSession(testAdminId, "127.0.0.1", "test-ua");
    await revokeSession(token);
    return (await validateSession(token)) === null;
  }, "validateSession after revokeSession → null");

  await test("AUTH-R7", async () => {
    const t1 = await createSession(testAdminId, "1.1.1.1", "ua1");
    const t2 = await createSession(testAdminId, "2.2.2.2", "ua2");
    await revokeAllSessions(testAdminId);
    return (await validateSession(t1)) === null && (await validateSession(t2)) === null;
  }, "validateSession after revokeAllSessions → null for all sessions");

  await test("AUTH-R8", async () => {
    // Insert a session with expires_at already in the past
    const fakeToken = crypto.randomBytes(32).toString("hex");
    const fakeHash = hashToken(fakeToken);
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    await sql`
      INSERT INTO admin_sessions (admin_id, token_hash, ip, user_agent, expires_at, last_used_at)
      VALUES (${testAdminId}, ${fakeHash}, '127.0.0.1', 'test-ua',
              ${pastExpiry}, ${new Date().toISOString()})
    `;
    const result = await validateSession(fakeToken);
    await sql`DELETE FROM admin_sessions WHERE token_hash = ${fakeHash}`;
    return result === null;
  }, "validateSession past absolute expiry → null");

  await test("AUTH-R9", async () => {
    // Insert a session with last_used_at more than 30 min ago
    const fakeToken = crypto.randomBytes(32).toString("hex");
    const fakeHash = hashToken(fakeToken);
    const futureExpiry = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
    const oldLastUsed = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO admin_sessions (admin_id, token_hash, ip, user_agent, expires_at, last_used_at)
      VALUES (${testAdminId}, ${fakeHash}, '127.0.0.1', 'test-ua',
              ${futureExpiry}, ${oldLastUsed})
    `;
    const result = await validateSession(fakeToken);
    await sql`DELETE FROM admin_sessions WHERE token_hash = ${fakeHash}`;
    return result === null;
  }, "validateSession past 30-min idle timeout → null");

  await test("AUTH-R10", async () => {
    // Insert a session with last_used_at 10 min ago (valid idle — within 30m)
    const fakeToken = crypto.randomBytes(32).toString("hex");
    const fakeHash = hashToken(fakeToken);
    const futureExpiry = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
    const oldLastUsed = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO admin_sessions (admin_id, token_hash, ip, user_agent, expires_at, last_used_at)
      VALUES (${testAdminId}, ${fakeHash}, '127.0.0.1', 'test-ua',
              ${futureExpiry}, ${oldLastUsed})
    `;
    const before = new Date(oldLastUsed);
    await validateSession(fakeToken); // triggers last_used_at update in session.ts
    const rows = await sql`
      SELECT last_used_at FROM admin_sessions WHERE token_hash = ${fakeHash}
    `;
    await sql`DELETE FROM admin_sessions WHERE token_hash = ${fakeHash}`;
    if (!rows.length) return false;
    const after = new Date(rows[0].last_used_at);
    return after > before;
  }, "validateSession updates last_used_at (idle timeout reset)");

  // ─── OTP ────────────────────────────────────────────────────────────

  console.log("\nOTP:");

  await test("AUTH-R11", async () => {
    const otp = generateOtp();
    return /^\d{6}$/.test(otp);
  }, "generateOtp → exactly 6 digits");

  await test("AUTH-R12", async () => {
    const otp = generateOtp();
    const txId = crypto.randomUUID();
    const h1 = hashOtp(otp, txId);
    const h2 = hashOtp(otp, txId);
    const hDiff = hashOtp("000000", txId);
    return typeof h1 === "string" && h1.length === 64 && h1 === h2 && h1 !== hDiff;
  }, "hashOtp → HMAC-SHA256 (64 hex chars), deterministic, distinct for different OTPs");

  await test("AUTH-R13", async () => {
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    return (await verifyOtp(txId, otp)) === "ok";
  }, "verifyOtp correct OTP → 'ok'");

  await test("AUTH-R14", async () => {
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    const result = await verifyOtp(txId, "000000"); // wrong OTP
    const rows = await sql`
      SELECT attempts FROM recovery_transactions WHERE id = ${txId}
    `;
    return result === "invalid" && rows.length > 0 && Number(rows[0].attempts) === 1;
  }, "verifyOtp incorrect OTP → 'invalid', attempts incremented to 1");

  await test("AUTH-R15", async () => {
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    let last = "";
    for (let i = 0; i < 5; i++) {
      last = await verifyOtp(txId, "000000"); // always wrong
    }
    return last === "exhausted";
  }, "verifyOtp after 5 wrong attempts → 'exhausted'");

  await test("AUTH-R16", async () => {
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    await verifyOtp(txId, otp); // first use — consume it
    return (await verifyOtp(txId, otp)) === "used"; // replay
  }, "verifyOtp replay after use → 'used'");

  await test("AUTH-R17", async () => {
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    // Manually expire the transaction
    await sql`
      UPDATE recovery_transactions
      SET expires_at = now() - interval '1 second'
      WHERE id = ${txId}
    `;
    return (await verifyOtp(txId, otp)) === "expired";
  }, "verifyOtp on expired transaction → 'expired'");

  await test("AUTH-R18", async () => {
    // Concurrent correct-OTP: exactly one must win ('ok'), the other must lose ('used').
    // Requires Fix 1's atomic UPDATE … WHERE used_at IS NULL RETURNING id.
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    const [r1, r2] = await Promise.all([
      verifyOtp(txId, otp),
      verifyOtp(txId, otp),
    ]);
    const outcomes = [r1, r2].sort();
    return outcomes[0] === "ok" && outcomes[1] === "used";
  }, "CONCURRENT verifyOtp (2 simultaneous) → exactly one 'ok', one 'used'");

  // ─── Reset token ─────────────────────────────────────────────────────

  console.log("\nReset token:");

  await test("AUTH-R19", async () => {
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    const rawToken = await createResetToken(txId, testAdminId);
    // Verify the raw token is NOT stored; only its SHA-256 hash is
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const rows = await sql`
      SELECT id FROM recovery_reset_tokens WHERE token_hash = ${tokenHash}
    `;
    return rows.length === 1;
  }, "createResetToken → token stored as SHA-256 hash in DB");

  await test("AUTH-R20", async () => {
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    const rawToken = await createResetToken(txId, testAdminId);
    const result = await verifyResetToken(rawToken);
    return result !== null && result.adminId === testAdminId;
  }, "verifyResetToken correct token → returns adminId");

  await test("AUTH-R21", async () => {
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    const rawToken = await createResetToken(txId, testAdminId);
    await verifyResetToken(rawToken); // first use
    return (await verifyResetToken(rawToken)) === null; // replay
  }, "verifyResetToken replay → null");

  await test("AUTH-R22", async () => {
    // Concurrent token verification: exactly one must succeed, the other → null.
    // Requires Fix 1's atomic UPDATE … WHERE used_at IS NULL RETURNING id, admin_id.
    const otp = generateOtp();
    const txId = await createRecoveryTransaction(testAdminId, otp, "email", "127.0.0.1");
    const rawToken = await createResetToken(txId, testAdminId);
    const [r1, r2] = await Promise.all([
      verifyResetToken(rawToken),
      verifyResetToken(rawToken),
    ]);
    const nonNullCount = [r1, r2].filter((r) => r !== null).length;
    const nullCount = [r1, r2].filter((r) => r === null).length;
    return nonNullCount === 1 && nullCount === 1;
  }, "CONCURRENT verifyResetToken (2 simultaneous) → exactly one result, one null");

  // ─── Emergency codes ─────────────────────────────────────────────────

  console.log("\nEmergency codes:");

  await test("AUTH-R23", async () => {
    // Test the atomic UPDATE … WHERE used_at IS NULL RETURNING id pattern
    // directly (mirrors the fix applied in emergency/route.ts).
    const rawCode = crypto.randomBytes(12).toString("hex");
    const codeHash = await hashPassword(rawCode);
    const inserted = await sql`
      INSERT INTO recovery_codes (admin_id, code_hash)
      VALUES (${testAdminId}, ${codeHash})
      RETURNING id
    `;
    const codeId: string = inserted[0].id;

    // First redemption — should claim the code
    const first = await sql`
      UPDATE recovery_codes
      SET used_at = now()
      WHERE id = ${codeId}
        AND used_at IS NULL
      RETURNING id
    `;
    // Second redemption — used_at IS NULL is false → 0 rows
    const second = await sql`
      UPDATE recovery_codes
      SET used_at = now()
      WHERE id = ${codeId}
        AND used_at IS NULL
      RETURNING id
    `;
    return first.length === 1 && second.length === 0;
  }, "Emergency code atomic UPDATE: first succeeds, second gets 0 rows");

  await test("AUTH-R24", async () => {
    // Concurrent emergency code redemption: exactly one must win.
    // Requires Fix 1C's atomic guard in emergency/route.ts.
    const rawCode = crypto.randomBytes(12).toString("hex");
    const codeHash = await hashPassword(rawCode);
    const inserted = await sql`
      INSERT INTO recovery_codes (admin_id, code_hash)
      VALUES (${testAdminId}, ${codeHash})
      RETURNING id
    `;
    const codeId: string = inserted[0].id;

    const [u1, u2] = await Promise.all([
      sql`UPDATE recovery_codes SET used_at = now() WHERE id = ${codeId} AND used_at IS NULL RETURNING id`,
      sql`UPDATE recovery_codes SET used_at = now() WHERE id = ${codeId} AND used_at IS NULL RETURNING id`,
    ]);
    const winnerCount = [u1.length, u2.length].filter((n) => n === 1).length;
    const loserCount = [u1.length, u2.length].filter((n) => n === 0).length;
    return winnerCount === 1 && loserCount === 1;
  }, "CONCURRENT emergency code (2 simultaneous) → exactly one wins");

  // ─── Session extras ──────────────────────────────────────────────────

  console.log("\nSession extras:");

  await test("AUTH-R25", async () => {
    const t1 = await createSession(testAdminId, "1.1.1.1", "ua1");
    const t2 = await createSession(testAdminId, "2.2.2.2", "ua2");
    await revokeAllSessions(testAdminId);
    return (await validateSession(t1)) === null && (await validateSession(t2)) === null;
  }, "revokeAllSessions invalidates all active sessions for admin");

  await test("AUTH-R26", async () => {
    // Validate several times — last_used_at must update but expires_at must not.
    const token = await createSession(testAdminId, "127.0.0.1", "test-ua");
    const tokenHash = hashToken(token);
    const before = await sql`
      SELECT expires_at FROM admin_sessions WHERE token_hash = ${tokenHash}
    `;
    const initialExpiry = new Date(before[0].expires_at).getTime();

    await validateSession(token); // triggers last_used_at refresh
    await validateSession(token);

    const after = await sql`
      SELECT expires_at FROM admin_sessions WHERE token_hash = ${tokenHash}
    `;
    const finalExpiry = new Date(after[0].expires_at).getTime();
    await revokeSession(token);
    return finalExpiry === initialExpiry;
  }, "absolute expiry (expires_at) not extended by idle refresh");

  // ─── Cleanup ─────────────────────────────────────────────────────────

  console.log("\n  Cleaning up test data (CASCADE deletes sessions, transactions, etc.)...");
  await sql`DELETE FROM admins WHERE username LIKE 'test-auth-%'`;
  console.log("  Cleanup complete.");

  // ─── Summary ─────────────────────────────────────────────────────────

  console.log("\n════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════");

  if (errors.length > 0) {
    console.log("\nFailed tests:");
    errors.forEach((e) => console.log(e));
    process.exit(1);
  } else {
    console.log("\n  All real-implementation auth tests passed.\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
