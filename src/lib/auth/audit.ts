// ═══════════════════════════════════════════════════════════
// Audit log — all auth events stored in admin_audit_log
// ═══════════════════════════════════════════════════════════
//
// NEVER stores: full email addresses, passwords, OTP values,
// or any credential. Use masked identifiers (first 3 chars + ***).
//
// Never throws — errors are logged to console only.
// ═══════════════════════════════════════════════════════════

import { sql } from "@/lib/db";

interface AuditOptions {
  adminId?: string;
  ip?: string;
  ua?: string;
  meta?: Record<string, unknown>;
}

/**
 * Record an auth audit event.
 * Silently swallows errors so a DB hiccup never breaks the auth flow.
 */
export async function audit(
  event: string,
  opts: AuditOptions = {}
): Promise<void> {
  try {
    await sql`
      INSERT INTO admin_audit_log
        (admin_id, event_type, ip, user_agent, metadata)
      VALUES
        (${opts.adminId ?? null},
         ${event},
         ${opts.ip ?? null},
         ${opts.ua ?? null},
         ${opts.meta ? JSON.stringify(opts.meta) : null})
    `;
  } catch (err) {
    console.error("[audit] Failed to write audit event:", event, err);
  }
}

/** Mask an identifier for safe storage in audit metadata. */
export function maskId(value: string): string {
  if (!value || value.length <= 3) return "***";
  return value.slice(0, 3) + "***";
}
