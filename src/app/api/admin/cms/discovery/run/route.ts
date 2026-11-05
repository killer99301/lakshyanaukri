// ═══════════════════════════════════════════════════════════
// GET  /api/admin/cms/discovery/run   → whether portal checks are enabled, and the sources a run reads
// POST /api/admin/cms/discovery/run   → Check portals now (N4): one collector run, and its summary
//
// Admin only; POST also checks the request's origin. How the run fetches is
// decided on the server (src/lib/cms/discovery/run.ts), never by the request:
// off by default, saved test pages in a local test copy, the real portals only
// when the owner has enabled them. One run at a time. Leads are research: no
// job is created, changed, verified or published, and no AI is used.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { checkPortalsNow, runInfo, RunError } from "@/lib/cms/discovery/run";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(runInfo());
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (!validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await checkPortalsNow());
  } catch (err) {
    if (err instanceof RunError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (/discovery_leads/.test(err instanceof Error ? err.message : "")) {
      return NextResponse.json({ error: "The New Jobs Found tables are not in this database yet (scripts/cms-add-discovery-leads.ts has not been run)." }, { status: 503 });
    }
    console.error("[discovery/run] failed", err);
    return NextResponse.json({ error: "The portal check stopped with an error. Leads it saved before the error stay; no review decision was changed." }, { status: 500 });
  }
}
