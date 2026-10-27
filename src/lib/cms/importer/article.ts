// ═══════════════════════════════════════════════════════════
// Smart intake: one reading of a whole article or notice
// ═══════════════════════════════════════════════════════════
//
// Server only. AI Assist reads a notice through keyword windows, one request
// per topic, and is kept as it is. This reads the WHOLE text once and maps it
// onto every section of the job record, including the ones AI Assist does not
// fill: the vacancy breakdown, exam stages, category-wise age limits and the
// notice's explanatory notes.
//
// The model must quote the source for everything. A value is kept only when
// its quote is in the text word for word, and every number in it appears in
// its quote (dates: in a recognisable form). Anything else is refused, with
// the reason, and never shown as a proposal.

import { callAiJson } from "@/lib/cms/ai-assist";
import { pageOf } from "@/lib/cms/importer/evidence-text";
import { classifyStageName } from "@/lib/exam-stage-kind";
import type { ExtractedValue } from "@/lib/cms/importer/proposal";
import type { ExamStage, VacancyRow, AgeRelaxation, AgeEvidence, PostAgeRange } from "@/types";
import type {
  AgeCriteria, CmsRecruitmentPost, CmsSelectionInformation, CmsSelectionStage, ExamPatternPaper, SelectionStageType, SyllabusSubject,
} from "@/types/recruitment-record";

// The whole notice is read, up to Smart intake's own limit on a source's text
// (MAX_TEXT_CHARS): long official notices keep their vacancy tables in an
// annexure near the end (IBPS: pages 44-53 of 76). A long text gets a longer
// answer and more time; the preview route allows 60 s.
export const ARTICLE_MAX_CHARS = 200_000;
/** Room for one reading's answer, in tokens (the model's thinking uses some of it). */
export const ANSWER_TOKENS = 16_384;
const READ_TIMEOUT_MS = 50_000;
const MAX_ITEMS = 40;

export interface ArticleReading {
  values: ExtractedValue[];
  refused: Array<{ fieldPath: string; reason: string }>;
  /** Why nothing was read (no key, the daily cap, the model failed). */
  skipped?: string;
}

type J = Record<string, unknown>;

export function buildArticlePrompt(text: string, subject: string, part?: { first: number; last: number; pages: number }): string {
  const scope = part
    ? `\nThe TEXT below is pages ${part.first} to ${part.last} of a ${part.pages}-page notice; the other pages are read separately. Give what THESE pages state, even when it seems minor or continues from another page. The lines "-- N of ${part.pages} --" mark page ends.\n`
    : "";
  return `You are reading a government recruitment notice or an article about one: "${subject}".
Map what it says onto the fields below. Use ONLY what the text states. Never guess, never fill a field from general knowledge.
${scope}
Every value comes with "quote": words copied EXACTLY from the text (10 to 250 characters) that contain the value.
Leave a field out when the text does not state it. Facts about other recruitments mentioned on the page are ignored.

Return one JSON object with any of:
- "notificationNumber": { "value": as written, e.g. "29/2026", "quote" }
- "dates": { "<name>": { "value": "YYYY-MM-DD", "quote" } } for: applicationOpenDate, applicationCloseDate, feePaymentCloseDate, correctionWindowEnd, examDate, admitCardDate, interviewDate, resultDate. The date the article was posted is not a recruitment date. A month without a day is not a date.
- "totalVacancies": { "value": integer, "quote" }
- "vacancyRows": [ { "post", "count": integer, "quote", "payScale"?: as written, "categories"?: [ { "category": as written, "count": integer, "quote" } ] } ] — one row per post; category-wise counts as given in the text go in that post's "categories", never as rows of their own.
- "feeGeneral": { "value": integer rupees for General/UR/OBC or for everyone when one fee applies to all, "quote" }
- "feeSCST": { "value": integer rupees, 0 only when the text says exempt/nil, "quote" } — only when the text states the SC/ST fee separately.
- "payScale": { "value": as written, e.g. "Pay Level 6, Grade Pay Rs 4,200", "quote" }
- "age": { "min"?: integer, "max"?: integer for General/UR men — only when one range applies to every post, "asOf"?: "YYYY-MM-DD", "quote", "categoryMax"?: [ { "category", "max": integer, "quote" } ] — upper ages printed by category, "postWise"?: [ { "post": the post's name as printed, "min"?: integer, "max"?: integer, "bornFrom"?: "YYYY-MM-DD", "bornTo"?: "YYYY-MM-DD" — the date-of-birth range printed for the post, "quote": the post's own line(s) with its name and figures, "asOf"?: { "value": "YYYY-MM-DD", "quote" } — only when this post's age is counted on a date of its own, "relaxations"?: [ { "category", "years"?: integer, "text"?: as written, "quote" } ] — relaxations printed for this post only, "categoryMax"?: [ { "category", "max": integer, "quote" } ] — upper ages printed for this post } ] — when the notice sets ages post by post: one item per post, as printed; never a range worked out across posts }
- "eligibility": [ { "post", "qualifications": [ each copied from the text ], "quote" } ]
- "selectionStages": [ { "name", "type": one of WRITTEN, CBT, INTERVIEW, SKILL_TEST, DOCUMENT_VERIFICATION, PHYSICAL, OTHER, "description"?: copied from the text, "quote" } ] in order.
- "examStages": [ { "name", "date"?: "YYYY-MM-DD" or null when not announced, "dateText"?: as written, e.g. "To be announced", "quote" } ] — each entry of the schedule after applying, in the notice's order: examinations, interviews and document verification, and also call-letter or admit-card downloads, results and training, each as its own entry with its name as printed. Not the notification, the application or registration window, the fee payment or document deadlines: those dates are read separately. Include an entry from a schedule or "important dates" table whose date is only a month or "to be announced": then "date" is null and "dateText" is the month or words as written.
- "examPattern": [ { "name": paper name, "durationMinutes"?: integer, "totalQuestions"?: integer, "totalMarks"?: integer, "sections": [ { "subject", "questions"?: integer, "marks"?: integer } ], "note"?: copied, "quote" } ]
- "syllabus": [ { "subject", "topics": [ each copied from the text ], "paper"?: name, "quote" } ]
- "howToApply": [ { "step": copied from the text, "quote" } ] in order.
- "notes": [ { "text": copied from the text, "quote" } ] — rules a candidate must know that fit no field above (qualifying marks, reservation rules, documents deadlines, training). At most 12. No marketing, coaching or course text.

TEXT:
${text.slice(0, ARTICLE_MAX_CHARS)}`;
}

