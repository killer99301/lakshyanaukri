// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/records/[id]  — fetch a single record
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { getRecruitmentById } from "@/lib/cms/repository";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const record = await getRecruitmentById(id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ record });
  } catch (err) {
    console.error("[CMS] get error", err);
    return NextResponse.json({ error: "Failed to load record" }, { status: 500 });
  }
}
