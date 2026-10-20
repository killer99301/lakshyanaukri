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
//
// The private morning digest goes to TELEGRAM_ADMIN_CHAT_ID instead, never to
// the channel. A change to any of these variables in Vercel only takes effect
// on the next deployment.

import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";
import { formatDate } from "@/lib/utils";
import { siteConfig } from "@/config/site";

export type AnnouncementKind = "NEW" | "UPDATED";
export type AnnouncementResult = "sent" | "skipped" | "failed";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The channel message for a published record. HTML, as Telegram's "HTML" parse mode expects. */
export function buildJobAnnouncement(snapshot: PublishedRecruitmentSnapshot, kind: AnnouncementKind, news?: string): string {
  const lines: string[] = [];
  // The heading is in capitals as well as bold: Telegram has no larger type,
  // and it is what a subscriber scans the channel for. Every value is bold.
  lines.push(kind === "NEW" ? "🆕 <b>NEW JOB</b>" : "🔄 <b>UPDATED</b>");
  lines.push(`<b>${escapeHtml(snapshot.title ?? snapshot.shortTitle ?? "Recruitment")}</b>`);
  lines.push(`<b>${escapeHtml(snapshot.organizationName)}</b>`);
  // On an update, what changed comes first: it is why the post was sent.
  if (kind === "UPDATED" && news) lines.push(`What's new: <b>${escapeHtml(news)}</b>`);
  lines.push("");
  if (typeof snapshot.vacancies.total === "number" && snapshot.vacancies.total > 0) {
    lines.push(`Posts: <b>${snapshot.vacancies.total.toLocaleString("en-IN")}</b>`);
  }
  if (snapshot.classification.qualification) {
    lines.push(`Qualification: <b>${escapeHtml(snapshot.classification.qualification)}</b>`);
  }
  if (snapshot.dates.applicationOpenDate) lines.push(`Apply from: <b>${formatDate(snapshot.dates.applicationOpenDate)}</b>`);
  if (snapshot.dates.applicationCloseDate) lines.push(`<b>Last date: ${formatDate(snapshot.dates.applicationCloseDate)}</b>`);
  if (lines[lines.length - 1] !== "") lines.push("");
  lines.push(`<b>Details and official links:</b> ${siteConfig.url}/jobs/${snapshot.slug}`);
  return lines.join("\n");
}

export function telegramConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHANNEL_ID?.trim());
}

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

/**
 * The chat a message goes to, in the form Telegram accepts. A channel is
 * easily entered as its link or its bare name; Telegram answers both with
 * "chat not found". Numeric IDs and @names pass through unchanged.
 */
export function normalizeChatId(raw: string): string {
  const value = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (/^-?\d+$/.test(value)) return value;
  const fromLink = value.match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,})\/?$/i);
  if (fromLink) return `@${fromLink[1]}`;
  if (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(value)) return `@${value}`;
  return value;
}

/** Telegram's own reason for a refusal ("chat not found"). It never holds the token. */
async function refusalReason(res: { json?: () => Promise<unknown> }): Promise<string> {
  try {
    const body = (await res.json?.()) as { description?: unknown } | undefined;
    return typeof body?.description === "string" ? `: ${body.description.slice(0, 120)}` : "";
  } catch {
    return "";
  }
}

async function send(rawChatId: string, text: string, token: string, fetchFn: FetchLike, what: string): Promise<AnnouncementResult> {
  const chatId = normalizeChatId(rawChatId);
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
      // Status and Telegram's reason only: the URL holds the token and must not reach the logs.
      console.error(`[Telegram] ${what} refused with HTTP ${res.status}${await refusalReason(res)}`);
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
