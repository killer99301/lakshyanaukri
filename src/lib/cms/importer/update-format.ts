// ═══════════════════════════════════════════════════════════
// LN Update v1: a GPT-prepared update, read by code (CMS 2.0, step U1)
// ═══════════════════════════════════════════════════════════
//
// Pure. Reads a text that starts with "LN Update v1" into structured
// PROPOSED information. It edits nothing, saves nothing, and executes
// nothing: an announcement or a supersession is a proposal the owner reviews
// (later steps compare it with the job and show one review).
//
// The format keeps the GPT v0.3.1 principles (plain labelled lines, plain
// headings, URLs only under Important Links). A text without the "LN Update"
// first line is not read here at all: it goes through the v0.3.1 readers
// exactly as before.
//
// Rules this reader keeps:
//   - A section the text leaves out is OMITTED: the job keeps what it has.
//   - "Not specified in the notice" and "Not applicable" are recorded as such;
//     they are never read as "remove", and never as "not mentioned".
//   - Inside a section, items are changes to those items only (scope ITEMS).
//     A whole list is replaced only when the text says "Complete list".
//   - Stage, paper and post together identify a pattern or a syllabus block;
//     a stage name alone may be ambiguous, so the context is kept as written.
//   - Two lines that disagree give nothing; both are shown. Nothing invented.
//   - A person named as the author of a change ("By: …") is ignored: who made a
//     change is recorded by the CMS from the signed-in session.
//   - Every line is accounted for: read, or listed as not read with the reason.

import type { ExamPatternSection, RecruitmentLinkType, SelectionStageType } from "@/types/recruitment-record";
import type { DateCertainty, ExamStageKind, ExamStageStatus } from "@/types";
import { parseDatesInText } from "@/lib/cms/ai-assist";
import { cleanUrl, linkFlags } from "@/lib/cms/importer/links";
import { readLabelledLines, type LabelledValue } from "@/lib/cms/importer/prepared-fields";
import { selectionStageType } from "@/lib/cms/importer/extract";
import { classifyStageName } from "@/lib/exam-stage-kind";
import { MAX_REASON } from "@/lib/cms/announcements";

export const UPDATE_FORMAT = "LN Update v1";

// ─── What the reader returns ──────────────────────────────

export type UpdateType =
  | "CORRECTION" | "NEW_INFORMATION" | "CORRIGENDUM" | "SCHEDULE" | "RESULT" | "ADMIT_CARD"
  | "ANSWER_KEY" | "CUT_OFF" | "POSTPONEMENT" | "CANCELLATION" | "NEW_RECRUITMENT";

/** Sections an update can carry. The last group is read by the v0.3.1 readers. */
export type SectionKey =
  | "examStages" | "selection" | "examPattern" | "syllabus" | "links" | "announcement" | "supersede"
  | "fees" | "age" | "eligibility" | "vacancies" | "dates" | "howToApply" | "pay";

/** OMITTED = not in the text (keep the job's value). The others are what the text says. */
export type SectionState = "OMITTED" | "PROVIDED" | "NOT_SPECIFIED" | "NOT_APPLICABLE";
/** ITEMS = changes to the items given, the rest kept. COMPLETE_LIST = the text says its list is the whole list. */
export type Scope = "ITEMS" | "COMPLETE_LIST";
export type ItemState = "PROVIDED" | "NOT_SPECIFIED" | "NOT_APPLICABLE";

export interface Quoted { line: number; quote: string }
/** Where a block applies. Absent parts mean the text did not say (not "all"). */
export interface Context { stage?: string; paper?: string; post?: string }

export interface SectionInfo { state: SectionState; scope: Scope; line?: number; quote?: string }

export interface UpdateHeader {
  job?: string;
  /** null = the text says the notice has no number ("None"); undefined = not given. */
  noticeNumber?: string | null;
  organisation?: string;
  updateType?: UpdateType;
  source?: string;
  sourceDate?: string;
  sourceLink?: string;
  quotes: Quoted[];
}

export interface IdentityCheck { result: "MATCH" | "MISMATCH" | "UNSURE" | "NOT_CHECKED"; reasons: string[] }

export interface StageItem extends Quoted {
  name: string;
  post?: string;
  kind: ExamStageKind;
  state: ItemState;
  status?: ExamStageStatus;
  certainty?: DateCertainty;
  /** The day, or the first day of a continuous window. */
  dateIso?: string;
  /** The last day of a continuous window ("From … | Until …"). */
  dateEndIso?: string;
  /** Separate days ("Date: 23 & 25 Nov 2026"): never read as one date or as a window. */
  days?: string[];
  dateDisplay?: string;
  noticeUrl?: string;
  notes?: string;
}

export interface SelectionItem extends Quoted { name: string; order: number; type: SelectionStageType; post?: string; qualifying?: boolean; description?: string; state: ItemState }

export interface PatternBlock extends Quoted {
  context: Context;
  scope: Scope;
  state: ItemState;
  name: string;
  mode?: string;
  durationMinutes?: number;
  negativeMarking?: string;
  qualifying?: boolean;
  sections: Array<ExamPatternSection & Quoted>;
  totalQuestions?: number;
  totalMarks?: number;
  note?: string;
  /** Printed figures that do not add up: said, never corrected. */
  problems: string[];
}

export interface SyllabusBlock extends Quoted {
  context: Context;
  scope: Scope;
  state: ItemState;
  subjects: Array<Quoted & { subject: string; topics: string[]; state: ItemState }>;
}

export interface LinkItem extends Quoted { type: RecruitmentLinkType; label: string; url: string; appliesTo?: string; flags: string[] }
export interface PendingLink extends Quoted { type: RecruitmentLinkType; label: string; says: string }

export interface AnnouncementProposal extends Quoted {
  title: string;
  text?: string;
  date?: string;
  /** U3, optional: which of the job's official links the notice's button uses ("Action: Admit card"). */
  action?: RecruitmentLinkType;
  /** U3, optional: the last day the notice matters, only when the notice says so ("Relevant until: 5 Dec 2026"). */
  relevantUntil?: string;
  /** U3, optional: the stage the notice is about ("Stage: Tier-II"), so two admit cards of one job stay apart. */
  stage?: string;
  /** Offered unticked (a correction, which is normally saved quietly). */
  offeredUnticked: boolean;
  why?: string;
}

export interface SupersedeProposal extends Quoted {
  date?: string;
  title: string;
  reason?: string;
  /** "Replaced by:" as written; matched to an announcement of the job later. */
  replacedBy?: string;
  sourceUrl?: string;
  problems: string[];
}

export type RemovalTarget = "POST" | "STAGE" | "SELECTION_STAGE" | "PAPER" | "SUBJECT" | "LINK";
/** Always offered unticked, with a warning. */
export interface Removal extends Quoted { target: RemovalTarget; name: string; context: Context; /** The section the line was in, when it was in one. */ section?: SectionKey }

export type AttentionCode =
  | "IDENTITY" | "CONFLICT" | "DUPLICATE" | "AMBIGUOUS_CONTEXT" | "NO_CONTEXT" | "BAD_DATE" | "BAD_VALUE"
  | "TWO_ANNOUNCEMENTS" | "ACTOR_IGNORED" | "URL_OUTSIDE_LINKS" | "UNCHANGED_WORD" | "UNKNOWN_UPDATE_TYPE";
export interface Attention { code: AttentionCode; message: string; lines: number[] }

