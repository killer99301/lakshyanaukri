export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// POST /api/admin/auth/recovery/verify
// ═══════════════════════════════════════════════════════════
//
// Body: { transactionId: string, token: string }
// Verifies OTP and returns a short-lived resetToken on success.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyOtp, createResetToken } from "@/lib/auth/otp";
import { checkRateLimit, RECOVERY_LIMIT } from "@/lib/auth/rate-limit";
import { audit } from "@/lib/auth/audit";
import { sql } from "@/lib/db";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const rl = await checkRateLimit(
    `otp-verify:ip:${ip}`,
    RECOVERY_LIMIT.limit * 2, // slightly looser: 6 per window
    RECOVERY_LIMIT.window
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter ?? RECOVERY_LIMIT.window) },
      }
    );
  }

  let body: { transactionId?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { transactionId, token: otp } = body;
  if (!transactionId || !otp) {
    return NextResponse.json({ error: "Missing transactionId or token" }, { status: 400 });
  }

  const result = await verifyOtp(transactionId, otp);

  if (result === "ok") {
    // Get admin_id from transaction
    const rows = await sql`
      SELECT admin_id FROM recovery_transactions WHERE id = ${transactionId} LIMIT 1
    `;
    if (!rows.length) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }

    const resetToken = await createResetToken(transactionId, rows[0].admin_id);

    await audit("otp.verified", {
      adminId: rows[0].admin_id,
      ip,
    });

    return NextResponse.json({ ok: true, resetToken });
  }

  if (result === "exhausted") {
    await audit("otp.exhausted", { ip, meta: { transactionId } });
    return NextResponse.json(
      { error: "Too many incorrect attempts. Start a new recovery request." },
      { status: 429 }
    );
  }

  if (result === "expired") {
    return NextResponse.json(
      { error: "OTP has expired. Start a new recovery request." },
      { status: 410 }
    );
  }

  if (result === "used") {
    return NextResponse.json(
      { error: "This OTP has already been used." },
      { status: 409 }
    );
  }

  // "invalid"
  await audit("otp.failed", { ip, meta: { transactionId } });
  return NextResponse.json({ error: "Invalid OTP" }, { status: 400 });
}