// ── Checks ────────────────────────────────────────────────

const norm = (s: string) => s
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/₹/g, "rs ")
  .replace(/\s+/g, " ").trim().toLowerCase();
const digitGroups = (s: string): string[] => s.replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? [];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The date is written in the quote: its year, and its day with its month (as a number or a name). */
export function dateInQuote(iso: string, quote: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || Number.isNaN(Date.parse(iso)) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) return false;
  const q = norm(quote);
  const [y, mo, d] = [m[1], Number(m[2]), Number(m[3])];
  if (!q.includes(y) && !q.includes(`-${y.slice(2)}`) && !q.includes(`/${y.slice(2)}`)) return false;
  const day = `0?${d}`;
  const numeric = new RegExp(`\\b${day}[./-]0?${mo}[./-]`).test(q) || new RegExp(`\\b${y}-0?${mo}-${day}\\b`).test(q);
  const named = new RegExp(`\\b${day}(st|nd|rd|th)?\\s+${MONTHS[mo - 1]}`).test(q) || new RegExp(`${MONTHS[mo - 1]}[a-z]*\\.?\\s+${day}(st|nd|rd|th)?\\b`).test(q);
  return numeric || named;
}

function makeChecker(text: string) {
  const source = norm(text);
  const inText = (s: unknown): s is string => typeof s === "string" && s.trim().length >= 3 && source.includes(norm(s));
  const numbersIn = (value: string, where: string) => digitGroups(value).every((n) => digitGroups(where).includes(n));
  return { inText, numbersIn, source };
}

const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : typeof v === "string" && /^\d[\d,]*$/.test(v.trim()) ? Number(v.replace(/,/g, "")) : undefined);
const str = (v: unknown, max = 300): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const arr = (v: unknown): J[] => (Array.isArray(v) ? v.filter((x): x is J => !!x && typeof x === "object").slice(0, MAX_ITEMS) : []);
const obj = (v: unknown): J | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : undefined);

const ARTICLE_DATE = /\b(posted|updated|published|last modified)\b(?![^.]*\b(notification|advertisement|notice)\b)/i;
const DATE_KEYS = ["applicationOpenDate", "applicationCloseDate", "feePaymentCloseDate", "correctionWindowEnd", "examDate", "admitCardDate", "interviewDate", "resultDate"] as const;
/** Words a date's quote must contain to be that date: the event it belongs to. */
const DATE_EVENT: Record<(typeof DATE_KEYS)[number], RegExp> = {
  applicationOpenDate: /appl(?:y|ication)|regist|online|start|commenc|open|begin|invit/i,
  applicationCloseDate: /appl(?:y|ication)|regist|online|last\s+date|clos|end|till|upto|up\s+to|until|invit/i,
  feePaymentCloseDate: /\bfees?\b|payment|charges/i,
  correctionWindowEnd: /correct|edit|modif|rectif/i,
  examDate: /exam|test\b|\bcbt\b|\bwritten\b/i,
  admitCardDate: /admit|call\s+letter|hall\s+ticket/i,
  interviewDate: /interview/i,
  resultDate: /result/i,
};
/** The editor's limit on an exam stage's name. */
const STAGE_NAME_MAX = 80;
/** The editor's lowest age: a smaller "maximum age" is relaxation years, not an age. */
const MIN_PRINTED_AGE = 14;
const STAGE_TYPES: SelectionStageType[] = ["WRITTEN", "CBT", "INTERVIEW", "SKILL_TEST", "DOCUMENT_VERIFICATION", "PHYSICAL", "OTHER"];

/**
 * Category names as written → the breakdown's usual keys (ur, ews, obc, sc,
 * st, exsm); any other column (EBC, BC, "Backward Class Women") is kept under
 * its own name, as the editor stores the split: a flat name → count list.
 */
