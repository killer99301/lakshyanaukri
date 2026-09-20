// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/records/[id]/revisions
//     ?fieldPath=dates.applicationCloseDate  (optional filter)
//
// Returns the append-only field revision log.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { getFieldRevisions } from "@/lib/cms/repository";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const fieldPath = request.nextUrl.searchParams.get("fieldPath") ?? undefined;

  try {
    const revisions = await getFieldRevisions(id, fieldPath);
    return NextResponse.json({ revisions });
  } catch (err) {
    console.error("[CMS] revisions error", err);
    return NextResponse.json({ error: "Failed to load revisions" }, { status: 500 });
  }
}
