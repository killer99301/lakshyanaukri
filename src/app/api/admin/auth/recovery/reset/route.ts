export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// POST /api/admin/auth/recovery/reset
// ═══════════════════════════════════════════════════════════
//
// Body: { resetToken: string, password: string }
// Completes password reset, revokes all sessions.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { verifyResetToken } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { audit } from "@/lib/auth/audit";
import { sendSecurityNotification } from "@/lib/auth/email";
import { validateOrigin } from "@/lib/auth/guard";

const MIN_PASSWORD_LENGTH = 12;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "";

  let body: { resetToken?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { resetToken, password } = body;
  if (!resetToken || !password) {
    return NextResponse.json({ error: "Missing resetToken or password" }, { status: 400 });
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const tokenResult = await verifyResetToken(resetToken);
  if (!tokenResult) {
    return NextResponse.json(
      { error: "Invalid or expired reset token." },
      { status: 400 }
    );
  }

  const { adminId } = tokenResult;

  const newHash = await hashPassword(password);

  await sql`
    UPDATE admins
    SET password_hash = ${newHash},
        updated_at = now()
    WHERE id = ${adminId}
  `;

  await revokeAllSessions(adminId);

  await audit("password.reset", { adminId, ip, ua });

  // Get admin email for security notification
  const rows = await sql`SELECT email FROM admins WHERE id = ${adminId} LIMIT 1`;
  if (rows.length) {
    void sendSecurityNotification(rows[0].email, "password.reset", {
      ip,
      time: new Date().toISOString(),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
