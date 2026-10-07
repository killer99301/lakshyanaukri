// ═══════════════════════════════════════════════════════════
// Telegram channel posts when a job is published
// ═══════════════════════════════════════════════════════════
//
// One message to the site's channel each time a record goes live: "New job"
// the first time, "Updated" after that. Nothing is posted unless both
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID are set.
//
//   - Posting can never block or undo a publish: every failure is swallowed
//     and reported as "failed".
//   - The message carries only facts that are on the published snapshot.
//   - The bot token is never logged or returned.

import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";
import { formatDate } from "@/lib/utils";
import { siteConfig } from "@/config/site";

export type AnnouncementKind = "NEW" | "UPDATED";
export type AnnouncementResult = "sent" | "skipped" | "failed";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The channel message for a published record. HTML, as Telegram's "HTML" parse mode expects. */
export function buildJobAnnouncement(snapshot: PublishedRecruitmentSnapshot, kind: AnnouncementKind): string {
  const lines: string[] = [];
  lines.push(kind === "NEW" ? "🆕 <b>New job</b>" : "🔄 <b>Updated</b>");
  lines.push(`<b>${escapeHtml(snapshot.title ?? snapshot.shortTitle ?? "Recruitment")}</b>`);
  lines.push(escapeHtml(snapshot.organizationName));
  lines.push("");
  if (typeof snapshot.vacancies.total === "number" && snapshot.vacancies.total > 0) {
    lines.push(`Posts: ${snapshot.vacancies.total.toLocaleString("en-IN")}`);
  }
  if (snapshot.classification.qualification) {
    lines.push(`Qualification: ${escapeHtml(snapshot.classification.qualification)}`);
  }
  if (snapshot.dates.applicationOpenDate) lines.push(`Apply from: ${formatDate(snapshot.dates.applicationOpenDate)}`);
  if (snapshot.dates.applicationCloseDate) lines.push(`Last date: ${formatDate(snapshot.dates.applicationCloseDate)}`);
  if (lines[lines.length - 1] !== "") lines.push("");
  lines.push(`Details and official links: ${siteConfig.url}/jobs/${snapshot.slug}`);
  return lines.join("\n");
}

export function telegramConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHANNEL_ID?.trim());
}

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

async function send(chatId: string, text: string, token: string, fetchFn: FetchLike, what: string): Promise<AnnouncementResult> {
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      // Status only: the URL holds the token and must not reach the logs.
      console.error(`[Telegram] ${what} refused with HTTP ${res.status}`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error(`[Telegram] ${what} failed:`, err instanceof Error ? err.name : "error");
    return "failed";
  }
}

/**
 * Post one message to the channel. Resolves to what happened; never throws.
 * `fetchFn` exists so tests can run without the network.
 */
export async function sendToChannel(
  text: string,
  env: Record<string, string | undefined> = process.env,
  fetchFn: FetchLike = fetch,
): Promise<AnnouncementResult> {
  if (!telegramConfigured(env)) return "skipped";
  return send(env.TELEGRAM_CHANNEL_ID!.trim(), text, env.TELEGRAM_BOT_TOKEN!.trim(), fetchFn, "channel post");
}

/** True when the bot can message the site's owner privately. */
export function adminChatConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_ADMIN_CHAT_ID?.trim());
}

/**
 * Send one private message to the owner's own chat (TELEGRAM_ADMIN_CHAT_ID).
 * Never goes to the public channel. Resolves to what happened; never throws.
 */
export async function sendToAdmin(
  text: string,
  env: Record<string, string | undefined> = process.env,
  fetchFn: FetchLike = fetch,
): Promise<AnnouncementResult> {
  if (!adminChatConfigured(env)) return "skipped";
  return send(env.TELEGRAM_ADMIN_CHAT_ID!.trim(), text, env.TELEGRAM_BOT_TOKEN!.trim(), fetchFn, "admin message");
}
