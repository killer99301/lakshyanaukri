// ═══════════════════════════════════════════════════════════
// Correcting an existing announcement's details (15 Nov 2026)
// ═══════════════════════════════════════════════════════════
//
// Pure. The owner can set, correct or clear two details of an announcement already on the job, without a new
// announcement and without touching its words:
//   - "relevant until": the last day the notice matters (YYYY-MM-DD). After it, the notice is no longer current
//     anywhere public (Latest updates, Important now, the job page's banner);
//   - its event kind (and the exam stage it is about), from the existing kinds. Without one, the site guesses the
//     kind from the notice's words (important-update.ts, kindOf); this records the right one instead.
// Everything else stays exactly as it is: id, date, type, title, text, source, action, values, supersession notes
// (in both directions), and every other announcement. The caller saves the result through the job's normal change
// history (persistUpdatesNote: one transaction, only while the job is open for editing) and it goes live only with
// the owner's reviewed publish. The reason is private: it goes to the change history, never to the announcement.
//
// SSC CGL, Nov 2026: a 4 Nov notice ("…answer-key window (4–7 Nov) has closed") had no stored kind and no
// "relevant until", so it was guessed as "Answer key out" and stayed current after the window closed.

import type { AnnouncementEventKind, UpdateRecord } from "@/types";
import { kindOf, statusOfKind } from "@/lib/important-update";
import { MAX_REASON } from "@/lib/cms/announcements";
import { formatDate } from "@/lib/utils";

export const EVENT_KINDS: readonly AnnouncementEventKind[] = [
  "ADMIT_CARD", "RESULT", "ANSWER_KEY", "CUT_OFF", "EXAM_DATE", "POSTPONEMENT", "CANCELLATION",
  "EXTENSION", "CORRIGENDUM", "NEW_RECRUITMENT", "OTHER",
];

/** The correctable details of an announcement, as stored ("" = not set). */
export interface AnnouncementMeta { relevantUntil: string; eventKind: string; eventStage: string }

export const metaOf = (u: Pick<UpdateRecord, "relevantUntil" | "event">): AnnouncementMeta => ({
  relevantUntil: u.relevantUntil ?? "",
  eventKind: u.event?.kind ?? "",
  eventStage: u.event?.stage ?? "",
});

export const sameMeta = (a: AnnouncementMeta, b: AnnouncementMeta): boolean =>
  a.relevantUntil === b.relevantUntil && a.eventKind === b.eventKind && a.eventStage === b.eventStage;

export interface CorrectionInput {
  id: string;
  /** The details wanted, in full ("" clears one). */
  set: AnnouncementMeta;
  /** The details as the owner's page showed them: a correction made from an out-of-date page is refused. */
  was: AnnouncementMeta;
  reason: string;
  /** The names of the job's exam stages (a stage must be one of them, or the one already stored). */
  stages: readonly string[];
}

export type CorrectionResult =
  | { ok: true; list: UpdateRecord[]; changes: string[] }
  | { ok: false; error: string; code: "INVALID" | "STALE" | "NOT_FOUND" | "NO_CHANGE" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s: string) => ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** "Answer key out (guessed from its words)", "Exam date · Tier-I", "not set". */
export function describeKind(u: Pick<UpdateRecord, "event" | "type" | "title" | "description">): string {
  if (u.event?.kind) return `${statusOfKind(u.event.kind)}${u.event.stage ? ` · ${u.event.stage}` : ""}`;
  return `not set (guessed from its words: ${statusOfKind(kindOf(u as UpdateRecord).kind)})`;
}

/** The changes between two versions of the same announcement's details, in words, for the history and the review. */
export function metaChanges(before: UpdateRecord, after: UpdateRecord): string[] {
  const out: string[] = [];
  const a = metaOf(before), b = metaOf(after);
  if (a.relevantUntil !== b.relevantUntil) {
    out.push(`Relevant until: ${a.relevantUntil ? formatDate(a.relevantUntil) : "not set"} → ${b.relevantUntil ? formatDate(b.relevantUntil) : "not set"}`);
  }
  if (a.eventKind !== b.eventKind || a.eventStage !== b.eventStage) out.push(`Kind: ${describeKind(before)} → ${describeKind(after)}`);
  return out;
}

/** The job's announcements with one announcement's details corrected, or why it cannot be done. */
export function correctAnnouncement(list: readonly UpdateRecord[], input: CorrectionInput): CorrectionResult {
  const target = list.find((u) => u.id === input.id);
  if (!target) return { ok: false, code: "NOT_FOUND", error: "This announcement is not in the job (reload the page)." };
  const was = { relevantUntil: clean(input.was?.relevantUntil), eventKind: clean(input.was?.eventKind), eventStage: clean(input.was?.eventStage) };
  if (!sameMeta(was, metaOf(target))) {
    return { ok: false, code: "STALE", error: "This announcement was changed since the page was loaded. Reload the page and try again." };
  }
  if (target.superseded) {
    return { ok: false, code: "INVALID", error: "This announcement is superseded, so it is not shown as current anyway. Make it current again first if it needs correcting." };
  }
  const reason = clean(input.reason);
  if (!reason) return { ok: false, code: "INVALID", error: "Give the reason (it is kept in the job's history, never shown publicly)." };
  if (reason.length > MAX_REASON) return { ok: false, code: "INVALID", error: `Keep the reason to ${MAX_REASON} characters.` };

  const set = { relevantUntil: clean(input.set?.relevantUntil), eventKind: clean(input.set?.eventKind), eventStage: clean(input.set?.eventStage) };
  if (set.relevantUntil) {
    if (!realDay(set.relevantUntil)) return { ok: false, code: "INVALID", error: "“Relevant until” must be a real date (YYYY-MM-DD)." };
    if (target.date && ISO.test(target.date.slice(0, 10)) && set.relevantUntil < target.date.slice(0, 10)) {
      return { ok: false, code: "INVALID", error: `“Relevant until” cannot be before the notice's own date (${formatDate(target.date)}).` };
    }
    if (set.relevantUntil > "2100-12-31") return { ok: false, code: "INVALID", error: "“Relevant until” is too far ahead." };
  }
  if (set.eventKind && !(EVENT_KINDS as readonly string[]).includes(set.eventKind)) return { ok: false, code: "INVALID", error: "Choose one of the listed kinds." };
  if (set.eventStage && !set.eventKind) return { ok: false, code: "INVALID", error: "A stage needs a kind: choose the kind too." };
  if (set.eventStage && set.eventStage.length > 120) return { ok: false, code: "INVALID", error: "The stage name is too long." };
  if (set.eventStage && !input.stages.includes(set.eventStage) && set.eventStage !== was.eventStage) {
    return { ok: false, code: "INVALID", error: "Choose one of this job's exam stages." };
  }
  if (sameMeta(set, was)) return { ok: false, code: "NO_CHANGE", error: "Nothing changed." };

  // Only these two details change; every other key is copied as it is.
  const { relevantUntil: _r, event: _e, ...rest } = target;
  void _r; void _e;
  const corrected: UpdateRecord = {
    ...rest,
    ...(set.relevantUntil ? { relevantUntil: set.relevantUntil } : {}),
    ...(set.eventKind ? { event: { kind: set.eventKind as AnnouncementEventKind, ...(set.eventStage ? { stage: set.eventStage } : {}) } } : {}),
  };
  return { ok: true, list: list.map((u) => (u.id === target.id ? corrected : u)), changes: metaChanges(target, corrected) };
}
