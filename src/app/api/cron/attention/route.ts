// ═══════════════════════════════════════════════════════════
// GET /api/cron/attention
//
// Run once each morning by Vercel Cron (vercel.json). Sends the owner one
// private Telegram message listing the live jobs that need a look today.
//
//   - Accepts only requests that carry "Authorization: Bearer <CRON_SECRET>",
//     which Vercel adds to its own cron calls. With no CRON_SECRET set, every
//     request is refused.
//   - Reads records; never changes or publishes one. Also clears old Smart
//     intake readings (abandoned ones cancelled, their uploaded pieces dropped).
//   - Sends to TELEGRAM_ADMIN_CHAT_ID only, never to the public channel.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { listLiveRecruitments } from "@/lib/cms/repository";
import { buildAttentionDigest, buildAttentionList, todayInIndia } from "@/lib/cms/attention";
import { sendToAdmin } from "@/lib/telegram";
import { siteConfig } from "@/config/site";
import { purgeOldJobs } from "@/lib/cms/importer/jobs";

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const records = await listLiveRecruitments();
    const today = todayInIndia();
    const list = buildAttentionList(records, today);
    const sent = await sendToAdmin(buildAttentionDigest(list, today, records.length, siteConfig.url));
    // Smart intake readings: abandoned ones cancelled, uploaded pieces of ended ones dropped.
    // Separate, so a failure here (e.g. before the importer's tables exist) never stops the digest.
    let readingsCleanup: unknown = null;
    try { readingsCleanup = await purgeOldJobs(); } catch (err) { console.error("[Cron] readings clean-up skipped", err instanceof Error ? err.message : err); }
    return NextResponse.json({ today, liveCount: records.length, jobsNeedingAttention: list.length, sent, readingsCleanup });
  } catch (err) {
    console.error("[Cron] attention digest error", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
