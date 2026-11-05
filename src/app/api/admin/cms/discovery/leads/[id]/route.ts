// ═══════════════════════════════════════════════════════════
// GET  /api/admin/cms/discovery/leads/[id]
// POST /api/admin/cms/discovery/leads/[id]   { action, reason?, note?, recruitmentId? }
//
// One lead, and the admin's review of it (N3): ready for review, needs
// source, needs correction, duplicate (of a job it was matched to), dismiss
// (with a reason), reopen. Only the lead changes, never a recruitment; a
// later collector run never changes what is recorded here.
//
// CSRF: validateOrigin required for POST.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getLead, LEAD_ACTIONS, LeadReviewError, reviewLead, type LeadAction } from "@/lib/cms/discovery/repository";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const lead = await getLead((await params).id);
  return lead ? NextResponse.json({ lead }) : NextResponse.json({ error: "Lead not found" }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (!validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (typeof action !== "string" || !(LEAD_ACTIONS as string[]).includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  try {
    const lead = await reviewLead({ id: (await params).id, adminId: auth.adminId, action: action as LeadAction,
      reason: text(body?.reason), note: text(body?.note), recruitmentId: text(body?.recruitmentId) });
    return NextResponse.json({ lead });
  } catch (err) {
    if (err instanceof LeadReviewError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[discovery/leads] review failed", err);
    return NextResponse.json({ error: "The review could not be saved" }, { status: 500 });
  }
}
