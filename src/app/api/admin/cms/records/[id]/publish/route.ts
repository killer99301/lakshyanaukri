// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/publish
//
// Publishes an APPROVED CMS record.
//
// Pipeline (Phase E — locked):
//   1. Load record — must be APPROVED
//   2. Official evidence gate (hard): at least one CmsEvidence
//      with sourceType OFFICIAL_NOTIFICATION or OFFICIAL_CORRIGENDUM
//      OR at least one link with official=true
//      (Fail if neither is present)
//   3. Call projectToPublished() — deterministic, fail-closed
//   4. Call persistPublication() — atomic DB write
//   5. Return updated record
//
// CSRF: validateOrigin required.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistPublication } from "@/lib/cms/repository";
import { projectToPublished, PROJECTION_VERSION } from "@/lib/cms/projector";
import { sql } from "@/lib/db";

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

  const record = await getRecruitmentById(id);
  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  if (record.draftState !== "APPROVED") {
    return NextResponse.json(
      { error: `Cannot publish: record is in state ${record.draftState} (must be APPROVED)` },
      { status: 409 },
    );
  }

  // ── Official evidence hard gate ──────────────────────────
  // At least one official evidence source OR one official link required.
  const hasOfficialLink = record.links.some((l) => l.official);

  let hasOfficialEvidence = false;
  if (!hasOfficialLink) {
    const evidenceRows = await sql`
      SELECT 1 FROM recruitment_evidence
      WHERE recruitment_id = ${id}
        AND source_type IN ('OFFICIAL_NOTIFICATION', 'OFFICIAL_CORRIGENDUM', 'OFFICIAL_EXAM_NOTICE')
      LIMIT 1
    `;
    hasOfficialEvidence = evidenceRows.length > 0;
  }

  if (!hasOfficialLink && !hasOfficialEvidence) {
    return NextResponse.json(
      {
        error: "Cannot publish: at least one official evidence source or official link is required",
        code: "MISSING_OFFICIAL_EVIDENCE",
      },
      { status: 422 },
    );
  }

  // ── Project ───────────────────────────────────────────────
  let snapshot: ReturnType<typeof projectToPublished>;
  try {
    snapshot = projectToPublished(record);
  } catch (err) {
    console.error("[CMS] projection failed", err);
    return NextResponse.json(
      { error: `Projection failed: ${String(err)}` },
      { status: 500 },
    );
  }

  // ── Persist ───────────────────────────────────────────────
  try {
    const published = await persistPublication(record, snapshot, PROJECTION_VERSION, auth.adminId);
    return NextResponse.json({ record: published });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("state") && msg.includes("APPROVED")) {
      return NextResponse.json({ error: "Record is no longer in APPROVED state" }, { status: 409 });
    }
    console.error("[CMS] persistPublication failed", err);
    return NextResponse.json({ error: "Failed to publish record" }, { status: 500 });
  }
}