function categoryKey(label: string): string | null {
  const l = label.toLowerCase();
  if (/women|female/.test(l)) return null;                     // "Backward Class Women" is its own column
  if (/\b(ur|unreserved|general|gen)\b/.test(l)) return "ur";
  if (/\bews\b|economically weaker/.test(l)) return "ews";
  if (/\bobc\b|other backward/.test(l)) return "obc";
  if (/\bsc\b|scheduled caste/.test(l)) return "sc";
  if (/\bst\b|scheduled tribe/.test(l)) return "st";
  if (/ex-?servicemen|\besm\b|\bexsm\b/.test(l)) return "exsm";
  return null;
}

// Seats counted inside the other categories, not alongside them.
const HORIZONTAL = new Set(["women", "exsm", "pwbd"]);

/**
 * The model sometimes returns one post's category table as one row per
 * category ("Food Safety Officer 41 (UR)", "Food Safety Officer 11 (EWS)"…).
 * Rows with the same post where each holds a single category equal to its
 * count are put back together as one row: the categories become its split,
 * and its count is their sum (horizontal seats left out of the sum). Rows
 * that are not like that are left exactly as they are.
 */
export function mergeCategoryRows(rows: VacancyRow[]): VacancyRow[] {
  const key = (post: string) => post.toLowerCase().replace(/\s+/g, " ").trim();
  const isCategoryRow = (r: VacancyRow) => {
    const entries = Object.entries(r.breakdown ?? {});
    return entries.length === 1 && entries[0][1] === r.count;
  };
  const groups = new Map<string, VacancyRow[]>();
  for (const r of rows) groups.set(key(r.post), [...(groups.get(key(r.post)) ?? []), r]);
  const out: VacancyRow[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    const k = key(r.post);
    const group = groups.get(k)!;
    if (group.length < 2 || !group.every(isCategoryRow)) { out.push(r); continue; }
    if (done.has(k)) continue;
    done.add(k);
    const breakdown: Record<string, number> = {};
    for (const g of group) Object.assign(breakdown, g.breakdown);
    const count = Object.entries(breakdown).filter(([c]) => !HORIZONTAL.has(c)).reduce((sum, [, n]) => sum + (n as number), 0);
    const merged: VacancyRow = { post: group[0].post, count, breakdown: breakdown as VacancyRow["breakdown"] };
    const pay = group.find((g) => g.payScale)?.payScale;
    if (pay) merged.payScale = pay;
    out.push(merged);
  }
  return out;
}

