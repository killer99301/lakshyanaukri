// ═══════════════════════════════════════════════════════════
// Phase 10F: Intelligence Drafts — List
// ═══════════════════════════════════════════════════════════
//
// GET /api/admin/intelligence/drafts
//
// Returns a list of draft summaries (no full snapshot).
// Requires an authenticated admin session.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { sql } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const rows = await sql`
    SELECT
      id,
      status,
      current_revision,
      created_at,
      updated_at,
      snapshot -> 'identity' -> 'title' ->> 'value' AS title_preview,
      snapshot -> 'identity' -> 'organizationName' ->> 'value' AS org_preview
    FROM intelligence_drafts
    ORDER BY updated_at DESC
    LIMIT 50
  `;

  return NextResponse.json({
    drafts: rows.map((r) => ({
      id: r.id as string,
      status: r.status as string,
      currentRevision: r.current_revision as number,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      titlePreview: (r.title_preview as string | null) ?? null,
      orgPreview: (r.org_preview as string | null) ?? null,
    })),
  });
}
