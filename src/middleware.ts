// ═══════════════════════════════════════════════════════════
// Admin Auth Middleware — Edge runtime
// ═══════════════════════════════════════════════════════════
//
// Protects /admin/* and /api/admin/* routes.
// Exempts: /admin/login, /api/admin/auth/**
//
// Uses Web Crypto API for SHA-256 (Edge compatible).
// Uses @neondatabase/serverless HTTP driver for DB lookup.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

/** SHA-256 hash using Web Crypto API (Edge-compatible). */
async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Exempt: login page and all auth API routes
  const isAuthRoute =
    pathname === "/admin/login" ||
    pathname.startsWith("/api/admin/auth/");

  if (isAuthRoute) return NextResponse.next();

  // Check DATABASE_URL — fail closed if not configured
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  // Extract session cookie
  const cookieName =
    process.env.NODE_ENV === "production" ? "__Secure-admin_sid" : "admin_sid";
  const token = request.cookies.get(cookieName)?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Hash token with Web Crypto (Edge-compatible)
  const tokenHash = await sha256Hex(token);

  // Query DB via Neon HTTP driver
  try {
    const sql = neon(dbUrl);
    const now = new Date().toISOString();
    const idleDeadline = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30m ago

    const rows = await sql`
      SELECT id, admin_id, expires_at, last_used_at, revoked_at
      FROM admin_sessions
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;

    if (!rows.length) {
      return redirectOrUnauthorized(request, pathname);
    }

    const session = rows[0];

    // Revoked?
    if (session.revoked_at) {
      return redirectOrUnauthorized(request, pathname);
    }

    // Absolute expiry
    if (session.expires_at < now) {
      return redirectOrUnauthorized(request, pathname);
    }

    // Idle expiry (30 min)
    if (session.last_used_at < idleDeadline) {
      return redirectOrUnauthorized(request, pathname);
    }

    // Session valid — pass through with admin ID header
    const response = NextResponse.next();
    response.headers.set("x-admin-id", session.admin_id);
    return response;
  } catch (err) {
    console.error("[middleware] DB error:", err);
    // Fail-closed on DB error
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
}

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
