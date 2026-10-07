// ═══════════════════════════════════════════════════════════
// "Needs attention": what on a live job is due, overdue or going stale
// ═══════════════════════════════════════════════════════════
//
// Pure. Works only from what is on the record and today's date: closing
// dates, stage dates, stage status and which links exist. It never looks at
// an outside site, and it never changes a record. Every item is a prompt for
// the admin to go and check the official source.
//
// Only jobs the public can see are considered: a record that has been
// published at least once and is not archived. Never-published drafts are
// left out (they include old test records that must stay unpublished).

import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { ExamStage } from "@/types";
import { formatDate } from "@/lib/utils";

export type AttentionLevel = "NOW" | "SOON" | "CHECK";

export interface AttentionItem {
  level: AttentionLevel;
  /** Stable key for the rule, for tests and for telling items apart. */
  code:
    | "EDITS_NOT_LIVE" | "CLOSES_SOON" | "CLOSED_NO_NEXT_STAGE" | "EXAM_NEAR_NO_ADMIT_CARD" | "STAGE_DATE_PASSED"
    | "TENTATIVE_DATE_NEAR" | "POSTPONED_NO_DATE" | "RESULT_MAY_BE_OUT" | "RESULT_DATE_PASSED" | "NOT_LOOKED_AT";
  message: string;
}

