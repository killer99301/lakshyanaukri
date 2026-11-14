// ═══════════════════════════════════════════════════════════
// CMS 2.0 U3: announcements and supersession from an LN Update
// ═══════════════════════════════════════════════════════════
//
// Pure. From what the U1 reader found in an LN Update ("Announcement:", "Supersede:"), and the job as it is,
// this makes review items for the same Smart Intake preview as the field changes: at most ONE new announcement,
// and one item per earlier announcement to mark superseded. Nothing is saved here and nothing is posted
// anywhere: the owner ticks, the save goes through the existing announcement rules (supersede() in
// announcements.ts, persistUpdatesNote), and the public sees it only after the reviewed publish.
//
// Rules (owner decisions, 13 Nov 2026):
//   - A correction is saved quietly: GPT's announcement for one is offered unticked, and no automatic stage
//     announcement is written.
//   - Any other update: GPT's Announcement block if it has one, otherwise the automatic stage announcement the
//     stage editor would write (only on a job that has been public), never both.
//   - Never a duplicate: the same announcement already on the job is "Matches"; one that is probably the same
//     news (announcement-duplicates.ts) is offered unticked with the reason.
//   - Supersede only an announcement that the date and title name unambiguously; anything else is said, not done.
//   - Nothing is invented: no date (the announcement's own, else the notice's), no link (an "Action" names one of
//     the job's link types, never an address), no "relevant until" unless the text gives it.
//   - The old announcements are never rewritten or deleted: supersede only adds its note.

import { randomUUID } from "node:crypto";
import type { AnnouncementEventKind, ExamStage, UpdateRecord, UpdateType } from "@/types";
import type { CmsRecruitmentLink, RecruitmentRecord } from "@/types/recruitment-record";
import type { ProposalItem } from "@/lib/cms/importer/proposal";
import { squash, type UpdateReading, type UpdateType as LnUpdateType } from "@/lib/cms/importer/update-format";
import { supersede, updatesFingerprint, MAX_REASON } from "@/lib/cms/announcements";
import { eventsOf, likelyDuplicates } from "@/lib/cms/announcement-duplicates";
import { stageChangeEntries } from "@/lib/cms/stage-updates";

/** A new announcement, as it will be stored. */
export interface AddAnnouncement {
  op: "ADD";
  /** TEXT: GPT's Announcement block. STAGES: written from the stage changes, as the stage editor would. */
  origin: "TEXT" | "STAGES";
  entry: UpdateRecord;
  /** The job's announcement list the preview was made from (updatesFingerprint). */
  basis: string;
}

/** An earlier announcement of the job to mark superseded. */
export interface SupersedeAnnouncement {
  op: "SUPERSEDE";
  targetId: string;
  target: { date: string; title: string };
  reason: string;
  /** An existing announcement of the job that carries the correct information. */
  replacedBy?: string;
  /** The text named this update's own new announcement as the replacement. */
  replacedByNew?: boolean;
  /** The official notice that shows it. */
  sourceUrl?: string;
  basis: string;
}

export type AnnouncementValue = AddAnnouncement | SupersedeAnnouncement;

export const ANNOUNCEMENT_PATH = "updates#new";
export const supersedePath = (targetId: string) => `updates#supersede:${targetId}`;
export const isAnnouncementItem = (i: Pick<ProposalItem, "kind">) => i.kind === "ANNOUNCEMENT";

const LN_TO_TYPE: Record<LnUpdateType, UpdateType> = {
  CORRECTION: "GENERAL_NOTICE", NEW_INFORMATION: "GENERAL_NOTICE", CORRIGENDUM: "CORRIGENDUM", SCHEDULE: "EXAM_NOTICE",
  RESULT: "EXAM_NOTICE", ADMIT_CARD: "EXAM_NOTICE", ANSWER_KEY: "EXAM_NOTICE", CUT_OFF: "EXAM_NOTICE",
  POSTPONEMENT: "POSTPONEMENT", CANCELLATION: "CANCELLATION", NEW_RECRUITMENT: "GENERAL_NOTICE",
};
const LN_TO_EVENT: Record<LnUpdateType, AnnouncementEventKind> = {
  CORRECTION: "OTHER", NEW_INFORMATION: "OTHER", CORRIGENDUM: "CORRIGENDUM", SCHEDULE: "EXAM_DATE",
  RESULT: "RESULT", ADMIT_CARD: "ADMIT_CARD", ANSWER_KEY: "ANSWER_KEY", CUT_OFF: "CUT_OFF",
  POSTPONEMENT: "POSTPONEMENT", CANCELLATION: "CANCELLATION", NEW_RECRUITMENT: "NEW_RECRUITMENT",
};
const LINK_WORDS: Record<string, string> = {
  APPLY_ONLINE: "apply", OFFICIAL_NOTIFICATION: "official notification", OFFICIAL_WEBSITE: "official website", CORRIGENDUM: "corrigendum",
  ADMIT_CARD: "admit card", RESULT: "result", ANSWER_KEY: "answer key", CUT_OFF: "cut-off", EXAM_NOTICE: "exam notice",
};

