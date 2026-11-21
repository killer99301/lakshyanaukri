// ═══════════════════════════════════════════════════════════
// GET /api/cron/refresh-public
//
// Marks every public page and the sitemap for re-rendering, so their server HTML follows the India date without a
// redeploy. Meant to run once a day just after midnight IST (proposed Vercel cron "0 19 * * *"; not registered yet).
// Needs "Authorization: Bearer <CRON_SECRET>". Reads published jobs first and refreshes nothing if that read fails.
// Writes no record and sends nothing. Logic and limits: src/lib/public-refresh.ts.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { runPublicRefresh } from "@/lib/public-refresh";
import { getAllPublishedSnapshots } from "@/lib/cms/public-repository";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { status, body } = await runPublicRefresh({
    secret: process.env.CRON_SECRET,
    authorization: request.headers.get("authorization"),
    countPublishedJobs: async () => (await getAllPublishedSnapshots()).length,
    revalidate: (path, type) => revalidatePath(path, type),
  });
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