export interface Unread { line: number; text: string; why: string }

export interface UpdateReading {
  /** null: the text is not an LN Update; read it with the v0.3.1 readers as before. */
  format: typeof UPDATE_FORMAT | null;
  /** Set when nothing may be offered from this text (wrong job, unsupported version, no Job line). */
  refused?: string;
  header: UpdateHeader;
  identity: IdentityCheck;
  sections: Record<SectionKey, SectionInfo>;
  stages: StageItem[];
  selection: { items: SelectionItem[]; merit?: Quoted & { text: string } };
  pattern: PatternBlock[];
  syllabus: SyllabusBlock[];
  links: LinkItem[];
  pendingLinks: PendingLink[];
  announcement: AnnouncementProposal | null;
  supersede: SupersedeProposal[];
  removals: Removal[];
  /** Fees, age, eligibility, vacancies, dates, how to apply, pay: from the existing v0.3.1 readers. */
  values: LabelledValue[];
  refusedValues: Array<{ fieldPath: string; reason: string }>;
  attention: Attention[];
  unread: Unread[];
  /** The lines given to the v0.3.1 readers, with the section each was in (fees rows, a vacancy table…), for U2. */
  generalLines: Array<{ line: number; text: string; section: SectionKey | null }>;
}

/** The job the owner opened, for the identity check. */
export interface JobIdentity {
  title: string;
  organizationName?: string;
  organizationId?: string;
  notificationNumber?: string | null;
  advertisementNumber?: string | null;
}

// ─── Small helpers ────────────────────────────────────────

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const NOT_SPECIFIED = /^not\s+(?:specified|prescribed|given|stated|provided)(?:\s+in\s+the\s+(?:notice|notification|advertisement))?\.?$/i;
const NOT_APPLICABLE = /^(?:not\s+applicable|n\/a)\.?$/i;
const UNCHANGED = /^(?:unchanged|no\s+change|not\s+mentioned|same\s+as\s+before)\.?$/i;
const COMPLETE = /^(?:complete|full)\s+list\b/i;
const PENDING = /^(?:not\s+yet\s+(?:released|available|out|published)|awaited|to\s+be\s+(?:released|announced|notified)|coming\s+soon)\.?$/i;
const ACTOR = /^(?:by|admin|approved\s+by|posted\s+by|edited\s+by|author|user|actor|reviewer)$/i;

const markerState = (v: string): ItemState | null => (NOT_SPECIFIED.test(v.trim()) ? "NOT_SPECIFIED" : NOT_APPLICABLE.test(v.trim()) ? "NOT_APPLICABLE" : null);

/** "Stage: Tier-II | Post: Assistant | Tentative" → the first key's value, the other keys, and the bare words. */
function partsOf(text: string): { head: { key: string; value: string } | null; keys: Map<string, string>; words: string[] } {
  const parts = text.split("|").map(clean).filter(Boolean);
  const keyed = (p: string) => { const m = /^([A-Za-z][A-Za-z ]{0,30}?)\s*:\s*(.*)$/.exec(p); return m && !/^https?$/i.test(m[1]) ? { key: m[1].toLowerCase(), value: clean(m[2]) } : null; };
  const keys = new Map<string, string>();
  const words: string[] = [];
  const first = parts.length ? keyed(parts[0]) : null;
  for (const p of parts.slice(first ? 1 : 0)) {
    const k = keyed(p);
    if (k) keys.set(k.key, k.value); else words.push(p);
  }
  return { head: first, keys, words };
}

/** Exactly one date in the words, as ISO; or why not. */
/** "23 & 25 Nov 2026" is read as "23 and 25 Nov 2026". */
const datesIn = (words: string) => [...new Set(parseDatesInText(words.replace(/\s*&\s*/g, " and ")))].sort();

function oneDate(words: string): { iso?: string; error?: string } {
  const found = datesIn(words);
  if (found.length === 1) return { iso: found[0] };
  return { error: found.length === 0 ? `no date could be read from “${words}”` : `“${words}” gives ${found.length} dates where one is expected` };
}

const STATUS: Array<[RegExp, ExamStageStatus]> = [
  [/^(?:scheduled|announced|upcoming)$/i, "SCHEDULED"],
  [/^admit\s+card\s+(?:out|released|available)$/i, "ADMIT_CARD_OUT"],
  [/^postponed$/i, "POSTPONED"],
  [/^(?:conducted|held|completed|over)$/i, "CONDUCTED"],
  [/^result\s+(?:declared|out|released)$/i, "RESULT_DECLARED"],
  [/^(?:not\s+declared|not\s+announced|awaited|dates?\s+awaited)$/i, "NOT_DECLARED"],
];
const CERTAINTY: Array<[RegExp, DateCertainty]> = [
  [/^(?:confirmed|final)$/i, "CONFIRMED"], [/^(?:tentative|expected|likely)$/i, "TENTATIVE"], [/^postponed$/i, "POSTPONED"], [/^(?:tba|to\s+be\s+announced)$/i, "TBA"],
];
const UPDATE_TYPES: Array<[RegExp, UpdateType]> = [
  [/^correction$/i, "CORRECTION"], [/^new\s+information$/i, "NEW_INFORMATION"], [/^corrigendum$/i, "CORRIGENDUM"],
  [/^schedule$/i, "SCHEDULE"], [/^result$/i, "RESULT"], [/^admit\s+card$/i, "ADMIT_CARD"], [/^answer\s+key$/i, "ANSWER_KEY"],
  [/^cut[\s-]?off$/i, "CUT_OFF"], [/^postponement$/i, "POSTPONEMENT"], [/^cancell?ation$/i, "CANCELLATION"],
  [/^new\s+recruitment$/i, "NEW_RECRUITMENT"],
];
const LINK_TYPES: Array<[RegExp, RecruitmentLinkType]> = [
  [/^(?:apply\s+online|apply\s+link|online\s+application|registration(?:\s+link)?|apply)$/i, "APPLY_ONLINE"],
  [/^(?:official\s+notification|notification(?:\s+pdf)?|advertisement(?:\s+pdf)?|detailed\s+notification)$/i, "OFFICIAL_NOTIFICATION"],
  [/^(?:official\s+website|website)$/i, "OFFICIAL_WEBSITE"],
  [/^corrigendum$/i, "CORRIGENDUM"],
  [/^(?:admit\s+card|call\s+letter|hall\s+ticket)$/i, "ADMIT_CARD"],
  [/^results?$/i, "RESULT"],
  [/^answer\s+keys?$/i, "ANSWER_KEY"],
  [/^cut[\s-]?offs?(?:\s+marks)?$/i, "CUT_OFF"],
  [/^(?:exam\s+notice|notice|schedule|exam\s+schedule)$/i, "EXAM_NOTICE"],
  [/^other$/i, "OTHER"],
];
const firstMatch = <T,>(table: Array<[RegExp, T]>, v: string): T | undefined => table.find(([re]) => re.test(clean(v)))?.[1];

