// ═══════════════════════════════════════════════════════════
// Recruitment timeline and "What's next"
// ═══════════════════════════════════════════════════════════
//
// One reading of a recruitment's dated events — the application window plus
// its exam stages — for the public timeline, the "What's next" line and, later,
// the exam calendar. Pure: `now` is passed in.
//
// Nothing is inferred. A stage whose date has gone by is NOT assumed to have
// been held: exams get postponed, so it is shown as awaiting an update until
// the admin marks it conducted.

import type { ExamStage, Opportunity } from "@/types";
import { formatDate } from "@/lib/utils";

export type TimelineState =
  | "done"       // happened
  | "next"       // the next dated event
  | "upcoming"   // dated, later than the next one
  | "awaiting"   // its date has passed but nothing says it was held
  | "unknown";   // no date announced

export interface TimelineEvent {
  id: string;
  label: string;
  /** Exact date, when one is known. */
  dateIso?: string;
  /** What to show for the date: "7 Oct 2026", "Dec 2026", or "To be announced". */
  dateText: string;
  state: TimelineState;
  /** The date is tentative, not confirmed. */
  tentative: boolean;
  /** Extra line, e.g. "Admit card released" or the stage's note. */
  note?: string;
  kind: "application" | "stage";
}

const isIso = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}/.test(v);
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

const STAGE_NOTES: Partial<Record<ExamStage["status"], string>> = {
  ADMIT_CARD_OUT: "Admit card released",
  CONDUCTED: "Held",
  RESULT_DECLARED: "Result declared",
  POSTPONED: "Postponed",
};

/** Every known event of a recruitment, in order, with where each stands today. */
export function buildTimeline(job: Opportunity, now: Date): TimelineEvent[] {
  const today = dayOf(now);
  const events: TimelineEvent[] = [];

  // Only government notices carry an extension, a fee deadline or a correction window.
  const gov = job.type === "government" ? job.application : null;
  const applicationDates: Array<[string, string, string | undefined]> = [
    ["open", "Applications open", job.application.openDate],
    ["close", gov?.extendedCloseDate ? "Last date to apply (extended)" : "Last date to apply", gov?.extendedCloseDate || job.application.closeDate],
    ["fee", "Last date for fee payment", gov?.feeDeadline],
    ["correction", "Correction window closes", gov?.correctionWindowEnd],
  ];
  for (const [id, label, date] of applicationDates) {
    if (!isIso(date)) continue;
    const iso = date.slice(0, 10);
    events.push({
      id: `application-${id}`,
      label,
      dateIso: iso,
      dateText: formatDate(iso),
      state: iso < today ? "done" : "upcoming",
      tentative: false,
      kind: "application",
    });
  }
  events.sort((a, b) => (a.dateIso ?? "").localeCompare(b.dateIso ?? ""));

  const stages = job.type === "government" ? [...(job.examStages ?? [])].sort((a, b) => a.order - b.order) : [];
  for (const stage of stages) {
    const iso = isIso(stage.dateIso) ? stage.dateIso.slice(0, 10) : undefined;
    const held = stage.status === "CONDUCTED" || stage.status === "RESULT_DECLARED";
    const postponed = stage.status === "POSTPONED" || stage.certainty === "POSTPONED";
    const hasDate = Boolean(iso || stage.dateDisplay);

    let state: TimelineState;
    if (held) state = "done";
    else if (postponed || !hasDate) state = "unknown";
    else if (iso && iso < today) state = "awaiting";
    else state = "upcoming";

    events.push({
      id: `stage-${stage.order}`,
      label: stage.name,
      dateIso: postponed ? undefined : iso,
      dateText: postponed ? "Postponed — new date awaited" : stage.dateDisplay || (iso ? formatDate(iso) : "To be announced"),
      state,
      tentative: !postponed && stage.certainty === "TENTATIVE",
      note: STAGE_NOTES[stage.status] ?? stage.notes,
      kind: "stage",
    });
  }

  // The next event is the earliest one that is still ahead and has an exact date.
  const next = events
    .filter((e) => e.state === "upcoming" && e.dateIso)
    .sort((a, b) => (a.dateIso as string).localeCompare(b.dateIso as string))[0];
  if (next) next.state = "next";

  return events;
}

export interface WhatsNext {
  /** Short headline, e.g. "Tier-I Exam". */
  title: string;
  /** The date or the state of play, e.g. "12 Dec 2026 (tentative)". */
  detail: string;
}

/** The single most useful thing to tell a candidate about what comes next. Null when there is nothing to say. */
export function whatsNext(job: Opportunity, now: Date): WhatsNext | null {
  const events = buildTimeline(job, now);
  const stages = events.filter((e) => e.kind === "stage");

  const next = events.find((e) => e.state === "next");
  if (next) {
    return { title: next.label, detail: `${next.dateText}${next.tentative ? " (tentative)" : ""}` };
  }

  // A stage with an approximate date ("December 2026") and nothing exact ahead of it.
  const approx = stages.find((e) => e.state === "upcoming");
  if (approx) return { title: approx.label, detail: `${approx.dateText}${approx.tentative ? " (tentative)" : ""}` };

  const awaiting = stages.find((e) => e.state === "awaiting");
  if (awaiting) return { title: awaiting.label, detail: `Was scheduled for ${awaiting.dateText}. Check the official site for the latest status.` };

  const undated = stages.find((e) => e.state === "unknown");
  if (undated) return { title: undated.label, detail: undated.dateText === "To be announced" ? "Date to be announced" : undated.dateText };

  if (stages.length > 0 && stages.every((e) => e.state === "done")) {
    const last = stages[stages.length - 1];
    return { title: last.label, detail: last.note === "Result declared" ? "Result declared. Watch for the next official notice." : "Held. Result awaited." };
  }

  // No stages recorded: only say something once applications have closed.
  const applicationsOver = events.filter((e) => e.kind === "application").every((e) => e.state === "done");
  if (events.length > 0 && applicationsOver) return { title: "Exam schedule", detail: "To be announced" };
  return null;
}
