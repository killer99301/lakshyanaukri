// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/records/[id]/evidence
//
// The evidence kept for a record, newest first: each source (an AI Assist
// run, or an intelligence draft promoted to this record) with the quotes it
// supplied, field by field. Read only, admin only.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { listEvidence } from "@/lib/cms/assist-evidence";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  return NextResponse.json({ evidence: await listEvidence(id) });
}
