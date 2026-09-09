export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// POST /api/admin/auth/login
// ═══════════════════════════════════════════════════════════
//
// Body: { identity: string, password: string }
// Returns: 200 {} on success, 401 on failure
//
// Anti-enumeration: identical error for wrong user/wrong password.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { checkRateLimit, LOGIN_LIMIT } from "@/lib/auth/rate-limit";
import { audit, maskId } from "@/lib/auth/audit";
import { validateOrigin, getSessionCookieName, SESSION_COOKIE_MAX_AGE } from "@/lib/auth/guard";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Origin validation
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "";

  // Rate limit by IP
  const ipLimit = await checkRateLimit(`login:ip:${ip}`, LOGIN_LIMIT.limit, LOGIN_LIMIT.window);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(ipLimit.retryAfter ?? LOGIN_LIMIT.window) },
      }
    );
  }

  let body: { identity?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { identity, password } = body;
  if (!identity || !password) {
    return NextResponse.json({ error: "Missing identity or password" }, { status: 400 });
  }

  // Rate limit by identity
  const identityLimit = await checkRateLimit(
    `login:identity:${identity.toLowerCase()}`,
    LOGIN_LIMIT.limit,
    LOGIN_LIMIT.window
  );
  if (!identityLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(identityLimit.retryAfter ?? LOGIN_LIMIT.window) },
      }
    );
  }

  // Look up admin by email OR username
  const rows = await sql`
    SELECT id, password_hash, email, username
    FROM admins
    WHERE email = ${identity} OR username = ${identity}
    LIMIT 1
  `;

  // Constant-time: always run verifyPassword even on no-match
  const dummyHash = "$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy";
  const storedHash = rows[0]?.password_hash ?? dummyHash;
  const valid = await verifyPassword(storedHash, password);

  if (!rows.length || !valid) {
    await audit("login.failed", {
      ip,
      ua,
      meta: { identity: maskId(identity) },
    });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const admin = rows[0];
  const token = await createSession(admin.id, ip, ua);

  await audit("login.success", {
    adminId: admin.id,
    ip,
    ua,
    meta: { username: admin.username },
  });

  const cookieName = getSessionCookieName();
  const isProd = process.env.NODE_ENV === "production";

  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}
