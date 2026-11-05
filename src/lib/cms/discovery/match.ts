// ═══════════════════════════════════════════════════════════
// Discovery: which CMS job a lead may be (N2)
// ═══════════════════════════════════════════════════════════
//
// Pure. Compared with the CMS's own recruitments (never the retired static
// dataset). Reasons are kept so the admin sees why:
//   DUPLICATE  the same notice number as a job of the same organisation
//   STRONG     the same notice number with the organisation not recognised, or
//              the same organisation and year with titles that name the same exam
//   POSSIBLE   titles that agree without the organisation or the exam confirming
//              it, or the same notice number under another organisation: for review
//   NONE       no job like it; UNRESOLVED when the organisation is not recognised
// A title alone never makes a DUPLICATE or STRONG match.

import { similarJobs } from "@/lib/cms/importer/discover";

export type MatchKind = "DUPLICATE" | "STRONG" | "POSSIBLE" | "NONE" | "UNRESOLVED";

export interface CmsJob { id: string; organizationId: string; organizationName?: string | null; title: string; notificationNumber: string | null; year: number | null }
export interface LeadForMatch { organizationId: string | null; organizationName?: string | null; title: string; notificationNumber: string | null }
export interface MatchCandidate { id: string; title: string; kind: Exclude<MatchKind, "NONE" | "UNRESOLVED">; reason: string }
export interface LeadMatch { kind: MatchKind; recruitmentId: string | null; reason: string | null; confidence: number | null; candidates: MatchCandidate[] }

const RANK: Record<MatchCandidate["kind"], number> = { DUPLICATE: 3, STRONG: 2, POSSIBLE: 1 };
const CONFIDENCE: Record<MatchCandidate["kind"], number> = { DUPLICATE: 0.95, STRONG: 0.75, POSSIBLE: 0.4 };

import { noticeKey } from "@/lib/cms/discovery/notice";
export { noticeKey };

// ── Which exam a title names ──
// Same organisation, same year and a few shared words are not the same exam: "IBPS RRB XV 2026 Corrigendum" and
// "IBPS PO/MT XV 2026" share "IBPS" and "XV" and nothing else. A title's exam words are what is left once the
// organisation's own words, years, the words every notice uses (result, corrigendum, recruitment…) and cycle
// markers (XV, 71st) are taken out. Two titles name the same exam when neither has an exam word the other lacks
// (an abbreviation counts for the words it stands for: "CCE" for "Combined Competitive Exam"), and their cycles,
// where both give one, agree. No list of exam names is involved.
const NOTICE_WORDS = new Set(("recruitment notification notice result declared admit card hall ticket call letter corrigendum addendum " +
  "extended extension last date apply online form out exam examination post vacancy released revised schedule city intimation " +
  "answer key cut off merit list final provisional official website download link update new the for of and in to on advt no " +
  "now check details pdf application registration started start begin begins reopened reopen notified detailed short through via " +
  "regarding about important latest").split(" ").map((w) => w.replace(/s$/, "")));
const ROMAN = /^(?:x{1,3}(?:ix|iv|v?i{0,3})|ix|iv|v|v?i{1,3})$/;
const CYCLE = (t: string) => ROMAN.test(t) || /^\d+(?:st|nd|rd|th)$/.test(t) || /^\d{1,3}$/.test(t);

interface ExamWords { identity: Set<string>; cycles: Set<string>; runs: Array<{ initials: string; words: string[] }> }
function examWords(title: string, orgWords: Set<string>): ExamWords {
  const raw = title.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, ""));
  const identity = new Set<string>(), cycles = new Set<string>();
  const kept: string[] = []; // words an abbreviation can stand for: everything but years, cycles and the organisation
  for (const w of raw) {
    if (/^(?:19|20)\d{2}$/.test(w) || orgWords.has(w)) continue;
    if (CYCLE(w)) { cycles.add(w); continue; }
    kept.push(w);
    if (!NOTICE_WORDS.has(w) && w.length > 1) identity.add(w);
  }
  const runs: ExamWords["runs"] = [];
  for (let i = 0; i < kept.length; i++) for (let n = 2; n <= 4 && i + n <= kept.length; n++) runs.push({ initials: kept.slice(i, i + n).map((w) => w[0]).join(""), words: kept.slice(i, i + n) });
  return { identity, cycles, runs };
}

