// ═══════════════════════════════════════════════════════════
// Simple Update: one routine update to an existing job, entered by hand (CMS usability batch 2)
// ═══════════════════════════════════════════════════════════
//
// The owner picks what has changed (exam date, admit card, result, answer
// key, cut-off, deadline, other notice), types only that, and reviews the
// before/after before saving. Nothing here saves anything and nothing calls
// the AI: it turns the form into the very proposals "Check for updates"
// produces, and the saves come from that panel's own savesFor(). So both
// paths write the same fields the same way (stages, typed links, dates), and
// a stage change writes its own announcement through the fields route, as
// before. Publishing stays with the owner's publication review.
//
// Rules kept here:
//   - Nothing is invented: every date, stage and address is the owner's own;
//     missing input is a problem to fix, never a default.
//   - A link counts as official only when the owner ticks it; the form
//     suggests the tick only for the job's own sites or government domains
//     (isOfficialHost, the rule Check for updates already uses).
//   - A date marked Verified is replaced only when the owner ticks that it is.
//   - A tentative date stays tentative; only a date the notice calls final is
//     marked confirmed.
//   - An announcement is offered only where no stage change writes one, and
//     is checked against the job's entries for near-duplicates.
//
// Pure.

import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { ExamStage, UpdateRecord, UpdateType } from "@/types";
import { formatDate } from "@/lib/utils";
import {
  hostOf, isOfficialHost, savesFor, UPDATE_DATE_FIELDS,
  type FieldSave, type UpdateDateField, type UpdateLinkType, type UpdateProposal,
} from "@/lib/cms/update-check";
import { stageChangeEntries } from "@/lib/cms/stage-updates";
import { likelyDuplicates, type DuplicateHit } from "@/lib/cms/announcement-duplicates";

export type SimpleKind = "EXAM_DATE" | "ADMIT_CARD" | "RESULT" | "ANSWER_KEY" | "CUT_OFF" | "DEADLINE" | "NOTICE";

export const SIMPLE_KINDS: Array<{ kind: SimpleKind; label: string; hint: string }> = [
  { kind: "EXAM_DATE", label: "Exam date or postponement", hint: "A stage's date is announced, changed, or postponed" },
  { kind: "ADMIT_CARD", label: "Admit card", hint: "Admit cards or call letters are out" },
  { kind: "RESULT", label: "Result", hint: "A stage's result or the final result is out" },
  { kind: "ANSWER_KEY", label: "Answer key", hint: "An answer key is published" },
  { kind: "CUT_OFF", label: "Cut-off", hint: "Cut-off marks are published" },
  { kind: "DEADLINE", label: "Deadline extension", hint: "The last date to apply has changed" },
  { kind: "NOTICE", label: "Corrigendum or other notice", hint: "Any other official notice" },
];

/** How an exam date changed. CONFIRMED: the date on the job stays, and the notice now gives it as final. */
export type ExamChange = "ANNOUNCED" | "RESCHEDULED" | "POSTPONED" | "CONFIRMED";

export interface SimpleInput {
  kind: SimpleKind;
  /** The official page or PDF the change comes from. Required. */
  source: string;
  /** EXAM_DATE: the stage (as on the job, or a new one). ADMIT_CARD / RESULT: optional, to mark that stage. */
  stageName?: string;
  examChange?: ExamChange;
  /** ISO date of the stage (EXAM_DATE), or of the date field the kind updates. */
  dateIso?: string;
  /** EXAM_DATE: only a date the notice calls final is CONFIRMED. */
  certainty?: "CONFIRMED" | "TENTATIVE";
  /** DEADLINE: the new fee-payment last date, if the notice gives one. */
  feeDateIso?: string;
  linkUrl?: string;
  linkLabel?: string;
  /** Ticked by the owner: the link is on the recruiting body's own site. */
  linkOfficial?: boolean;
  /** RESULT: this is the final result of the whole recruitment (sets the result date). */
  finalResult?: boolean;
  /** The owner's announcement, where one is offered. */
  announcement?: { type: UpdateType; date: string; title: string; description: string } | null;
  /** The owner ticked that a Verified date may be replaced. */
  replaceVerified?: boolean;
}

export interface SimpleChange { label: string; before: string; after: string; note?: string }

export interface SimplePlan {
  /** What must be fixed before saving. Empty when the update can be saved. */
  problems: string[];
  /** Field saves, from Check for updates' own savesFor(). */
  saves: FieldSave[];
  /** The owner's own announcement, saved through the announcement route. */
  announcement: Omit<UpdateRecord, "id"> | null;
  /** Announcements the stage change will write by itself (job that has been public). */
  autoEntries: Array<Omit<UpdateRecord, "id">>;
  /** Before → after, for the review step. */
  changes: SimpleChange[];
  /** Dates now marked Verified that this update would replace. */
  verifiedReplaced: string[];
  /** Entries already on the job that look like the same news as the owner's announcement. */
  duplicates: DuplicateHit[];
  /** Whether this kind offers an announcement of its own (no stage change writes one). */
  offersAnnouncement: boolean;
}

