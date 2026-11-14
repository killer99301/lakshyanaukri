// ═══════════════════════════════════════════════════════════
// P1 (CMS 2.0, Nov 2026): the job page's "Important update"
// ═══════════════════════════════════════════════════════════
//
// Pure. Chooses the one announcement a visitor should see first on a recruitment page: the most relevant
// CURRENT notice, not simply the newest. Works on the public copy of the announcements (toPublicUpdates), so it
// sees only allowlisted fields. Nothing is deleted or hidden: every announcement stays in the page's history.
//
// Rules (owner decision, 13 Nov 2026):
//   - A superseded announcement is never chosen.
//   - Urgency first: a cancellation or postponement outranks everything, then an exam or admit card within 7
//     days or under way, then a new result, answer key or cut-off, then an extension of a still-open
//     application, then other schedule news, then everything else.
//   - A notice stops being "current" only on a KNOWN date: its own "relevant until", or, for an admit card or an
//     exam date, the last day of the stage it is about. A result, answer key, cut-off, postponement or
//     cancellation is never expired by a stage's dates. With no known date it stays until a newer notice about
//     the same stage replaces it. No date is ever invented.
//   - The button is shown only for a real link of the right kind, and never once its known validity has passed:
//     an admit card's after its exam, an extension's after the (extended) closing date.
//   - Routine news ("other") is shown as a small note, not a big banner.
//
// Older announcements, saved before the event kind was recorded, are classified from their type and words.

import type { AnnouncementEventKind, ExamStage, Opportunity, UpdateRecord } from "@/types";
import { currentUpdates } from "@/lib/cms/announcements";
import { eventsOf } from "@/lib/cms/announcement-duplicates";
import { isAggregatorHost } from "@/lib/public-link-labels";
import { hostOf, originFor } from "@/lib/cms/importer/trusted-domains";

export type ImportantTone = "URGENT" | "ACTION" | "INFO";

export interface ImportantUpdate {
  update: UpdateRecord;
  kind: AnnouncementEventKind;
  /** The kind was read from the words of an older announcement, not recorded. */
  inferred: boolean;
  tone: ImportantTone;
  /** A short status for the chip: "Postponed", "Admit card out"… */
  status: string;
  /** The stage it is about, as the job names it, when known. */
  stage?: { name: string; when?: string };
  /** The button: a real, still-valid link of the right kind, or none. `official`: on the recruiting body's own site. */
  action?: { label: string; url: string; host: string | null; official: boolean };
  /** The notice the announcement came from, when it has one (shown as a small link). */
  noticeUrl?: string;
  /** The same, with its host and whether it is the recruiting body's own site (R1: never called official when not). */
  notice?: { url: string; host: string | null; official: boolean };
  /** Why the button is absent, in a few words, when the visitor might expect one. */
  noAction?: string;
}

