// GET /api/admin/cms/import/jobs/:jobId/pages/:sourceNo/:page — a scanned
// page as its one-page PDF, to see beside what the AI read from it (the
// admin's own readings only; kept until the preview is saved or discarded).

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { JobError, scanPagePdf } from "@/lib/cms/importer/jobs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string; sourceNo: string; page: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: false });
  if (guard instanceof NextResponse) return guard;
  const { jobId, sourceNo, page } = await params;
  try {
    const pdf = await scanPagePdf({ adminId: guard.adminId, jobId, sourceNo: Number(sourceNo), page: Number(page) });
    if (!pdf) return NextResponse.json({ error: "This page's image is no longer kept (the preview was saved or discarded)" }, { status: 404 });
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (err) {
    if (err instanceof JobError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
