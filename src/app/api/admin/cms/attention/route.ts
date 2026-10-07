// ═══════════════════════════════════════════════════════════
// /api/admin/cms/attention
//
// GET   → live jobs that have something due, overdue or going stale
// POST  → sends today's list to the owner's Telegram chat now (a way to
//         test the morning message without waiting for it)
//
// Read-only as far as records go: nothing here changes a job.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { listLiveRecruitments } from "@/lib/cms/repository";
import { buildAttentionDigest, buildAttentionList, todayInIndia } from "@/lib/cms/attention";
import { adminChatConfigured, sendToAdmin } from "@/lib/telegram";
import { siteConfig } from "@/config/site";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const records = await listLiveRecruitments();
    const today = todayInIndia();
    return NextResponse.json({
      today,
      liveCount: records.length,
      jobs: buildAttentionList(records, today),
      telegramReady: adminChatConfigured(),
    });
  } catch (err) {
    console.error("[CMS] attention list error", err);
    return NextResponse.json({ error: "Failed to work out what needs attention" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (!validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!adminChatConfigured()) {
    return NextResponse.json({ sent: "skipped", error: "Telegram is not set up for private messages yet (TELEGRAM_ADMIN_CHAT_ID is missing)." }, { status: 409 });
  }
  try {
    const records = await listLiveRecruitments();
    const today = todayInIndia();
    const text = buildAttentionDigest(buildAttentionList(records, today), today, records.length, siteConfig.url);
    return NextResponse.json({ sent: await sendToAdmin(text) });
  } catch (err) {
    console.error("[CMS] attention send error", err);
    return NextResponse.json({ error: "Failed to send the list" }, { status: 500 });
  }
}
