// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/revert
//
// Transitions PUBLISHED → DRAFT without touching lastPublishedRevision.
// The most recent published snapshot is preserved; public pages continue
// to serve it while the record is being edited.
//
// OCC guard: record must still be in PUBLISHED state.
// If another admin already reverted, returns 409.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistRevert, OccConflictError } from "@/lib/cms/repository";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const record = await getRecruitmentById(id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    if (record.draftState !== "PUBLISHED") {
      return NextResponse.json(
        { error: `Cannot revert: record is in state ${record.draftState} (must be PUBLISHED)` },
        { status: 409 },
      );
    }

    const saved = await persistRevert(record, auth.adminId);
    return NextResponse.json({ record: saved });
  } catch (err) {
    if (err instanceof OccConflictError) {
      return NextResponse.json(
        { error: "CONFLICT", message: "Record was already reverted by another session" },
        { status: 409 },
      );
    }
    console.error("[CMS] revert error", err);
    return NextResponse.json({ error: "Failed to revert record" }, { status: 500 });
  }
}