/** Which kind of notice it is, and the stored type: the update type first, the words only to tell an extension or a reschedule apart. */
function kindOf(updateType: LnUpdateType | undefined, text: string): { type: UpdateType; kind: AnnouncementEventKind } {
  const words = eventsOf(text);
  if (words.includes("deadline extended") && (!updateType || ["NEW_INFORMATION", "CORRIGENDUM", "SCHEDULE"].includes(updateType))) return { type: "DEADLINE_EXTENSION", kind: "EXTENSION" };
  if (updateType === "SCHEDULE" && words.includes("rescheduled")) return { type: "RESCHEDULE", kind: "EXAM_DATE" };
  if (!updateType) return { type: "GENERAL_NOTICE", kind: "OTHER" };
  return { type: LN_TO_TYPE[updateType], kind: LN_TO_EVENT[updateType] };
}

const sameStage = (a: string, b: string) => squash(a) === squash(b);
const titleWords = (t: string) => new Set(squash(t).split(" ").filter((w) => w.length > 2));

/** The job's announcements a Supersede line names: same date (when given) and the same, or nearly the same, title. */
export function findAnnouncement(list: readonly UpdateRecord[], date: string | undefined, title: string): UpdateRecord[] {
  const pool = list.filter((u) => !date || u.date === date);
  const exact = pool.filter((u) => squash(u.title) === squash(title));
  if (exact.length) return exact;
  const mine = titleWords(title);
  return pool.filter((u) => {
    const theirs = titleWords(u.title);
    const common = [...mine].filter((w) => theirs.has(w)).length;
    const union = new Set([...mine, ...theirs]).size;
    return union > 0 && common / union >= 0.6;
  });
}

export interface AnnouncementProposals { items: ProposalItem[]; warnings: string[] }

/**
 * Review items for the announcement and the supersessions an LN Update gives.
 * `stages` is the job's whole stage list after this update (the U2 merge), when the update changes stages.
 */
