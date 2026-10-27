// GET /api/admin/cms/import/jobs/:jobId — a reading's progress (the admin's own only).

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { JobError, jobProgress } from "@/lib/cms/importer/jobs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: false });
  if (guard instanceof NextResponse) return guard;
  const { jobId } = await params;
  try {
    return NextResponse.json({ progress: await jobProgress({ adminId: guard.adminId, jobId }) });
  } catch (err) {
    if (err instanceof JobError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
