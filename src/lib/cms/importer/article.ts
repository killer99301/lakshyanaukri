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
import type { ExtractedValue } from "@/lib/cms/importer/proposal";
import type { ExamStage, VacancyRow, AgeRelaxation } from "@/types";
import type {
  AgeCriteria, CmsRecruitmentPost, CmsSelectionInformation, CmsSelectionStage, ExamPatternPaper, SelectionStageType, SyllabusSubject,
} from "@/types/recruitment-record";

export const ARTICLE_MAX_CHARS = 60_000;
const MAX_ITEMS = 40;

export interface ArticleReading {
  values: ExtractedValue[];
  refused: Array<{ fieldPath: string; reason: string }>;
  /** Why nothing was read (no key, the daily cap, the model failed). */
  skipped?: string;
}

type J = Record<string, unknown>;

export function buildArticlePrompt(text: string, subject: string): string {
  return `You are reading a government recruitment notice or an article about one: "${subject}".
Map what it says onto the fields below. Use ONLY what the text states. Never guess, never fill a field from general knowledge.

Every value comes with "quote": words copied EXACTLY from the text (10 to 250 characters) that contain the value.
Leave a field out when the text does not state it. Facts about other recruitments mentioned on the page are ignored.

Return one JSON object with any of:
- "notificationNumber": { "value": as written, e.g. "29/2026", "quote" }
- "dates": { "<name>": { "value": "YYYY-MM-DD", "quote" } } for: applicationOpenDate, applicationCloseDate, feePaymentCloseDate, correctionWindowEnd, examDate, admitCardDate, interviewDate, resultDate. The date the article was posted is not a recruitment date. A month without a day is not a date.
- "totalVacancies": { "value": integer, "quote" }
- "vacancyRows": [ { "post", "count": integer, "quote", "payScale"?: as written, "categories"?: [ { "category": as written, "count": integer, "quote" } ] } ] — one row per post; category-wise counts as given in the text.
- "feeGeneral": { "value": integer rupees for General/UR/OBC or for everyone when one fee applies to all, "quote" }
- "feeSCST": { "value": integer rupees, 0 only when the text says exempt/nil, "quote" } — only when the text states the SC/ST fee separately.
- "payScale": { "value": as written, e.g. "Pay Level 6, Grade Pay Rs 4,200", "quote" }
- "age": { "min"?: integer, "max"?: integer for General/UR men, "asOf"?: "YYYY-MM-DD", "quote", "categoryMax"?: [ { "category", "max": integer, "quote" } ] }
- "eligibility": [ { "post", "qualifications": [ each copied from the text ], "quote" } ]
- "selectionStages": [ { "name", "type": one of WRITTEN, CBT, INTERVIEW, SKILL_TEST, DOCUMENT_VERIFICATION, PHYSICAL, OTHER, "description"?: copied from the text, "quote" } ] in order.
- "examStages": [ { "name", "date"?: "YYYY-MM-DD" or null when not announced, "dateText"?: as written, e.g. "To be announced", "quote" } ] — the dated steps after applying (exam, interview, document verification).
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
    else if (dateInQuote(v, d.quote as string)) keep(path, v, d.quote as string);
    else refuse(path, "the date is not written in its quote");
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
  if (rows.length > 0) keep("vacancies.breakdown", rows, rowQuote);

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
  if (age && quoted("age", age.quote)) {
    const q = age.quote as string;
    const min = int(age.min);
    let max = int(age.max);
    const asOf = str(age.asOf, 10);
    const limits = arr(age.categoryMax)
      .map((c) => ({ category: str(c.category, 100), max: int(c.max), quote: c.quote }))
      .filter((c): c is { category: string; max: number; quote: string } => !!c.category && c.max !== undefined && inText(c.quote) && numbersIn(String(c.max), c.quote as string));
    if (max === undefined && limits.length > 0) max = Math.min(...limits.map((c) => c.max));
    const stated = [min, max].filter((n): n is number => n !== undefined);
    if (stated.length > 0 && stated.every((n) => numbersIn(String(n), [q, ...limits.map((c) => c.quote)].join(" ")))) {
      const relaxations: AgeRelaxation[] = limits
        .filter((c) => max !== undefined && c.max !== max)
        .map((c) => ({ category: c.category, years: c.max - max!, text: `up to ${c.max} years` }));
      const value: AgeCriteria = { relaxations };
      if (min !== undefined) value.min = min;
      if (max !== undefined) value.max = max;
      if (asOf && dateInQuote(asOf, q)) value.asOf = asOf;
      keep("age", value, q);
    } else refuse("age", "the age limits are not in the quotes");
  }

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
    const date = str(s.date, 10);
    const dated = !!date && dateInQuote(date, s.quote as string);
    const stage: ExamStage = {
      name, order: examStages.length + 1,
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
export async function readArticle(opts: { text: string; subject: string; apiKey: string | undefined; fetchFn?: typeof fetch }): Promise<ArticleReading> {
  if (opts.text.trim().length < 100) return { values: [], refused: [], skipped: "too little text to read" };
  const answer = await callAiJson({ prompt: buildArticlePrompt(opts.text, opts.subject), apiKey: opts.apiKey, fetchFn: opts.fetchFn, maxOutputTokens: 8192, feature: "import" });
  if (!answer.ok) return { values: [], refused: [], skipped: answer.reason };
  return judgeArticle(answer.data, opts.text);
}
