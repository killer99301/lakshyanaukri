// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/import/discover
//
// Body: { url } — one listing page. Returns the recruitments and updates it
// links to (the collector's Stage 1 rules), each compared with the jobs
// already in the CMS (the collector's matching). Fetches that one
// page (if robots.txt allows); saves nothing; uses no AI.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { discoverFromPage } from "@/lib/cms/importer/discover";
import { cmsJobs } from "@/lib/cms/discovery/collector";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "Give the address of a page that lists jobs" }, { status: 400 });

  // The same jobs, with organisation, notice number and year, that the portal collector matches its leads against.
  const outcome = await discoverFromPage({ url, jobs: await cmsJobs() });
  return outcome.ok ? NextResponse.json(outcome) : NextResponse.json({ error: outcome.error }, { status: 422 });
}
