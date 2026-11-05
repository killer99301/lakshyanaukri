// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/discovery/updates[?recordId=]
//
// Updates Needed (U1–U2): the update leads found on portals and the live
// jobs' date reminders; with recordId, one job's (its matched update leads,
// the possible ones kept apart, and its reminders). Admin only; read only:
// no job changes, no AI request, nothing fetched. The review of a lead is
// the New Jobs Found action route.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { updatesForJob, updatesOverview } from "@/lib/cms/discovery/updates";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const recordId = request.nextUrl.searchParams.get("recordId");
  try {
    if (recordId !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) return NextResponse.json({ error: "Not a job id" }, { status: 400 });
      const job = await updatesForJob(recordId);
      return job ? NextResponse.json(job) : NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json(await updatesOverview());
  } catch (err) {
    if (/discovery_leads/.test(err instanceof Error ? err.message : "")) {
      return NextResponse.json({ error: "The New Jobs Found tables are not in this database yet (scripts/cms-add-discovery-leads.ts has not been run)." }, { status: 503 });
    }
    console.error("[discovery/updates] failed", err);
    return NextResponse.json({ error: "Updates needed could not be worked out" }, { status: 500 });
  }
}