/** Turns the model's answer into checked values; pure, so it is tested without a model. */
export function judgeArticle(raw: J, text: string): Omit<ArticleReading, "skipped"> {
  const { inText, numbersIn } = makeChecker(text);
  const values: ExtractedValue[] = [];
  const refused: ArticleReading["refused"] = [];
  const keep = (fieldPath: string, value: unknown, quote: string) => values.push({ fieldPath, value, quote, page: pageOf(text, quote) });
  const refuse = (fieldPath: string, reason: string) => refused.push({ fieldPath, reason });
  const quoted = (fieldPath: string, q: unknown): q is string => {
    if (inText(q)) return true;
    refuse(fieldPath, "the quote is not in the text");
    return false;
  };

  const num = obj(raw.notificationNumber);
  if (num) {
    const v = str(num.value, 60);
    if (v && quoted("identity.notificationNumber", num.quote)) {
      if (norm(num.quote as string).includes(norm(v))) keep("identity.notificationNumber", v, num.quote as string);
      else refuse("identity.notificationNumber", "the number is not in its quote");
    }
  }

  const dates = obj(raw.dates) ?? {};
  for (const key of DATE_KEYS) {
    const d = obj(dates[key]);
    if (!d) continue;
    const path = `dates.${key}`;
    const v = str(d.value, 10);
    if (!v || !quoted(path, d.quote)) continue;
    // "Posted on 15 October 2026", "Updated on …": the article's own date.
    if (ARTICLE_DATE.test(d.quote as string)) refuse(path, "the quote dates the article, not the recruitment");
    else if (!dateInQuote(v, d.quote as string)) refuse(path, "the date is not written in its quote");
    // A date beside another event ("Director, Date: 01.09.2026", "result on or before …") is not this one.
    else if (!DATE_EVENT[key].test(d.quote as string)) refuse(path, "the quote does not name this event");
    else keep(path, v, d.quote as string);
  }

  const tv = obj(raw.totalVacancies);
  if (tv && int(tv.value) !== undefined && quoted("vacancies.total", tv.quote)) {
    if (numbersIn(String(int(tv.value)), tv.quote as string)) keep("vacancies.total", int(tv.value), tv.quote as string);
    else refuse("vacancies.total", "the number is not in its quote");
  }

  const rows: VacancyRow[] = [];
  let rowQuote = "";
  for (const r of arr(raw.vacancyRows)) {
    const post = str(r.post, 160);
    const count = int(r.count);
    if (!post || count === undefined || !inText(r.quote) || !numbersIn(String(count), r.quote as string)) continue;
    const row: VacancyRow = { post, count };
    const pay = str(r.payScale, 120);
    if (pay && numbersIn(pay, text)) row.payScale = pay;
    const breakdown: Record<string, number> = {};
    for (const c of arr(r.categories)) {
      const label = str(c.category, 80);
      const n = int(c.count);
      if (!label || n === undefined || !inText(c.quote) || !numbersIn(String(n), c.quote as string)) continue;
      const k = categoryKey(label);
      if (k) breakdown[k] = n;
      else if (/women|female/i.test(label) && !/class|caste|tribe|bc|sc|st/i.test(label)) breakdown.women = n;
      else breakdown[label] = n;
    }
    if (Object.keys(breakdown).length > 0) row.breakdown = breakdown as VacancyRow["breakdown"];
    rows.push(row);
    rowQuote ||= r.quote as string;
  }
  if (rows.length > 0) keep("vacancies.breakdown", mergeCategoryRows(rows), rowQuote);

  for (const [key, path] of [["feeGeneral", "financial.feeGeneral"], ["feeSCST", "financial.feeSCST"]] as const) {
    const f = obj(raw[key]);
    const v = f ? int(f.value) : undefined;
    if (!f || v === undefined || !quoted(path, f.quote)) continue;
    const q = f.quote as string;
    if (v === 0 ? /exempt|nil|no (application )?fee|free|not required/i.test(q) : numbersIn(String(v), q)) keep(path, v, q);
    else refuse(path, "the fee is not in its quote");
  }

  const pay = obj(raw.payScale);
  const payValue = pay ? str(pay.value, 200) : undefined;
  if (pay && payValue && quoted("financial.payScale", pay.quote)) {
    if (numbersIn(payValue, text)) keep("financial.payScale", payValue, pay.quote as string);
    else refuse("financial.payScale", "a number in the pay scale is not in the text");
  }

  const age = obj(raw.age);
  if (age && (inText(age.quote) || arr(age.postWise).length > 0)) {
    const q = inText(age.quote) ? age.quote : "";
    const evidence = (about: string, value: unknown, quote: string): AgeEvidence => ({ about, value: String(value), quote, page: pageOf(text, quote) });
    const min = int(age.min);
    const max = int(age.max);
    const asOf = str(age.asOf, 10);
    // Upper ages printed by category: kept as printed, nothing worked out from them.
    // A figure too small to be an age ("SC/ST: 5 years") is a relaxation, not an upper age: left out, and said.
    const printedMax = (list: unknown) => arr(list)
      .map((c) => ({ category: str(c.category, 100), max: int(c.max), quote: c.quote }))
      .filter((c): c is { category: string; max: number; quote: string } => {
        if (!c.category || c.max === undefined || !inText(c.quote) || !numbersIn(String(c.max), c.quote as string)) return false;
        if (c.max < MIN_PRINTED_AGE) { refuse("age", `"${c.category}: ${c.max}" is a number of years of relaxation, not an upper age; not taken as one`); return false; }
        return true;
      });
    const limits = printedMax(age.categoryMax);
    const value: AgeCriteria = { relaxations: [] };
    const overallEvidence: AgeEvidence[] = [];
    for (const [key, n] of [["min", min], ["max", max]] as const) {
      if (n === undefined) continue;
      if (q && numbersIn(String(n), q)) { value[key] = n; overallEvidence.push(evidence(key, n, q)); }
      else refuse("age", `the ${key === "min" ? "minimum" : "maximum"} age ${n} is not in its quote`);
    }
    if (asOf && q && dateInQuote(asOf, q)) { value.asOf = asOf; overallEvidence.push(evidence("asOf", asOf, q)); }
    if (limits.length) {
      value.categoryMax = limits.map((c) => ({ category: c.category, max: c.max }));
      overallEvidence.push(...limits.map((c) => evidence(`categoryMax: ${c.category}`, c.max, c.quote)));
    }

    // Ages post by post: each post's figures from its own quote, each with its own evidence.
    const postWise: PostAgeRange[] = [];
    const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
    for (const p of arr(age.postWise)) {
      const post = str(p.post, 160);
      if (!post) continue;
      const pq = p.quote;
      // The quote must be the notice's words and name the post, so its figures belong to it.
      if (!inText(pq) || !words(post).every((w) => words(pq as string).includes(w))) {
        refuse("age", `post "${post}": its quote is not in the text or does not name the post; its ages are not read`);
        continue;
      }
      const row: PostAgeRange = { post };
      const ev: AgeEvidence[] = [evidence("post", post, pq as string)];
      for (const [key, n] of [["min", int(p.min)], ["max", int(p.max)]] as const) {
        if (n === undefined) continue;
        if (numbersIn(String(n), pq as string)) { row[key] = n; ev.push(evidence(key, n, pq as string)); }
        else refuse("age", `post "${post}": the ${key === "min" ? "minimum" : "maximum"} age ${n} is not in its quote`);
      }
      for (const key of ["bornFrom", "bornTo"] as const) {
        const d = str(p[key], 10);
        if (!d) continue;
        if (dateInQuote(d, pq as string)) { row[key] = d; ev.push(evidence(key, d, pq as string)); }
        else refuse("age", `post "${post}": the date of birth ${d} is not in its quote`);
      }
      if (row.min === undefined && row.max === undefined && !row.bornFrom && !row.bornTo) {
        refuse("age", `post "${post}": no age or date of birth could be read; not read`);
        continue;
      }
      const own = obj(p.asOf);
      const ownDate = own ? str(own.value, 10) : undefined;
      if (own && ownDate && inText(own.quote) && dateInQuote(ownDate, own.quote as string)) { row.asOf = ownDate; ev.push(evidence("asOf", ownDate, own.quote as string)); }
      const relax: AgeRelaxation[] = [];
      for (const r of arr(p.relaxations)) {
        const category = str(r.category, 120);
        const years = int(r.years);
        const written = str(r.text, 160);
        if (!category || !inText(r.quote)) continue;
        if (years !== undefined && !numbersIn(String(years), r.quote as string)) { refuse("age", `post "${post}": the ${category} relaxation of ${years} years is not in its quote`); continue; }
        if (written && !inText(written)) continue;
        if (years === undefined && !written) continue;
        relax.push({ category, ...(years !== undefined ? { years } : {}), ...(written ? { text: written } : {}) });
        ev.push(evidence(`relaxation: ${category}`, years !== undefined ? years : written, r.quote as string));
      }
      if (relax.length) row.relaxations = relax;
      const ownMax = printedMax(p.categoryMax);
      if (ownMax.length) {
        row.categoryMax = ownMax.map((c) => ({ category: c.category, max: c.max }));
        ev.push(...ownMax.map((c) => evidence(`categoryMax: ${c.category}`, c.max, c.quote)));
      }
      row.evidence = ev;
      postWise.push(row);
    }
    if (postWise.length) value.postWise = postWise;
    if (overallEvidence.length) value.evidence = overallEvidence;

    if (value.min !== undefined || value.max !== undefined || value.categoryMax?.length || postWise.length) {
      keep("age", value, q || (postWise[0].evidence![0].quote));
    } else refuse("age", "the age limits are not in the quotes");
  } else if (age) refuse("age", "the quote is not in the text");

  const posts: CmsRecruitmentPost[] = [];
  let eligQuote = "";
  for (const e of arr(raw.eligibility)) {
    const post = str(e.post, 160);
    const quals = (Array.isArray(e.qualifications) ? e.qualifications : []).map((x) => str(x, 400)).filter((x): x is string => !!x && inText(x));
    if (!post || quals.length === 0 || !inText(e.quote)) continue;
    posts.push({ post, qualification: quals });
    eligQuote ||= e.quote as string;
  }
  if (posts.length > 0) keep("eligibility", posts, eligQuote);

  const stages: CmsSelectionStage[] = [];
  let selQuote = "";
  for (const s of arr(raw.selectionStages)) {
    const name = str(s.name, 120);
    if (!name || !inText(s.quote)) continue;
    const type = STAGE_TYPES.includes(s.type as SelectionStageType) ? (s.type as SelectionStageType) : "OTHER";
    const stage: CmsSelectionStage = { name, order: stages.length + 1, type };
    const description = str(s.description, 500);
    if (description && inText(description)) stage.description = description;
    stages.push(stage);
    selQuote ||= s.quote as string;
  }
  if (stages.length > 0) {
    const value: CmsSelectionInformation = { stages };
    if (!stages.some((s) => s.type === "WRITTEN" || s.type === "CBT")) value.noWrittenExam = true;
    keep("selection", value, selQuote);
  }

  const examStages: ExamStage[] = [];
  let stageQuote = "";
  for (const s of arr(raw.examStages)) {
    const name = str(s.name, 120);
    if (!name || !inText(s.quote)) continue;
    // The editor keeps stage names short; a longer one is left out, and said, not cut.
    if (name.length > STAGE_NAME_MAX) { refuse("examStages", `a stage name is longer than ${STAGE_NAME_MAX} characters: "${name.slice(0, 60)}…"`); continue; }
    const date = str(s.date, 10);
    const dated = !!date && dateInQuote(date, s.quote as string);
    const stage: ExamStage = {
      name, order: examStages.length + 1,
      // Selection stage or announcement, by code from the printed name; UNCLASSIFIED is shown to the admin to decide.
      kind: classifyStageName(name),
      status: dated ? "SCHEDULED" : "NOT_DECLARED",
      certainty: dated ? (/tentative|likely|expected/i.test(s.quote as string) ? "TENTATIVE" : "CONFIRMED") : "TBA",
    };
    if (dated) stage.dateIso = date;
    // "To be announced" is not a date: the editor keeps it as the stage's note.
    const shown = str(s.dateText, 60);
    if (shown && inText(shown)) {
      if (dated) stage.dateDisplay = shown;
      else stage.notes = shown;
    }
    examStages.push(stage);
    stageQuote ||= s.quote as string;
  }
  if (examStages.length > 0) keep("examStages", examStages, stageQuote);

  const papers: ExamPatternPaper[] = [];
  let paperQuote = "";
  for (const p of arr(raw.examPattern)) {
    const name = str(p.name, 120);
    if (!name || !inText(p.quote)) continue;
    const sections = arr(p.sections)
      .map((s) => ({ subject: str(s.subject, 160), questions: int(s.questions), marks: int(s.marks) }))
      .filter((s): s is { subject: string; questions: number | undefined; marks: number | undefined } => !!s.subject && inText(s.subject))
      .map((s) => ({ subject: s.subject, ...(s.questions !== undefined ? { questions: s.questions } : {}), ...(s.marks !== undefined ? { marks: s.marks } : {}) }));
    const paper: ExamPatternPaper = { name, sections };
    for (const k of ["durationMinutes", "totalQuestions", "totalMarks"] as const) if (int(p[k]) !== undefined) paper[k] = int(p[k]);
    const note = str(p.note, 300);
    if (note && inText(note)) paper.note = note;
    // Every number in the paper must be in the text (hours become minutes: 2 hours = 120 is allowed).
    const numbers = [...sections.flatMap((s) => [s.questions, s.marks]), paper.totalQuestions, paper.totalMarks].filter((n): n is number => n !== undefined);
    if (!numbers.every((n) => numbersIn(String(n), text))) continue;
    papers.push(paper);
    paperQuote ||= p.quote as string;
  }
  if (papers.length > 0) keep("examPattern", papers, paperQuote);

  const subjects: SyllabusSubject[] = [];
  let sylQuote = "";
  for (const s of arr(raw.syllabus)) {
    const subject = str(s.subject, 160);
    const topics = (Array.isArray(s.topics) ? s.topics : []).map((t) => str(t, 300)).filter((t): t is string => !!t && inText(t));
    if (!subject || !inText(subject) || !inText(s.quote)) continue;
    const row: SyllabusSubject = { subject, topics };
    const paper = str(s.paper, 120);
    if (paper) row.paper = paper;
    subjects.push(row);
    sylQuote ||= s.quote as string;
  }
  if (subjects.length > 0) keep("syllabus", subjects, sylQuote);

  const steps = arr(raw.howToApply).map((s) => str(s.step, 500)).filter((s): s is string => !!s && inText(s));
  if (steps.length > 0) keep("howToApply", steps, steps[0]);

  const notes = arr(raw.notes).map((n) => str(n.text, 500)).filter((n): n is string => !!n && inText(n)).slice(0, 12);
  if (notes.length > 0) keep("conditions", notes, notes[0]);

  return { values, refused };
}

