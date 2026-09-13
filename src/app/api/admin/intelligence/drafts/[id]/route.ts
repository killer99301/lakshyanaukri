// ═══════════════════════════════════════════════════════════
// Phase 10F: Intelligence Draft — Load & Save Review
// ═══════════════════════════════════════════════════════════
//
// GET /api/admin/intelligence/drafts/[id]
//   → Load full draft snapshot + metadata
//
// PUT /api/admin/intelligence/drafts/[id]
//   Body: { snapshot: RecruitmentIntelligenceDraft, currentRevision: number }
//   → Atomically save with optimistic concurrency control.
//   → 200: { draftId, currentRevision }
//   → 409: { error: "CONFLICT", latestRevision, message }
//
// Requires an authenticated admin session.
// CSRF: PUT validates Origin header.
//
// OPTIMISTIC CONCURRENCY:
//   The UPDATE uses WHERE current_revision = clientRevision.
//   If another save has occurred, 0 rows are affected and the
//   INSERT into intelligence_draft_revisions is skipped (CTE).
//   The response includes the current server revision so the
//   UI can inform the reviewer without any data loss.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { sql } from "@/lib/db";
import type { RecruitmentIntelligenceDraft } from "@/intelligence/draft-types";

// ─── GET ──────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id: draftId } = await params;

  const rows = await sql`
    SELECT id, status, current_revision, created_by, updated_by,
           created_at, updated_at, snapshot
    FROM intelligence_drafts
    WHERE id = ${draftId}::uuid
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const row = rows[0];
  return NextResponse.json({
    draftId: row.id as string,
    status: row.status as string,
    currentRevision: row.current_revision as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    draft: row.snapshot as RecruitmentIntelligenceDraft,
  });
}

// ─── PUT ──────────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: draftId } = await params;

  let body: { snapshot?: unknown; currentRevision?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.currentRevision !== "number") {
    return NextResponse.json({ error: "currentRevision (number) required" }, { status: 400 });
  }
  if (!body.snapshot || typeof body.snapshot !== "object") {
    return NextResponse.json({ error: "snapshot (object) required" }, { status: 400 });
  }

  const clientRevision = body.currentRevision;
  const snapshotJson = JSON.stringify(body.snapshot);

  // Atomic OCC save using a CTE:
  //   UPDATE succeeds only when current_revision = clientRevision.
  //   INSERT into revisions selects from the UPDATE's RETURNING clause —
  //   if UPDATE matched 0 rows, the SELECT returns nothing and INSERT
  //   inserts 0 rows. Both operations share the same statement, ensuring
  //   the revision record is created iff the draft was updated.
  const revisionRows = await sql`
    WITH updated AS (
      UPDATE intelligence_drafts
      SET
        snapshot         = ${snapshotJson}::jsonb,
        current_revision = current_revision + 1,
        updated_by       = ${auth.adminId}::uuid,
        updated_at       = now(),
        status           = 'IN_REVIEW'
      WHERE id = ${draftId}::uuid
        AND current_revision = ${clientRevision}::int
      RETURNING id, current_revision
    )
    INSERT INTO intelligence_draft_revisions (draft_id, revision, saved_by, snapshot)
    SELECT id, current_revision, ${auth.adminId}::uuid, ${snapshotJson}::jsonb
    FROM updated
    RETURNING draft_id, revision
  `;

  if (revisionRows.length === 0) {
    // OCC failure — fetch the current revision so the UI can show it
    const currentRows = await sql`
      SELECT current_revision FROM intelligence_drafts WHERE id = ${draftId}::uuid
    `;
    const latestRevision =
      currentRows.length > 0 ? (currentRows[0].current_revision as number) : null;

    return NextResponse.json(
      {
        error: "CONFLICT",
        message:
          "This draft was modified elsewhere. Reload to see the latest version — your unsaved changes were not saved.",
        latestRevision,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    draftId: revisionRows[0].draft_id as string,
    currentRevision: revisionRows[0].revision as number,
  });
}
