// ═══════════════════════════════════════════════════════════
// Phase 10: Admin Intelligence Preview API Route
// ═══════════════════════════════════════════════════════════
//
// POST /api/admin/intelligence
// Content-Type: application/json
// Body: { urls: string[] }
//
// Returns:
//   { draft: RecruitmentIntelligenceDraft }
//
// Authentication: proxy.ts (ADMIN_SECRET cookie/header).
// Node.js runtime — requires HTTP fetching via fetchHtmlContent.
//
// INVARIANTS:
//   - Draft is never automatically published
//   - No writes to canonical data or discovery-candidates.json
//   - GitHub token NEVER returned to client
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
// PDF fetch (720KB+) + pdf-parse processing can take 15–30 s.
// Default 10 s on Vercel Hobby would kill the request before the PDF is read.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { buildDraft } from "@/intelligence/draft-builder";
import { sql } from "@/lib/db";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: { urls?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const urls = Array.isArray(body.urls)
    ? body.urls.filter(
        (u): u is string => typeof u === "string" && u.trim().length > 0,
      )
    : [];

  if (urls.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one URL" },
      { status: 400 },
    );
  }

  try {
    const draft = await buildDraft(urls);

    // ── Dedup: check for existing draft with same notification + org ──
    const notifNum = draft.identity.notificationNumber.value;
    const orgId = draft.identity.organizationId.value;

    if (notifNum && orgId) {
      const existingRows = await sql`
        SELECT id FROM intelligence_drafts
        WHERE snapshot->'identity'->'notificationNumber'->>'value' = ${notifNum}
          AND snapshot->'identity'->'organizationId'->>'value' = ${orgId}
        LIMIT 1
      `;
      if (existingRows.length > 0) {
        return NextResponse.json({
          draft,
          draftId: existingRows[0].id as string,
          isDuplicate: true,
        });
      }
    }

    // ── Save to intelligence_drafts (revision 1 = machine output) ──
    const snapshotJson = JSON.stringify(draft);
    const insertRows = await sql`
      WITH new_draft AS (
        INSERT INTO intelligence_drafts
          (snapshot, status, current_revision, created_by, updated_by)
        VALUES
          (${snapshotJson}::jsonb, 'DRAFT', 1, ${auth.adminId}::uuid, ${auth.adminId}::uuid)
        RETURNING id
      )
      INSERT INTO intelligence_draft_revisions (draft_id, revision, saved_by, snapshot)
        SELECT id, 1, ${auth.adminId}::uuid, ${snapshotJson}::jsonb FROM new_draft
      RETURNING draft_id AS id
    `;

    const draftId = insertRows[0].id as string;
    return NextResponse.json({ draft, draftId, isDuplicate: false });
  } catch (err) {
    console.error("[api/admin/intelligence] error:", err);
    return NextResponse.json(
      { error: "Intelligence pipeline failed. Check server logs." },
      { status: 500 },
    );
  }
}