export function proposeAnnouncements(input: {
  record: RecruitmentRecord | null;
  reading: UpdateReading;
  retrievalId: string;
  stages?: ExamStage[];
  /** For the automatic stage announcement: today in India (YYYY-MM-DD), when the notice has no date. */
  today: string;
  /** Links this update offers, so an "Action" can point at one that will be on the job. */
  offeredLinks?: Array<Pick<CmsRecruitmentLink, "type">>;
}): AnnouncementProposals {
  const { record, reading } = input;
  const out: AnnouncementProposals = { items: [], warnings: [] };
  if (reading.format === null || reading.refused) return out;
  const list = record?.updates ?? [];
  const basis = updatesFingerprint(list);
  const head = reading.header;
  const unsure = reading.identity.result === "UNSURE";
  const correction = head.updateType === "CORRECTION";
  const claim = (quote: string) => [{ retrievalId: input.retrievalId, quote, page: null }];
  const say = (w: string) => out.warnings.push(`Announcements: ${w}`);

  // ── The new announcement: GPT's, or the automatic stage one.
  let added: AddAnnouncement | null = null;
  let addedItem: ProposalItem | null = null;
  const a = reading.announcement;
  if (a) {
    const date = a.date ?? head.sourceDate;
    const text = a.text?.trim();
    if (!a.title.trim()) say(`the announcement (line ${a.line}) has no title, so it is not offered`);
    else if (!text) say(`the announcement “${a.title}” (line ${a.line}) has no “Text:” line, so it is not offered`);
    else if (!date) say(`the announcement “${a.title}” has no date, and the notice's date (“Source: …, dated …”) is not given, so it is not offered; no date is guessed`);
    else {
      const flags: string[] = [];
      const tick = !a.offeredUnticked;
      if (a.offeredUnticked && a.why) flags.push(`not ticked: ${a.why}`);
      const { type, kind } = kindOf(head.updateType, `${a.title} ${text}`);
      const stageNames = (input.stages ?? record?.examStages ?? []).map((s) => s.name);
      const stage = a.stage ? stageNames.find((n) => sameStage(n, a.stage!)) ?? a.stage : undefined;
      if (a.stage && !stageNames.some((n) => sameStage(n, a.stage!))) flags.push(`the stage “${a.stage}” is not one of the job's stages; kept as written`);
      if (a.relevantUntil && a.relevantUntil < date) { flags.push(`“relevant until” (${a.relevantUntil}) is before the notice's date (${date}); it is left out`); }
      const until = a.relevantUntil && a.relevantUntil >= date ? a.relevantUntil : undefined;
      if (a.action) {
        const has = (record?.links ?? []).some((l) => l.type === a.action) || (input.offeredLinks ?? []).some((l) => l.type === a.action);
        if (!has) flags.push(`the action uses the job's ${LINK_WORDS[a.action] ?? a.action} link, which the job does not have yet: add it under Important Links, or the button has nothing to open`);
      }
      const entry: UpdateRecord = {
        id: randomUUID(), date, type, title: a.title.trim(), description: text,
        ...(head.sourceLink ? { sourceUrl: head.sourceLink } : {}),
        ...(a.action ? { action: a.action as UpdateRecord["action"] } : {}),
        ...(until ? { relevantUntil: until } : {}),
        event: { kind, ...(stage ? { stage } : {}) },
      };
      added = { op: "ADD", origin: "TEXT", entry, basis };
      addedItem = itemFor(added, claim(a.quote), flags, tick);
    }
  } else if (!correction && record?.publishedAt && input.stages) {
    // No Announcement block on a public job whose stages change: the announcement the stage editor would write.
    const auto = stageChangeEntries(record.examStages, input.stages, head.sourceDate ?? input.today);
    if (auto.length) {
      const first = auto[0];
      const entry: UpdateRecord = { id: randomUUID(), ...first, ...(head.sourceLink ? { sourceUrl: head.sourceLink } : {}) };
      const flags = ["written from the stage changes, as the stage editor does on a public job; saved only with the stage changes ticked"];
      // Several stages change (R1): one automatic announcement would speak for only the first, so it is never
      // ticked on its own. It waits under "Needs attention" until the owner ticks it knowingly, or GPT writes one
      // Announcement block covering the whole update.
      const several = auto.length > 1;
      if (several) flags.unshift(`needs attention: ${auto.length} stages change, but this announcement covers only “${first.title}”. Not ticked. Ask GPT for one Announcement block covering ${auto.map((e) => `“${e.title}”`).join(", ")}, or tick this to announce only the first`);
      added = { op: "ADD", origin: "STAGES", entry, basis };
      addedItem = itemFor(added, [], flags, !several);
      if (several) addedItem.attention = true;
    }
  } else if (correction && input.stages && record?.publishedAt) {
    say("a correction: the stage changes are saved quietly, with no announcement");
  }

  if (added && addedItem) {
    const e = added.entry;
    const same = list.find((u) => !u.superseded && u.date === e.date && squash(u.title) === squash(e.title) && squash(u.description) === squash(e.description));
    if (same) {
      addedItem.action = "MATCHES";
      addedItem.defaultTicked = false;
      addedItem.flags.push("already on the job, word for word: nothing to add");
    } else {
      const dups = likelyDuplicates({ date: e.date, title: e.title, description: e.description }, list);
      if (dups.length) {
        addedItem.defaultTicked = false;
        for (const d of dups) addedItem.flags.push(`probably already on the job: “${d.entry.title}” (${d.entry.date}), ${d.why}. Not ticked; supersede the old one if this replaces it`);
      }
    }
    if (unsure && addedItem.defaultTicked) { addedItem.defaultTicked = false; addedItem.flags.push("not ticked: check first that the text is about this job"); }
    out.items.push(addedItem);
  }

  // ── Supersessions.
  for (const s of reading.supersede) {
    const named = `“${s.title}”${s.date ? ` (${s.date})` : ""}`;
    if (s.problems.length) { say(`${named} is not offered for superseding: ${s.problems.join("; ")}`); continue; }
    const hits = findAnnouncement(list, s.date, s.title);
    if (hits.length === 0) { say(`${named} is not among the job's announcements${s.date ? " on that date" : ""}; nothing is superseded`); continue; }
    if (hits.length > 1) { say(`${named} could be any of ${hits.map((h) => `“${h.title}” (${h.date})`).join(", ")}; nothing is superseded. Use the job's own Supersede button to choose`); continue; }
    const target = hits[0];
    const flags: string[] = [];
    if (squash(target.title) !== squash(s.title)) flags.push(`matched by most of its title: “${target.title}”`);
    let replacedBy: string | undefined;
    let replacedByNew = false;
    if (s.replacedBy) {
      if (added && added.origin === "TEXT" && squash(s.replacedBy) === squash(added.entry.title)) replacedByNew = true;
      else {
        const r = findAnnouncement(list.filter((u) => !u.superseded && u.id !== target.id), undefined, s.replacedBy);
        if (r.length === 1) replacedBy = r[0].id;
        else flags.push(`“Replaced by: ${s.replacedBy}” is not ${r.length ? "one single" : "an"} announcement of the job; the official notice is given instead`);
      }
    }
    const sourceUrl = s.sourceUrl ?? head.sourceLink;
    const value: SupersedeAnnouncement = {
      op: "SUPERSEDE", targetId: target.id, target: { date: target.date, title: target.title }, reason: (s.reason ?? "").slice(0, MAX_REASON),
      ...(replacedBy ? { replacedBy } : {}), ...(replacedByNew ? { replacedByNew } : {}), ...(sourceUrl ? { sourceUrl } : {}), basis,
    };
    if (!replacedBy && !replacedByNew && !sourceUrl) { say(`${named}: say what replaces it (a newer announcement, or “Source: https://…”); nothing is superseded`); continue; }
    if (replacedByNew && !sourceUrl) flags.push("replaced by this update's new announcement: tick both, or it cannot be saved");
    else if (replacedByNew) flags.push("replaced by this update's new announcement; if that one is not ticked, the official notice is given instead");
    const item = itemFor(value, claim(s.quote), flags, !unsure);
    if (target.superseded) { item.action = "MATCHES"; item.defaultTicked = false; item.flags.push(`already superseded on ${target.superseded.on}: nothing to change`); }
    if (unsure && !target.superseded) item.flags.push("not ticked: check first that the text is about this job");
    out.items.push(item);
  }
  return out;
}