/** Whether two titles of the same organisation name the same exam; when not, why. */
export function sameExam(leadTitle: string, jobTitle: string, orgWords: Set<string>): { same: boolean; why?: string } {
  const a = examWords(leadTitle, orgWords), b = examWords(jobTitle, orgWords);
  if (a.identity.size === 0) return { same: false, why: "the lead's title names no exam, only the organisation and the kind of notice" };
  const covered = (x: ExamWords, y: ExamWords) => {
    const out = new Set<string>();
    for (const w of x.identity) if (y.identity.has(w) || y.runs.some((r) => r.initials === w)) out.add(w);
    // x's words that an abbreviation in y stands for
    for (const r of x.runs) if (y.identity.has(r.initials)) for (const w of r.words) out.add(w);
    return out;
  };
  const coveredA = covered(a, b), coveredB = covered(b, a);
  const onlyA = [...a.identity].filter((w) => !coveredA.has(w)), onlyB = [...b.identity].filter((w) => !coveredB.has(w));
  if (onlyA.length && onlyB.length) return { same: false, why: `the titles name different exams (“${onlyA.join(" ")}” / “${onlyB.join(" ")}”)` };
  if (a.cycles.size && b.cycles.size && ![...a.cycles].some((c) => b.cycles.has(c))) return { same: false, why: `the titles give different cycles (${[...a.cycles].join(", ")} / ${[...b.cycles].join(", ")})` };
  if (onlyA.length === a.identity.size) return { same: false, why: "no exam word of the lead is in this job's title" };
  return { same: true };
}

const orgWordsOf = (...names: Array<string | null | undefined>) =>
  new Set(names.flatMap((n) => (n ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)).filter((w) => w.length > 1).map((w) => w.replace(/s$/, "")));

export function matchLead(lead: LeadForMatch, jobs: CmsJob[]): LeadMatch {
  const key = noticeKey(lead.notificationNumber);
  const year = /\b20\d{2}\b/.exec(lead.title)?.[0];
  const candidates: MatchCandidate[] = [];
  for (const job of jobs) {
    const sameOrg = !!lead.organizationId && job.organizationId === lead.organizationId;
    const jobKey = noticeKey(job.notificationNumber);
    if (key && jobKey === key) {
      candidates.push(sameOrg
        ? { id: job.id, title: job.title, kind: "DUPLICATE", reason: `same notice number (${job.notificationNumber}) as this job` }
        : lead.organizationId
          ? { id: job.id, title: job.title, kind: "POSSIBLE", reason: `same notice number (${job.notificationNumber}), but this job is another organisation's` }
          : { id: job.id, title: job.title, kind: "STRONG", reason: `same notice number (${job.notificationNumber}); the lead's organisation was not recognised` });
      continue;
    }
    // The job's year counts when its title leaves it out.
    const jobTitle = job.year && year && !job.title.includes(year) && String(job.year) === year ? `${job.title} ${job.year}` : job.title;
    if (similarJobs(lead.title, [{ id: job.id, title: jobTitle }]).length === 0) continue;
    // Strong only when the titles also name the same exam; otherwise the admin chooses, told why.
    const exam = sameOrg && year ? sameExam(lead.title, job.title, orgWordsOf(lead.organizationId, lead.organizationName, job.organizationId, job.organizationName)) : null;
    candidates.push(sameOrg && year && exam?.same
      ? { id: job.id, title: job.title, kind: "STRONG", reason: `same organisation and year (${year}), and the titles name the same exam` }
      : { id: job.id, title: job.title, kind: "POSSIBLE", reason: lead.organizationId
        ? (sameOrg ? (year ? `same organisation and year (${year}), but ${exam?.why ?? "the exam is not confirmed"}` : "same organisation and the titles agree, but no year to confirm it") : "the titles agree, but this job is another organisation's")
        : "the titles agree; the lead's organisation was not recognised" });
  }
  candidates.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
  const top = candidates.slice(0, 5);
  const best = top[0];
  if (!best) return { kind: lead.organizationId ? "NONE" : "UNRESOLVED", recruitmentId: null, reason: lead.organizationId ? null : "organisation not recognised; no CMS job like it", confidence: null, candidates: [] };
  // Two different jobs both "strong" or both "duplicate": none is chosen, the admin decides.
  const tied = top.filter((c) => c.kind === best.kind && c.id !== best.id);
  if (tied.length > 0 && best.kind !== "POSSIBLE") {
    return { kind: "POSSIBLE", recruitmentId: null, reason: `${tied.length + 1} CMS jobs match as well as each other — choose the right one`, confidence: CONFIDENCE.POSSIBLE, candidates: top };
  }
  // A possible match names its job too, for the admin to confirm or reject; it is never treated as the job.
  const possibles = top.filter((c) => c.kind === "POSSIBLE");
  if (best.kind === "POSSIBLE" && possibles.length > 1) {
    return { kind: "POSSIBLE", recruitmentId: null, reason: `${possibles.length} CMS jobs may be this one — choose the right one`, confidence: CONFIDENCE.POSSIBLE, candidates: top };
  }
  return { kind: best.kind, recruitmentId: best.id, reason: best.reason, confidence: CONFIDENCE[best.kind], candidates: top };
}
