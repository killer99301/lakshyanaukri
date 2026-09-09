// ═══════════════════════════════════════════════════════════
// OTP & Recovery — HMAC-SHA256 signed 6-digit codes
// ═══════════════════════════════════════════════════════════
//
// OTP: 6-digit numeric, HMAC-SHA256(ADMIN_OTP_HMAC_KEY, otp:txnId)
// TTL: 10 minutes
// Attempt limit: 5
// Resend limit: 3
//
// After OTP verified: createResetToken() issues a 15-min reset token.
// ═══════════════════════════════════════════════════════════

import crypto from "crypto";
import { sql } from "@/lib/db";

export const OTP_EXPIRY_SECONDS = 600; // 10m
export const RESET_TOKEN_EXPIRY_SECONDS = 900; // 15m
export const MAX_OTP_ATTEMPTS = 5;
export const MAX_RESEND_COUNT = 3;

function getHmacKey(): string {
  const key = process.env.ADMIN_OTP_HMAC_KEY;
  if (!key) {
    throw new Error(
      "ADMIN_OTP_HMAC_KEY is not set. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return key;
}

/** Generate a 6-digit OTP padded to 6 characters. */
export function generateOtp(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

/** HMAC-SHA256(ADMIN_OTP_HMAC_KEY, `${otp}:${transactionId}`) as hex. */
export function hashOtp(otp: string, transactionId: string): string {
  return crypto
    .createHmac("sha256", getHmacKey())
    .update(`${otp}:${transactionId}`)
    .digest("hex");
}

/** Create a recovery transaction. Returns the transaction ID. */
export async function createRecoveryTransaction(
  adminId: string,
  otp: string,
  channel: "email" | "sms",
  ip: string
): Promise<string> {
  const txId = crypto.randomUUID();
  const otpHash = hashOtp(otp, txId);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

  await sql`
    INSERT INTO recovery_transactions
      (id, admin_id, otp_hash, channel, ip, expires_at)
    VALUES
      (${txId}, ${adminId}, ${otpHash}, ${channel}, ${ip}, ${expiresAt.toISOString()})
  `;

  return txId;
}

/**
 * Verify an OTP for a transaction.
 * Returns: 'ok' | 'expired' | 'used' | 'exhausted' | 'invalid'
 *
 * Uses atomic UPDATE … RETURNING to prevent TOCTOU race conditions.
 * Two concurrent correct-OTP requests will each try to win the
 * "mark as used" UPDATE; only the one that finds used_at IS NULL will
 * get a row back — the other gets 0 rows and returns "used".
 */
export async function verifyOtp(
  transactionId: string,
  otp: string
): Promise<"ok" | "expired" | "used" | "exhausted" | "invalid"> {
  // Step 1: SELECT the transaction — we need otp_hash to verify the HMAC.
  const rows = await sql`
    SELECT id, admin_id, otp_hash, attempts, expires_at, used_at, superseded_at
    FROM recovery_transactions
    WHERE id = ${transactionId}
    LIMIT 1
  `;

  if (!rows.length) return "invalid";

  const tx = rows[0];

  // Step 2: Pre-check state (fast path — avoids unnecessary DB writes).
  if (tx.used_at) return "used";
  if (tx.superseded_at) return "expired";
  if (new Date(tx.expires_at) < new Date()) return "expired";
  if (tx.attempts >= MAX_OTP_ATTEMPTS) return "exhausted";

  // Step 3: Compute expected hash and compare.
  const expectedHash = hashOtp(otp, transactionId);
  const valid = expectedHash === tx.otp_hash;

  if (!valid) {
    // Step 4: Atomic attempt increment — guard prevents double-consuming.
    // Returns 0 rows if a concurrent request already consumed the transaction.
    const incRows = await sql`
      UPDATE recovery_transactions
      SET attempts = attempts + 1
      WHERE id = ${transactionId}
        AND used_at IS NULL
        AND superseded_at IS NULL
        AND expires_at > now()
      RETURNING attempts
    `;
    if (!incRows.length) {
      // A concurrent request consumed the transaction first.
      return "used";
    }
    if (incRows[0].attempts >= MAX_OTP_ATTEMPTS) return "exhausted";
    return "invalid";
  }

  // Step 5: Atomic mark-as-used — only one concurrent winner possible.
  // If used_at IS NULL is false (another request won the race), 0 rows returned.
  const usedRows = await sql`
    UPDATE recovery_transactions
    SET used_at = now()
    WHERE id = ${transactionId}
      AND used_at IS NULL
      AND superseded_at IS NULL
      AND expires_at > now()
    RETURNING id
  `;

  if (!usedRows.length) {
    // Another concurrent request beat us to it.
    return "used";
  }

  return "ok";
}

/** Mark all open transactions for an admin as superseded (before creating new one). */
export async function supersedePreviousTransactions(adminId: string): Promise<void> {
  await sql`
    UPDATE recovery_transactions
    SET superseded_at = now()
    WHERE admin_id = ${adminId}
      AND used_at IS NULL
      AND superseded_at IS NULL
  `;
}

/** Create a short-lived password reset token after OTP verification. */
export async function createResetToken(
  transactionId: string,
  adminId: string
): Promise<string> {
  const rawToken = crypto.randomBytes(16).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_SECONDS * 1000);

  await sql`
    INSERT INTO recovery_reset_tokens
      (transaction_id, admin_id, token_hash, expires_at)
    VALUES
      (${transactionId}, ${adminId}, ${tokenHash}, ${expiresAt.toISOString()})
  `;

  return rawToken;
}

/**
 * Validate a reset token. Returns adminId + tokenId or null. Marks used_at.
 *
 * Uses a single atomic UPDATE … RETURNING to eliminate the SELECT-then-UPDATE
 * race: two concurrent calls with the same token will each attempt the UPDATE,
 * but only the first finds used_at IS NULL — the second gets 0 rows → null.
 */
export async function verifyResetToken(
  resetToken: string
): Promise<{ adminId: string; tokenId: string } | null> {
  const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

  // Atomic: mark as used only when not already used and not expired.
  // 0 rows → already used, expired, or never existed.
  const rows = await sql`
    UPDATE recovery_reset_tokens
    SET used_at = now()
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING id, admin_id
  `;

  if (!rows.length) return null;

  return { adminId: rows[0].admin_id, tokenId: rows[0].id };
}
