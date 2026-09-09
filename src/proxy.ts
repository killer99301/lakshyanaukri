// ═══════════════════════════════════════════════════════════
// Admin Auth Proxy — Next.js 16
// ═══════════════════════════════════════════════════════════
//
// Protects /admin/* and /api/admin/* routes.
// Public: /admin/login, /api/admin/auth/**
//
// Authentication order:
//   1. Session-based auth (primary — checks signed token against DB)
//   2. ADMIN_SECRET legacy fallback (temporary — Gate 5 retires this)
//
// Next.js 16: Middleware renamed to Proxy. Function export must be
// `proxy` (or default). Runtime is nodejs, not edge.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";

export const config = {
  // Explicit /admin and /api/admin entries ensure root paths are covered
  // in addition to the wildcard sub-paths.
  matcher: ["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*"],
};

// ─── SHA-256 helper (Node.js 20+ global crypto.subtle) ─────────────────────

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function redirectOrUnauthorized(
  request: NextRequest,
  pathname: string
): NextResponse {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

// ─── Legacy ADMIN_SECRET helpers (Phase 8 — removed at Gate 5) ─────────────

/** Returns true if the request carries a valid ADMIN_SECRET credential. */
function checkAdminSecret(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  // Authorization: Bearer <ADMIN_SECRET> (API callers / CLI scripts)
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  // admin_session cookie = ADMIN_SECRET (legacy browser session cookie)
  const sessionCookie = request.cookies.get("admin_session")?.value;
  if (sessionCookie === secret) return true;

  return false;
}

/**
 * Handles ?s=<ADMIN_SECRET> query-param login.
 * Sets the legacy cookie and redirects to the same URL without the param.
 * Returns null if the param is absent or incorrect.
 */
function handleAdminSecretQueryParam(
  request: NextRequest
): NextResponse | null {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return null;

  const urlSecret = request.nextUrl.searchParams.get("s");
  if (urlSecret !== secret) return null;

  const url = request.nextUrl.clone();
  url.searchParams.delete("s");
  const response = NextResponse.redirect(url);
  response.cookies.set("admin_session", secret, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  });
  return response;
}

// ─── Main proxy function ────────────────────────────────────────────────────

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Public routes — exempt from all auth checks
  const isPublicAuthRoute =
    pathname === "/admin/login" ||
    pathname.startsWith("/api/admin/auth/");
  if (isPublicAuthRoute) return NextResponse.next();

  // ── 1. Session-based authentication (primary) ────────────────────────────
  //
  // Only attempted when DATABASE_URL is configured. A DB error does NOT grant
  // access on its own — the request falls through to the ADMIN_SECRET check,
  // which itself fails-closed when ADMIN_SECRET is absent.

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const cookieName =
      process.env.NODE_ENV === "production" ? "__Secure-admin_sid" : "admin_sid";
    const token = request.cookies.get(cookieName)?.value;

    if (token) {
      try {
        const tokenHash = await sha256Hex(token);
        const sql = neon(dbUrl);
        const now = new Date();
        const idleDeadline = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago

        const rows = await sql`
          SELECT id, admin_id, expires_at, last_used_at, revoked_at
          FROM admin_sessions
          WHERE token_hash = ${tokenHash}
          LIMIT 1
        `;

        if (rows.length) {
          const session = rows[0];
          const isValid =
            !session.revoked_at &&
            new Date(session.expires_at) > now &&
            new Date(session.last_used_at) > idleDeadline;

          if (isValid) {
            const response = NextResponse.next();
            response.headers.set("x-admin-id", session.admin_id);

            // Refresh last_used_at (idle timeout reset) — fire-and-forget so
            // it does not add latency to every request. Does NOT extend
            // expires_at (absolute expiry stays fixed). Guards on revoked_at
            // IS NULL and expires_at > now() so a revoked or expired session
            // never gets a phantom refresh.
            void sql`
              UPDATE admin_sessions
              SET last_used_at = ${new Date().toISOString()}
              WHERE id = ${session.id}
                AND revoked_at IS NULL
                AND expires_at > ${new Date().toISOString()}
            `.catch((err: unknown) => {
              console.error("[proxy] Failed to refresh last_used_at:", err);
            });

            return response;
          }
          // Session found but revoked / expired / idle-timed-out — fall through
        }
        // No matching session row — fall through to legacy auth
      } catch (err) {
        // DB error: fail-closed for session auth. Fall through to ADMIN_SECRET.
        // If ADMIN_SECRET is not set, the request is denied at step 3.
        console.error("[proxy] DB error during session validation:", err);
      }
    }
    // No session cookie — fall through to legacy auth
  }

  // ── 2. Legacy ADMIN_SECRET fallback (Phase 8 — removed at Gate 5) ────────

  // Query-param login: validates ADMIN_SECRET, sets cookie, redirects
  const qpResponse = handleAdminSecretQueryParam(request);
  if (qpResponse) return qpResponse;

  // Bearer header or legacy session cookie
  if (checkAdminSecret(request)) return NextResponse.next();

  // ── 3. Deny — fail-closed ─────────────────────────────────────────────────
  return redirectOrUnauthorized(request, pathname);
}
