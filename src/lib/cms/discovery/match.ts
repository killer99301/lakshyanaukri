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
export interface LeadForMatch {
  organizationId: string | null; organizationName?: string | null; title: string; notificationNumber: string | null;
  /** A body the title names that has no ID here (the listing finder's common bodies): its like-titled jobs of other bodies are not suggested. */
  namedBody?: string | null;
}
export interface MatchCandidate { id: string; title: string; kind: Exclude<MatchKind, "NONE" | "UNRESOLVED">; reason: string }
export interface LeadMatch {
  kind: MatchKind; recruitmentId: string | null; reason: string | null; confidence: number | null; candidates: MatchCandidate[];
  /** Jobs with a like title but another notice number: shown apart, never a candidate (listing finder, 10 Nov). */
  differentNotice?: Array<{ id: string; title: string; reason: string }>;
}

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
  "regarding about important latest " +
  // The stage of a notice, not the exam (Stage 1, real pages: "Result Status of Online Preliminary Examination for CRP-SPL-XVI").
  "status preliminary prelim mains score marks stage phase tier document verification upload correction edit window").split(" ").map((w) => w.replace(/s$/, "")));
const ROMAN = /^(?:x{1,3}(?:ix|iv|v?i{0,3})|ix|iv|v|v?i{1,3})$/;
const CYCLE = (t: string) => ROMAN.test(t) || /^\d+(?:st|nd|rd|th)$/.test(t) || /^\d{1,3}$/.test(t);

/**
 * A title as its exam is compared (listing finder, SarkariResult 10 Nov): a portal's trailing "| Last Date : 13/11/2026"
 * is not part of the exam (its numbers read as cycles), "10+2" is a qualification level, and "Under Graduate" is
 * "Undergraduate".
 */
export function normaliseExamWording(title: string): string {
  return title
    .replace(/\s*\|?\s*last\s+date\b.*$/i, "")
    .replace(/\b10\s*\+\s*2\b/g, " ")
    .replace(/\bunder[\s-]+graduate\b/gi, "Undergraduate")
    .replace(/\bpost[\s-]+graduate\b/gi, "Postgraduate")
    .replace(/\s+/g, " ").trim();
}

interface ExamWords { identity: Set<string>; cycles: Set<string>; runs: Array<{ initials: string; words: string[] }> }
function examWords(title: string, orgWords: Set<string>): ExamWords {
  const raw = normaliseExamWording(title).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, ""));
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
export function sameExam(leadTitle: string, jobTitle: string, orgWords: Set<string>): { same: boolean; why?: string; shared?: number } {
  const a = examWords(leadTitle, orgWords), b = examWords(jobTitle, orgWords);
  if (a.identity.size === 0) {
    // An organisation whose name holds the post ("LIC HFL Apprentice", real CMS record) leaves neither title an exam
    // word: the same post count in both is then the evidence ("… for 232 Post" / "… for 232 Posts").
    if (b.identity.size === 0 && [...a.cycles].some((c) => /^\d{2,3}$/.test(c) && b.cycles.has(c))) return { same: true, shared: 0 };
    return { same: false, why: "the lead's title names no exam, only the organisation and the kind of notice" };
  }
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
  return { same: true, shared: coveredA.size };
}

const orgWordsOf = (...names: Array<string | null | undefined>) =>
  new Set(names.flatMap((n) => (n ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)).filter((w) => w.length > 1).map((w) => w.replace(/s$/, "")));