export interface JobAttention {
  id: string;
  slug: string;
  title: string;
  organizationName: string;
  items: AttentionItem[];
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const dayNumber = (iso: string | null | undefined): number | null => {
  const m = iso ? ISO_DAY.exec(iso) : null;
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : null;
};

/** Today's calendar date in India, as "YYYY-MM-DD". */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const ago = (n: number) => (n === 1 ? "yesterday" : `${n} days ago`);

const LEVEL_ORDER: Record<AttentionLevel, number> = { NOW: 0, SOON: 1, CHECK: 2 };
const OPEN_STAGE = new Set(["NOT_DECLARED", "SCHEDULED", "ADMIT_CARD_OUT"]);

export function isLive(record: RecruitmentRecord): boolean {
  return Boolean(record.publishedAt) && record.draftState !== "ARCHIVED";
}

export function attentionFor(record: RecruitmentRecord, todayIso: string): AttentionItem[] {
  const today = dayNumber(todayIso);
  if (today == null || !isLive(record)) return [];
  const items: AttentionItem[] = [];
  const add = (level: AttentionLevel, code: AttentionItem["code"], message: string) => items.push({ level, code, message });

  const stages: ExamStage[] = [...(record.examStages ?? [])].sort((a, b) => a.order - b.order);
  const hasLink = (type: string) => record.links.some((l) => l.type === type);
  const updated = dayNumber(record.updatedAt);

  // Saved changes the public cannot see yet.
  if (record.draftState !== "PUBLISHED" && updated != null && today - updated >= 1) {
    add("NOW", "EDITS_NOT_LIVE", `Changes saved ${ago(today - updated)} are not published. The public still sees the older version.`);
  }

  // The application window.
  const closeIso = record.dates.applicationCloseDate?.value ?? null;
  const close = dayNumber(closeIso);
  const stageAhead = stages.some((s) => {
    const d = dayNumber(s.dateIso);
    return (d != null && d >= today) || s.status === "ADMIT_CARD_OUT" || (s.status === "SCHEDULED" && d == null && Boolean(s.dateDisplay));
  });
  const legacyAhead = [record.dates.examDate, record.dates.prelimsDate, record.dates.mainsDate, record.dates.interviewDate]
    .some((f) => { const d = dayNumber(f?.value); return d != null && d >= today; });
  // A stage the record already says something about: dated, or past "not declared".
  const anyStageKnown = stages.some((s) => Boolean(s.dateIso) || Boolean(s.dateDisplay) || s.status !== "NOT_DECLARED");
  const anyLegacyDate = [record.dates.examDate, record.dates.prelimsDate, record.dates.mainsDate, record.dates.interviewDate]
    .some((f) => dayNumber(f?.value) != null);

  if (close != null && close >= today && close - today <= 3) {
    add("SOON", "CLOSES_SOON", `Applications close ${inDays(close - today)} (${formatDate(closeIso!)}). Check the official site for an extension.`);
  }
  if (close != null && close < today && !anyStageKnown && !anyLegacyDate) {
    add("CHECK", "CLOSED_NO_NEXT_STAGE", `Applications closed on ${formatDate(closeIso!)} and no exam or next stage is dated yet. Add it when it is announced.`);
  }

  // Each stage, by its own date and status.
  let lastConducted: { stage: ExamStage; day: number } | null = null;
  for (const stage of stages) {
    const d = dayNumber(stage.dateIso);
    const when = stage.dateIso ? formatDate(stage.dateIso) : stage.dateDisplay ?? "";

    if (stage.status === "POSTPONED" && (d == null || d < today)) {
      add("CHECK", "POSTPONED_NO_DATE", `${stage.name} is marked postponed with no new date. Watch for the revised schedule.`);
      continue;
    }
    if (d == null) continue;

    if (OPEN_STAGE.has(stage.status) && d < today) {
      add(today - d <= 7 ? "NOW" : "SOON", "STAGE_DATE_PASSED", `${stage.name} was dated ${when} (${ago(today - d)}) and is not marked as held. Mark it conducted, or correct the date if it moved.`);
      continue;
    }
    if (OPEN_STAGE.has(stage.status) && d - today <= 14) {
      if (stage.status !== "ADMIT_CARD_OUT" && !hasLink("ADMIT_CARD")) {
        add(d - today <= 7 ? "NOW" : "SOON", "EXAM_NEAR_NO_ADMIT_CARD", `${stage.name} is ${inDays(d - today)} (${when}) and there is no admit card link. Check whether the admit card or city slip is out.`);
      }
    }
    if (OPEN_STAGE.has(stage.status) && stage.certainty === "TENTATIVE" && d >= today && d - today <= 21) {
      add("SOON", "TENTATIVE_DATE_NEAR", `${stage.name} is ${inDays(d - today)} (${when}) but the date is still marked tentative. Confirm it against the official notice.`);
    }
    if (stage.status === "CONDUCTED") lastConducted = { stage, day: d };
    if (stage.status === "RESULT_DECLARED") lastConducted = null;
  }

  // An exam held a while ago with no result recorded after it.
  if (lastConducted && today - lastConducted.day >= 30 && !stageAhead) {
    add("CHECK", "RESULT_MAY_BE_OUT", `${lastConducted.stage.name} was held ${days(today - lastConducted.day)} ago and no result is recorded. Check whether the result or answer key is out.`);
  }

  const resultIso = record.dates.resultDate?.value ?? null;
  const result = dayNumber(resultIso);
  if (result != null && result <= today && !hasLink("RESULT") && !stages.some((s) => s.status === "RESULT_DECLARED")) {
    add("SOON", "RESULT_DATE_PASSED", `The result was dated ${formatDate(resultIso!)} and there is no result link. Check whether it is out.`);
  }

  // Still running, but nobody has touched it for three weeks.
  const stillRunning = (close != null && close >= today) || stageAhead || legacyAhead;
  if (stillRunning && items.length === 0 && updated != null && today - updated >= 21) {
    add("CHECK", "NOT_LOOKED_AT", `Not updated for ${days(today - updated)}. Look at the official site for a corrigendum or a date change.`);
  }

  return items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** Every live job with something to look at, most pressing first. */
export function buildAttentionList(records: RecruitmentRecord[], todayIso: string): JobAttention[] {
  const out: JobAttention[] = [];
  for (const record of records) {
    const items = attentionFor(record, todayIso);
    if (items.length === 0) continue;
    out.push({
      id: record.id,
      slug: record.slug,
      title: record.identity.shortTitle?.value || record.identity.title.value || record.slug,
      organizationName: record.identity.organizationName,
      items,
    });
  }
  return out.sort((a, b) => LEVEL_ORDER[a.items[0].level] - LEVEL_ORDER[b.items[0].level] || a.title.localeCompare(b.title));
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The morning message. "Now" and "soon" items are written out; "check when
 * free" items are only counted, so a quiet day reads as quiet.
 */
export function buildAttentionDigest(list: JobAttention[], todayIso: string, liveCount: number, adminUrl: string): string {
  const lines: string[] = [`<b>LakshyaNaukri — ${formatDate(todayIso)}</b>`];
  const pressing = list.map((job) => ({ job, items: job.items.filter((i) => i.level !== "CHECK") })).filter((x) => x.items.length > 0);
  const checkCount = list.reduce((n, job) => n + job.items.filter((i) => i.level === "CHECK").length, 0);

  if (pressing.length === 0) {
    lines.push("", `Nothing pressing today across ${liveCount} live job${liveCount === 1 ? "" : "s"}.`);
  } else {
    for (const { job, items } of pressing.slice(0, 15)) {
      lines.push("", `<b>${escapeHtml(job.title)}</b>`);
      for (const item of items) lines.push(`${item.level === "NOW" ? "🔴" : "🟡"} ${escapeHtml(item.message)}`);
    }
    if (pressing.length > 15) lines.push("", `…and ${pressing.length - 15} more jobs in the admin.`);
  }
  if (checkCount > 0) lines.push("", `${checkCount} more to check when free.`);
  lines.push("", `${adminUrl}/admin/cms`);
  return lines.join("\n");
}
