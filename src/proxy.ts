// ═══════════════════════════════════════════════════════════
// Admin Route Proxy — Phase 8
// ═══════════════════════════════════════════════════════════
//
// Protects /admin/* and /api/admin/* routes.
//
// Access modes:
//   1. ADMIN_SECRET env not set → 401 everywhere (fail-closed)
//   2. Authorization: Bearer <ADMIN_SECRET> header → allowed (API calls)
//   3. Cookie admin_session=<ADMIN_SECRET> → allowed (browser)
//   4. Query param ?s=<ADMIN_SECRET> → sets cookie, redirects (browser nav)
//
// All other routes pass through unchanged.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isAdminPath =
    pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

  if (!isAdminPath) return NextResponse.next();

  const secret = process.env.ADMIN_SECRET;

  if (!secret) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Admin access not configured. Set ADMIN_SECRET in .env.local." },
        { status: 401 }
      );
    }
    return new NextResponse(
      `<html><body style="font-family:monospace;padding:2rem;max-width:600px">
        <h2>Admin Access Not Configured</h2>
        <p>Set <code>ADMIN_SECRET</code> in <code>.env.local</code> and restart the dev server.</p>
        <p>Example: <code>ADMIN_SECRET=your-local-secret-here</code></p>
      </body></html>`,
      { status: 401, headers: { "Content-Type": "text/html" } }
    );
  }

  // Check Authorization header (for API calls from CLI / scripts)
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return NextResponse.next();

  // Check session cookie (set after first successful auth)
  const sessionCookie = request.cookies.get("admin_session")?.value;
  if (sessionCookie === secret) return NextResponse.next();

  // Check query param — browser-friendly login: /admin/intake?s=<secret>
  const urlSecret = request.nextUrl.searchParams.get("s");
  if (urlSecret === secret) {
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

  // Unauthorized
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return new NextResponse(
    `<html><body style="font-family:monospace;padding:2rem;max-width:600px">
      <h2>Admin Login Required</h2>
      <p>Append <code>?s=YOUR_ADMIN_SECRET</code> to the URL to authenticate.</p>
      <p>Example: <code>/admin/intake?s=your-local-secret-here</code></p>
      <p>After first login a session cookie is set for 8 hours.</p>
    </body></html>`,
    { status: 401, headers: { "Content-Type": "text/html" } }
  );
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*"],
};
