// AI Assist — the longer sections of a notice: eligibility, age, selection,
// how to apply, pay scale, and official links.
//
// Same rules as the rest of AI Assist: nothing is invented, every item must be
// backed by a quote found in the source, and everything stays PENDING.
// The model writes facts in its own short words; the source's sentences are
// used only as evidence quotes and are never stored.

import * as cheerio from "cheerio";
import type { PageSection } from "@/intelligence/page-structurer";
import { structureDocument, normalizeForMatching } from "@/intelligence/page-structurer";
import { classifySourceUrl } from "@/intelligence/intake";
import { ORG_CATEGORY } from "@/intelligence/org-registry";
import type {
  AgeCriteria,
  CmsRecruitmentLink,
  CmsRecruitmentPost,
  CmsSelectionInformation,
  CmsSelectionStage,
  RecruitmentLinkType,
  SelectionStageType,
} from "@/types/recruitment-record";
import { callAiJson, parseDatesInText, type SourceKind } from "@/lib/cms/ai-assist";

// ─── Passages ─────────────────────────────────────────────

const DETAIL_HEADING_RE =
  /age|eligib|qualif|selection|exam\s+pattern|scheme\s+of\s+exam|tier|skill|typing|how\s+to\s+apply|salary|pay\s+(?:scale|level)|stipend|post\s+list|nationality/i;
// Editorial or historical material: not facts about this recruitment.
const DETAIL_EXCLUDE_RE = /cut.?off|previous\s+year|trend|\bvs\b|which\s+is\s+best|job\s+profile|syllabus|faq/i;
const DETAIL_TYPES = new Set(["eligibility", "selection", "how_to_apply"]);
const MAX_DETAIL_SECTIONS = 12;
const MAX_DETAIL_SECTION_CHARS = 3000;
const MAX_DETAIL_TOTAL_CHARS = 18_000;

const PDF_DETAIL_RE =
  /age\s+limit|educational\s+qualification|essential\s+qualification|eligibility\s+criteria|selection\s+(?:process|procedure)|scheme\s+of\s+examination|how\s+to\s+apply|pay\s+(?:scale|level)|stipend/gi;

function section(heading: string, text: string): PageSection {
  return { type: "other", heading, text, rawHtml: "", tables: [], lists: [], links: [], paragraphs: [] };
}

const SUBJECT_STOPWORDS = new Set([
  "recruitment", "examination", "exam", "notification", "combined", "level", "apply", "online", "posts", "post",
  "the", "for", "and", "of", "india", "board", "commission", "staff", "selection", "government", "govt",
]);

/** Distinctive words of the record's title and organisation ("ssc", "chsl", "apprentice"). */
export function subjectTokens(subject: string | undefined): string[] {
  if (!subject) return [];
  return [...new Set(
    normalizeForMatching(subject).split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !SUBJECT_STOPWORDS.has(w)),
  )];
}

// Aggregator pages end with cards for other recruitments ("PGIMER Nursing
// Officer Recruitment 2026 – Apply Online"). Their facts must never be mixed in.
const OTHER_JOB_HEADING_RE = /recruitment|notification|vacanc|bharti|apply\s+online/i;

function isOtherJobHeading(heading: string, tokens: string[]): boolean {
  if (tokens.length === 0 || !OTHER_JOB_HEADING_RE.test(heading)) return false;
  const h = normalizeForMatching(heading);
  return !tokens.some((t) => h.split(" ").includes(t));
}

