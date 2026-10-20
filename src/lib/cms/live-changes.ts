// ═══════════════════════════════════════════════════════════
// What publishing again would change on the live page
// ═══════════════════════════════════════════════════════════
//
// Pure. A live job reopened for editing keeps serving its last published
// snapshot. Before it is republished, this lists every difference between
// that snapshot and what the edited record would publish, in plain words:
//
//   Last date: 20 Oct 2026 → 26 Oct 2026
//   Vacancies: 500 → 650
//   Exam stage “Tier 1”: Not declared → Scheduled, 15 Dec 2026
//
// Both sides are projections (the same shape the public page reads), so a
// value that only differs in how it is stored inside the record never shows
// as a change. Bookkeeping (revision, projection time) is ignored.

import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";
import type { ExamStage, UpdateRecord } from "@/types";
import type { AgeCriteria, CmsRecruitmentPost, CmsSelectionInformation, ExamPatternPaper, SyllabusSubject } from "@/types/recruitment-record";
import { formatDate } from "@/lib/utils";
import { compareWithLibrary } from "@/lib/cms/library-compare";

export interface LiveChange {
  /** The editor section where the value lives. */
  section: string;
  label: string;
  before: string;
  after: string;
}

const NONE = "—";
const text = (v: unknown): string => (v === null || v === undefined || v === "" ? NONE : String(v));
const date = (v: string | null | undefined): string => (v ? formatDate(v) : NONE);
const money = (v: number | null, notSpecified?: boolean): string => (notSpecified ? "Not specified" : v === null ? NONE : v === 0 ? "Nil" : `₹${v.toLocaleString("en-IN")}`);
const key = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const DATE_LABELS: Array<[keyof PublishedRecruitmentSnapshot["dates"], string]> = [
  ["notificationDate", "Notification date"],
  ["applicationOpenDate", "Applications open"],
  ["applicationCloseDate", "Last date"],
  ["feePaymentCloseDate", "Fee payment deadline"],
  ["correctionWindowEnd", "Correction window ends"],
  ["examDate", "Exam date"],
  ["prelimsDate", "Prelims date"],
  ["mainsDate", "Mains date"],
  ["admitCardDate", "Admit card date"],
  ["resultDate", "Result date"],
  ["interviewDate", "Interview date"],
  ["documentVerificationDate", "Document verification date"],
  ["joiningDate", "Joining date"],
];

const STATUS: Record<string, string> = {
  NOT_DECLARED: "Not declared", SCHEDULED: "Scheduled", ADMIT_CARD_OUT: "Admit card released",
  POSTPONED: "Postponed", CONDUCTED: "Held", RESULT_DECLARED: "Result declared",
};
const stageText = (s: ExamStage | undefined): string =>
  s ? [STATUS[s.status] ?? s.status, s.dateDisplay || (s.dateIso ? formatDate(s.dateIso) : ""), s.certainty === "TENTATIVE" ? "tentative" : ""].filter(Boolean).join(", ") : "Not on the page";

function ageText(a: AgeCriteria | null | undefined): string {
  if (!a) return NONE;
  const range = typeof a.min === "number" || typeof a.max === "number" ? `${a.min ?? "?"}–${a.max ?? "?"} years` : "";
  const counted = a.asOf ? `counted on ${formatDate(a.asOf)}` : "";
  const born = a.bornFrom || a.bornTo ? `born ${a.bornFrom ? formatDate(a.bornFrom) : "…"} to ${a.bornTo ? formatDate(a.bornTo) : "…"}` : "";
  const relax = (a.relaxations ?? []).map((r) => `${r.category} +${r.years}`).join(", ");
  const posts = (a.postWise ?? []).length > 0 ? `${a.postWise!.length} posts with their own range` : "";
  return [range, counted, born, posts, relax && `relaxation: ${relax}`].filter(Boolean).join("; ") || NONE;
}