// ── Titles whose organisation was not recognised ──
/** The body a title starts with, when it starts with an acronym ("OPSC ASO …", "AIIMS Patna …"): lower case, as words are compared. */
export function leadingAcronym(title: string): string | null {
  const first = title.trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9]/g, "") ?? "";
  return /^[A-Z][A-Z0-9]{2,7}$/.test(first) ? first.toLowerCase().replace(/s$/, "") : null;
}
/** The number of posts a title gives ("… for 340 Posts", "340 Assistant Section Officer Posts"). */
export function postCount(title: string): number | null {
  const m = /\b(\d[\d,]*)\s+(?:[A-Za-z&.,()/'’\- ]{0,50}\s)?posts?\b/i.exec(title);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}
const yearsOf = (t: string) => new Set(t.match(/\b20\d{2}\b/g) ?? []);

// Words many bodies' names share: they never show on their own that a title names one body.
const BODY_GENERIC = new Set(("bank india indian limited ltd company co corporation university board commission department government govt " +
  "state public service services selection staff recruitment of the and for organisation organization council institute authority").split(" "));
/**
 * A body's distinctive words, from its ID and name ("canara-bank", "Canara Bank" → canara); its ID run together
 * ("mp-esb" → mpesb). A body named only in generic words ("Indian Bank") has them all, all of them needed.
 */
export function bodyWords(organizationId: string | null | undefined, organizationName?: string | null): { words: Set<string>; allNeeded: boolean; joined: string | null } {
  const every = [...orgWordsOf(organizationId?.replace(/-/g, " "), organizationName)].filter((w) => w.length > 1);
  const distinctive = every.filter((w) => !BODY_GENERIC.has(w));
  const joined = organizationId && organizationId.includes("-") ? organizationId.replace(/-/g, "").toLowerCase() : null;
  const allNeeded = distinctive.length === 0 && every.length >= 2;
  return { words: new Set(allNeeded ? every : distinctive), allNeeded, joined: joined && joined.length >= 3 ? joined : null };
}
/** Exam codes a title gives (CRP-SPL-XVI, PO/MT): letters joined to letters or numbers by a hyphen or slash. */
export const examCodes = (title: string) => new Set((title.match(/\b[A-Z]{2,}(?:[-/][A-Z0-9]+)+\b/g) ?? []).map((c) => c.toUpperCase()));
// ── Acronyms (real CMS records, 10 Nov) ──
// A body's own acronyms, from its name only: the initials of all its words ("Madhya Pradesh Employees Selection
// Board" → MPESB, "National Insurance Company Limited" → NICL) and an acronym its name gives in brackets
// ("Bihar Technical Service Commission (BTSC)"). Never part of the initials: "NWR" is not enough for "Railway
// Recruitment Cell, North Western Railway"; such a short form counts only as a verified alias below.
const INITIAL_SKIP = new Set(["of", "and", "the", "for", "&"]);
export function bodyAcronyms(organizationName: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!organizationName) return out;
  for (const m of organizationName.matchAll(/\(([A-Za-z][A-Za-z.]{1,9})\)/g)) {
    const a = m[1].replace(/\./g, "").toLowerCase();
    if (a.length >= 3) out.add(a);
  }
  const words = organizationName.replace(/\([^)]*\)/g, " ").split(/[\s,–-]+/).filter((w) => /^[A-Za-z]/.test(w) && !INITIAL_SKIP.has(w.toLowerCase()));
  const initials = words.map((w) => w[0]).join("").toLowerCase();
  if (words.length >= 3 && initials.length >= 3) out.add(initials);
  return out;
}
/** The acronyms a title writes in capitals ("MPESB MP Police …" → mpesb), lower case. */
export const titleAcronyms = (title: string) => new Set((title.match(/\b[A-Z][A-Z0-9]{2,7}\b/g) ?? []).map((a) => a.toLowerCase()));
/**
 * Verified short forms that are not a body's initials, each checked against the CMS's own record (10 Nov):
 * the title wording, and the body name it stands for.
 */
export const VERIFIED_ALIASES: Array<{ title: RegExp; body: RegExp }> = [
  { title: /\b(?:rrc\s+nwr|nwr\s+rrc)\b/i, body: /^railway recruitment cell,?\s+north western railway$/i },
];
const aliasNames = (title: string, organizationName: string | null | undefined) =>
  !!organizationName && VERIFIED_ALIASES.some((a) => a.title.test(title) && a.body.test(organizationName.trim()));

/**
 * Whether a title names this body: one of its distinctive words (all of them when it has only generic ones), its ID
 * run together ("MPESB"), one of its own acronyms written in capitals, or a verified alias.
 */
export function titleNamesBody(title: string, organizationId: string | null | undefined, organizationName?: string | null): boolean {
  const t = orgWordsOf(title);
  const acr = titleAcronyms(title);
  // The ID's words and the name's words each name the body ("indian-bank" or "Indian Bank").
  return [bodyWords(organizationId), bodyWords(null, organizationName)].some((b) =>
    (b.words.size > 0 && (b.allNeeded ? [...b.words].every((w) => t.has(w)) : [...b.words].some((w) => t.has(w)))) || (!!b.joined && t.has(b.joined)))
    || [...bodyAcronyms(organizationName)].some((a) => acr.has(a))
    || aliasNames(title, organizationName);
}

/**
 * Whether two leads seen on different portals may be the same recruitment, and why (Stage 1: "OPSC Assistant
 * Section Officer Recruitment 2026 – … 340 Posts" and "OPSC ASO Recruitment 2026 – … 340 Assistant Section
 * Officer Posts"). Only ever a reviewable link between two leads, never a merge. Needs the same organisation
 * (recognised, or the same acronym the titles start with), the same exam (no exam word on each side the other
 * lacks, cycles agreeing), no other year, and independent support: the same post count, or three shared exam words.
 */
export function relatedLeadTitles(a: { title: string; organizationId: string | null }, b: { title: string; organizationId: string | null }): string | null {
  const acrA = leadingAcronym(a.title), acrB = leadingAcronym(b.title);
  const sameBody = a.organizationId && b.organizationId ? a.organizationId === b.organizationId : !!acrA && acrA === acrB;
  if (!sameBody) return null;
  const ya = yearsOf(a.title), yb = yearsOf(b.title);
  if (ya.size && yb.size && ![...ya].some((y) => yb.has(y))) return null;
  const ca = postCount(a.title), cb = postCount(b.title);
  if (ca !== null && cb !== null && ca !== cb) return null;
  const exam = sameExam(a.title, b.title, orgWordsOf(a.organizationId, b.organizationId, acrA, acrB));
  if (!exam.same) return null;
  if (ca !== null && ca === cb) return `same body and exam, and the same ${ca} posts (not merged: no shared notice number or address)`;
  if ((exam.shared ?? 0) >= 3) return `same body and exam wording (not merged: no shared notice number or address)`;
  return null;
}

export function matchLead(lead: LeadForMatch, jobs: CmsJob[]): LeadMatch {
  const key = noticeKey(lead.notificationNumber);
  const year = /\b20\d{2}\b/.exec(lead.title)?.[0];
  const candidates: MatchCandidate[] = [];
  const differentNotice: NonNullable<LeadMatch["differentNotice"]> = [];
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
    if (similarJobs(normaliseExamWording(lead.title), [{ id: job.id, title: normaliseExamWording(jobTitle) }]).length === 0) continue;
    // Like titles are not enough when the lead names another body (listing finder, 10 Nov: "National Insurance NICL
    // Graduate Apprentice" is not a Canara Bank job): when the lead's body is known (recognised, or named only), a job
    // of another body is suggested only if the title names that body too, or the titles share an exam code ("… for
    // CRP-SPL-XVI" is IBPS's SO job). A lead whose body is unknown is left to the checks below.
    if (!sameOrg && (lead.organizationId || lead.namedBody) && (job.organizationId || job.organizationName) && !titleNamesBody(lead.title, job.organizationId, job.organizationName)
      && ![...examCodes(lead.title)].some((c) => examCodes(job.title).has(c))) continue;
    // Two different notice numbers are two notices: never a strong match (CEN 06/2026 is not CEN 06/2025).
    if (key && jobKey && jobKey !== key) {
      differentNotice.push({ id: job.id, title: job.title, reason: `a like title, but another notice number (${job.notificationNumber}): probably another recruitment` });
      continue;
    }
    // Organisation not recognised: no suggestion when the title starts with another body's acronym ("AIIMS Patna
    // …" is not an IBPS job), nor when the titles do not name the same exam (Stage 1, real pages).
    if (!lead.organizationId) {
      const jobWords = orgWordsOf(job.organizationId, job.organizationName);
      // The acronym may follow an honorific ("Dr. RMLIMS …" is not a Delhi University job).
      const acr = leadingAcronym(lead.title.replace(/^\s*(?:dr|shri|smt|sri)\.?\s+/i, ""));
      if (acr && !jobWords.has(acr) && !orgWordsOf(job.title).has(acr)) continue;
      if (!sameExam(lead.title, job.title, jobWords).same) continue;
    }
    // Strong only when the titles also name the same exam; otherwise the admin chooses, told why.
    const exam = sameOrg && year ? sameExam(lead.title, job.title, orgWordsOf(lead.organizationId, lead.organizationName, job.organizationId, job.organizationName)) : null;
    candidates.push(sameOrg && year && exam?.same
      ? { id: job.id, title: job.title, kind: "STRONG", reason: `same organisation and year (${year}), and the titles name the same exam` }
      : { id: job.id, title: job.title, kind: "POSSIBLE", reason: lead.organizationId
        ? (sameOrg ? (year ? `same organisation and year (${year}), but ${exam?.why ?? "the exam is not confirmed"}` : "same organisation and the titles agree, but no year to confirm it") : "the titles agree, but this job is another organisation's")
        : "the titles agree; the lead's organisation was not recognised" });
  }
  candidates.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
  const apart = differentNotice.length ? { differentNotice: differentNotice.slice(0, 3) } : {};
  const top = candidates.slice(0, 5);
  const best = top[0];
  if (!best) return { kind: lead.organizationId ? "NONE" : "UNRESOLVED", recruitmentId: null, reason: lead.organizationId ? null : "organisation not recognised; no CMS job like it", confidence: null, candidates: [], ...apart };
  // Two different jobs both "strong" or both "duplicate": none is chosen, the admin decides.
  const tied = top.filter((c) => c.kind === best.kind && c.id !== best.id);
  if (tied.length > 0 && best.kind !== "POSSIBLE") {
    return { kind: "POSSIBLE", recruitmentId: null, reason: `${tied.length + 1} CMS jobs match as well as each other — choose the right one`, confidence: CONFIDENCE.POSSIBLE, candidates: top, ...apart };
  }
  // A possible match names its job too, for the admin to confirm or reject; it is never treated as the job.
  const possibles = top.filter((c) => c.kind === "POSSIBLE");
  if (best.kind === "POSSIBLE" && possibles.length > 1) {
    return { kind: "POSSIBLE", recruitmentId: null, reason: `${possibles.length} CMS jobs may be this one — choose the right one`, confidence: CONFIDENCE.POSSIBLE, candidates: top, ...apart };
  }
  return { kind: best.kind, recruitmentId: best.id, reason: best.reason, confidence: CONFIDENCE[best.kind], candidates: top, ...apart };
}
