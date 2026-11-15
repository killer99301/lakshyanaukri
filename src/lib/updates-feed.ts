// ═══════════════════════════════════════════════════════════
// R3 (CMS 2.0, Nov 2026): the Latest updates archive
// ═══════════════════════════════════════════════════════════
//
// Pure. Builds the public feed from published recruitments' announcements, as public pages receive them (the
// allowlisted copy, toPublicUpdates). Owner decisions (14–15 Nov 2026):
//   - Only owner-reviewed announcements of published recruitments. A job's links that have no announcement are
//     never turned into feed entries; they stay on the category pages.
//   - Nothing is invented: no date, event or text that the announcement does not hold.
//   - "Current" follows the job page's own rule (classifyAnnouncements): the same notice is never current in one
//     place and closed in the other. "Closed": its known date passed, or a newer notice about the same stage
//     replaced it. "Superseded": marked as replaced by newer verified information; shown with its correction
//     note and no body, never as current.
//   - Taken-down jobs are not in the input at all (the public query leaves them out).
//   - Only public fields leave this module: no reason, author or other internal metadata.

import type { AnnouncementEventKind, Opportunity, UpdateRecord } from "@/types";
import { announcementAction, classifyAnnouncements, kindOf, pickImportantUpdate, statusOfKind } from "@/lib/important-update";

export type FeedState = "CURRENT" | "CLOSED" | "SUPERSEDED";

/** The archive's type filter: a few groups visitors look for, each a set of event kinds. */
export const FEED_TYPES = [
  { slug: "admit-card", label: "Admit cards", kinds: ["ADMIT_CARD"] },
  { slug: "result", label: "Results", kinds: ["RESULT", "CUT_OFF"] },
  { slug: "answer-key", label: "Answer keys", kinds: ["ANSWER_KEY"] },
  { slug: "exam-date", label: "Exam dates", kinds: ["EXAM_DATE"] },
  { slug: "postponed", label: "Postponed / cancelled", kinds: ["POSTPONEMENT", "CANCELLATION"] },
  { slug: "extension", label: "Extensions", kinds: ["EXTENSION"] },
  { slug: "new", label: "New notifications", kinds: ["NEW_RECRUITMENT"] },
  { slug: "corrigendum", label: "Corrigenda", kinds: ["CORRIGENDUM"] },
  { slug: "other", label: "Other news", kinds: ["OTHER"] },
] as const satisfies ReadonlyArray<{ slug: string; label: string; kinds: readonly AnnouncementEventKind[] }>;
export type FeedTypeSlug = (typeof FEED_TYPES)[number]["slug"];

export const typeOfKind = (kind: AnnouncementEventKind): FeedTypeSlug =>
  FEED_TYPES.find((t) => (t.kinds as readonly string[]).includes(kind))?.slug ?? "other";

/** One public entry of the archive. Every field is public. */
export interface FeedEntry {
  /** Stable and unique: the job's slug and the announcement's id. */
  key: string;
  date: string;            // YYYY-MM-DD, the notice's date
  month: string;           // YYYY-MM
  title: string;
  /** Current and closed entries only; a superseded entry carries no body. */
  summary?: string;
  kind: AnnouncementEventKind;
  type: FeedTypeSlug;
  /** "Admit card out", "Postponed"… */
  kindLabel: string;
  state: FeedState;
  /** The stage it is about, as the job names it; `tentative` when the job marks that stage's date tentative. */
  stage?: { name: string; when?: string; tentative?: boolean };
  job: { slug: string; title: string; organization: string };
  /** The official button: current entries only, a real still-valid link, never an aggregator. */
  action?: { label: string; url: string };
  /** Superseded entries only: when it was corrected and what replaced it. */
  correction?: { on: string; replacementTitle?: string; replacementKey?: string; sourceUrl?: string };
}

