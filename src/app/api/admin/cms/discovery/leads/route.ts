// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/discovery/leads?status=&kind=&sort=
//
// New Jobs Found (N3): the discovery leads the collector saved, with every
// place each was seen and what it may be in the CMS. Admin only; read only.
// Leads are research: nothing here is official or verified.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { LEAD_STATUSES, listLeads, type LeadSort, type LeadStatus } from "@/lib/cms/discovery/repository";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const q = request.nextUrl.searchParams;
  const status = q.get("status") || undefined;
  const kind = q.get("kind") || undefined;
  const sort = q.get("sort") || undefined;
  if (status && !(LEAD_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  if (kind && kind !== "NEW" && kind !== "UPDATE") return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  if (sort && sort !== "last_seen" && sort !== "first_seen") return NextResponse.json({ error: "Unknown sort" }, { status: 400 });
  try {
    const leads = await listLeads({ status: status as LeadStatus | undefined, kind: kind as "NEW" | "UPDATE" | undefined, sort: sort as LeadSort | undefined });
    return NextResponse.json({ leads });
  } catch (err) {
    // Before the discovery tables exist (their migration has not run), say so plainly.
    if (/discovery_leads/.test(err instanceof Error ? err.message : "")) {
      return NextResponse.json({ error: "The New Jobs Found tables are not in this database yet (scripts/cms-add-discovery-leads.ts has not been run)." }, { status: 503 });
    }
    console.error("[discovery/leads] list failed", err);
    return NextResponse.json({ error: "The leads could not be read" }, { status: 500 });
  }
}