export function buildDetailSections(content: string, kind: SourceKind, url: string, subject?: string): PageSection[] {
  const picked: Array<{ title: string; text: string }> = [];
  const tokens = subjectTokens(subject);

  if (kind === "html") {
    for (const s of structureDocument(content, url).sections) {
      const text = s.text.trim();
      if (!text || DETAIL_EXCLUDE_RE.test(s.heading) || isOtherJobHeading(s.heading, tokens)) continue;
      if (DETAIL_TYPES.has(s.type) || DETAIL_HEADING_RE.test(s.heading)) {
        // The heading is part of the source text: post names often appear only there.
        picked.push({ title: s.heading || "Section", text: s.heading ? `${s.heading}\n${text}` : text });
      }
    }
  } else {
    let lastEnd = -1;
    for (const m of content.matchAll(PDF_DETAIL_RE)) {
      const start = Math.max(0, (m.index ?? 0) - 100);
      if (start < lastEnd) continue;
      lastEnd = start + 2500;
      picked.push({ title: m[0], text: content.slice(start, lastEnd) });
    }
  }

  const out: PageSection[] = [];
  let total = 0;
  for (const p of picked) {
    if (out.length === MAX_DETAIL_SECTIONS) break;
    const text = p.text.slice(0, MAX_DETAIL_SECTION_CHARS);
    if (total + text.length > MAX_DETAIL_TOTAL_CHARS) break;
    total += text.length;
    out.push(section(`Detail ${out.length + 1}: ${p.title.replace(/\s+/g, " ").slice(0, 60)}`, text));
  }
  return out;
}

export function buildDetailPrompt(sections: PageSection[], url: string, subject?: string): string {
  const block = sections.map((s) => `## Section: ${s.heading}\n${s.text}`).join("\n\n");
  const scope = subject
    ? `\nThis record is about: ${subject}\nExtract facts for THIS recruitment only. Ignore any other recruitment, exam or job mentioned in the text.\n`
    : "";
  return `You are extracting facts from an Indian government recruitment notice or a page describing one.

Source URL: ${url}
${scope}
${block}

---

Return ONE JSON object with any of the fields below. Include a field ONLY when the text above states it. Never guess and never use outside knowledge.

Write every value in your own short, neutral words. Do not copy sentences, except in "evidence".
Every "evidence" is a verbatim quote (10–200 characters) copied from the text above that supports the item.

{
  "howToApply": { "steps": ["short step", "..."], "evidence": "..." },
  "age": {
    "min": <integer years>, "max": <integer years>, "asOf": "YYYY-MM-DD",
    "evidence": "quote stating the age limit",
    "relaxations": [ { "category": "OBC", "years": <integer>, "evidence": "..." } ]
  },
  "eligibility": [ { "post": "post name", "qualification": "required qualification", "evidence": "..." } ],
  "selection": {
    "stages": [ { "name": "Tier 1", "type": "CBT|WRITTEN|SKILL_TEST|INTERVIEW|DOCUMENT_VERIFICATION|PHYSICAL|OTHER", "summary": "e.g. 100 questions, 200 marks, 60 minutes", "evidence": "..." } ],
    "negativeMarking": { "value": "e.g. 0.50 marks per wrong answer", "evidence": "..." }
  },
  "payScale": { "value": "e.g. Pay Level 2 (Rs. 19,900 – 63,200)", "evidence": "..." },
  "summary": "one plain sentence for a job listing"
}

Rules:
1. Omit any field, list item or sub-field the text does not state.
2. "howToApply": at most 8 steps, in order.
3. "eligibility": one item per post or group of posts, at most 12.
4. "selection.stages": in the order candidates go through them. "summary" is optional.
5. Numbers must be exactly as written in the text.
6. "summary": ONE or TWO plain sentences, 80–220 characters, for a job listing: what the recruitment is, the posts, who can apply and the last date to apply, as far as the text states them. Factual and neutral — no advice, no praise, no "hurry", no exclamation marks.`;
}

// ─── Verification ─────────────────────────────────────────

interface Evidence {
  /** Normalised text of every passage sent to the model. */
  text: string;
  /** Every number that appears in those passages. */
  numbers: Set<string>;
}

function numbersIn(text: string): string[] {
  return (text.replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ""));
}

export function buildEvidence(sections: PageSection[]): Evidence {
  const joined = sections.map((s) => s.text).join("\n");
  return { text: normalizeForMatching(joined), numbers: new Set(numbersIn(joined)) };
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= max ? t : null;
};

