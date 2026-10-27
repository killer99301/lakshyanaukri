// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/import/jobs/:jobId/action
//
// JSON { action }:
//   "estimate"  what is uploaded or missing, the AI requests the reading
//               will take, and today's allowance;
//   "start"     { allowMissing? } starts reading;
//   "step"      reads up to two tasks (well under this route's 60 s) and
//               returns the progress; the importer page calls it again
//               and again while it is open;
//   "pause", "resume", "retry" (failed tasks only), "cancel",
//   "finish"    { acceptFailed } builds the preview without failed parts.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { JobError, cancelJob, finishJob, jobProgress, pauseJob, resumeJob, retryFailed, startJob, stepJob } from "@/lib/cms/importer/jobs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;
  const { jobId } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Could not read the request" }, { status: 400 }); }
  const who = { adminId: guard.adminId, jobId };
  const apiKey = process.env.GEMINI_API_KEY;
  try {
    switch (body.action) {
      case "estimate": return NextResponse.json(await startJob({ ...who, confirm: false }));
      case "start": return NextResponse.json(await startJob({ ...who, confirm: true, allowMissing: body.allowMissing === true }));
      case "step": return NextResponse.json({ progress: await stepJob({ ...who, apiKey }) });
      case "pause": return NextResponse.json({ progress: await pauseJob(who) });
      case "resume": return NextResponse.json({ progress: await resumeJob(who) });
      case "retry": return NextResponse.json({ progress: await retryFailed(who) });
      case "cancel": return NextResponse.json({ progress: await cancelJob(who) });
      case "finish":
        await finishJob({ ...who, apiKey, acceptFailed: body.acceptFailed === true });
        return NextResponse.json({ progress: await jobProgress(who) });
      default: return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof JobError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[importer] reading action failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "That did not work; try again" }, { status: 500 });
  }
}
