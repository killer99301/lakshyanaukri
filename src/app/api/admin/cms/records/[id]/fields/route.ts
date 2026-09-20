// ═══════════════════════════════════════════════════════════
// PATCH /api/admin/cms/records/[id]/fields
//
// Updates a single field (or ProvenanceField block) through
// the typed writer path:
//
//   request body → routeFieldUpdate() → validation →
//   FieldRevision → persistFieldUpdate() → DB
//
// The CMS form NEVER writes directly to the database.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistFieldUpdate, OccConflictError } from "@/lib/cms/repository";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import type { ProvenanceField } from "@/types/recruitment-record";

interface PatchBody {
  fieldPath: string;
  field: ProvenanceField<unknown>;
  clientRevision: string;
  reason?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fieldPath, field, clientRevision, reason } = body;
  if (!fieldPath || field === undefined) {
    return NextResponse.json(
      { error: "fieldPath and field are required" },
      { status: 400 },
    );
  }
  if (!clientRevision) {
    return NextResponse.json(
      { error: "clientRevision is required" },
      { status: 400 },
    );
  }

  try {
    const record = await getRecruitmentById(id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    if (record.draftState === "PUBLISHED" || record.draftState === "ARCHIVED") {
      return NextResponse.json(
        { error: `Cannot edit a ${record.draftState} record` },
        { status: 409 },
      );
    }

    // Fast pre-check before hitting the DB (DB CTE is the authoritative gate)
    if (clientRevision !== record.recordRevision) {
      return NextResponse.json(
        { error: "CONFLICT", serverRevision: record.recordRevision, message: "Record was modified by another session" },
        { status: 409 },
      );
    }

    const result = routeFieldUpdate(record, fieldPath, field, auth.adminId, reason);
    const { record: saved, revision } = await persistFieldUpdate(result, clientRevision);

    return NextResponse.json({
      record: saved,
      revision,
    });
  } catch (err) {
    if (err instanceof OccConflictError) {
      return NextResponse.json(
        { error: "CONFLICT", serverRevision: err.serverRevision, message: err.message },
        { status: 409 },
      );
    }
    const msg = String(err);
    if (msg.includes("Unknown or unroutable") || msg.includes("not an editable")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes("invariant") || msg.includes("I1") || msg.includes("I3")) {
      return NextResponse.json({ error: `Validation failed: ${msg}` }, { status: 422 });
    }
    console.error("[CMS] field update error", err);
    return NextResponse.json({ error: "Failed to update field" }, { status: 500 });
  }
}