function quoteFound(quote: unknown, ev: Evidence): quote is string {
  if (typeof quote !== "string") return false;
  const q = normalizeForMatching(quote);
  return q.length >= 8 && ev.text.includes(q);
}

/** Every number in a model-written value must appear somewhere in the source passages. */
function numbersSupported(value: string, ev: Evidence): boolean {
  return numbersIn(value).every((n) => ev.numbers.has(n));
}

const hasWholeNumber = (text: string, n: number) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(text);

export type DetailOutcome<T> =
  | { status: "accepted"; value: T; dropped: number }
  | { status: "not_stated" }
  | { status: "rejected"; reason: string }
  | { status: "skipped"; reason: string };

const notStated = { status: "not_stated" } as const;

export function judgeHowToApply(raw: unknown, ev: Evidence): DetailOutcome<string[]> {
  if (typeof raw !== "object" || raw === null) return notStated;
  const r = raw as { steps?: unknown; evidence?: unknown };
  if (!Array.isArray(r.steps)) return notStated;
  if (!quoteFound(r.evidence, ev)) return { status: "rejected", reason: "AI quote not found in the source text" };
  const steps = r.steps.map((s) => str(s, 220)).filter((s): s is string => s !== null).slice(0, 8);
  if (steps.length < 2) return { status: "rejected", reason: "fewer than two usable steps" };
  return { status: "accepted", value: steps, dropped: r.steps.length - steps.length };
}

export function judgeAge(raw: unknown, ev: Evidence): DetailOutcome<AgeCriteria> {
  if (typeof raw !== "object" || raw === null) return notStated;
  const r = raw as { min?: unknown; max?: unknown; asOf?: unknown; evidence?: unknown; relaxations?: unknown };
  const okAge = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 14 && (v as number) <= 70;
  const min = okAge(r.min) ? r.min : undefined;
  const max = okAge(r.max) ? r.max : undefined;

  let dropped = 0;
  const relaxations: AgeCriteria["relaxations"] = [];
  for (const item of Array.isArray(r.relaxations) ? r.relaxations.slice(0, 15) : []) {
    const it = (item ?? {}) as { category?: unknown; years?: unknown; evidence?: unknown };
    const category = str(it.category, 60);
    const years = Number.isInteger(it.years) && (it.years as number) >= 1 && (it.years as number) <= 20 ? (it.years as number) : null;
    if (category && years !== null && quoteFound(it.evidence, ev) && hasWholeNumber(it.evidence, years)) {
      relaxations.push({ category, years });
    } else {
      dropped++;
    }
  }

  const limitsStated = min !== undefined || max !== undefined;
  if (!limitsStated && relaxations.length === 0) return notStated;

  const value: AgeCriteria = { relaxations };
  if (limitsStated) {
    if (!quoteFound(r.evidence, ev)) return { status: "rejected", reason: "AI quote for the age limit not found in the source text" };
    if ((min !== undefined && !hasWholeNumber(r.evidence, min)) || (max !== undefined && !hasWholeNumber(r.evidence, max))) {
      return { status: "rejected", reason: "age limit does not appear in the quoted source text" };
    }
    if (min !== undefined && max !== undefined && min > max) return { status: "rejected", reason: "minimum age is above the maximum" };
    if (min !== undefined) value.min = min;
    if (max !== undefined) value.max = max;
    // The reference date is kept only if the source text states that exact date.
    if (typeof r.asOf === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(r.asOf)) {
      const stated = ev.text.length > 0 && parseDatesInText(r.evidence).includes(r.asOf);
      if (stated) value.asOf = r.asOf;
    }
  }
  return { status: "accepted", value, dropped };
}