function postLines(posts: unknown): Map<string, { name: string; line: string }> {
  const out = new Map<string, { name: string; line: string }>();
  for (const p of (Array.isArray(posts) ? posts : []) as CmsRecruitmentPost[]) {
    const name = p.post ?? "";
    out.set(key(name) || `#${out.size + 1}`, { name, line: (p.qualification ?? []).join(" / ") || NONE });
  }
  return out;
}

export function liveChanges(live: PublishedRecruitmentSnapshot, next: PublishedRecruitmentSnapshot): LiveChange[] {
  const out: LiveChange[] = [];
  const add = (section: string, label: string, before: string, after: string) => {
    if (before !== after) out.push({ section, label, before, after });
  };

  // ── Basic info ──
  add("Identity", "Title", text(live.title), text(next.title));
  add("Identity", "Short title", text(live.shortTitle), text(next.shortTitle));
  add("Identity", "Notification number", text(live.notificationNumber), text(next.notificationNumber));
  add("Identity", "Advertisement number", text(live.advertisementNumber), text(next.advertisementNumber));
  for (const [k, label] of [["qualification", "Listed qualification"], ["category", "Category"], ["state", "State"], ["shortDescription", "Short description"]] as const) {
    add("Identity", label, text(live.classification?.[k]), text(next.classification?.[k]));
  }

  // ── Dates ──
  for (const [k, label] of DATE_LABELS) add("Dates", label, date(live.dates?.[k]), date(next.dates?.[k]));

  // ── Vacancies ──
  add("Vacancies", "Vacancies", text(live.vacancies?.total?.toLocaleString("en-IN")), text(next.vacancies?.total?.toLocaleString("en-IN")));
  const rows = (b: unknown[] | null | undefined) => new Map((Array.isArray(b) ? b : []).map((r) => {
    const row = r as { post?: string; count?: number };
    return [key(row.post), { name: row.post ?? "", count: `${row.count ?? "?"}` }] as const;
  }));
  const beforeRows = rows(live.vacancies?.breakdown);
  const afterRows = rows(next.vacancies?.breakdown);
  for (const [k, row] of afterRows) add("Vacancies", `Posts — ${row.name}`, beforeRows.get(k)?.count ?? "Not on the page", row.count);
  for (const [k, row] of beforeRows) if (!afterRows.has(k)) add("Vacancies", `Posts — ${row.name}`, row.count, "Removed");

  // ── Fees and pay ──
  add("Financial", "Fee (General / OBC)", money(live.financial?.feeGeneral ?? null, live.financial?.feeGeneralNotSpecified), money(next.financial?.feeGeneral ?? null, next.financial?.feeGeneralNotSpecified));
  add("Financial", "Fee (SC / ST / PwBD)", money(live.financial?.feeSCST ?? null, live.financial?.feeSCSTNotSpecified), money(next.financial?.feeSCST ?? null, next.financial?.feeSCSTNotSpecified));
  add("Financial", "Pay scale", text(live.financial?.payScale), text(next.financial?.payScale));

  // ── Age and eligibility ──
  add("Age", "Age limit", ageText(live.age as AgeCriteria | null), ageText(next.age as AgeCriteria | null));
  const beforePosts = postLines(live.eligibility);
  const afterPosts = postLines(next.eligibility);
  for (const [k, p] of afterPosts) add("Eligibility", `Eligibility — ${p.name}`, beforePosts.get(k)?.line ?? "Not on the page", p.line);
  for (const [k, p] of beforePosts) if (!afterPosts.has(k)) add("Eligibility", `Eligibility — ${p.name}`, p.line, "Removed");

  // ── Selection, stages, pattern, syllabus ──
  const steps = (s: unknown) => {
    const info = s as CmsSelectionInformation | null;
    const names = (info?.stages ?? []).map((st) => st.name).join(" → ");
    return [names, info?.noWrittenExam ? "no written exam" : ""].filter(Boolean).join("; ") || NONE;
  };
  add("Selection", "Selection process", steps(live.selection), steps(next.selection));

  const beforeStages = new Map((live.examStages ?? []).map((s) => [key(s.name), s]));
  const afterStages = new Map((next.examStages ?? []).map((s) => [key(s.name), s]));
  for (const [k, s] of afterStages) add("Exam Stages", `Exam stage “${s.name}”`, stageText(beforeStages.get(k)), stageText(s));
  for (const [k, s] of beforeStages) if (!afterStages.has(k)) add("Exam Stages", `Exam stage “${s.name}”`, stageText(s), "Removed");

  const papers = (v: unknown) => (Array.isArray(v) ? (v as ExamPatternPaper[]) : []);
  const subjects = (v: unknown) => (Array.isArray(v) ? (v as SyllabusSubject[]) : []);
  const pattern = compareWithLibrary(
    { examPattern: papers(live.examPattern), syllabus: subjects(live.syllabus) },
    { examPattern: papers(next.examPattern), syllabus: subjects(next.syllabus) },
  );
  // compareWithLibrary speaks of "the library" and "this job"; here they are the live page and the edit.
  const reword = (line: string) => line.replace(/in the library/g, "on the live page").replace(/on this job/g, "in your edit").replace(/New on this job/g, "New in your edit").replace(/In the library but not/g, "On the live page but not");
  for (const line of pattern.pattern) out.push({ section: "Exam Pattern", label: "Exam pattern", before: "", after: reword(line) });
  for (const line of pattern.syllabus) out.push({ section: "Syllabus", label: "Syllabus", before: "", after: reword(line) });
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (papers(live.examPattern).length === 0 || papers(next.examPattern).length === 0) {
    add("Exam Pattern", "Exam pattern", papers(live.examPattern).length ? count(papers(live.examPattern).length, "paper") : NONE, papers(next.examPattern).length ? count(papers(next.examPattern).length, "paper") : NONE);
  }
  if (subjects(live.syllabus).length === 0 || subjects(next.syllabus).length === 0) {
    add("Syllabus", "Syllabus", subjects(live.syllabus).length ? count(subjects(live.syllabus).length, "subject") : NONE, subjects(next.syllabus).length ? count(subjects(next.syllabus).length, "subject") : NONE);
  }

  // ── How to apply ──
  const steps2 = (s: string[] | undefined) => (s ?? []).join(" | ");
  if (steps2(live.howToApply) !== steps2(next.howToApply)) {
    add("How to Apply", "How to apply", count((live.howToApply ?? []).length, "step"), `${count((next.howToApply ?? []).length, "step")}, reworded`);
  }

  // ── Links ──
  const links = (l: PublishedRecruitmentSnapshot["links"]) => new Map((l ?? []).map((x) => [x.url, x] as const));
  const beforeLinks = links(live.links);
  const afterLinks = links(next.links);
  for (const [url, l] of afterLinks) {
    const was = beforeLinks.get(url);
    if (!was) add("Links", `Link “${l.label}”`, "Not on the page", `${url}${l.official ? " (official)" : ""}`);
    else {
      add("Links", `Link “${l.label}”`, `${was.label}${was.official ? ", official" : ""}`, `${l.label}${l.official ? ", official" : ""}`);
    }
  }
  for (const [url, l] of beforeLinks) if (!afterLinks.has(url)) add("Links", `Link “${l.label}”`, url, "Removed");

  // ── Update entries: new ones appear in the banner and history ──
  const seen = new Set((live.updates as UpdateRecord[] ?? []).map((u) => `${u.date}|${u.title}`));
  for (const u of (next.updates as UpdateRecord[] ?? [])) {
    if (!seen.has(`${u.date}|${u.title}`)) out.push({ section: "Updates", label: "New update", before: "", after: `${formatDate(u.date)}: ${u.title}` });
  }

  return out;
}