const SUMMARY_MAX = 220;
const clip = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= SUMMARY_MAX ? t : `${t.slice(0, SUMMARY_MAX - 1).replace(/\s+\S*$/, "")}…`;
};
const validDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d) && !Number.isNaN(Date.parse(d.slice(0, 10)));
const readable = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A stage's date as the job writes it, or its ISO date(s) written out ("6 Mar 2097", "6 Mar 2097 – 9 Mar 2097"). */
const stageWhen = (s: { dateDisplay?: string; dateIso?: string; dateEndIso?: string }): string | undefined =>
  s.dateDisplay?.trim() || (validDay(s.dateIso) ? (validDay(s.dateEndIso) && s.dateEndIso > s.dateIso ? `${readable(s.dateIso)} – ${readable(s.dateEndIso)}` : readable(s.dateIso)) : undefined);

/** The archive's entries for these jobs (government recruitments only), newest first, in a stable order. */
export function buildFeed(jobs: readonly Opportunity[], now: Date): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const job of jobs) {
    if (job.type !== "government") continue;
    const ref = { slug: job.slug, title: job.title, organization: job.organizationName };
    const classified = new Map(classifyAnnouncements(job, now).map((c) => [c.u.id, c]));
    const byId = new Map((job.updates ?? []).map((u) => [u.id, u]));
    for (const u of job.updates ?? []) {
      if (!validDay(u.date)) continue;
      const date = u.date.slice(0, 10);
      const base = { key: `${job.slug}#${u.id}`, date, month: date.slice(0, 7), title: u.title, job: ref };
      if (u.superseded) {
        const { kind } = kindOf(u);
        const repl = u.superseded.replacedBy ? byId.get(u.superseded.replacedBy) : undefined;
        out.push({
          ...base, kind, type: typeOfKind(kind), kindLabel: statusOfKind(kind), state: "SUPERSEDED",
          correction: {
            on: u.superseded.on,
            ...(repl && !repl.superseded ? { replacementTitle: repl.title, replacementKey: `${job.slug}#${repl.id}` } : {}),
            ...(u.superseded.sourceUrl ? { sourceUrl: u.superseded.sourceUrl } : {}),
          },
        });
        continue;
      }
      const c = classified.get(u.id);
      if (!c) continue;
      const stage = c.stage
        ? { name: c.stage.name, ...(stageWhen(c.stage) ? { when: stageWhen(c.stage) } : {}), ...(c.stage.certainty === "TENTATIVE" ? { tentative: true } : {}) }
        : u.event?.stage ? { name: u.event.stage } : undefined;
      const action = c.current ? announcementAction(job, c, now).action : undefined;
      out.push({
        ...base, kind: c.kind, type: typeOfKind(c.kind), kindLabel: statusOfKind(c.kind),
        state: c.current ? "CURRENT" : "CLOSED",
        ...(u.description?.trim() ? { summary: clip(u.description) } : {}),
        ...(stage ? { stage } : {}),
        ...(action ? { action } : {}),
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || a.job.title.localeCompare(b.job.title) || a.key.localeCompare(b.key));
}

// ─── Filters and pages ─────────────────────────────────────

export interface FeedQuery { type?: FeedTypeSlug; job?: string; month?: string; status?: "current" | "closed" | "superseded"; page: number }

const pick = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** The archive's address parameters, checked: anything unknown is ignored, never trusted. */
export function readFeedQuery(params: Record<string, string | string[] | undefined>, entries: readonly FeedEntry[]): FeedQuery {
  const type = pick(params.type);
  const job = pick(params.job);
  const month = pick(params.month);
  const status = pick(params.status);
  const page = Number.parseInt(pick(params.page) ?? "1", 10);
  return {
    ...(type && FEED_TYPES.some((t) => t.slug === type) ? { type: type as FeedTypeSlug } : {}),
    ...(job && /^[a-z0-9-]{1,200}$/.test(job) && entries.some((e) => e.job.slug === job) ? { job } : {}),
    ...(month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? { month } : {}),
    ...(status === "current" || status === "closed" || status === "superseded" ? { status } : {}),
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** True when the query narrows the archive (a filtered view: not for search engines). */
export const isFiltered = (q: FeedQuery) => !!(q.type || q.job || q.month || q.status);

export function filterFeed(entries: readonly FeedEntry[], q: Omit<FeedQuery, "page">): FeedEntry[] {
  return entries.filter((e) => (!q.type || e.type === q.type) && (!q.job || e.job.slug === q.job)
    && (!q.month || e.month === q.month) && (!q.status || e.state === q.status.toUpperCase()));
}

export const PAGE_SIZE = 20;

/**
 * The archive's two parts: Current (all of them, on the first page only: they are few and they are what a
 * visitor came for) and Previous (closed and superseded), paginated. Every entry appears exactly once.
 */
export function feedPage(entries: readonly FeedEntry[], page: number, size = PAGE_SIZE) {
  const current = entries.filter((e) => e.state === "CURRENT");
  const previous = entries.filter((e) => e.state !== "CURRENT");
  const pages = Math.max(1, Math.ceil(previous.length / size));
  const at = Math.min(Math.max(1, page), pages);
  return {
    current: at === 1 ? current : [],
    currentCount: current.length,
    previous: previous.slice((at - 1) * size, at * size),
    previousCount: previous.length,
    page: at,
    pages,
    /** The requested page was beyond the last one. */
    outOfRange: page > pages,
  };
}

/** Entries grouped by month, newest month first, keeping the given order inside each month. */
export function byMonth(entries: readonly FeedEntry[]): Array<{ month: string; label: string; entries: FeedEntry[] }> {
  const groups: Array<{ month: string; label: string; entries: FeedEntry[] }> = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.month === e.month) last.entries.push(e);
    else groups.push({ month: e.month, label: monthLabel(e.month), entries: [e] });
  }
  return groups;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** How many entries each type has, under the other filters (for the type pills). */
export function typeCounts(entries: readonly FeedEntry[], q: Omit<FeedQuery, "page" | "type">): Record<string, number> {
  const base = filterFeed(entries, q);
  const counts: Record<string, number> = { all: base.length };
  for (const t of FEED_TYPES) counts[t.slug] = base.filter((e) => e.type === t.slug).length;
  return counts;
}

/** The archive's address for a query (only the parameters that are set; page 1 has no page parameter). */
export function feedHref(q: Partial<FeedQuery>): string {
  const p = new URLSearchParams();
  if (q.type) p.set("type", q.type);
  if (q.job) p.set("job", q.job);
  if (q.month) p.set("month", q.month);
  if (q.status) p.set("status", q.status);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `/updates?${s}` : "/updates";
}

/**
 * The homepage's "Important now": each job's own important update, chosen by the job page's rule
 * (pickImportantUpdate), kept only when it is urgent or calls for action (not routine news), most urgent first,
 * then newest. At most one per job.
 */
export function importantNow(jobs: readonly Opportunity[], entries: readonly FeedEntry[], now: Date, limit = 4): FeedEntry[] {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const picked: Array<{ e: FeedEntry; urgent: boolean }> = [];
  for (const job of jobs) {
    if (job.type !== "government") continue;
    const imp = pickImportantUpdate(job, now);
    if (!imp || imp.tone === "INFO") continue;
    const e = byKey.get(`${job.slug}#${imp.update.id}`);
    if (e && e.state === "CURRENT") picked.push({ e, urgent: imp.tone === "URGENT" });
  }
  return picked.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : 0) || a.e.key.localeCompare(b.e.key))
    .slice(0, limit).map((x) => x.e);
}

/** A job's announcements count for "All updates for this recruitment (N)". */
export const updatesCountOf = (job: Pick<Opportunity, "updates">): number => (job.updates ?? []).filter((u: UpdateRecord) => validDay(u.date)).length;