export function judgeEligibility(raw: unknown, ev: Evidence): DetailOutcome<CmsRecruitmentPost[]> {
  if (!Array.isArray(raw) || raw.length === 0) return notStated;
  const posts: CmsRecruitmentPost[] = [];
  let dropped = 0;
  for (const item of raw.slice(0, 12)) {
    const it = (item ?? {}) as { post?: unknown; qualification?: unknown; evidence?: unknown };
    const post = str(it.post, 120);
    const qualification = str(it.qualification, 240);
    // The post must be named in the source: at least one distinctive word of it.
    const named = post !== null && normalizeForMatching(post).split(" ").some((w) => w.length >= 4 && ev.text.includes(w));
    if (post && qualification && named && quoteFound(it.evidence, ev) && numbersSupported(qualification, ev)) {
      posts.push({ post, qualification: [qualification] });
    } else {
      dropped++;
    }
  }
  if (posts.length === 0) return { status: "rejected", reason: "no eligibility item could be matched to the source text" };
  return { status: "accepted", value: posts, dropped: dropped + Math.max(0, raw.length - 12) };
}

const STAGE_TYPES = new Set<SelectionStageType>(["WRITTEN", "CBT", "INTERVIEW", "SKILL_TEST", "DOCUMENT_VERIFICATION", "PHYSICAL", "OTHER"]);

export function judgeSelection(raw: unknown, ev: Evidence): DetailOutcome<CmsSelectionInformation> {
  if (typeof raw !== "object" || raw === null) return notStated;
  const r = raw as { stages?: unknown; negativeMarking?: unknown };
  const stages: CmsSelectionStage[] = [];
  let dropped = 0;

  for (const item of Array.isArray(r.stages) ? r.stages.slice(0, 8) : []) {
    const it = (item ?? {}) as { name?: unknown; type?: unknown; summary?: unknown; evidence?: unknown };
    const name = str(it.name, 80);
    if (!name || !quoteFound(it.evidence, ev)) { dropped++; continue; }
    const type = STAGE_TYPES.has(it.type as SelectionStageType) ? (it.type as SelectionStageType) : "OTHER";
    const stage: CmsSelectionStage = { name, order: stages.length + 1, type };
    const summary = str(it.summary, 160);
    if (summary && numbersSupported(summary, ev)) stage.description = summary;
    stages.push(stage);
  }

  const value: CmsSelectionInformation = {};
  if (stages.length > 0) value.stages = stages;
  const nm = (r.negativeMarking ?? {}) as { value?: unknown; evidence?: unknown };
  const negative = str(nm.value, 160);
  if (negative && quoteFound(nm.evidence, ev) && numbersSupported(negative, ev)) value.negativeMarking = negative;

  if (!value.stages && !value.negativeMarking) {
    return dropped > 0 ? { status: "rejected", reason: "no selection stage could be matched to the source text" } : notStated;
  }
  return { status: "accepted", value, dropped };
}

export function judgePayScale(raw: unknown, ev: Evidence): DetailOutcome<string> {
  if (typeof raw !== "object" || raw === null) return notStated;
  const r = raw as { value?: unknown; evidence?: unknown };
  const value = str(r.value, 160);
  if (!value) return notStated;
  if (!quoteFound(r.evidence, ev)) return { status: "rejected", reason: "AI quote not found in the source text" };
  if (!numbersSupported(value, ev)) return { status: "rejected", reason: "a number in the pay scale does not appear in the source text" };
  return { status: "accepted", value, dropped: 0 };
}

export interface DetailExtraction {
  howToApply: DetailOutcome<string[]>;
  age: DetailOutcome<AgeCriteria>;
  eligibility: DetailOutcome<CmsRecruitmentPost[]>;
  selection: DetailOutcome<CmsSelectionInformation>;
  payScale: DetailOutcome<string>;
  /** Unchecked listing sentence written by the model; see summarySupported. */
  summary: string | null;
}