/** One request for the whole text. Never throws. */
export async function readArticle(opts: { text: string; subject: string; apiKey: string | undefined; fetchFn?: typeof fetch; part?: { first: number; last: number; pages: number }; timeoutMs?: number }): Promise<ArticleReading> {
  if (opts.text.trim().length < 100) return { values: [], refused: [], skipped: "too little text to read" };
  // The same room for the answer whether the text is read whole or as a page batch: a short notice read whole can be
  // as long as a batch (up to BATCH_FROM_CHARS), and its answer was being cut off at half the room (B2.6).
  const answer = await callAiJson({
    prompt: buildArticlePrompt(opts.text, opts.subject, opts.part), apiKey: opts.apiKey, fetchFn: opts.fetchFn, feature: "import",
    maxOutputTokens: ANSWER_TOKENS, timeoutMs: opts.timeoutMs ?? READ_TIMEOUT_MS,
  });
  if (!answer.ok) return { values: [], refused: [], skipped: answer.reason };
  return judgeArticle(answer.data, opts.text);
}

// ─── A long notice, page batch by page batch (stage B2.2) ─────
//
// One request over a 76-page notice returns some fields and drops others,
// differently each time. A notice with page marks and more than
// BATCH_FROM_CHARS of text is read in batches of whole pages instead; code,
// not the model, puts the batches' readings together. What no batch read is
// reported page by page, and the reading is never called complete while a
// page is unread.