// Section headings: "Exam Stages:", "Syllabus" (plain heading), "Syllabus: Complete list", "Syllabus: Not specified in the notice".
const UPDATE_SECTIONS: Array<[RegExp, SectionKey | "remove"]> = [
  [/^exam\s+(?:stages?|schedule)$/i, "examStages"],
  [/^selection\s+(?:process|procedure)$/i, "selection"],
  [/^(?:exam(?:ination)?\s+pattern|scheme\s+of\s+(?:the\s+)?exam(?:ination)?)$/i, "examPattern"],
  [/^syllabus$/i, "syllabus"],
  [/^(?:important\s+)?links$/i, "links"],
  [/^announcements?$/i, "announcement"],
  [/^supersede$/i, "supersede"],
  [/^remove$/i, "remove"],
];
// v0.3.1 sections, read by the existing readers. A label line here ("Age Limit: …") is also a heading for its section.
const GENERAL_SECTIONS: Array<[RegExp, SectionKey]> = [
  [/^(?:application|exam(?:ination)?)\s+fees?$|^fees?(?:\s+details)?$/i, "fees"],
  [/^age(?:\s+limits?)?$|^age\s+relaxations?$/i, "age"],
  [/^eligibility(?:\s+criteria)?$|^(?:educational\s+)?qualifications?$|^experience$|^post(?:\s+details|s)?$|^name\s+of\s+(?:the\s+)?posts?$/i, "eligibility"],
  [/^vacanc(?:y|ies)(?:\s+details)?$|^total\s+(?:vacancies|posts)$/i, "vacancies"],
  [/^important\s+dates$|^(?:application\s+)?(?:start|last|closing|opening)\s+date|^(?:last\s+date|fee\s+payment)/i, "dates"],
  [/^how\s+to\s+apply$|^steps\s+to\s+apply$/i, "howToApply"],
  [/^pay(?:\s+scale)?$|^salary$|^stipend$/i, "pay"],
];

const HEADER_LABELS: Array<[RegExp, keyof Omit<UpdateHeader, "quotes" | "sourceDate"> | "actor"]> = [
  [/^job$/i, "job"], [/^(?:notice|notification|advertisement)\s+(?:number|no\.?)$/i, "noticeNumber"],
  [/^organi[sz]ation$/i, "organisation"], [/^update\s+type$/i, "updateType"], [/^source$/i, "source"], [/^source\s+link$/i, "sourceLink"],
  [ACTOR, "actor"],
];

function sectionOf(label: string): SectionKey | "remove" | null {
  const l = clean(label);
  return firstMatch(UPDATE_SECTIONS, l) ?? firstMatch(GENERAL_SECTIONS, l) ?? null;
}
const isGeneral = (k: SectionKey | "remove" | null): boolean => k !== null && GENERAL_SECTIONS.some(([, key]) => key === k);

function emptySections(): Record<SectionKey, SectionInfo> {
  const keys: SectionKey[] = ["examStages", "selection", "examPattern", "syllabus", "links", "announcement", "supersede", "fees", "age", "eligibility", "vacancies", "dates", "howToApply", "pay"];
  return Object.fromEntries(keys.map((k) => [k, { state: "OMITTED", scope: "ITEMS" } as SectionInfo])) as Record<SectionKey, SectionInfo>;
}

// ─── Identity ─────────────────────────────────────────────

const STOP = new Set(["of", "the", "and", "for", "in", "to", "a", "an", "&"]);
const GENERIC = new Set(["recruitment", "exam", "examination", "notification", "notice", "post", "posts", "vacancy", "vacancies", "online", "form", "apply", "limited", "ltd", "india", "indian", "government", "govt",
  // Words many recruiting bodies share: on their own they do not show two names are the same body.
  "bank", "corporation", "board", "commission", "authority", "service", "services", "selection", "public", "staff", "national", "state", "central",
  "institute", "company", "plant", "personnel", "department", "ministry", "council", "agency", "test", "example"]);
const wordsOf = (s: string) => squash(s).split(" ").filter((w) => w && !STOP.has(w));
/** Initials of every run of 2–6 words: "Steel Authority of India Limited" gives "sail", "Combined Graduate Level" gives "cgl". */
function initials(s: string): Set<string> {
  const w = wordsOf(s).filter((x) => /^[a-z]/.test(x));
  const out = new Set<string>();
  for (let i = 0; i < w.length; i++) for (let n = 2; n <= 6 && i + n <= w.length; n++) out.add(w.slice(i, i + n).map((x) => x[0]).join(""));
  return out;
}
const mentions = (text: string, token: string) => wordsOf(text).includes(token) || initials(text).has(token);
/** Upper-case short names in a title ("SSC", "CGL", "BSP"): what tells one exam from another. */
const acronyms = (s: string) => [...new Set((s.match(/\b[A-Z][A-Z0-9]{1,6}\b/g) ?? []).map((x) => x.toLowerCase()))].filter((x) => !/^\d+$/.test(x));
const yearsOf = (s: string) => new Set(s.match(/\b20\d{2}\b/g) ?? []);
const sameNumber = (a: string, b: string) => { const x = squash(a).replace(/ /g, ""), y = squash(b).replace(/ /g, ""); return x.length > 0 && y.length > 0 && (x === y || x.includes(y) || y.includes(x)); };

/** Is this text about the job the owner opened? Conservative: anything that points elsewhere stops the update. */
export function checkIdentity(header: UpdateHeader, job: JobIdentity | undefined): IdentityCheck {
  if (!job) return { result: "NOT_CHECKED", reasons: [] };
  const mismatch: string[] = [];
  const unsure: string[] = [];
  const numbers = [job.notificationNumber, job.advertisementNumber].filter((n): n is string => Boolean(n && n.trim()));
  if (header.noticeNumber && numbers.length && !numbers.some((n) => sameNumber(n, header.noticeNumber!))) {
    mismatch.push(`the notice number “${header.noticeNumber}” is not this job's (${numbers.join(" / ")})`);
  }
  const jobOrg = [job.organizationName, job.organizationId].filter(Boolean).join(" ");
  if (header.organisation && jobOrg) {
    const theirs = wordsOf(header.organisation).filter((w) => !GENERIC.has(w)), ours = wordsOf(jobOrg).filter((w) => !GENERIC.has(w));
    const all = wordsOf(header.organisation);
    // Distinctive words (or an acronym of the other's name) in common; for names made only of common words, most of the words.
    const shared = theirs.length && ours.length
      ? theirs.some((w) => mentions(jobOrg, w)) || ours.some((w) => mentions(header.organisation!, w))
      : all.length > 0 && all.filter((w) => mentions(jobOrg, w)).length / all.length >= 0.6;
    if (!shared) mismatch.push(`the organisation “${header.organisation}” is not this job's (${job.organizationName ?? job.organizationId})`);
  }
  if (header.job) {
    const ya = yearsOf(header.job), yb = yearsOf(job.title);
    if (ya.size && yb.size && ![...ya].some((y) => yb.has(y))) mismatch.push(`the text is about ${[...ya].join("/")}, this job is ${[...yb].join("/")}`);
    const orgAcr = new Set([...initials(jobOrg), ...wordsOf(jobOrg)]);
    const theirs = acronyms(header.job).filter((a) => !orgAcr.has(a) && !mentions(job.title, a));
    const ours = acronyms(job.title).filter((a) => !orgAcr.has(a) && !mentions(header.job!, a));
    if (theirs.length && ours.length) mismatch.push(`the text names ${theirs.map((a) => a.toUpperCase()).join(", ")}, this job is ${ours.map((a) => a.toUpperCase()).join(", ")}`);
    else if (theirs.length || ours.length) unsure.push(`the titles differ (${[...theirs, ...ours].map((a) => a.toUpperCase()).join(", ")}): check this is the same recruitment`);
    const a = wordsOf(header.job).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
    const b = wordsOf(job.title).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
    const common = a.filter((w) => b.includes(w) || mentions(job.title, w)).length;
    if (a.length && b.length && common / Math.min(a.length, b.length) < 0.5) unsure.push(`the title “${header.job}” differs from this job's “${job.title}”`);
  }
  if (mismatch.length) return { result: "MISMATCH", reasons: [...mismatch, ...unsure] };
  if (unsure.length) return { result: "UNSURE", reasons: unsure };
  return { result: "MATCH", reasons: [] };
}