const LINK_KIND: Partial<Record<SimpleKind, UpdateLinkType>> = {
  ADMIT_CARD: "ADMIT_CARD", RESULT: "RESULT", ANSWER_KEY: "ANSWER_KEY", CUT_OFF: "CUT_OFF",
};
const LINK_LABEL: Record<UpdateLinkType, string> = {
  ADMIT_CARD: "Admit card", RESULT: "Result", ANSWER_KEY: "Answer key", CUT_OFF: "Cut-off", EXAM_NOTICE: "Exam notice", CORRIGENDUM: "Corrigendum",
};

const isHttp = (s: string | undefined) => /^https?:\/\/[^\s]+\.[^\s]+/i.test((s ?? "").trim());
const isIso = (s: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
const showDate = (iso: string | null | undefined) => (iso ? formatDate(iso) : "not set");

/** The suggestion for the "official link" tick: the job's own sites and government domains only. */
export function suggestOfficial(url: string, record: RecruitmentRecord): boolean {
  return isOfficialHost(hostOf(url), record);
}

/** Does this kind change a stage (so the fields route writes the announcement itself)? */
const changesStage = (input: SimpleInput) =>
  input.kind === "EXAM_DATE" || ((input.kind === "ADMIT_CARD" || input.kind === "RESULT") && Boolean(input.stageName?.trim()));

export function planSimpleUpdate(record: RecruitmentRecord, input: SimpleInput, todayIso: string): SimplePlan {
  const problems: string[] = [];
  const source = input.source.trim();
  const sourceHost = hostOf(source);
  if (!isHttp(source)) problems.push("Give the address of the official page or PDF this comes from.");

  const base = {
    evidence: "Entered by hand from the official source",
    sourceHost,
    official: isOfficialHost(sourceHost, record),
    confirmed: true,
    supplied: true,
  };
  const proposals: UpdateProposal[] = [];
  const stages = [...(record.examStages ?? [])].sort((a, b) => a.order - b.order);
  const stageName = input.stageName?.trim() ?? "";
  const existingStage = stages.find((s) => s.name.toLowerCase() === stageName.toLowerCase());

  const addDate = (field: UpdateDateField, value: string | undefined, required: boolean) => {
    if (!value) { if (required) problems.push(`Enter the ${UPDATE_DATE_FIELDS[field].toLowerCase()}.`); return; }
    if (!isIso(value)) { problems.push(`${UPDATE_DATE_FIELDS[field]}: the date cannot be read.`); return; }
    const current = record.dates[field]?.value ?? null;
    if (current === value) { if (required) problems.push(`${UPDATE_DATE_FIELDS[field]} is already ${showDate(value)}.`); return; }
    proposals.push({ ...base, id: `date:${field}`, kind: "DATE", label: UPDATE_DATE_FIELDS[field], oldText: showDate(current), newText: showDate(value), date: { field, value } });
  };

  const addStage = (status: ExamStage["status"], extra: { dateIso?: string; certainty?: "CONFIRMED" | "TENTATIVE"; clearDate?: boolean } = {}) => {
    if (!stageName) { problems.push("Name the exam stage (as on the job, or a new one)."); return; }
    const was = existingStage
      ? `${existingStage.status.toLowerCase().replace(/_/g, " ")}${existingStage.dateIso ? `, ${formatDate(existingStage.dateIso)}${existingStage.certainty === "CONFIRMED" ? " (confirmed)" : " (tentative)"}` : existingStage.dateDisplay ? `, ${existingStage.dateDisplay}` : ""}`
      : "not on the job";
    const now = `${status.toLowerCase().replace(/_/g, " ")}${extra.dateIso ? `, ${formatDate(extra.dateIso)}${extra.certainty === "CONFIRMED" ? " (confirmed)" : " (tentative)"}` : extra.clearDate ? ", new date awaited" : ""}`;
    proposals.push({
      ...base, id: `stage:${stageName.toLowerCase()}`, kind: "STAGE",
      label: existingStage ? existingStage.name : `${stageName} (new stage)`, oldText: was, newText: now,
      stage: { name: existingStage?.name ?? stageName, isNew: !existingStage, status, ...extra },
    });
  };

  const addLink = (type: UpdateLinkType) => {
    const url = (input.linkUrl ?? "").trim();
    if (!isHttp(url)) { problems.push(`Give the ${LINK_LABEL[type].toLowerCase()} link (an https:// address).`); return; }
    if (record.links.some((l) => l.url.trim() === url)) { problems.push("That link is already on the job."); return; }
    const label = (input.linkLabel ?? "").trim() || LINK_LABEL[type];
    proposals.push({
      ...base, official: Boolean(input.linkOfficial), id: `link:${url}`, kind: "LINK",
      label: `${LINK_LABEL[type]} link`, oldText: "none", newText: `${label}: ${url}${input.linkOfficial ? " (official)" : " (not marked official)"}`,
      link: { type, url, label },
    });
  };

  switch (input.kind) {
    case "EXAM_DATE": {
      const change = input.examChange;
      if (!change) { problems.push("Say how the date changed: announced, rescheduled or postponed."); break; }
      if (change === "POSTPONED") {
        addStage("POSTPONED", { clearDate: true });
      } else if (change === "CONFIRMED") {
        // Same date, now final: the stage keeps its date and its status; only the certainty changes.
        if (!existingStage) problems.push("Choose the stage whose date the notice confirms.");
        else if (!existingStage.dateIso) problems.push("That stage has no exact date to confirm. Use \"Date announced\" and enter it.");
        else if (existingStage.certainty === "CONFIRMED") problems.push("That stage's date is already confirmed.");
        else addStage(existingStage.status, { dateIso: existingStage.dateIso, certainty: "CONFIRMED" });
      } else {
        if (!input.dateIso) problems.push("Enter the exam date.");
        else if (!isIso(input.dateIso)) problems.push("The exam date cannot be read.");
        else if (!input.certainty) problems.push("Say whether the notice gives the date as final (confirmed) or tentative.");
        // Only a change of date or of confirmation is an update; the same date with the same certainty is not.
        else if (existingStage?.dateIso === input.dateIso && existingStage.status === "SCHEDULED" && (existingStage.certainty === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE") === input.certainty) problems.push("That stage already has this date, marked the same way.");
        else addStage("SCHEDULED", { dateIso: input.dateIso, certainty: input.certainty });
      }
      break;
    }
    case "ADMIT_CARD":
      addLink("ADMIT_CARD");
      if (stageName) addStage("ADMIT_CARD_OUT");
      addDate("admitCardDate", input.dateIso, false);
      break;
    case "RESULT":
      addLink("RESULT");
      if (stageName) addStage("RESULT_DECLARED");
      if (input.finalResult) addDate("resultDate", input.dateIso, true);
      break;
    case "ANSWER_KEY":
    case "CUT_OFF":
      addLink(LINK_KIND[input.kind]!);
      break;
    case "DEADLINE":
      addDate("applicationCloseDate", input.dateIso, true);
      addDate("feePaymentCloseDate", input.feeDateIso, false);
      break;
    case "NOTICE":
      if (input.linkUrl?.trim()) addLink("CORRIGENDUM");
      break;
  }

  // Dates already checked against a document are replaced only on the owner's tick.
  const verifiedReplaced = proposals
    .filter((p) => p.kind === "DATE" && p.date && record.dates[p.date.field]?.status === "VERIFIED")
    .map((p) => p.label);
  if (verifiedReplaced.length > 0 && !input.replaceVerified) {
    problems.push(`${verifiedReplaced.join(", ")} is marked Verified. Tick that the official notice replaces it.`);
  }

  const saves = problems.length === 0 ? savesFor(record, proposals) : [];

  // The stage change writes its own announcement on a job that has been public (fields route).
  const stageSave = saves.find((s) => s.fieldPath === "examStages");
  const autoEntries = stageSave && record.publishedAt
    ? stageChangeEntries(record.examStages, stageSave.value as ExamStage[], todayIso)
    : [];

  const offersAnnouncement = !changesStage(input);
  let announcement: SimplePlan["announcement"] = null;
  const a = input.announcement;
  if (offersAnnouncement && a) {
    if (!isIso(a.date)) problems.push("Enter the date printed on the notice for the announcement.");
    if (!a.title.trim() || !a.description.trim()) problems.push("Give the announcement a title and a short description.");
    if (isIso(a.date) && a.title.trim() && a.description.trim()) {
      announcement = { type: a.type, date: a.date, title: a.title.trim(), description: a.description.trim(), ...(isHttp(source) ? { sourceUrl: source } : {}) };
    }
  }
  if (input.kind === "NOTICE" && !announcement && problems.length === 0) problems.push("Write the announcement: what the notice says.");

  const duplicates = announcement ? likelyDuplicates(announcement, record.updates ?? []) : [];

  const changes: SimpleChange[] = proposals.map((p) => ({
    label: p.label, before: p.oldText, after: p.newText,
    note: p.kind === "DATE" && p.date && record.dates[p.date.field]?.status === "VERIFIED" ? "replaces a Verified value" : undefined,
  }));
  for (const e of autoEntries) changes.push({ label: "Announcement (written by the stage change)", before: "—", after: `${e.date}: ${e.title}` });
  if (announcement) changes.push({ label: "Announcement", before: "—", after: `${announcement.date}: ${announcement.title}` });

  return { problems, saves, announcement, autoEntries, changes, verifiedReplaced, duplicates, offersAnnouncement };
}
