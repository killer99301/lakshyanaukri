// ═══════════════════════════════════════════════════════════
// Email delivery — Resend API
// ═══════════════════════════════════════════════════════════
//
// Dev fallback: console.log OTP when RESEND_API_KEY not set
//   AND NODE_ENV !== 'production'
//
// NEVER log OTP values in production.
// NEVER log email addresses in non-dev.
// ═══════════════════════════════════════════════════════════

import { Resend } from "resend";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function getFromAddress(): string {
  return (
    process.env.ADMIN_EMAIL_FROM ??
    "LakshyaNaukri Admin <noreply@lakshyanaukri.in>"
  );
}

/**
 * Send an OTP to the admin.
 * In dev without RESEND_API_KEY: prints to console instead of sending.
 */
export async function sendOtp(
  to: string,
  otp: string,
  channel: "email"
): Promise<void> {
  void channel; // channel is always "email" in V1; SMS is handled via 501
  const resend = getResend();

  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is required in production to send OTP emails.");
    }
    // Dev: log OTP to console
    console.log(`[DEV] OTP for ${to.slice(0, 3)}***: ${otp}`);
    return;
  }

  await resend.emails.send({
    from: getFromAddress(),
    to,
    subject: "LakshyaNaukri Admin — Your one-time password",
    html: `
      <div style="font-family:monospace;max-width:400px;padding:24px">
        <h2 style="margin-bottom:8px">LakshyaNaukri Admin</h2>
        <p style="color:#555">Your one-time password is:</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${otp}</div>
        <p style="color:#888;font-size:12px">
          This code expires in 10 minutes.<br>
          If you did not request this, ignore this email.
        </p>
      </div>
    `,
  });
}

/**
 * Send a security notification (async, never throws).
 * Used for: password reset, suspicious login, etc.
 */
export async function sendSecurityNotification(
  to: string,
  event: string,
  meta: Record<string, string>
): Promise<void> {
  const resend = getResend();
  if (!resend) {
    // Dev: skip silently
    if (process.env.NODE_ENV !== "production") return;
    console.error("[email] Cannot send security notification — RESEND_API_KEY not set");
    return;
  }

  const metaRows = Object.entries(meta)
    .map(([k, v]) => `<tr><td style="color:#888">${k}</td><td>${v}</td></tr>`)
    .join("");

  try {
    await resend.emails.send({
      from: getFromAddress(),
      to,
      subject: `LakshyaNaukri Admin — Security alert: ${event}`,
      html: `
        <div style="font-family:monospace;max-width:500px;padding:24px">
          <h2>Security Alert — LakshyaNaukri Admin</h2>
          <p>Event: <strong>${event}</strong></p>
          <table style="border-collapse:collapse;font-size:13px;margin-top:12px">
            ${metaRows}
          </table>
          <p style="color:#888;font-size:12px;margin-top:16px">
            If you did not perform this action, contact support immediately.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error("[email] Failed to send security notification:", err);
  }
}