// ─── Matching an item of the text to an item of the job (used from U2) ──

export type TargetMatch<T> = { kind: "MATCH"; item: T; loose: boolean } | { kind: "NONE" } | { kind: "AMBIGUOUS"; items: T[]; why: string };

/**
 * Which existing item (a stage, a pattern paper, a syllabus block, a post) the text means. A stage name alone is
 * not always enough: the same stage may have a different pattern or syllabus per post or paper, so post and paper
 * must agree as well. Anything other than exactly one candidate is never applied automatically.
 */
export function findTarget<T>(candidates: readonly T[], wanted: Context & { name: string }, describe: (t: T) => Context & { name: string }): TargetMatch<T> {
  const same = (a?: string, b?: string) => squash(a ?? "") === squash(b ?? "");
  const pick = (byName: (have: string) => boolean): TargetMatch<T> | null => {
    const named = candidates.filter((c) => byName(squash(describe(c).name)));
    if (named.length === 0) return null;
    // A paper named in the text must be the paper on record. One on record with no paper named is not assumed
    // to be it: that is a question for the owner, never a silent match.
    const paperKnown = wanted.paper ? named.filter((c) => describe(c).paper && same(describe(c).paper, wanted.paper)) : named;
    const paperUnknown = wanted.paper ? named.filter((c) => !describe(c).paper) : [];
    if (wanted.paper && paperKnown.length === 0 && paperUnknown.length > 0) {
      return { kind: "AMBIGUOUS", items: paperUnknown, why: `“${wanted.name}” is on record without a paper named; the text says “${wanted.paper}”: is it the same paper?` };
    }
    const paper = paperKnown;
    const exactPost = paper.filter((c) => same(describe(c).post, wanted.post));
    if (exactPost.length === 1) return { kind: "MATCH", item: exactPost[0], loose: false };
    if (exactPost.length > 1) return { kind: "AMBIGUOUS", items: exactPost, why: `${exactPost.length} items are named “${wanted.name}”${wanted.post ? ` for “${wanted.post}”` : ""}; say the paper` };
    if (paper.length > 0) {
      return { kind: "AMBIGUOUS", items: paper, why: wanted.post
        ? `“${wanted.name}” is on record, but not for the post “${wanted.post}”: is it the same for all posts, or new for this post?`
        : `“${wanted.name}” is on record post by post (${paper.map((c) => describe(c).post ?? "all posts").join(", ")}): say which post` };
    }
    return null;
  };
  const target = squash(wanted.name);
  if (!target) return { kind: "NONE" };
  const exact = pick((have) => have === target);
  if (exact) return exact;
  const loose = pick((have) => have.length >= 5 && target.length >= 5 && (` ${target} `.includes(` ${have} `) || ` ${have} `.includes(` ${target} `)));
  if (loose && loose.kind === "MATCH") return { ...loose, loose: true };
  return loose ?? { kind: "NONE" };
}

// ─── The reader ───────────────────────────────────────────

/** The first non-empty line says whether the text is an LN Update, and which version. */
export function updateVersion(text: string): string | null {
  const first = text.replace(/\r/g, "").split("\n").find((l) => l.trim());
  const m = first ? /^\s*LN\s+Update\s+v(\d+(?:\.\d+)?)\s*$/i.exec(first) : null;
  return m ? m[1] : null;
}

