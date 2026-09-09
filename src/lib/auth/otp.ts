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
 */
export async function verifyOtp(
  transactionId: string,
  otp: string
): Promise<"ok" | "expired" | "used" | "exhausted" | "invalid"> {
  const rows = await sql`
    SELECT id, admin_id, otp_hash, attempts, expires_at, used_at, superseded_at
    FROM recovery_transactions
    WHERE id = ${transactionId}
    LIMIT 1
  `;

  if (!rows.length) return "invalid";

  const tx = rows[0];

  // Already used
  if (tx.used_at) return "used";

  // Superseded
  if (tx.superseded_at) return "expired";

  // Expired
  if (new Date(tx.expires_at) < new Date()) return "expired";

  // Exhausted
  if (tx.attempts >= MAX_OTP_ATTEMPTS) return "exhausted";

  // Validate hash
  const expectedHash = hashOtp(otp, transactionId);
  const valid = expectedHash === tx.otp_hash;

  if (!valid) {
    // Increment attempts
    await sql`
      UPDATE recovery_transactions
      SET attempts = attempts + 1
      WHERE id = ${transactionId}
    `;
    // Check if now exhausted
    if (tx.attempts + 1 >= MAX_OTP_ATTEMPTS) return "exhausted";
    return "invalid";
  }

  // Mark used
  await sql`
    UPDATE recovery_transactions
    SET used_at = now()
    WHERE id = ${transactionId}
  `;

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

/** Validate a reset token. Returns adminId + tokenId or null. Marks used_at. */
export async function verifyResetToken(
  resetToken: string
): Promise<{ adminId: string; tokenId: string } | null> {
  const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

  const rows = await sql`
    SELECT id, admin_id, expires_at, used_at
    FROM recovery_reset_tokens
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;

  if (!rows.length) return null;

  const tok = rows[0];

  if (tok.used_at) return null;
  if (new Date(tok.expires_at) < new Date()) return null;

  await sql`
    UPDATE recovery_reset_tokens
    SET used_at = now()
    WHERE id = ${tok.id}
  `;

  return { adminId: tok.admin_id, tokenId: tok.id };
}
