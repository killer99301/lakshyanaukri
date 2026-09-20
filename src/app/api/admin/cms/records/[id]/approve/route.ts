// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/approve
//
// Validates + transitions DRAFT → APPROVED.
// Enforces Trust Gate (minimum field requirements).
// No bypass. No weakening.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistApproval } from "@/lib/cms/repository";
import { validateRecord } from "@/lib/cms/validation";

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

    if (record.draftState !== "DRAFT") {
      return NextResponse.json(
        { error: `Record is already ${record.draftState}` },
        { status: 409 },
      );
    }

    // Validate before approval — same logic as approveRecord() but returns details
    const validation = validateRecord(record);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors },
        { status: 422 },
      );
    }

    const unresolved = record.lifecycle.conflicts.filter((c) => !c.resolvedAt);
    if (unresolved.length > 0) {
      return NextResponse.json(
        { error: `${unresolved.length} unresolved conflict(s) must be resolved before approval` },
        { status: 422 },
      );
    }

    const saved = await persistApproval(record, auth.adminId);
    return NextResponse.json({ record: saved });
  } catch (err) {
    console.error("[CMS] approve error", err);
    return NextResponse.json({ error: "Failed to approve record" }, { status: 500 });
  }
}
