export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// DELETE /api/admin/auth/session — Logout
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revokeSession } from "@/lib/auth/session";
import { audit } from "@/lib/auth/audit";
import {
  requireAdmin,
  getSessionCookieName,
  validateOrigin,
} from "@/lib/auth/guard";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const cookieName = getSessionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (token) {
    await revokeSession(token);
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "";

  await audit("logout", {
    adminId: authResult.adminId,
    ip,
    ua,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });

  return response;
}
