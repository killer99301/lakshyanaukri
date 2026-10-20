// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/records/[id]/published
//
// The snapshot the public page serves for this record right now (the latest
// publish), or { snapshot: null } when it has never been published. Read
// only; the editor compares it with the edit before a republish.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { sql } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Record not found" }, { status: 404 });

  const rows = await sql`
    SELECT snapshot, published_at
    FROM published_recruitments
    WHERE recruitment_id = ${id}
    ORDER BY published_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return NextResponse.json({ snapshot: null });
  return NextResponse.json({ snapshot: rows[0].snapshot, publishedAt: new Date(rows[0].published_at as string).toISOString() });
}
