// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/records/[id]/publication-review
//
// The owner's publication review for one job (owner-controlled publication,
// docs/owner-controlled-publication-design.md, revision 3, §2): what is ready,
// missing, disagreeing; source standing (admin only); links; warnings; the
// hard rules; the review fingerprint and the job's freshness, which a publish
// must send back unchanged. Read only: nothing is written. Any admin may look;
// only a publisher may act on it (`publisher`), and a non-publisher is told
// their own admin ID.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { getRecruitmentById } from "@/lib/cms/repository";
import { todayInIndia } from "@/lib/cms/attention";
import { isPublisher } from "@/lib/cms/publication-policy";
import { buildPublicationReview } from "@/lib/cms/publication-review";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const record = await getRecruitmentById(id);
  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  try {
    const review = await buildPublicationReview(record, todayInIndia());
    return NextResponse.json({ review, publisher: isPublisher(auth.adminId), adminId: auth.adminId });
  } catch (err) {
    console.error("[CMS] publication review failed", err instanceof Error ? err.message : "error");
    return NextResponse.json({ error: "The publication review could not be built" }, { status: 500 });
  }
}
