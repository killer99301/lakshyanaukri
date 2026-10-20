// ═══════════════════════════════════════════════════════════
// Checks before publishing: values that contradict each other
// ═══════════════════════════════════════════════════════════
//
// Pure. The publish checklist says whether things are filled; this says
// whether what is filled hangs together: a last date before the opening
// date, vacancies that do not add up, an exam before applications close.
//
// Advice only. Nothing here blocks publishing (the one hard rule, an
// official link, lives in the publish route); a notice can be odd and still
// be right, and the admin decides.

import type { RecruitmentRecord } from "@/types/recruitment-record";
import { formatDate } from "@/lib/utils";

export type CheckLevel = "contradiction" | "warning";

export interface PrepublishCheck {
  level: CheckLevel;
  /** The editor section to open to fix it. */
  section: string;
  text: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) ? v : null);
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const show = (d: string) => formatDate(d);

export function prepublishChecks(record: RecruitmentRecord, todayIso: string): PrepublishCheck[] {
  const out: PrepublishCheck[] = [];
  const add = (level: CheckLevel, section: string, text: string) => out.push({ level, section, text });

  const d = record.dates;
  const notified = iso(d.notificationDate?.value);
  const open = iso(d.applicationOpenDate?.value);
  const close = iso(d.applicationCloseDate?.value);
  const feeBy = iso(d.feePaymentCloseDate?.value);
  const correctBy = iso(d.correctionWindowEnd?.value);

  // ── Dates against each other ──
  if (open && close && close < open) add("contradiction", "Dates", `The last date (${show(close)}) is before the opening date (${show(open)}).`);
  if (notified && open && open < notified) add("warning", "Dates", `Applications open (${show(open)}) before the notification date (${show(notified)}).`);
  if (feeBy && open && feeBy < open) add("contradiction", "Dates", `The fee deadline (${show(feeBy)}) is before applications open (${show(open)}).`);
  if (feeBy && close && days(close, feeBy) > 30) add("warning", "Dates", `The fee deadline (${show(feeBy)}) is more than a month after the last date (${show(close)}).`);
  if (correctBy && close && correctBy < close) add("warning", "Dates", `The correction window ends (${show(correctBy)}) before applications close (${show(close)}).`);
  if (close && close < todayIso) add("warning", "Dates", `The last date (${show(close)}) has already passed. The job will show as closed.`);

  // ── Exam stages against the application window ──
  for (const stage of record.examStages ?? []) {
    const when = iso(stage.dateIso);
    if (!when || !close) continue;
    if (when < close && (stage.status === "SCHEDULED" || stage.status === "ADMIT_CARD_OUT")) {
      add("warning", "Exam Stages", `“${stage.name}” is dated ${show(when)}, before applications close (${show(close)}).`);
    }
  }
  for (const stage of record.examStages ?? []) {
    if (stage.status === "SCHEDULED" && !stage.dateIso && !stage.dateDisplay) {
      add("warning", "Exam Stages", `“${stage.name}” is marked scheduled but has no date.`);
    }
  }

  // ── Vacancies ──
  const total = typeof record.vacancies.total?.value === "number" ? record.vacancies.total.value : null;
  const rows = record.vacancies.breakdown?.value ?? [];
  if (total !== null && rows.length > 0) {
    const sum = rows.reduce((n, r) => n + (typeof r.count === "number" ? r.count : 0), 0);
    if (sum > 0 && sum !== total) add("warning", "Vacancies", `The posts in the breakdown add up to ${sum.toLocaleString("en-IN")}, but the total says ${total.toLocaleString("en-IN")}.`);
  }
  if (total === 0) add("warning", "Vacancies", "The total number of posts is 0.");

  // ── Age ──
  const age = record.age?.value;
  if (age) {
    if (typeof age.min === "number" && typeof age.max === "number" && age.min > age.max) {
      add("contradiction", "Age", `The minimum age (${age.min}) is above the maximum (${age.max}).`);
    }
    if (typeof age.max === "number" && (age.max < 16 || age.max > 70)) add("warning", "Age", `A maximum age of ${age.max} is unusual. Check the notice.`);
    const hasLimit = typeof age.min === "number" || typeof age.max === "number" || (age.postWise ?? []).length > 0;
    const counted = iso(age.asOf);
    if (hasLimit && !counted && !age.bornFrom && !age.bornTo) {
      add("warning", "Age", "No date is given for when age is counted, so the age checker and the eligibility finder cannot give an answer for this job.");
    }
    const anchor = close ?? open ?? notified;
    if (counted && anchor && Math.abs(days(anchor, counted)) > 400) {
      add("warning", "Age", `Age is counted on ${show(counted)}, more than a year from the application dates. Check it is this cycle's date.`);
    }
  }

  // ── Fees ──
  const general = record.financial.feeGeneral?.value;
  const reserved = record.financial.feeSCST?.value;
  if (typeof general === "number" && typeof reserved === "number" && reserved > general) {
    add("warning", "Financial", `The fee for SC/ST/PwBD (₹${reserved}) is higher than for General/OBC (₹${general}).`);
  }

  // ── Links ──
  const hasApply = record.links.some((l) => l.type === "APPLY_ONLINE");
  if (!hasApply && close && close >= todayIso) add("warning", "Links", "There is no “Apply Online” link while applications are open.");

  // ── Listing details: the filters and the eligibility finder read these ──
  const cls = record.classification;
  const missing = [!cls?.qualification && "qualification", !cls?.category && "category", !cls?.state && "state"].filter(Boolean) as string[];
  if (missing.length > 0) {
    add("warning", "Identity", `Listing details have no ${missing.join(", ")}, so the job will not appear under ${missing.length === 1 ? "that filter" : "those filters"}${missing.includes("qualification") ? " and the eligibility finder cannot judge it" : ""}.`);
  }

  // ── The title against the recruitment year ──
  const title = record.identity.title?.value ?? "";
  const years = [...title.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.length > 0 && !years.includes(record.identity.recruitmentYear) && !years.includes(record.identity.recruitmentYear - 1)) {
    add("warning", "Identity", `The title says ${years.join(", ")} but the recruitment year is ${record.identity.recruitmentYear}.`);
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "contradiction" ? -1 : 1));
}