export function readUpdateText(text: string, opts: { job?: JobIdentity; stageType?: (name: string) => SelectionStageType } = {}): UpdateReading {
  const stageType = opts.stageType ?? selectionStageType;
  const out: UpdateReading = {
    format: null, header: { quotes: [] }, identity: { result: "NOT_CHECKED", reasons: [] }, sections: emptySections(),
    stages: [], selection: { items: [] }, pattern: [], syllabus: [], links: [], pendingLinks: [], announcement: null,
    supersede: [], removals: [], values: [], refusedValues: [], attention: [], unread: [], generalLines: [],
  };
  const version = updateVersion(text);
  if (version === null) return out;
  out.format = UPDATE_FORMAT;
  if (!/^1(?:\.0)?$/.test(version)) { out.refused = `This is LN Update v${version}; this CMS reads v1 only. Ask GPT for LN Update v1.`; return out; }

  const lines = text.replace(/\r/g, "").split("\n");
  const attention = (code: AttentionCode, message: string, ...at: number[]) => out.attention.push({ code, message, lines: at });
  const unread = (line: number, why: string) => out.unread.push({ line, text: clean(lines[line - 1]), why });

  // ── The header: from the line after "LN Update v1" to the first blank line or section heading.
  let i = lines.findIndex((l) => l.trim()) + 1;
  const seen = new Map<string, Quoted & { value: string }>();
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) break;
    const m = /^\s*([A-Za-z][A-Za-z .]{0,30}?)\s*:\s*(.*)$/.exec(raw);
    const label = m ? firstMatch(HEADER_LABELS, m[1]) : undefined;
    if (!m || !label) {
      if (m && sectionOf(m[1])) break;
      if (!m && sectionOf(raw)) break;
      unread(i + 1, "a header line this format does not have");
      continue;
    }
    const value = clean(m[2]);
    const q: Quoted = { line: i + 1, quote: clean(raw) };
    if (label === "actor") { attention("ACTOR_IGNORED", `“${q.quote}” is ignored: who makes a change is recorded by the CMS from your sign-in, never taken from the text`, q.line); continue; }
    const prev = seen.get(label);
    if (prev && squash(prev.value) !== squash(value)) { out.refused = `The header gives two different values for ${m[1].trim()} (lines ${prev.line} and ${q.line}).`; }
    seen.set(label, { ...q, value });
    out.header.quotes.push(q);
    if (label === "noticeNumber") out.header.noticeNumber = /^(?:none|nil|not\s+(?:given|numbered|printed)|n\/a|-)$/i.test(value) ? null : value;
    else if (label === "updateType") {
      const t = firstMatch(UPDATE_TYPES, value.split("|")[0]);
      if (t) out.header.updateType = t;
      else attention("UNKNOWN_UPDATE_TYPE", `“${value}” is not an update type this format knows; it is treated as new information`, q.line);
    } else if (label === "sourceLink") {
      const url = cleanUrl(value);
      if (url) out.header.sourceLink = url; else attention("BAD_VALUE", `the source link “${value}” is not a web address`, q.line);
    } else {
      (out.header as unknown as Record<string, string>)[label] = value;
    }
  }
  if (out.header.source) {
    const dated = /\bdated\s+(.+)$/i.exec(out.header.source);
    const d = dated ? oneDate(dated[1]) : {};
    if (d.iso) out.header.sourceDate = d.iso;
  }
  if (!out.header.job) out.refused ??= "The text has no “Job:” line, so it cannot be checked against this job. Nothing is offered.";
  out.identity = checkIdentity(out.header, opts.job);
  if (out.identity.result === "MISMATCH") out.refused ??= `This text is about another recruitment: ${out.identity.reasons[0]}. Nothing is offered.`;
  if (out.identity.result === "UNSURE") attention("IDENTITY", `Check this text is about this job: ${out.identity.reasons.join("; ")}`);

  // ── The body.
  let section: SectionKey | "remove" | null = null;
  const general: Array<{ line: number; text: string; section: SectionKey | null }> = [];
  let block: PatternBlock | SyllabusBlock | null = null;
  let lastStage: StageItem | null = null;
  let announcementOpen: AnnouncementProposal | null = null;
  let announcements = 0;
  const setSection = (key: SectionKey, state: SectionState, line: number, scope: Scope = "ITEMS") => {
    const cur = out.sections[key];
    if (cur.state !== "OMITTED" && cur.state !== state && state !== "PROVIDED" && cur.state !== "PROVIDED") {
      attention("CONFLICT", `the ${key} section is said to be both “${cur.state}” and “${state}”`, cur.line ?? line, line);
    }
    if (cur.state === "OMITTED" || state !== "PROVIDED") out.sections[key] = { state, scope: scope === "COMPLETE_LIST" ? scope : cur.scope, line, quote: clean(lines[line - 1]) };
    else if (scope === "COMPLETE_LIST") cur.scope = scope;
  };
  const provided = (key: SectionKey, line: number) => { if (out.sections[key].state === "OMITTED") setSection(key, "PROVIDED", line); };

  for (; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i];
    const t = clean(raw);
    if (!t) continue;

    // A heading, possibly with a state or "Complete list" after it.
    // A label may carry a note in brackets ("Application Fee (Assistant Manager): …"): the label decides the section.
    const hm = /^([A-Za-z][A-Za-z &/-]{1,40}?)(?:\s*\([^)]{1,120}\))?\s*:\s*(.*)$/.exec(t);
    const plainHeading = !hm ? sectionOf(t) : null;
    let headingKey = hm ? sectionOf(hm[1]) : plainHeading;
    // Inside a stage-wise section, "Post:" and "Paper:" set the context of what follows; they are not headings.
    if (hm && /^(?:post|paper)s?$/i.test(clean(hm[1])) && (section === "examPattern" || section === "syllabus" || section === "selection" || section === "examStages")) headingKey = null;
    const rest = hm ? clean(hm[2]) : "";
    if (headingKey && (plainHeading || UPDATE_SECTIONS.some(([, k]) => k === headingKey) && (!rest || markerState(rest) || COMPLETE.test(rest) || UNCHANGED.test(rest) || /^none\.?$/i.test(rest)))) {
      section = headingKey;
      block = null; lastStage = null; announcementOpen = null;
      if (headingKey === "remove") continue;
      const st = markerState(rest);
      if (st) setSection(headingKey, st, n);
      else if (UNCHANGED.test(rest)) attention("UNCHANGED_WORD", `“${t}”: a section that has not changed is simply left out; it is read as not mentioned`, n);
      else if (/^none\.?$/i.test(rest)) { if (headingKey !== "announcement" && headingKey !== "supersede") attention("BAD_VALUE", `“${t}”: write “Not specified in the notice” or “Not applicable”, or leave the section out`, n); }
      else if (isGeneral(headingKey)) { provided(headingKey, n); general.push({ line: n, text: raw, section: sectionNow() }); }
      else if (COMPLETE.test(rest)) setSection(headingKey, "PROVIDED", n, "COMPLETE_LIST");
      continue;
    }
    // A v0.3.1 label line ("Age Limit: Minimum 18 years…"): its own section, read by the existing readers.
    if (headingKey && isGeneral(headingKey)) {
      section = headingKey; block = null; lastStage = null;
      const st = markerState(rest);
      if (st) { setSection(headingKey as SectionKey, st, n); continue; }
      if (UNCHANGED.test(rest)) { attention("UNCHANGED_WORD", `“${t}”: read as not mentioned`, n); continue; }
      provided(headingKey as SectionKey, n);
      general.push({ line: n, text: raw, section: sectionNow() });
      continue;
    }
    // "Selection Process: Prelims, Mains, Interview" (v0.3.1): a list on one line, read by the existing reader.
    if (headingKey === "selection" && rest) { provided("selection", n); section = "selection"; general.push({ line: n, text: raw, section: sectionNow() }); continue; }

    // "Remove: …" anywhere, or a line under a "Remove:" heading.
    const rm = /^remove\s*:\s*(.+)$/i.exec(t);
    if (rm || section === "remove") { readRemoval(rm ? rm[1] : t, n); continue; }

    switch (section) {
      case "examStages": readStageLine(t, n); break;
      case "selection": readSelectionLine(t, n); break;
      case "examPattern": readPatternLine(t, n); break;
      case "syllabus": readSyllabusLine(t, n); break;
      case "links": readLinkLine(t, n); break;
      case "announcement": readAnnouncementLine(t, n); break;
      case "supersede": readSupersedeLine(t, n); break;
      default:
        general.push({ line: n, text: raw, section: sectionNow() });
    }
  }

  // ── Fees, age, eligibility, vacancies, dates, how to apply, pay: the existing v0.3.1 readers.
  out.generalLines = general.map((g) => ({ line: g.line, text: g.text, section: g.section }));
  if (general.length) {
    const reading = readLabelledLines(general.map((g) => g.text).join("\n"), { stageType });
    out.values.push(...reading.values);
    out.refusedValues.push(...reading.refused);
    const quotes = reading.values.map((v) => squash(v.quote)).filter(Boolean);
    const reasons = reading.refused.map((r) => squash(r.reason));
    for (const g of general) {
      const s = squash(g.text);
      if (/https?:\/\//i.test(g.text)) attention("URL_OUTSIDE_LINKS", `a web address outside “Important Links” is not read as a link: “${clean(g.text)}”`, g.line);
      const heading = /^[^:]{2,40}:\s*$/.test(g.text.trim()) || sectionOf(g.text) !== null;
      const used = heading || quotes.some((q) => q.includes(s) || (q.length >= 12 && s.includes(q))) || reasons.some((r) => r.includes(s.slice(0, 40)));
      if (!used) unread(g.line, "passed to the standard readers, but no value was read from it");
    }
  }

  // ── Duplicates and conflicts inside the text: two lines that disagree give nothing.
  dedupe(out.stages, (s) => `${squash(s.name)}|${squash(s.post ?? "")}`, (s) => JSON.stringify({ ...s, line: 0, quote: "" }), "stage", (keep) => { out.stages = keep; });
  // A bare repeat of a link given with its label and who it is for adds nothing: read once.
  out.links = out.links.filter((l) => {
    const bare = !l.appliesTo && squash(l.label) === squash(l.quote.split(":")[0]);
    const richer = bare && out.links.find((o) => o !== l && o.url === l.url && o.type === l.type && !(!o.appliesTo && squash(o.label) === squash(o.quote.split(":")[0])));
    if (richer) attention("DUPLICATE", `the link ${l.url} is given twice; read once, with its label`, richer.line, l.line);
    return !richer;
  });
  dedupe(out.links, (l) => l.url, (l) => `${l.type}|${squash(l.label)}|${squash(l.appliesTo ?? "")}`, "link", (keep) => { out.links = keep; });
  dedupe(out.supersede, (s) => `${s.date ?? ""}|${squash(s.title)}`, (s) => `${squash(s.reason ?? "")}|${s.replacedBy ?? ""}|${s.sourceUrl ?? ""}`, "superseded announcement", (keep) => { out.supersede = keep; });
  const blockKey = (b: { context: Context }) => [b.context.stage, b.context.paper, b.context.post].map((x) => squash(x ?? "")).join("|");
  dedupe(out.pattern, blockKey, (b) => JSON.stringify({ ...b, line: 0, quote: "", sections: b.sections.map((s) => ({ ...s, line: 0, quote: "" })) }), "exam pattern", (keep) => { out.pattern = keep; });
  mergeSyllabusBlocks();
  for (const b of out.syllabus) {
    dedupe(b.subjects, (s) => squash(s.subject), (s) => `${s.state}|${s.topics.map(squash).join(";")}`, `syllabus subject (${describeContext(b.context)})`, (keep) => { b.subjects = keep; });
  }
  ambiguousContexts(out.pattern, "exam pattern");
  ambiguousContexts(out.syllabus, "syllabus");
  if (announcements > 1) {
    attention("TWO_ANNOUNCEMENTS", "the text gives more than one announcement; an update carries at most one, so none is offered", ...[out.announcement?.line ?? 0].filter(Boolean));
    out.announcement = null;
  }
  if (out.announcement && out.header.updateType === "CORRECTION") {
    out.announcement.offeredUnticked = true;
    out.announcement.why = "a correction is normally saved quietly, without an announcement";
  }
  return out;

  // ── Section readers ─────────────────────────────────────

  function sectionNow(): SectionKey | null { return section === null || section === "remove" ? null : section; }

  function contextFrom(keys: Map<string, string>, base: Context = {}): Context {
    const c: Context = { ...base };
    if (keys.get("paper")) c.paper = keys.get("paper");
    if (keys.get("post")) c.post = keys.get("post");
    return c;
  }
  function actorParts(keys: Map<string, string>, n: number) {
    for (const k of keys.keys()) if (ACTOR.test(k)) attention("ACTOR_IGNORED", `“${k}: ${keys.get(k)}” is ignored: who makes a change is recorded by the CMS from your sign-in`, n);
  }

  function readStageLine(t: string, n: number) {
    const p = partsOf(t);
    if (/^note$/i.test(p.head?.key ?? "") && lastStage && p.head) { lastStage.notes = lastStage.notes ? `${lastStage.notes} ${p.head.value}` : p.head.value; return; }
    if (p.head?.key !== "stage" || !p.head.value) { unread(n, "under Exam Stages, each line starts “Stage:” (or “Note:” for the stage above)"); return; }
    actorParts(p.keys, n);
    provided("examStages", n);
    const name = p.head.value;
    const item: StageItem = { line: n, quote: t, name, kind: classifyStageName(name), state: "PROVIDED", ...(p.keys.get("post") ? { post: p.keys.get("post") } : {}) };
    for (const w of p.words) {
      const st = markerState(w);
      const c = firstMatch(CERTAINTY, w);
      const s = firstMatch(STATUS, w);
      if (st) item.state = st;
      if (c) item.certainty = c;
      if (s) item.status = s;
      if (!st && !c && !s) attention("BAD_VALUE", `“${w}” in “${t}” is not understood and is ignored`, n);
    }
    const status = p.keys.get("status");
    if (status !== undefined) {
      const s = firstMatch(STATUS, status);
      if (s) item.status = s; else attention("BAD_VALUE", `the status “${status}” is not one this format knows (Scheduled, Admit card out, Postponed, Conducted, Result declared, Not declared)`, n);
    }
    const from = p.keys.get("from"), until = p.keys.get("until"), date = p.keys.get("date");
    if (from !== undefined || until !== undefined) {
      const a = from !== undefined ? oneDate(from) : { error: "“Until” needs a “From” date (the first day)" };
      const b = until !== undefined ? oneDate(until) : {};
      if (a.error || b.error) attention("BAD_DATE", `${name}: ${a.error ?? b.error}; no date is offered for this stage`, n);
      else if (b.iso && b.iso <= a.iso!) attention("BAD_DATE", `${name}: “Until” (${until}) must come after “From” (${from}); no date is offered for this stage`, n);
      else { item.dateIso = a.iso; if (b.iso) item.dateEndIso = b.iso; }
      if (date !== undefined) attention("BAD_VALUE", `${name}: give either “Date” or “From/Until”, not both; “Date” is ignored`, n);
    } else if (date !== undefined) {
      const days = datesIn(date);
      if (days.length === 1) item.dateIso = days[0];
      else if (days.length > 1) {
        // Separate days ("23 & 25 Nov"): kept as written, never turned into one date or a window.
        item.days = days; item.dateIso = days[0];
        item.dateDisplay ??= date;
      } else attention("BAD_DATE", `${name}: no date could be read from “${date}”`, n);
    }
    if (p.keys.get("as written")) item.dateDisplay = p.keys.get("as written");
    const notice = p.keys.get("notice");
    if (notice) { const u = cleanUrl(notice); if (u) item.noticeUrl = u; else attention("BAD_VALUE", `${name}: the notice “${notice}” is not a web address`, n); }
    if (p.keys.get("note")) item.notes = p.keys.get("note");
    for (const k of p.keys.keys()) if (!["status", "from", "until", "date", "as written", "notice", "note", "post"].includes(k) && !ACTOR.test(k)) attention("BAD_VALUE", `“${k}” is not a stage detail this format knows; ignored`, n);
    out.stages.push(item);
    lastStage = item;
  }

  function readSelectionLine(t: string, n: number) {
    const p = partsOf(t);
    const head = p.head;
    if (head && /^(?:merit\s+list|final\s+merit|merit)$/i.test(head.key)) { out.selection.merit = { line: n, quote: t, text: head.value }; provided("selection", n); return; }
    // v0.3.1: "Subject: N Questions, M Marks" rows under a stage of the Selection Process are that stage's pattern.
    if (head && /^subject$/i.test(head.key) || /\d+\s*questions?\b/i.test(t)) {
      const last = out.selection.items[out.selection.items.length - 1];
      if (!last) { unread(n, "an exam pattern row with no stage above it"); return; }
      if (!block || (block as PatternBlock).name !== last.name) {
        block = { line: last.line, quote: last.quote, context: { stage: last.name, ...(last.post ? { post: last.post } : {}) }, scope: "ITEMS", state: "PROVIDED", name: last.name, sections: [], problems: [] };
        out.pattern.push(block as PatternBlock);
        provided("examPattern", n);
      }
      readPatternLine(t, n);
      return;
    }
    const list = /^(?:\d{1,2}[.)]|[-*•])\s+(.+)$/.exec(t);
    const name = head?.key === "stage" ? head.value : list ? clean(list[1]) : null;
    if (!name) { unread(n, "under Selection Process, each stage is a line starting “Stage:”"); return; }
    actorParts(p.keys, n);
    provided("selection", n);
    const item: SelectionItem = { line: n, quote: t, name, order: out.selection.items.length + 1, type: stageType(name), state: "PROVIDED" };
    if (p.keys.get("post")) item.post = p.keys.get("post");
    if (p.keys.get("description")) item.description = p.keys.get("description");
    for (const w of p.words) {
      if (/^qualifying(?:\s+in\s+nature)?$/i.test(w)) item.qualifying = true;
      else if (markerState(w)) item.state = markerState(w)!;
      else attention("BAD_VALUE", `“${w}” in “${t}” is not understood and is ignored`, n);
    }
    out.selection.items.push(item);
    block = null;
  }

  function newBlock<B extends PatternBlock | SyllabusBlock>(kind: "pattern" | "syllabus", t: string, n: number): B | null {
    const p = partsOf(t);
    if (!p.head || !["stage", "paper", "post"].includes(p.head.key)) return null;
    actorParts(p.keys, n);
    const base: Context = p.head.key === "stage" ? { stage: p.head.value }
      : { ...(block?.context.stage ? { stage: block.context.stage } : {}), [p.head.key]: p.head.value };
    const context = contextFrom(p.keys, base);
    let scope: Scope = "ITEMS";
    let state: ItemState = "PROVIDED";
    let qualifying = false;
    for (const w of p.words) {
      if (COMPLETE.test(w)) scope = "COMPLETE_LIST";
      else if (markerState(w)) state = markerState(w)!;
      else if (/^qualifying(?:\s+in\s+nature)?$/i.test(w)) qualifying = true;
      else attention("BAD_VALUE", `“${w}” in “${t}” is not understood and is ignored`, n);
    }
    if (kind === "syllabus") {
      const b: SyllabusBlock = { line: n, quote: t, context, scope, state, subjects: [] };
      out.syllabus.push(b);
      return b as B;
    }
    const b: PatternBlock = { line: n, quote: t, context, scope, state, name: context.paper ?? context.stage ?? "", sections: [], problems: [], ...(qualifying ? { qualifying } : {}) };
    if (p.keys.get("mode")) b.mode = p.keys.get("mode");
    const duration = p.keys.get("duration");
    if (duration) { const m = minutes(duration); if (m) b.durationMinutes = m; else attention("BAD_VALUE", `the duration “${duration}” could not be read`, n); }
    if (p.keys.get("negative marking")) b.negativeMarking = p.keys.get("negative marking");
    for (const k of p.keys.keys()) if (!["paper", "post", "mode", "duration", "negative marking"].includes(k) && !ACTOR.test(k)) attention("BAD_VALUE", `“${k}” is not an exam pattern detail this format knows; ignored`, n);
    out.pattern.push(b);
    return b as B;
  }

  function readPatternLine(t: string, n: number) {
    const fresh = newBlock<PatternBlock>("pattern", t, n);
    if (fresh) { block = fresh; provided("examPattern", n); return; }
    const b = block as PatternBlock | null;
    const note = /^note\s*:\s*(.+)$/i.exec(t);
    if (note && b) { b.note = b.note ? `${b.note} ${clean(note[1])}` : clean(note[1]); return; }
    const total = /^total\s*:?\s*(\d{1,4})\s*(?:questions?|qs)\s*,?\s*(\d{1,4}(?:\.\d+)?)\s*marks?\b/i.exec(t);
    if (total && b) {
      b.totalQuestions = Number(total[1]); b.totalMarks = Number(total[2]);
      const q = b.sections.reduce((s, x) => s + (x.questions ?? 0), 0), m = b.sections.reduce((s, x) => s + (x.marks ?? 0), 0);
      if (b.sections.length && (q !== b.totalQuestions || m !== b.totalMarks)) b.problems.push(`the subjects add up to ${q} questions and ${m} marks; the total line says ${b.totalQuestions} and ${b.totalMarks}`);
      return;
    }
    const row = /^(?:subject\s*:\s*)?(.+?)\s*:\s*(\d{1,3})\s*(?:questions?|qs)\s*,?\s*(\d{1,3}(?:\.\d+)?)\s*marks?\b(?:\s*,?\s*(\d{1,3})\s*min(?:ute)?s?\b)?\s*\.?$/i.exec(t);
    if (row) {
      if (!b) { attention("NO_CONTEXT", `“${t}”: say which stage (and post, if it differs by post) this row belongs to, with a “Stage:” line above it`, n); unread(n, "an exam pattern row with no stage above it"); return; }
      b.sections.push({ line: n, quote: t, subject: clean(row[1]), questions: Number(row[2]), marks: Number(row[3]) });
      return;
    }
    unread(n, b ? "not an exam pattern row (“Subject: N Questions, M Marks”)" : "under Exam Pattern, start with a “Stage:” line");
  }

  function readSyllabusLine(t: string, n: number) {
    const fresh = newBlock<SyllabusBlock>("syllabus", t, n);
    if (fresh) { block = fresh; provided("syllabus", n); return; }
    const m = /^subject\s*:\s*([^:|]+?)\s*[:|]\s*(?:topics?\s*:\s*)?(.+)$/i.exec(t);
    if (!m) { unread(n, "under Syllabus, a subject is written “Subject: name: topic; topic; topic”"); return; }
    let b = block as SyllabusBlock | null;
    if (!b) {
      attention("NO_CONTEXT", `“${t}”: say which stage (and post or paper, where they differ) this syllabus is for, with a “Stage:” line above it; it is not applied until then`, n);
      b = { line: n, quote: t, context: {}, scope: "ITEMS", state: "PROVIDED", subjects: [] };
      out.syllabus.push(b); block = b;
    }
    provided("syllabus", n);
    const body = clean(m[2]);
    const st = markerState(body);
    const topics = st ? [] : body.split(";").map((x) => clean(x).replace(/[.]+$/, "")).filter(Boolean);
    if (!st && topics.length === 1 && topics[0].length > 120 && topics[0].includes(",")) {
      attention("BAD_VALUE", `${clean(m[1])}: topics should be separated by semicolons; kept as one topic exactly as written`, n);
    }
    b.subjects.push({ line: n, quote: t, subject: clean(m[1]), topics, state: st ?? "PROVIDED" });
  }

  function readLinkLine(t: string, n: number) {
    const m = /^([A-Za-z][A-Za-z -]{1,40}?)\s*:\s*(.+)$/.exec(t);
    if (!m) { unread(n, "under Important Links, write “Type: label | https://… | For: who”"); return; }
    const label0 = clean(m[1]);
    const type = firstMatch(LINK_TYPES, label0);
    const rest = clean(m[2]);
    if (PENDING.test(rest) || markerState(rest)) {
      provided("links", n);
      out.pendingLinks.push({ line: n, quote: t, type: type ?? "OTHER", label: label0, says: rest });
      return;
    }
    const parts = rest.split("|").map(clean).filter(Boolean);
    const urls = parts.filter((p) => /^https?:\/\//i.test(p));
    if (urls.length !== 1) { unread(n, urls.length === 0 ? "a link line with no web address" : "a link line with more than one web address; give each its own line"); return; }
    const url = cleanUrl(urls[0]);
    if (!url) { attention("BAD_VALUE", `“${urls[0]}” is not a web address`, n); unread(n, "the web address could not be read"); return; }
    if (!type) attention("BAD_VALUE", `“${label0}” is not a link type this format knows; kept as “Other”`, n);
    let appliesTo: string | undefined;
    let label = label0;
    for (const p of parts) {
      if (p === urls[0]) continue;
      const f = /^(?:for|applies\s+to)\s*:\s*(.+)$/i.exec(p);
      if (f) appliesTo = clean(f[1]);
      else if (ACTOR.test(p.split(":")[0] ?? "")) attention("ACTOR_IGNORED", `“${p}” is ignored`, n);
      else label = p;
    }
    provided("links", n);
    out.links.push({ line: n, quote: t, type: type ?? "OTHER", label, url, ...(appliesTo ? { appliesTo } : {}), flags: linkFlags(url, urls[0]) });
  }

  function readAnnouncementLine(t: string, n: number) {
    const m = /^(title|text|date|action|relevant\s+until|stage)\s*:\s*(.*)$/i.exec(t);
    if (!m) {
      if (announcementOpen && announcementOpen.text !== undefined) { announcementOpen.text = `${announcementOpen.text} ${t}`; return; }
      unread(n, "under Announcement, write “Title:” and “Text:”"); return;
    }
    const key = m[1].toLowerCase().replace(/\s+/g, " "), value = clean(m[2]);
    provided("announcement", n);
    if (key === "title") {
      announcements++;
      announcementOpen = { line: n, quote: t, title: value, offeredUnticked: false };
      if (announcements === 1) out.announcement = announcementOpen;
      return;
    }
    if (!announcementOpen) { unread(n, "an announcement detail before its “Title:” line"); return; }
    if (key === "text") announcementOpen.text = value;
    else if (key === "action") {
      const type = firstMatch(LINK_TYPES, value);
      if (type && type !== "OTHER") announcementOpen.action = type;
      else attention("BAD_VALUE", `announcement action “${value}”: name a link type (Admit card, Result, Answer key, Apply Online…); it is ignored`, n);
    } else if (key === "stage") { if (value) announcementOpen.stage = value; }
    else {
      const d = oneDate(value);
      if (!d.iso) attention("BAD_DATE", `announcement ${key === "date" ? "date" : "“relevant until”"}: ${d.error}`, n);
      else if (key === "date") announcementOpen.date = d.iso;
      else announcementOpen.relevantUntil = d.iso;
    }
  }

  function readSupersedeLine(t: string, n: number) {
    const parts = t.split("|").map(clean).filter(Boolean);
    const head = parts[0].replace(/^[-*•]\s*/, "");
    const dm = /^(.+?)\s+[–—-]\s+(.+)$/.exec(head);
    if (!dm) { unread(n, "under Supersede, write “D Mon YYYY – announcement title | Reason: …”"); return; }
    provided("supersede", n);
    const d = oneDate(dm[1]);
    const item: SupersedeProposal = { line: n, quote: t, title: clean(dm[2]), problems: [], ...(d.iso ? { date: d.iso } : {}) };
    if (!d.iso) item.problems.push(`the date “${dm[1]}” could not be read`);
    for (const p of parts.slice(1)) {
      const k = /^([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*(.+)$/.exec(p);
      const key = k?.[1].toLowerCase() ?? "";
      if (key === "reason") item.reason = clean(k![2]);
      else if (key === "replaced by") item.replacedBy = clean(k![2]);
      else if (key === "source") { const u = cleanUrl(clean(k![2])); if (u) item.sourceUrl = u; else item.problems.push(`the source “${k![2]}” is not a web address`); }
      else if (ACTOR.test(key)) attention("ACTOR_IGNORED", `“${p}” is ignored: who supersedes an announcement is recorded by the CMS`, n);
      else attention("BAD_VALUE", `“${p}” is not understood and is ignored`, n);
    }
    if (!item.reason) item.problems.push("no reason is given (it is kept in the job's history, never shown publicly)");
    else if (item.reason.length > MAX_REASON) item.problems.push(`the reason is ${item.reason.length} characters; keep it to ${MAX_REASON}`);
    if (!item.replacedBy && !item.sourceUrl && !out.header.sourceLink) item.problems.push("say what replaces it: a newer announcement, or the official notice (“Source: https://…”)");
    out.supersede.push(item);
  }

  function readRemoval(spec: string, n: number) {
    const p = partsOf(spec);
    const kinds: Array<[RegExp, RemovalTarget]> = [[/^post$/i, "POST"], [/^stage$/i, "STAGE"], [/^selection\s+stage$/i, "SELECTION_STAGE"], [/^paper$/i, "PAPER"], [/^subject$/i, "SUBJECT"], [/^link$/i, "LINK"]];
    const target = p.head ? firstMatch(kinds, p.head.key) : undefined;
    if (!target || !p.head?.value) { unread(n, "“Remove:” must say what kind of item: Post, Stage, Selection stage, Paper, Subject or Link"); return; }
    let name = p.head.value;
    if (target === "LINK") { const u = cleanUrl(name); if (!u) { unread(n, "the link to remove is not a web address"); return; } name = u; }
    const context = contextFrom(p.keys, p.keys.get("stage") ? { stage: p.keys.get("stage") } : block?.context.stage ? { ...block.context } : {});
    if (target === "SUBJECT" && !context.stage) attention("NO_CONTEXT", `“${spec}”: say which stage the subject is removed from (“| Stage: …”)`, n);
    out.removals.push({ line: n, quote: clean(lines[n - 1]), target, name, context, ...(section && section !== "remove" ? { section } : {}) });
  }

  // ── Checks over the whole reading ───────────────────────

  function dedupe<T extends Quoted>(list: T[], key: (x: T) => string, value: (x: T) => string, what: string, set: (keep: T[]) => void) {
    const groups = new Map<string, T[]>();
    for (const x of list) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
    const keep: T[] = [];
    for (const g of groups.values()) {
      if (g.length === 1) { keep.push(g[0]); continue; }
      const distinct = new Set(g.map(value));
      if (distinct.size === 1) { keep.push(g[0]); attention("DUPLICATE", `the same ${what} is given twice; read once`, ...g.map((x) => x.line)); }
      else attention("CONFLICT", `two lines give different values for the same ${what}; neither is offered: ${g.map((x) => `“${x.quote}”`).join(" / ")}`, ...g.map((x) => x.line));
    }
    set(list.filter((x) => keep.includes(x)));
  }

  /** "Stage: Tier-II" given twice in the syllabus with no other difference: one block. */
  function mergeSyllabusBlocks() {
    const merged: SyllabusBlock[] = [];
    for (const b of out.syllabus) {
      const same = merged.find((m) => blockKey(m) === blockKey(b) && m.scope === b.scope && m.state === b.state);
      if (same) same.subjects.push(...b.subjects); else merged.push(b);
    }
    out.syllabus = merged;
  }

  /** The same stage given for one post and also with no post: which applies where is unclear. */
  function ambiguousContexts(blocks: Array<{ context: Context; line: number }>, what: string) {
    const byStage = new Map<string, Array<{ context: Context; line: number }>>();
    for (const b of blocks) { const k = squash(b.context.stage ?? ""); if (k) byStage.set(k, [...(byStage.get(k) ?? []), b]); }
    for (const g of byStage.values()) {
      const withPost = g.filter((b) => b.context.post), without = g.filter((b) => !b.context.post);
      if (withPost.length && without.length) {
        attention("AMBIGUOUS_CONTEXT", `the ${what} for “${g[0].context.stage}” is given for ${withPost.map((b) => `“${b.context.post}”`).join(", ")} and also with no post: say whether the second is for all posts or for a particular one`, ...g.map((b) => b.line));
      }
    }
  }
}

function describeContext(c: Context): string {
  return [c.stage, c.paper && c.paper !== c.stage ? c.paper : null, c.post ? `for ${c.post}` : null].filter(Boolean).join(", ") || "no stage given";
}

function minutes(s: string): number | undefined {
  const m = /(\d{1,3})\s*(?:minutes?|mins?)\b/i.exec(s);
  if (m) return Number(m[1]);
  const h = /(\d(?:\.\d)?)\s*(?:hours?|hrs?)\b/i.exec(s);
  return h ? Math.round(Number(h[1]) * 60) : undefined;
}
