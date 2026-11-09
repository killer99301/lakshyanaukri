// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/put-back
//
// Shows a job that was taken off the website again. The public pages serve
// its last published version, exactly as visitors last saw it; edits made
// since stay in the draft until they are published the usual way.
//
// Recorded with the admin and the time. Nothing is posted to Telegram.
//
// CSRF: validateOrigin required.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { isPublisher, logPublicationRefusal, notAPublisherMessage } from "@/lib/cms/publication-policy";
import { getRecruitmentById, persistPutBack, SiteVisibilityError } from "@/lib/cms/repository";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Owner-controlled publication (Stage 1): only the owner or an authorised publisher changes what the public sees.
  if (!isPublisher(auth.adminId)) {
    await logPublicationRefusal({ recruitmentId: id, adminId: auth.adminId, action: "PUT_BACK", reason: "NOT_A_PUBLISHER" });
    return NextResponse.json({ error: notAPublisherMessage(auth.adminId), code: "NOT_A_PUBLISHER", adminId: auth.adminId }, { status: 403 });
  }

  try {
    const record = await getRecruitmentById(id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const saved = await persistPutBack(record, auth.adminId);

    let revalidated = true;
    try {
      revalidatePath("/", "layout");
      revalidatePath("/sitemap.xml");
    } catch (err) {
      revalidated = false;
      console.error("[CMS] put back on the site, but public cache revalidation failed", err);
    }

    return NextResponse.json({ record: saved, revalidated });
  } catch (err) {
    if (err instanceof SiteVisibilityError) {
      await logPublicationRefusal({ recruitmentId: id, adminId: auth.adminId, action: "PUT_BACK", reason: "STATE" });
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[CMS] put-back error", err);
    return NextResponse.json({ error: "Failed to put the job back on the site" }, { status: 500 });
  }
}
