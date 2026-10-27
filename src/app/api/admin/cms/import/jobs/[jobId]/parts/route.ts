// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/import/jobs/:jobId/parts
//
// Multipart: sourceNo, first, last, file — one piece of whole pages, split
// in the browser. The server reads its text. Or JSON { sourceNo, first,
// last, reason } — pages the browser could not send (a page over the size
// limit), recorded as not uploaded, with why.
// A scanned page (stage B2.4): multipart sourceNo, scanPage, file (a PDF of
// that one page), or JSON { sourceNo, scanPage, reason } when it could not
// be sent.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { JOB_LIMITS, JobError, recordFailedPart, recordFailedScanPage, uploadJobPart, uploadScanPage } from "@/lib/cms/importer/jobs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;
  const { jobId } = await params;
  try {
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const b = await request.json() as Record<string, unknown>;
      if (b.scanPage !== undefined) {
        await recordFailedScanPage({ adminId: guard.adminId, jobId, sourceNo: Number(b.sourceNo), page: Number(b.scanPage), reason: String(b.reason ?? "could not be sent") });
        return NextResponse.json({ status: "FAILED" });
      }
      await recordFailedPart({ adminId: guard.adminId, jobId, sourceNo: Number(b.sourceNo), first: Number(b.first), last: Number(b.last), reason: String(b.reason ?? "could not be sent") });
      return NextResponse.json({ status: "FAILED" });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "The piece is missing" }, { status: 400 });
    if (file.size > JOB_LIMITS.partBytes) return NextResponse.json({ error: `A piece is at most ${JOB_LIMITS.partBytes / 1024 / 1024} MB` }, { status: 413 });
    if (form.get("scanPage") !== null) {
      return NextResponse.json(await uploadScanPage({
        adminId: guard.adminId, jobId, sourceNo: Number(form.get("sourceNo")), page: Number(form.get("scanPage")), bytes: Buffer.from(await file.arrayBuffer()),
      }));
    }
    const result = await uploadJobPart({
      adminId: guard.adminId, jobId, sourceNo: Number(form.get("sourceNo")), first: Number(form.get("first")), last: Number(form.get("last")),
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[importer] piece not saved", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The piece could not be saved" }, { status: 500 });
  }
}