function itemFor(value: AnnouncementValue, claims: ProposalItem["claims"], flags: string[], tick: boolean): ProposalItem {
  const add = value.op === "ADD";
  return {
    id: add ? `a:new:${value.entry.id.slice(0, 8)}` : `a:sup:${value.targetId}`,
    kind: "ANNOUNCEMENT",
    fieldPath: add ? ANNOUNCEMENT_PATH : supersedePath(value.targetId),
    label: add ? (value.origin === "STAGES" ? "New announcement (from the stage changes)" : "New announcement") : "Mark an announcement superseded",
    value,
    claims,
    action: add ? "FILL" : "REPLACE",
    conflict: false,
    supersedes: [],
    defaultTicked: tick,
    flags: [...flags, add ? "goes live only with your reviewed publish; never sent to Telegram from here" : "kept word for word in the job's history; no longer shown as current after your reviewed publish"],
    ...(add ? {} : { current: { date: value.target.date, title: value.target.title } }),
  };
}

// ─── Saving ───────────────────────────────────────────────

export interface AnnouncementWrite { after: UpdateRecord[]; done: string[]; nothingToDo: boolean }

/**
 * The job's announcement list after the ticked announcement items, worked out with the existing supersede rules,
 * or why it cannot be saved. Safe to run again: an announcement already added, or one already superseded, is
 * left as it is (a save repeated after a failure adds nothing twice).
 */
export function announcementWrite(
  before: readonly UpdateRecord[],
  chosen: AnnouncementValue[],
  opts: { adminId: string; today: string; stagesTicked: boolean },
): { ok: true; write: AnnouncementWrite } | { ok: false; error: string } {
  const adds = chosen.filter((c): c is AddAnnouncement => c.op === "ADD");
  const sups = chosen.filter((c): c is SupersedeAnnouncement => c.op === "SUPERSEDE");
  if (adds.length > 1) return { ok: false, error: "An update carries at most one new announcement." };
  const add = adds[0];
  const already = (!add || before.some((u) => u.id === add.entry.id))
    && sups.every((s) => before.find((u) => u.id === s.targetId)?.superseded);
  if (chosen.length > 0 && already) return { ok: true, write: { after: [...before], done: [], nothingToDo: true } };
  if (chosen.some((c) => c.basis !== updatesFingerprint(before))) {
    return { ok: false, error: "The job's announcements changed after this preview was made. Make a new preview." };
  }
  if (add?.origin === "STAGES" && !opts.stagesTicked) {
    return { ok: false, error: "The announcement written from the stage changes needs the exam stages ticked too (or untick the announcement)." };
  }
  let list: UpdateRecord[] = [...before];
  const done: string[] = [];
  if (add) { list = [...list, add.entry]; done.push(`added “${add.entry.title}”`); }
  for (const s of sups) {
    const replacedBy = s.replacedByNew ? (add ? add.entry.id : undefined) : s.replacedBy;
    if (s.replacedByNew && !add && !s.sourceUrl) return { ok: false, error: `“${s.target.title}” is replaced by this update's new announcement: tick that one too.` };
    const r = supersede(list, { ids: [s.targetId], reason: s.reason, replacedBy, sourceUrl: s.sourceUrl, on: opts.today, by: opts.adminId });
    if (!r.ok) return { ok: false, error: `“${s.target.title}”: ${r.error}` };
    list = r.list;
    done.push(`superseded “${s.target.title}”`);
  }
  return { ok: true, write: { after: list, done, nothingToDo: done.length === 0 } };
}
