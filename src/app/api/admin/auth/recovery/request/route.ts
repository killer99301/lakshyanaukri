export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// POST /api/admin/auth/recovery/request
// ═══════════════════════════════════════════════════════════
//
// Body: { identifier: string, channel: 'email' | 'sms' }
// ALWAYS returns 200 (anti-enumeration timing attack prevention).
// transactionId is returned even if no admin found — it's a no-op UUID.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import {
  generateOtp,
  createRecoveryTransaction,
  supersedePreviousTransactions,
} from "@/lib/auth/otp";
import { sendOtp } from "@/lib/auth/email";
import { checkRateLimit, RECOVERY_LIMIT } from "@/lib/auth/rate-limit";
import { audit, maskId } from "@/lib/auth/audit";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Rate limit by IP
  const ipLimit = await checkRateLimit(
    `recovery:ip:${ip}`,
    RECOVERY_LIMIT.limit,
    RECOVERY_LIMIT.window
  );
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(ipLimit.retryAfter ?? RECOVERY_LIMIT.window) },
      }
    );
  }

  let body: { identifier?: string; channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { identifier, channel } = body;
  if (!identifier || !channel) {
    return NextResponse.json({ error: "Missing identifier or channel" }, { status: 400 });
  }

  if (channel !== "email" && channel !== "sms") {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }

  // Rate limit by identifier
  await checkRateLimit(
    `recovery:identity:${identifier.toLowerCase()}`,
    RECOVERY_LIMIT.limit,
    RECOVERY_LIMIT.window
  );

  // SMS not yet supported
  if (channel === "sms") {
    return NextResponse.json(
      { error: "SMS recovery not yet enabled", code: "SMS_NOT_ENABLED" },
      { status: 501 }
    );
  }

  // Look up admin — anti-enumeration: always return 200
  const noOpTransactionId = randomUUID();
  const rows = await sql`
    SELECT id, email FROM admins
    WHERE email = ${identifier} OR username = ${identifier}
    LIMIT 1
  `;

  if (!rows.length) {
    // Return a plausible-looking transaction ID without creating a real transaction
    await audit("recovery.requested", {
      ip,
      meta: { identifier: maskId(identifier), found: false },
    });
    return NextResponse.json({
      ok: true,
      transactionId: noOpTransactionId,
      message: "If an account matches, an OTP has been sent.",
    });
  }

  const admin = rows[0];

  await supersedePreviousTransactions(admin.id);

  const otp = generateOtp();
  const transactionId = await createRecoveryTransaction(admin.id, otp, "email", ip);

  // Fire and forget — don't await (response first for timing safety)
  void sendOtp(admin.email, otp, "email").catch((err) => {
    console.error("[recovery] Failed to send OTP:", err);
  });

  await audit("recovery.requested", {
    adminId: admin.id,
    ip,
    meta: { identifier: maskId(identifier), found: true },
  });

  return NextResponse.json({
    ok: true,
    transactionId,
    message: "If an account matches, an OTP has been sent.",
  });
}