export const BATCH_FROM_CHARS = 40_000;
const BATCH_MAX_CHARS = 30_000;
const BATCH_MAX_PAGES = 8;
/**
 * A page with less text than this (after its page mark, spaces aside) has no
 * text layer: a scanned page. Low on purpose: a short text page ("Grand
 * Total 232") is still text; only a page number or nothing is "no text".
 */
const NO_TEXT_CHARS = 12;

export interface PageText { page: number; text: string }
export interface ReadingCoverage {
  mode: "whole" | "batches";
  /** Pages in the document, when it has page marks. */
  pages: number | null;
  batches: Array<{ first: number | null; last: number | null; status: "read" | "failed" | "not_read"; reason?: string; values: number }>;
  /** Pages with no text: scanned pages, not read by the text reading. */
  noTextPages: number[];
  /** Pages that never reached the reading (a piece that failed to upload or could not be opened), with why. */
  unavailable?: Array<{ first: number; last: number; reason: string }>;
  /** Scanned pages where the AI found almost nothing, twice: maybe something printed was missed. */
  suspectPages?: number[];
  /** Page ranges whose answer came back incomplete, so they were read again in halves (B2.5). */
  split?: Array<{ first: number; last: number }>;
}

/** The text cut into its pages, each ending with its page mark; null without page marks. */
export function pagesOf(text: string): PageText[] | null {
  const marks = [...text.matchAll(/^-- (\d+) of (\d+) --$/gm)];
  if (marks.length === 0) return null;
  const out: PageText[] = [];
  let at = 0;
  for (const m of marks) {
    const end = (m.index ?? 0) + m[0].length;
    out.push({ page: Number(m[1]), text: text.slice(at, end) });
    at = end;
  }
  const rest = text.slice(at);
  if (rest.trim()) out.push({ page: (out[out.length - 1]?.page ?? 0) + 1, text: rest });
  return out;
}

