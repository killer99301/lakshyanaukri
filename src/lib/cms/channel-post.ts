// ═══════════════════════════════════════════════════════════
// Whether a publish posts to the Telegram channel
// ═══════════════════════════════════════════════════════════
//
// Every republish used to post "Updated", so fixing a typo told every
// subscriber something had changed. Now the admin chooses on each publish:
//
//   - a job going live for the first time posts unless the admin unticks it;
//   - a republish posts only when the admin ticks it (or "Check for updates"
//     publishes real news);
//   - the same message is never posted twice for a job within 24 hours, so a
//     double click or an undo-and-redo cannot spam the channel.
//
// Each post is recorded as an audit event, which is also what the 24-hour
// check reads. Pure decisions here; the route does the reading and writing.

import { createHash } from "node:crypto";

export const REPEAT_WINDOW_HOURS = 24;
export const CHANNEL_POST_EVENT = "TELEGRAM_CHANNEL_POST";

export type ChannelDecision =
  | { post: true }
  | { post: false; reason: "not-asked" | "duplicate" };

export function messageHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * `requested` is what the admin chose; undefined means the caller did not
 * say, which is read as "yes" for a first publish and "no" for a republish.
 */
export function decideChannelPost(opts: { requested: boolean | undefined; isNew: boolean; sameMessageRecently: boolean }): ChannelDecision {
  const wanted = opts.requested ?? opts.isNew;
  if (!wanted) return { post: false, reason: "not-asked" };
  if (opts.sameMessageRecently) return { post: false, reason: "duplicate" };
  return { post: true };
}

interface UpdateLike { date?: unknown; title?: unknown }

/**
 * The newest update entry dated within the last three days, as one line for
 * the channel post ("What's new: Tier 1 date announced"). Older entries are
 * not news.
 */
export function newsLine(updates: unknown[], todayIso: string): string | undefined {
  const cutoff = new Date(`${todayIso}T00:00:00Z`).getTime() - 3 * 86_400_000;
  const recent = (updates as UpdateLike[])
    .filter((u) => typeof u?.date === "string" && typeof u?.title === "string" && /^\d{4}-\d{2}-\d{2}$/.test(u.date as string))
    .filter((u) => new Date(`${u.date}T00:00:00Z`).getTime() >= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  // Entries are appended in order, so among those on the newest day the last one is newest.
  const newestDay = recent[0]?.date;
  const sameDay = recent.filter((u) => u.date === newestDay);
  const newest = sameDay[sameDay.length - 1];
  return newest ? String(newest.title).replace(/\s+/g, " ").trim().slice(0, 160) : undefined;
}
