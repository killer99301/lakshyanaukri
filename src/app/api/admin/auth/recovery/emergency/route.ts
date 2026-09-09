export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// POST /api/admin/auth/recovery/emergency
// ═══════════════════════════════════════════════════════════
//
// Body: { identifier: string, code: string }
// Uses single-use emergency recovery codes (set up via admin-setup.ts).
// Strict rate limit: 3 per hour per IP.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { createResetToken } from "@/lib/auth/otp";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { audit, maskId } from "@/lib/auth/audit";
import { randomUUID } from "crypto";

const EMERGENCY_LIMIT = { limit: 3, window: 3600 }; // 3 per hour

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const rl = await checkRateLimit(
    `emergency:ip:${ip}`,
    EMERGENCY_LIMIT.limit,
    EMERGENCY_LIMIT.window
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter ?? EMERGENCY_LIMIT.window) },
      }
    );
  }

  let body: { identifier?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { identifier, code } = body;
  if (!identifier || !code) {
    return NextResponse.json({ error: "Missing identifier or code" }, { status: 400 });
  }

  // Look up admin
  const adminRows = await sql`
    SELECT id FROM admins
    WHERE email = ${identifier} OR username = ${identifier}
    LIMIT 1
  `;

  if (!adminRows.length) {
    // Anti-enumeration
    await audit("emergency_code.failed", { ip, meta: { identifier: maskId(identifier) } });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const adminId = adminRows[0].id;

  // Load all unused recovery codes
  const codeRows = await sql`
    SELECT id, code_hash FROM recovery_codes
    WHERE admin_id = ${adminId} AND used_at IS NULL
  `;

  // Try each code
  let matchedCodeId: string | null = null;
  for (const row of codeRows) {
    const valid = await verifyPassword(row.code_hash, code);
    if (valid) {
      matchedCodeId = row.id;
      break;
    }
  }

  if (!matchedCodeId) {
    await audit("emergency_code.failed", { adminId, ip });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Mark code as used
  await sql`
    UPDATE recovery_codes SET used_at = now() WHERE id = ${matchedCodeId}
  `;

  await revokeAllSessions(adminId);

  // Create a synthetic transaction record for the reset token
  const txId = randomUUID();
  await sql`
    INSERT INTO recovery_transactions
      (id, admin_id, otp_hash, channel, ip, expires_at, used_at)
    VALUES
      (${txId}, ${adminId}, 'emergency', 'email', ${ip},
       now() + interval '15 minutes', now())
  `;

  const resetToken = await createResetToken(txId, adminId);

  await audit("emergency_code.used", { adminId, ip });

  return NextResponse.json({ ok: true, resetToken });
}