/** A page with text: more than a page mark and a few words (a running header or a page number). */
export const pageHasText = (p: PageText) => p.text.replace(/^-- \d+ of \d+ --$/gm, "").replace(/\s+/g, "").length >= NO_TEXT_CHARS;

/** Batches of whole pages with text, at most BATCH_MAX_PAGES pages or BATCH_MAX_CHARS characters each. */
export function pageBatches(pages: PageText[]): Array<{ first: number; last: number; text: string }> {
  const out: Array<{ first: number; last: number; text: string }> = [];
  let cur: PageText[] = [];
  const flush = () => {
    if (cur.length) out.push({ first: cur[0].page, last: cur[cur.length - 1].page, text: cur.map((p) => p.text).join("") });
    cur = [];
  };
  for (const p of pages) {
    if (!pageHasText(p)) { flush(); continue; }
    // A batch never spans a gap (pages missing from the text, e.g. a piece not uploaded).
    if (cur.length > 0 && p.page !== cur[cur.length - 1].page + 1) flush();
    const size = cur.reduce((n, x) => n + x.text.length, 0);
    if (cur.length >= BATCH_MAX_PAGES || (cur.length > 0 && size + p.text.length > BATCH_MAX_CHARS)) flush();
    cur.push(p);
  }
  flush();
  return out;
}