/** One AI request for the longer sections. Never throws. */
export async function extractDetails(opts: {
  sections: PageSection[];
  url: string;
  apiKey: string | undefined;
  /** Record title and organisation, so facts about other jobs on the page are ignored. */
  subject?: string;
  fetchFn?: typeof fetch;
  maxOutputTokens?: number;
}): Promise<DetailExtraction> {
  const all = <T,>(o: DetailOutcome<T>) => o;
  const skipped = (reason: string): DetailExtraction => ({
    howToApply: all({ status: "skipped", reason }),
    age: all({ status: "skipped", reason }),
    eligibility: all({ status: "skipped", reason }),
    selection: all({ status: "skipped", reason }),
    payScale: all({ status: "skipped", reason }),
    summary: null,
  });
  if (opts.sections.length === 0) return skipped("nothing relevant found in the source");

  const answer = await callAiJson({ ...opts, prompt: buildDetailPrompt(opts.sections, opts.url, opts.subject) });
  if (!answer.ok) return skipped(answer.reason);

  const ev = buildEvidence(opts.sections);
  const raw = answer.data;
  return {
    howToApply: judgeHowToApply(raw.howToApply, ev),
    age: judgeAge(raw.age, ev),
    eligibility: judgeEligibility(raw.eligibility, ev),
    selection: judgeSelection(raw.selection, ev),
    payScale: judgePayScale(raw.payScale, ev),
    summary: str(raw.summary, 300),
  };
}

export const DETAIL_FIELDS: Array<{ key: Exclude<keyof DetailExtraction, "summary">; fieldPath: string; label: string }> = [
  { key: "eligibility", fieldPath: "eligibility",        label: "Post-wise Eligibility" },
  { key: "age",         fieldPath: "age",                label: "Age Limit" },
  { key: "selection",   fieldPath: "selection",          label: "Selection Process" },
  { key: "howToApply",  fieldPath: "howToApply",         label: "How to Apply" },
  { key: "payScale",    fieldPath: "financial.payScale", label: "Pay Scale" },
];

// ─── Listing details (classification) ─────────────────────
//
// Derived from facts already on the record — no AI. Only EMPTY sub-fields are
// filled; anything the admin has set is left alone.

const LEVEL_ORDER = ["10th Pass", "12th Pass", "ITI", "Diploma", "Graduate", "Post Graduate"] as const;
type Level = (typeof LEVEL_ORDER)[number];

function levelOf(text: string): Level | null {
  const t = text.toLowerCase();
  if (/post[\s-]?graduat|master'?s|\bm\.?\s?(?:tech|sc|a|com|ba|ca)\b|\bpg\b/.test(t)) return "Post Graduate";
  if (/\b10th|matric|high\s+school|class\s*(?:10|x)\b|\bsslc\b/.test(t) && !/12th|10\s*\+\s*2/.test(t)) return "10th Pass";
  if (/12th|10\s*\+\s*2|intermediate|higher\s+secondary|senior\s+secondary|class\s*(?:12|xii)\b/.test(t)) return "12th Pass";
  if (/\biti\b/.test(t)) return "ITI";
  if (/diploma/.test(t)) return "Diploma";
  if (/graduat|degree|bachelor|\bb\.?\s?(?:tech|sc|a|com|e|ed)\b/.test(t)) return "Graduate";
  return null;
}

/** The lowest qualification any post asks for: the level a candidate needs to be eligible for something. */
export function qualificationLevel(posts: CmsRecruitmentPost[] | null | undefined): Level | null {
  const levels = (posts ?? [])
    .map((p) => levelOf((p.qualification ?? []).join(" ")))
    .filter((l): l is Level => l !== null);
  if (levels.length === 0) return null;
  return levels.sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))[0];
}

export interface ListingDetails {
  shortDescription?: string;
  category?: string;
  state?: string;
  qualification?: string;
}

type Val = { value: unknown } | null | undefined;

