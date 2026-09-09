export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// POST /api/admin/auth/recovery/resend
// ═══════════════════════════════════════════════════════════
//
// Body: { transactionId: string }
// Resends OTP for an existing transaction (max 3 resends, 60s cooldown).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { generateOtp, hashOtp, MAX_RESEND_COUNT, OTP_EXPIRY_SECONDS } from "@/lib/auth/otp";
import { sendOtp } from "@/lib/auth/email";
import { checkRateLimit, RECOVERY_LIMIT } from "@/lib/auth/rate-limit";

const RESEND_COOLDOWN_SECONDS = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const rl = await checkRateLimit(
    `otp-resend:ip:${ip}`,
    RECOVERY_LIMIT.limit,
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

  let body: { transactionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { transactionId } = body;
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, admin_id, resend_count, created_at, used_at, superseded_at, expires_at
    FROM recovery_transactions
    WHERE id = ${transactionId}
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Invalid transaction" }, { status: 404 });
  }

  const tx = rows[0];

  if (tx.used_at || tx.superseded_at) {
    return NextResponse.json({ error: "Transaction is no longer active" }, { status: 409 });
  }

  if (new Date(tx.expires_at) < new Date()) {
    return NextResponse.json({ error: "Transaction has expired" }, { status: 410 });
  }

  // Check resend limit
  if (tx.resend_count >= MAX_RESEND_COUNT) {
    return NextResponse.json(
      { error: `Maximum resend limit (${MAX_RESEND_COUNT}) reached. Start a new recovery request.` },
      { status: 429 }
    );
  }

  // Check cooldown (60s since last created_at or resend)
  const createdAt = new Date(tx.created_at).getTime();
  const cooldownDeadline = createdAt + RESEND_COOLDOWN_SECONDS * 1000;
  if (Date.now() < cooldownDeadline) {
    const retryAfter = Math.ceil((cooldownDeadline - Date.now()) / 1000);
    return NextResponse.json(
      { error: `Please wait ${retryAfter}s before resending.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  // Generate new OTP, update transaction
  const newOtp = generateOtp();
  const newOtpHash = hashOtp(newOtp, transactionId);
  const newExpiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

  await sql`
    UPDATE recovery_transactions
    SET otp_hash    = ${newOtpHash},
        resend_count = resend_count + 1,
        attempts    = 0,
        expires_at  = ${newExpiresAt.toISOString()},
        created_at  = now()
    WHERE id = ${transactionId}
  `;

  // Get admin email
  const adminRows = await sql`
    SELECT email FROM admins WHERE id = ${tx.admin_id} LIMIT 1
  `;
  if (adminRows.length) {
    void sendOtp(adminRows[0].email, newOtp, "email").catch((err) => {
      console.error("[recovery/resend] Failed to send OTP:", err);
    });
  }

  return NextResponse.json({ ok: true, transactionId });
}
