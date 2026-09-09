// ═══════════════════════════════════════════════════════════
// Auth guard — shared session validation for API routes
// ═══════════════════════════════════════════════════════════
//
// CSRF protection: SameSite=Lax + strict Origin header validation
// for all state-changing API routes. No X-CSRF-Token needed.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateSession, SESSION_ABSOLUTE_MAX_AGE_SECONDS } from "@/lib/auth/session";

/** Max-age for the session cookie (matches absolute session lifetime). */
export const SESSION_COOKIE_MAX_AGE = SESSION_ABSOLUTE_MAX_AGE_SECONDS; // 8h

/** Cookie name varies by environment. */
export function getSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-admin_sid"
    : "admin_sid";
}

/** Allowed origins for state-changing requests. */
export const ORIGIN_ALLOWLIST: string[] = (() => {
  const env = process.env.ADMIN_ALLOWED_ORIGINS;
  if (env) {
    return env.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"];
})();

/**
 * Validate the Origin header for state-changing (non-GET/HEAD) requests.
 * Returns true if Origin is allowed or not present on a safe method.
 */
export function validateOrigin(request: NextRequest): boolean {
  const method = request.method;
  // GET and HEAD are safe — no CSRF check needed
  if (method === "GET" || method === "HEAD") return true;

  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header — allow in non-production (e.g. curl/Postman in dev)
    if (process.env.NODE_ENV !== "production") return true;
    return false;
  }

  return ORIGIN_ALLOWLIST.some(
    (allowed) => origin === allowed || origin.startsWith(allowed)
  );
}

/**
 * Require an authenticated admin session.
 * Returns admin info on success, or a 401 NextResponse on failure.
 */
export async function requireAdmin(
  request: NextRequest
): Promise<{ adminId: string; sessionId: string } | NextResponse> {
  const cookieName = getSessionCookieName();
  const token = request.cookies.get(cookieName)?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await validateSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return session;
}

/**
 * Optionally get the authenticated admin (nullable).
 * Use for routes that support both authenticated and unauthenticated access.
 */
export async function getAdminFromRequest(
  request: NextRequest
): Promise<{ adminId: string; sessionId: string } | null> {
  const cookieName = getSessionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return null;
  return validateSession(token);
}
