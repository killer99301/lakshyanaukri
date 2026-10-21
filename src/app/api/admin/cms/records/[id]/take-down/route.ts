// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/take-down   { reason }
//
// Takes a live job off the website at once: listings, search, its own page,
// the sitemap and every other public page stop showing it. Not a delete and
// not a revert: the record, its published snapshots and all its history are
// kept, and "Put it back" shows the last published version again.
//
// A reason is required and is kept with the admin and the time. Nothing is
// posted to Telegram.
//
// CSRF: validateOrigin required.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistTakeDown, SiteVisibilityError } from "@/lib/cms/repository";

const MAX_REASON_LENGTH = 500;

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

  let reason = "";
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body?.reason === "string") reason = body.reason.trim();
  } catch { /* no body: caught below as a missing reason */ }
  if (reason.length < 3) {
    return NextResponse.json({ error: "Say why the job is being taken off the site." }, { status: 400 });
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json({ error: `Keep the reason under ${MAX_REASON_LENGTH} characters.` }, { status: 400 });
  }

  try {
    const record = await getRecruitmentById(id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const saved = await persistTakeDown(record, auth.adminId, reason);

    // Same refresh as publishing: the static public pages drop the job on their next visit.
    let revalidated = true;
    try {
      revalidatePath("/", "layout");
      revalidatePath("/sitemap.xml");
    } catch (err) {
      revalidated = false;
      console.error("[CMS] taken off the site, but public cache revalidation failed", err);
    }

    return NextResponse.json({ record: saved, revalidated });
  } catch (err) {
    if (err instanceof SiteVisibilityError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[CMS] take-down error", err);
    return NextResponse.json({ error: "Failed to take the job off the site" }, { status: 500 });
  }
}