/** Lists merged across batches, by what names an entry; anything else is a single value. */
const LIST_KEY: Record<string, (x: J) => string> = {
  examStages: (x) => String(x.name ?? ""),
  examPattern: (x) => String(x.name ?? ""),
  eligibility: (x) => String(x.post ?? ""),
  "vacancies.breakdown": (x) => String(x.post ?? ""),
  syllabus: (x) => `${x.paper ?? ""}|${x.subject ?? ""}`,
};
const TEXT_LISTS = new Set(["howToApply", "conditions"]);
const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v as J).sort().map((k) => `${k}:${canon((v as J)[k])}`).join(",")}}` : JSON.stringify(v);

/**
 * The batches' readings as one. A list (exam stages, papers, posts…) is
 * joined, an entry given twice the same counting once; when two batches
 * give the same entry differently, nothing is joined for that field and each
 * batch's list is offered as it is, so the difference shows as a conflict.
 * A single value (a date, a fee, the age limit) is offered as each batch
 * gives it: the same value from two batches is one item with two quotes,
 * different values are a conflict. Every value keeps its batch's quote and
 * page. Nothing is chosen between differing values here.
 */
export function mergeReadings(parts: Array<Omit<ArticleReading, "skipped">>): Omit<ArticleReading, "skipped"> {
  const values: ExtractedValue[] = [];
  const byField = new Map<string, ExtractedValue[]>();
  for (const p of parts) for (const v of p.values) byField.set(v.fieldPath, [...(byField.get(v.fieldPath) ?? []), v]);
  for (const [fieldPath, given] of byField) {
    const listKey = LIST_KEY[fieldPath] ?? (TEXT_LISTS.has(fieldPath) ? (x: unknown) => String(x) : null);
    const isSelection = fieldPath === "selection";
    if ((!listKey && !isSelection) || given.length === 1) { values.push(...given); continue; }
    const entriesOf = (v: unknown): unknown[] => isSelection ? (((v as J)?.stages as unknown[]) ?? []) : (Array.isArray(v) ? v : []);
    const keyFn = isSelection ? (x: unknown) => String((x as J).name ?? "") : (listKey as (x: unknown) => string);
    const joined = new Map<string, unknown>();
    let differs = false;
    // An entry's place in its own batch's list ("order") is not part of what it says.
    const said = (e: unknown) => canon(e && typeof e === "object" ? Object.fromEntries(Object.entries(e as J).filter(([k]) => k !== "order")) : e);
    for (const v of given) for (const e of entriesOf(v.value)) {
      const k = keyOf(keyFn(e as J));
      const had = joined.get(k);
      if (had === undefined) joined.set(k, e);
      else if (said(had) !== said(e)) differs = true;
    }
    if (differs) { values.push(...given); continue; }
    const list = [...joined.values()];
    const merged = isSelection ? { ...(given[0].value as J), stages: list.map((s, i) => ({ ...(s as J), order: i + 1 })) }
      : fieldPath === "examStages" ? list.map((s, i) => ({ ...(s as J), order: i + 1 })) : list;
    // One value, with every contributing batch's quote and page.
    for (const v of given) values.push({ ...v, value: merged });
  }
  const kept = new Set(values.map((v) => v.fieldPath));
  const seen = new Set<string>();
  const refused = parts.flatMap((p) => p.refused).filter((r) => {
    const k = `${r.fieldPath}|${r.reason}`;
    if (kept.has(r.fieldPath) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { values, refused };
}

/** A failed request worth one more try (not a missing key, the daily cap, or a rejected key). */
const RETRY_BATCH = /unavailable|incomplete|took too long|rate limit/i;
/** An answer cut off or not whole JSON: too much for one answer, so the pages are read in halves (B2.5). */
export const INCOMPLETE = /incomplete/i;
const MAX_SPLIT_DEPTH = 3;

/**
 * Reads the text whole when it is short or has no page marks; otherwise in
 * page batches, through `gate` (so only a few requests run at a time), each
 * value's page counted in the whole document. A batch whose request fails is
 * tried once more; a batch not started before `deadline` is reported as not
 * read. Never throws.
 */
export async function readArticleInBatches(opts: {
  text: string; subject: string; apiKey: string | undefined; fetchFn?: typeof fetch;
  gate?: <T>(task: () => Promise<T>) => Promise<T>;
  /** Epoch ms after which no new batch is started. */
  deadline?: number;
}): Promise<ArticleReading & { coverage: ReadingCoverage }> {
  const gate = opts.gate ?? (<T>(t: () => Promise<T>) => t());
  const pages = pagesOf(opts.text);
  const pageCount = pages ? pages[pages.length - 1].page : null;
  const noTextPages = pages ? pages.filter((p) => !pageHasText(p)).map((p) => p.page) : [];
  const split: Array<{ first: number; last: number }> = [];
  let groups: PageText[][];
  let startDepth = 0;
  if (!pages || opts.text.length <= BATCH_FROM_CHARS) {
    const one = await gate(() => readArticle(opts));
    const withText = pages?.filter(pageHasText) ?? [];
    // A short text read in one request whose answer came back incomplete is read again in halves, as a batch is.
    if (!(one.skipped && INCOMPLETE.test(one.skipped) && withText.length > 1)) {
      return { ...one, coverage: { mode: "whole", pages: pageCount, noTextPages,
        batches: [{ first: pages ? 1 : null, last: pageCount, status: one.skipped ? "failed" : "read", ...(one.skipped ? { reason: one.skipped } : {}), values: one.values.length }] } };
    }
    split.push({ first: withText[0].page, last: withText[withText.length - 1].page });
    const mid = Math.ceil(withText.length / 2);
    groups = [withText.slice(0, mid), withText.slice(mid)];
    startDepth = 1;
  } else {
    groups = pageBatches(pages!).map((b) => pagesOf(b.text) ?? []);
  }
  /** One batch's pages; an incomplete answer cuts them in half and reads each half (B2.5), down to one page. */
  const readPages = async (ps: PageText[], depth: number): Promise<Array<{ first: number; last: number; r: ArticleReading | null }>> => {
    const first = ps[0].page, last = ps[ps.length - 1].page;
    const read = async () => {
      const left = opts.deadline ? opts.deadline - Date.now() : Infinity;
      if (left < 8_000) return null; // not started: too little time left
      return readArticle({ ...opts, text: ps.map((p) => p.text).join(""), part: { first, last, pages: pageCount ?? last }, timeoutMs: Math.min(READ_TIMEOUT_MS, left - 2_000) });
    };
    let r = await read();
    if (r?.skipped && INCOMPLETE.test(r.skipped) && ps.length > 1 && depth < MAX_SPLIT_DEPTH) {
      split.push({ first, last });
      const mid = Math.ceil(ps.length / 2);
      return [...await readPages(ps.slice(0, mid), depth + 1), ...await readPages(ps.slice(mid), depth + 1)];
    }
    if (r?.skipped && RETRY_BATCH.test(r.skipped)) r = (await read()) ?? r; // once more
    return [{ first, last, r }];
  };
  const results = (await Promise.all(groups.map((ps) => gate(() => readPages(ps, startDepth))))).flat();
  const coverage: ReadingCoverage = { mode: "batches", pages: pageCount, noTextPages, batches: [], ...(split.length ? { split } : {}) };
  const parts: Array<Omit<ArticleReading, "skipped">> = [];
  results.forEach(({ first, last, r }) => {
    const b = { first, last };
    if (!r) { coverage.batches.push({ first: b.first, last: b.last, status: "not_read", reason: "the time for this reading ran out before these pages were reached", values: 0 }); return; }
    if (r.skipped) { coverage.batches.push({ first: b.first, last: b.last, status: "failed", reason: r.skipped, values: 0 }); return; }
    // Pages come from the batch's own page marks, so they are the document's page numbers.
    const values = r.values;
    parts.push({ values, refused: r.refused });
    coverage.batches.push({ first: b.first, last: b.last, status: "read", values: values.length });
  });
  const merged = mergeReadings(parts);
  const failed = coverage.batches.filter((b) => b.status !== "read");
  return { ...merged, coverage, ...(parts.length === 0 && failed.length > 0 ? { skipped: failed[0].reason } : {}) };
}
