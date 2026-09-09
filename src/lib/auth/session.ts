// ═══════════════════════════════════════════════════════════
// Session management — random token in HTTP-only cookie,
// SHA-256 hash stored in Postgres
// ═══════════════════════════════════════════════════════════
//
// Lifetimes:
//   Absolute max: 8 hours from creation
//   Idle timeout: 30 minutes from last use
//
// Token: 32 random bytes as hex string
// Stored: SHA-256(token) in admin_sessions.token_hash
// ═══════════════════════════════════════════════════════════

import crypto from "crypto";
import { sql } from "@/lib/db";

export const SESSION_ABSOLUTE_MAX_AGE_SECONDS = 28800; // 8h
export const SESSION_IDLE_MAX_AGE_SECONDS = 1800; // 30m

/** Generate a cryptographically random 32-byte session token (hex). */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** SHA-256 hash of a token as hex. Used to store/look up sessions. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Create a new session in the DB. Returns the raw (unhashed) token. */
export async function createSession(
  adminId: string,
  ip: string,
  ua: string
): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000
  );

  await sql`
    INSERT INTO admin_sessions (admin_id, token_hash, ip, user_agent, expires_at)
    VALUES (${adminId}, ${tokenHash}, ${ip}, ${ua}, ${expiresAt.toISOString()})
  `;

  return token;
}

/**
 * Validate a session token.
 * Checks: token_hash match, not revoked, absolute expiry, 30-min idle.
 * Updates last_used_at on success.
 */
export async function validateSession(
  token: string
): Promise<{ adminId: string; sessionId: string } | null> {
  const tokenHash = hashToken(token);
  const now = new Date();

  const rows = await sql`
    SELECT id, admin_id, expires_at, last_used_at, revoked_at
    FROM admin_sessions
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;

  if (!rows.length) return null;

  const session = rows[0];

  // Revoked?
  if (session.revoked_at) return null;

  // Absolute expiry
  if (new Date(session.expires_at) < now) return null;

  // Idle expiry
  const idleDeadline = new Date(
    new Date(session.last_used_at).getTime() + SESSION_IDLE_MAX_AGE_SECONDS * 1000
  );
  if (idleDeadline < now) return null;

  // Touch last_used_at
  await sql`
    UPDATE admin_sessions
    SET last_used_at = ${now.toISOString()}
    WHERE id = ${session.id}
  `;

  return { adminId: session.admin_id, sessionId: session.id };
}

/** Revoke a single session by raw token. */
export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await sql`
    UPDATE admin_sessions
    SET revoked_at = now()
    WHERE token_hash = ${tokenHash}
      AND revoked_at IS NULL
  `;
}

/** Revoke all active sessions for an admin (e.g. after password reset). */
export async function revokeAllSessions(adminId: string): Promise<void> {
  await sql`
    UPDATE admin_sessions
    SET revoked_at = now()
    WHERE admin_id = ${adminId}
      AND revoked_at IS NULL
  `;
}