const STATUS: Record<AnnouncementEventKind, string> = {
  ADMIT_CARD: "Admit card out", RESULT: "Result declared", ANSWER_KEY: "Answer key out", CUT_OFF: "Cut-off out",
  EXAM_DATE: "Exam date", POSTPONEMENT: "Postponed", CANCELLATION: "Cancelled", EXTENSION: "Date extended",
  CORRIGENDUM: "Corrigendum", NEW_RECRUITMENT: "New notification", OTHER: "Update",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isoDay = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lastDay = (s: ExamStage) => (s.dateIso && s.dateEndIso && s.dateEndIso > s.dateIso ? s.dateEndIso : s.dateIso);

/** The kind of news an announcement carries: recorded (U3), or read from its type and words (older ones). */
export function kindOf(u: UpdateRecord): { kind: AnnouncementEventKind; inferred: boolean } {
  if (u.event?.kind) return { kind: u.event.kind, inferred: false };
  if (u.type === "CANCELLATION") return { kind: "CANCELLATION", inferred: true };
  if (u.type === "POSTPONEMENT") return { kind: "POSTPONEMENT", inferred: true };
  if (u.type === "DEADLINE_EXTENSION") return { kind: "EXTENSION", inferred: true };
  if (u.type === "CORRIGENDUM") return { kind: "CORRIGENDUM", inferred: true };
  const words = eventsOf(`${u.title} ${u.description ?? ""}`);
  const first: Array<[string, AnnouncementEventKind]> = [
    ["cancelled", "CANCELLATION"], ["postponed", "POSTPONEMENT"], ["result", "RESULT"], ["answer key", "ANSWER_KEY"],
    ["cut-off", "CUT_OFF"], ["admit card", "ADMIT_CARD"], ["deadline extended", "EXTENSION"], ["rescheduled", "EXAM_DATE"], ["exam date", "EXAM_DATE"],
  ];
  for (const [w, k] of first) if (words.includes(w)) return { kind: k, inferred: true };
  if (u.type === "RESCHEDULE") return { kind: "EXAM_DATE", inferred: true };
  return { kind: "OTHER", inferred: true };
}

/** The job's stage an announcement is about: its recorded stage, or the stage an automatic entry names. */
function stageOf(u: UpdateRecord, stages: readonly ExamStage[]): ExamStage | undefined {
  const name = u.event?.stage ?? u.field;
  if (!name) return undefined;
  return stages.find((s) => norm(s.name) === norm(name));
}

// News about a stage's schedule: a newer one about the same stage replaces an older one as "current".
const SCHEDULE: ReadonlySet<AnnouncementEventKind> = new Set(["ADMIT_CARD", "EXAM_DATE", "POSTPONEMENT", "CANCELLATION", "RESULT"]);

/** The most relevant current announcement of a job, or null when none is relevant now. */
export function pickImportantUpdate(job: Opportunity, now: Date): ImportantUpdate | null {
  const today = isoDay(now);
  const where = (url: string) => { const host = hostOf(url); return { host, official: originFor(job.organizationId ?? "", host).role === "AUTHORITY" }; };
  const stages: readonly ExamStage[] = job.type === "government" ? job.examStages ?? [] : [];
  const list = currentUpdates(job.updates).filter((u) => u.date && !Number.isNaN(Date.parse(u.date)));
  const closeDate = job.type === "government" ? (job.application.extendedCloseDate || job.application.closeDate || "") : "";

  type Cand = { u: UpdateRecord; kind: AnnouncementEventKind; inferred: boolean; stage?: ExamStage; tier: number };
  const cands: Cand[] = [];
  for (const u of list) {
    const { kind, inferred } = kindOf(u);
    const stage = stageOf(u, stages);
    // Ended on a known date only.
    if (u.relevantUntil && u.relevantUntil < today) continue;
    if ((kind === "ADMIT_CARD" || kind === "EXAM_DATE") && stage) {
      const end = lastDay(stage);
      if (end && end < today) continue;
    }
    if (kind === "EXTENSION" && closeDate && closeDate < today) continue;
    // Replaced: a newer current announcement about the same stage's schedule (both naming no stage counts too).
    const key = stage ? norm(stage.name) : (u.event?.stage ? norm(u.event.stage) : "");
    if (SCHEDULE.has(kind) && list.some((o) => o !== u && o.date > u.date && SCHEDULE.has(kindOf(o).kind)
      && (stageOf(o, stages) ? norm(stageOf(o, stages)!.name) : (o.event?.stage ? norm(o.event.stage) : "")) === key)) continue;

    let tier: number;
    const soon = (s?: ExamStage) => !!s?.dateIso && lastDay(s)! >= today && s.dateIso <= addDays(today, 7);
    if (kind === "CANCELLATION" || kind === "POSTPONEMENT") tier = 1;
    else if ((kind === "ADMIT_CARD" || kind === "EXAM_DATE") && soon(stage)) tier = 2;
    else if (kind === "RESULT" || kind === "ANSWER_KEY" || kind === "CUT_OFF") tier = 3;
    else if (kind === "ADMIT_CARD") tier = 3;
    else if (kind === "EXTENSION") tier = 4;
    else if (kind === "EXAM_DATE" || kind === "CORRIGENDUM" || kind === "NEW_RECRUITMENT") tier = 5;
    else tier = 6;
    cands.push({ u, kind, inferred, stage, tier });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => a.tier - b.tier || (a.u.date < b.u.date ? 1 : a.u.date > b.u.date ? -1 : 0));
  const c = cands[0];

  const out: ImportantUpdate = {
    update: c.u, kind: c.kind, inferred: c.inferred,
    tone: c.tier === 1 ? "URGENT" : c.tier <= 4 ? "ACTION" : "INFO",
    status: STATUS[c.kind],
    ...(c.u.sourceUrl ? { noticeUrl: c.u.sourceUrl, notice: { url: c.u.sourceUrl, ...where(c.u.sourceUrl) } } : {}),
  };
  if (c.stage) out.stage = { name: c.stage.name, ...(c.stage.dateDisplay || c.stage.dateIso ? { when: c.stage.dateDisplay?.trim() || c.stage.dateIso } : {}) };
  else if (c.u.event?.stage) out.stage = { name: c.u.event.stage };

  // The button: the job's own official link of the right kind, only while it can still be used.
  const g = job.type === "government" ? job : null;
  const answerKey = (job.downloads ?? []).find((d) => d.kind === "answerKey" && !d.savedCopy)?.url;
  const linkFor: Record<string, [string | undefined, string]> = {
    ADMIT_CARD: [g?.links.admitCard, "Download admit card"], RESULT: [g?.links.result, "Check result"], CUT_OFF: [g?.links.result, "View cut-off"],
    ANSWER_KEY: [answerKey, "View answer key"], APPLY_ONLINE: [g?.links.apply || undefined, "Apply online"],
    OFFICIAL_NOTIFICATION: [g?.links.notification, "Official notification"], CORRIGENDUM: [g?.links.correction, "View corrigendum"],
    OFFICIAL_WEBSITE: [g?.links.website || undefined, "Official website"],
  };
  const wanted = c.u.action ?? (c.kind === "EXTENSION" ? "APPLY_ONLINE" : c.kind);
  const [url, label] = linkFor[wanted] ?? [undefined, ""];
  const expired = (wanted === "ADMIT_CARD" && c.stage && lastDay(c.stage) && lastDay(c.stage)! < today)
    || (wanted === "APPLY_ONLINE" && closeDate && closeDate < today);
  // An aggregator is never the button (as for Apply on the rest of the page).
  if (url && !expired && !isAggregatorHost(hostOf(url))) out.action = { label, url, ...where(url) };
  else if (linkFor[wanted] && !url && wanted !== "OFFICIAL_WEBSITE") out.noAction = `${label.replace(/^(Download|Check|View) /, "").replace(/^./, (x) => x.toUpperCase())} link not on this page yet: check the official website.`;
  return out;
}
