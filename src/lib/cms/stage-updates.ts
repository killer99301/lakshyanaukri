// ═══════════════════════════════════════════════════════════
// Update entries written automatically when a live job's stages change
// ═══════════════════════════════════════════════════════════
//
// Pure. A job's page opens with a banner showing its newest update entry, and
// lists all entries in its history. Those entries used to be added only by
// hand, so marking an exam "postponed" left the banner announcing the old
// date. Whenever the stages of a job that has been public are saved, the
// difference between the old and new stages is turned into entries here, so
// the banner and the history always say what the stages say.
//
// An entry is written only for a change a visitor would care about: a stage's
// status or its date. Renaming, reordering or editing a note writes nothing.

import type { ExamStage, ExamStageStatus, UpdateRecord, UpdateType } from "@/types";
import { formatDate } from "@/lib/utils";

export const MAX_AUTO_ENTRIES = 5;

const STATUS_WORDS: Record<ExamStageStatus, string> = {
  NOT_DECLARED: "Not declared",
  SCHEDULED: "Scheduled",
  ADMIT_CARD_OUT: "Admit card released",
  POSTPONED: "Postponed",
  CONDUCTED: "Held",
  RESULT_DECLARED: "Result declared",
};

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The written form wins when there is one: an exam held over several days has
// "30 Sep – 30 Oct 2026" there and only its first day as the exact date, and
// announcing the first day alone would be wrong.
const dateOf = (s: ExamStage | undefined): string => s?.dateDisplay?.trim() || (s?.dateIso ? formatDate(s.dateIso) : "");
const tentative = (s: ExamStage) => (s.certainty === "TENTATIVE" ? " (tentative)" : "");
const state = (s: ExamStage | undefined): string =>
  s ? [STATUS_WORDS[s.status], dateOf(s)].filter(Boolean).join(", ") : "Not on record";

type Entry = Omit<UpdateRecord, "id">;

function entryFor(before: ExamStage | undefined, after: ExamStage, todayIso: string): Entry | null {
  const statusChanged = before?.status !== after.status;
  const was = dateOf(before);
  const now = dateOf(after);
  const dateChanged = was !== now;
  if (!statusChanged && !dateChanged) return null;
  // A stage added with nothing known about it yet is not news.
  if (!before && after.status === "NOT_DECLARED" && !now) return null;

  const name = after.name;
  let type: UpdateType = "EXAM_NOTICE";
  let title: string;
  let description: string;

  if (after.status === "POSTPONED" && statusChanged) {
    type = "POSTPONEMENT";
    title = `${name} postponed`;
    description = now && now !== was
      ? `${name} has been postponed${was ? ` from ${was}` : ""} to ${now}${tentative(after)}.`
      : `${name}${was ? `, earlier set for ${was},` : ""} has been postponed. A new date has not been announced.`;
  } else if (after.status === "ADMIT_CARD_OUT" && statusChanged) {
    title = `${name}: admit card released`;
    description = `The admit card for ${name} has been released.${now ? (after.dateDisplay?.trim() ? ` Exam dates: ${now}${tentative(after)}.` : ` The exam is on ${now}${tentative(after)}.`) : ""}`;
  } else if (after.status === "CONDUCTED" && statusChanged) {
    title = `${name} held`;
    description = `${name} has been held${now ? ` on ${now}` : ""}.`;
  } else if (after.status === "RESULT_DECLARED" && statusChanged) {
    title = `${name}: result declared`;
    description = `The result of ${name} has been declared.`;
  } else if (dateChanged && now) {
    type = was ? "RESCHEDULE" : "EXAM_NOTICE";
    title = was ? `${name} rescheduled` : `${name} date announced`;
    description = was
      ? `${name} has moved from ${was} to ${now}${tentative(after)}.`
      : `${name} is set for ${now}${tentative(after)}.`;
  } else if (dateChanged) {
    type = "RESCHEDULE";
    title = `${name}: date withdrawn`;
    description = `${name}${was ? `, earlier set for ${was},` : ""} no longer has a date. A new date has not been announced.`;
  } else {
    title = `${name}: ${STATUS_WORDS[after.status].toLowerCase()}`;
    description = `${name} is now marked “${STATUS_WORDS[after.status].toLowerCase()}”.`;
  }

  return { type, date: todayIso, title, description, field: name, previousValue: state(before), newValue: state(after) };
}

/**
 * Entries for what changed between two versions of a job's stages. Stages are
 * paired by name; a stage that was removed writes nothing.
 */
export function stageChangeEntries(before: ExamStage[] | undefined, after: ExamStage[] | undefined, todayIso: string): Entry[] {
  const old = new Map((before ?? []).map((s) => [key(s.name), s]));
  const entries: Entry[] = [];
  for (const stage of [...(after ?? [])].sort((a, b) => a.order - b.order)) {
    const entry = entryFor(old.get(key(stage.name)), stage, todayIso);
    if (entry) entries.push(entry);
    if (entries.length >= MAX_AUTO_ENTRIES) break;
  }
  return entries;
}
