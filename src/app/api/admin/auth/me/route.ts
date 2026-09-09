export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// GET /api/admin/auth/me — Current admin info
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guard";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const rows = await sql`
    SELECT id, username, email
    FROM admins
    WHERE id = ${authResult.adminId}
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  const admin = rows[0];
  return NextResponse.json({
    adminId: admin.id,
    username: admin.username,
    email: admin.email,
  });
}
