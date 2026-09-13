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

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { sql } from "@/lib/db";
import { buildDraft } from "@/intelligence/draft-builder";

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
    const snapshotJson = JSON.stringify(draft);

    // Persist the machine-output draft (revision 1)
    const draftRows = await sql`
      INSERT INTO intelligence_drafts (created_by, updated_by, status, current_revision, snapshot)
      VALUES (${auth.adminId}::uuid, ${auth.adminId}::uuid, 'DRAFT', 1, ${snapshotJson}::jsonb)
      RETURNING id
    `;
    const draftId = draftRows[0].id as string;

    await sql`
      INSERT INTO intelligence_draft_revisions (draft_id, revision, saved_by, snapshot)
      VALUES (${draftId}::uuid, 1, ${auth.adminId}::uuid, ${snapshotJson}::jsonb)
    `;

    return NextResponse.json({ draft, draftId, currentRevision: 1 });
  } catch (err) {
    console.error("[api/admin/intelligence] error:", err);
    return NextResponse.json(
      { error: "Intelligence pipeline failed. Check server logs." },
      { status: 500 },
    );
  }
}