/** The parts of a record a listing sentence may draw on. */
export interface ListingSource {
  identity: { organizationId: string; organizationName: string; govType?: string; recruitmentYear?: number; title: { value: string | null } };
  eligibility?: { value: CmsRecruitmentPost[] | null } | null;
  classification?: ListingDetails | null;
  dates?: Record<string, Val> | object;
  vacancies?: { total?: Val };
  financial?: Record<string, Val> | object;
  age?: Val;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SUMMARY_BANNED_RE = /https?:|www\.|!|\b(?:hurry|best|golden|great|excellent|don'?t miss|guaranteed|dream)\b/i;

/**
 * A model-written listing sentence is kept only if it invents nothing: every
 * number in it is already a value on the record, and every month it names is
 * the month of one of the record's dates.
 */
export function summarySupported(summary: string | null | undefined, record: ListingSource): summary is string {
  if (!summary) return false;
  const text = summary.replace(/\s+/g, " ").trim();
  if (text.length < 60 || text.length > 260 || SUMMARY_BANNED_RE.test(text)) return false;

  const vals = (group: unknown): unknown[] =>
    Object.values((group ?? {}) as Record<string, Val>).map((f) => (f && typeof f === "object" ? f.value : null));
  const dateValues = vals(record.dates).filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const facts = JSON.stringify([
    record.identity.title.value,
    record.identity.recruitmentYear,
    dateValues,
    record.vacancies?.total?.value,
    vals(record.financial),
    record.age?.value,
    record.eligibility?.value,
    record.classification?.qualification,
  ]);
  const known = new Set(numbersIn(facts));
  if (!numbersIn(text).every((n) => known.has(n))) return false;

  const months = new Set(dateValues.map((d) => MONTHS[Number(d.slice(5, 7)) - 1]));
  const lower = text.toLowerCase();
  // "may" counts as a month only next to a number ("7 May", "May 2026"), not in "may apply".
  const named = (m: string) =>
    m === "may" ? /\d(?:st|nd|rd|th)?\s+may\b(?!\s+[a-z])|\bmay\s+\d/.test(lower) : new RegExp(`\\b${m}\\b`).test(lower);
  return MONTHS.every((m) => !named(m) || months.has(m));
}

export function deriveListingDetails(
  record: ListingSource,
  /** Listing sentence written by the model, if any. Used only when it passes summarySupported. */
  aiSummary?: string | null,
): { value: ListingDetails; added: string[] } {
  const current = record.classification ?? {};
  const value: ListingDetails = { ...current };
  const added: string[] = [];

  if (!current.qualification) {
    const level = qualificationLevel(record.eligibility?.value);
    if (level) { value.qualification = level; added.push(`Qualification: ${level}`); }
  }
  if (!current.category) {
    const category = ORG_CATEGORY[record.identity.organizationId];
    if (category && category !== "private" && category !== "internship") {
      value.category = category;
      added.push(`Category: ${category}`);
    }
  }
  // Central and PSU recruitments are listed as All India, as the intake pipeline does.
  if (!current.state && (record.identity.govType === "Central Govt" || record.identity.govType === "PSU")) {
    value.state = "All India";
    added.push("Location: All India");
  }
  if (!current.shortDescription) {
    // Qualification derived above counts as a record fact for the check.
    if (summarySupported(aiSummary, { ...record, classification: value })) {
      value.shortDescription = aiSummary.replace(/\s+/g, " ").trim();
      added.push(`Short description (AI-written — read it before publishing): ${value.shortDescription}`);
    } else if (record.identity.title.value) {
      // A neutral line with nothing in it that can go out of date.
      value.shortDescription = `${record.identity.title.value} — recruitment by ${record.identity.organizationName}. Check eligibility, important dates, application fee and how to apply.`.slice(0, 300);
      added.push(`Short description (standard wording): ${value.shortDescription}`);
    }
  }
  return { value, added };
}

// ─── Official links ───────────────────────────────────────

export interface SuggestedLink extends CmsRecruitmentLink {
  /** The row or sentence the link sits in on the source page. */
  context: string;
  /** Host of the link, shown so the admin can see why it is treated as official. */
  host: string;
}

const LINK_LABELS: Partial<Record<RecruitmentLinkType, string>> = {
  OFFICIAL_NOTIFICATION: "Official Notification",
  APPLY_ONLINE: "Apply Online",
  OFFICIAL_WEBSITE: "Official Website",
  CORRIGENDUM: "Corrigendum",
  ADMIT_CARD: "Admit Card",
  RESULT: "Result",
  ANSWER_KEY: "Answer Key",
  EXAM_NOTICE: "Exam Notice",
};

function classifyLink(context: string, href: URL): RecruitmentLinkType | null {
  const c = context.toLowerCase();
  const path = href.pathname.toLowerCase();
  if (/corrigendum|addendum/.test(c)) return "CORRIGENDUM";
  if (/admit\s*card|hall\s*ticket/.test(c)) return "ADMIT_CARD";
  if (/answer\s*key/.test(c)) return "ANSWER_KEY";
  if (/\bresult/.test(c)) return "RESULT";
  if (/exam\s+date|exam\s+schedule|exam\s+notice|city\s+intimation/.test(c)) return "EXAM_NOTICE";
  if (/apply|registration|register/.test(c) || /login|apply|register/.test(path)) return "APPLY_ONLINE";
  if (/notification|advertisement|advt|\bnotice\b/.test(c)) return "OFFICIAL_NOTIFICATION";
  if (/official\s+website|home\s*page/.test(c) || path === "/" || path === "") return "OFFICIAL_WEBSITE";
  return null;
}

// Links on the page that point to a domain the project already recognises as
// official (its registry, or gov.in / nic.in). They are only SUGGESTED: nothing
// is added to the record until the admin clicks.
export function extractOfficialLinks(html: string, pageUrl: string, existingUrls: string[] = []): SuggestedLink[] {
  const $ = cheerio.load(html);
  const have = new Set(existingUrls.map((u) => u.replace(/\/+$/, "")));
  const byType = new Map<RecruitmentLinkType, SuggestedLink & { score: number }>();

  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href") ?? "";
    let href: URL;
    try {
      href = new URL(raw, pageUrl);
    } catch {
      return;
    }
    if (href.protocol !== "http:" && href.protocol !== "https:") return;
    if (classifySourceUrl(href.toString()).kind !== "OFFICIAL") return;

    const url = href.toString();
    if (have.has(url.replace(/\/+$/, ""))) return;

    // Aggregators label links "Click Here"; the meaning is in the table row or
    // list item. A link inside running text is described by its own text only,
    // so a paragraph that happens to say "notification" does not label it.
    const row = $(el).closest("tr");
    const item = $(el).closest("li");
    const labelled = row.length > 0 || item.length > 0;
    const context = (row.length ? row.text() : item.length ? item.text() : $(el).text()).replace(/\s+/g, " ").trim().slice(0, 140);
    const type = classifyLink(context, href);
    if (!type) return;

    const isPdf = /\.pdf$/i.test(href.pathname);
    const score = (labelled ? 2 : 0) + (type === "OFFICIAL_NOTIFICATION" && isPdf ? 2 : 0) + (type === "OFFICIAL_WEBSITE" && href.pathname.length <= 1 ? 1 : 0);
    const current = byType.get(type);
    if (current && current.score >= score) return;

    byType.set(type, { type, label: LINK_LABELS[type] ?? "Link", url, official: true, context, host: href.hostname, score });
  });

  const order: RecruitmentLinkType[] = ["OFFICIAL_NOTIFICATION", "APPLY_ONLINE", "OFFICIAL_WEBSITE", "CORRIGENDUM", "EXAM_NOTICE", "ADMIT_CARD", "RESULT", "ANSWER_KEY"];
  return order
    .map((t) => byType.get(t))
    .filter((l): l is SuggestedLink & { score: number } => l !== undefined)
    .map((l) => ({ type: l.type, label: l.label, url: l.url, official: l.official, context: l.context, host: l.host }));
}
