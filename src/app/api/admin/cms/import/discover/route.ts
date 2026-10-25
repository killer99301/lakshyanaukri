// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/import/discover
//
// Body: { url } — one listing page. Returns the recruitments and updates it
// links to, each compared with the jobs already in the CMS. Fetches that one
// page (if robots.txt allows); saves nothing; uses no AI.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { discoverFromPage } from "@/lib/cms/importer/discover";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "Give the address of a page that lists jobs" }, { status: 400 });

  const rows = await sql`SELECT id, coalesce(title_text, '') AS title FROM recruitments WHERE draft_state <> 'ARCHIVED'`;
  const outcome = await discoverFromPage({ url, jobs: rows.map((r) => ({ id: String(r.id), title: String(r.title) })) });
  return outcome.ok ? NextResponse.json(outcome) : NextResponse.json({ error: outcome.error }, { status: 422 });
}
