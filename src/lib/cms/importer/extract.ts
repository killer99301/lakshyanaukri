// ═══════════════════════════════════════════════════════════
// Importer: what one source says, field by field
// ═══════════════════════════════════════════════════════════
//
// Server only. The same extractors and checks as AI Assist (one
// deterministic pass, then three AI requests run together), so a value is
// kept only when the model's quote is found word for word in this source.
// Each value carries its quote and, for a PDF, the page the quote is on.
// Nothing is decided or saved here.

import {
  AI_FOUND_NOTHING,
  buildAiSections,
  buildAssistCandidates,
  extractWithAi,
  mergeAiDates,
  mergeAiNotificationNumber,
  parseDatesInText,
  type FeeOutcome,
  type SourceKind,
} from "@/lib/cms/ai-assist";
import { DETAIL_FIELDS, buildDetailSections, extractDetails } from "@/lib/cms/ai-assist-details";
import { SYLLABUS_FIELDS, buildSyllabusSections, extractPatternAndSyllabus } from "@/lib/cms/ai-assist-syllabus";
import { pageOf } from "@/lib/cms/importer/evidence-text";
import { linksInText, type FoundLink } from "@/lib/cms/importer/links";
import { readArticleInBatches, type ArticleReading, type ReadingCoverage } from "@/lib/cms/importer/article";
import type { ExtractedValue } from "@/lib/cms/importer/proposal";
import { readPatternTables, statedCoverage, type PatternCoverage } from "@/lib/cms/importer/pattern-tables";
import { relaxationMembers, statedRelaxations } from "@/lib/cms/importer/age-relaxations";
import { readPostAgeTable } from "@/lib/cms/importer/post-age-table";
import { readLabelledLines } from "@/lib/cms/importer/prepared-fields";
import type { AgeCriteria, CmsSelectionInformation, CmsSelectionStage, SelectionStageType } from "@/types/recruitment-record";
import type { ExamStage } from "@/types";
import { classifyStageName, STAGE_KIND_LABEL } from "@/lib/exam-stage-kind";

export interface SourceReading {
  values: ExtractedValue[];
  links: FoundLink[];
  /** Fields the extractors looked for and did not find, or refused (with why). */
  notFound: string[];
  refused: Array<{ fieldPath: string; reason: string }>;
  /** The model's one-line summary; never applied, shown as a suggestion only. */
  summary: string | null;
  /** Why the whole-text reading did not run, when it did not. */
  articleSkipped?: string;
  /** Which pages the whole-text reading read, batch by batch. */
  readingCoverage?: ReadingCoverage;
  /** The exam-pattern tables the notice prints, and which were read by code. */
  patternCoverage?: PatternCoverage;
}

/** Plain text from an HTML page, for storage, page lookup and link finding. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>/gi, " $1 ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export type SectionPart = "ai" | "details" | "pattern";
export type SectionOutcomes = {
  ai: Awaited<ReturnType<typeof extractWithAi>>;
  details: Awaited<ReturnType<typeof extractDetails>>;
  pattern: Awaited<ReturnType<typeof extractPatternAndSyllabus>>;
};

/** One of the three section readers (dates and fees; details; pattern and syllabus): one AI request. */
export async function readSectionPart<P extends SectionPart>(part: P, opts: { content: string; kind: SourceKind; url: string; subject: string; apiKey: string | undefined; fetchFn?: typeof fetch }): Promise<SectionOutcomes[P]> {
  const { content, kind, url, subject, apiKey, fetchFn } = opts;
  if (part === "ai") return extractWithAi({ sections: buildAiSections(content, kind, url), url, apiKey, fetchFn }) as Promise<SectionOutcomes[P]>;
  if (part === "details") return extractDetails({ sections: buildDetailSections(content, kind, url, subject), url, apiKey, subject, fetchFn }) as Promise<SectionOutcomes[P]>;
  return extractPatternAndSyllabus({ sections: buildSyllabusSections(content, kind, url, subject), url, apiKey, subject, fetchFn }) as Promise<SectionOutcomes[P]>;
}

/** A section reader that did not run (its task failed), with why: the same shape as a reader that was skipped. */
export function skippedSection<P extends SectionPart>(part: P, reason: string): SectionOutcomes[P] {
  const skip = { status: "skipped" as const, reason };
  if (part === "ai") {
    return { fees: { general: skip, scst: skip }, notificationNumber: skip,
      dates: { applicationOpenDate: skip, applicationCloseDate: skip, feePaymentCloseDate: skip, correctionWindowEnd: skip } } as SectionOutcomes[P];
  }
  if (part === "details") return { howToApply: skip, age: skip, eligibility: skip, selection: skip, payScale: skip, summary: null } as SectionOutcomes[P];
  return { examPattern: skip, syllabus: skip } as SectionOutcomes[P];
}

export async function readSource(opts: {
  content: string;
  kind: SourceKind;
  url: string;
  /** Title and organisation, so facts about other jobs in the same source are ignored. */
  subject: string;
  organizationId: string;
  apiKey: string | undefined;
  fetchFn?: typeof fetch;
  /** Lets only a few AI requests of the import run at a time (see pacing.ts). */
  gate?: <T>(task: () => Promise<T>) => Promise<T>;
  /** Epoch ms after which no new page batch is started. */
  deadline?: number;
  /** Pasted text: its labelled lines are read by code too (I1). */
  labelledLines?: boolean;
}): Promise<SourceReading> {
  const gate = opts.gate ?? (<T>(t: () => Promise<T>) => t());
  const plain = opts.kind === "html" ? htmlToText(opts.content) : opts.content;
  const [ai, details, pattern, article] = await Promise.all([
    gate(() => readSectionPart("ai", opts)),
    gate(() => readSectionPart("details", opts)),
    gate(() => readSectionPart("pattern", opts)),
    readArticleInBatches({ text: plain, subject: opts.subject, apiKey: opts.apiKey, fetchFn: opts.fetchFn, gate, deadline: opts.deadline }),
  ]);
  return combineReading({ ...opts, ai, details, pattern, article });
}

/**
 * The section readers' and the whole-text reading's results as one source
 * reading: the stricter section readers win wherever they speak. No AI here,
 * so a reading job can put its stored task results together the same way.
 */
export function combineReading(opts: {
  content: string; kind: SourceKind; url: string; organizationId: string;
  ai: SectionOutcomes["ai"]; details: SectionOutcomes["details"]; pattern: SectionOutcomes["pattern"];
  article: ArticleReading & { coverage?: ReadingCoverage };
  /** Pasted text (I1): its labelled lines ("Application fee: …", "Age limit: …") are read by code as well. */
  labelledLines?: boolean;
}): SourceReading {
  const { content, kind, url, ai, details, pattern, article } = opts;
  const plain = kind === "html" ? htmlToText(content) : content;
  const values: ExtractedValue[] = [];
  const notFound: string[] = [];
  const refused: SourceReading["refused"] = [];
  const add = (fieldPath: string, value: unknown, quote?: string) =>
    values.push({ fieldPath, value, ...(quote ? { quote, page: pageOf(plain, quote) } : {}) });

  const base = buildAssistCandidates(content, kind, url);

  const merged = mergeAiDates(mergeAiNotificationNumber(base, ai.notificationNumber), ai.dates);
  for (const f of merged.flagged) refused.push({ fieldPath: f.label, reason: f.reason });
  const quoteFor = (fieldPath: string): string | undefined => {
    if (fieldPath === "identity.notificationNumber") {
      // The AI's quote only for the AI's own number; a labelled number that stood over the AI's file number is quoted from its own line.
      const value = merged.candidates.find((c) => c.fieldPath === fieldPath)?.value;
      if (ai.notificationNumber.status === "accepted" && ai.notificationNumber.value === value) return ai.notificationNumber.quote;
      return typeof value === "string" ? plain.split("\n").find((l) => l.includes(value))?.trim() : undefined;
    }
    const key = fieldPath.startsWith("dates.") ? fieldPath.slice(6) as keyof typeof ai.dates : null;
    const d = key ? ai.dates[key] : undefined;
    return d && d.status === "accepted" ? d.quote : undefined;
  };
  for (const c of merged.candidates) {
    if (c.value === null || c.value === undefined) { notFound.push(c.label); continue; }
    add(c.fieldPath, c.value, quoteFor(c.fieldPath));
    if (c.doubt) values[values.length - 1].doubt = c.doubt;
  }

  const fee = (fieldPath: string, label: string, o: FeeOutcome) => {
    if (o.status === "accepted") add(fieldPath, o.value, o.quote);
    else if (o.status === "rejected") refused.push({ fieldPath, reason: o.reason });
    else notFound.push(`${label} (${o.status === "skipped" ? o.reason : AI_FOUND_NOTHING})`);
  };
  fee("financial.feeGeneral", "Application fee (General/OBC)", ai.fees.general);
  fee("financial.feeSCST", "Application fee (SC/ST/PwBD)", ai.fees.scst);

  const outcomes: Array<{ fieldPath: string; label: string; outcome: { status: string; value?: unknown; quotes?: string[]; reason?: string } }> = [
    ...DETAIL_FIELDS.map((f) => ({ fieldPath: f.fieldPath, label: f.label, outcome: details[f.key] })),
    ...SYLLABUS_FIELDS.map((f) => ({ fieldPath: f.fieldPath, label: f.label, outcome: pattern[f.key] })),
  ];
  for (const { fieldPath, label, outcome } of outcomes) {
    if (outcome.status === "accepted") add(fieldPath, outcome.value, outcome.quotes?.[0]);
    else if (outcome.status === "rejected") refused.push({ fieldPath, reason: outcome.reason ?? "not accepted" });
    else notFound.push(`${label} (${outcome.status === "skipped" ? outcome.reason : AI_FOUND_NOTHING})`);
  }

  // The whole-text reading fills what the readers above did not give or
  // refused: their checks are stricter, so they win wherever they speak.
  const DATE_FLAG_PATHS: Record<string, string> = {
    "Notification Number": "identity.notificationNumber", "Application Opens": "dates.applicationOpenDate", "Application Closes": "dates.applicationCloseDate",
    "Fee Payment Deadline": "dates.feePaymentCloseDate", "Correction Window End": "dates.correctionWindowEnd",
  };
  // One exception: ages set post by post. The details reader can give only one
  // range, so where the whole-text reading found each post's own ages (each
  // checked against its own quote), that reading is the age, not one range.
  const postWiseAge = article.values.find((v) => v.fieldPath === "age" && ((v.value as { postWise?: unknown[] } | null)?.postWise?.length ?? 0) > 0);
  if (postWiseAge) {
    for (let i = values.length - 1; i >= 0; i--) if (values[i].fieldPath === "age") values.splice(i, 1);
    for (let i = refused.length - 1; i >= 0; i--) if (refused[i].fieldPath === "age") refused.splice(i, 1);
  }
  const handled = new Set([...values.map((v) => v.fieldPath), ...refused.map((r) => DATE_FLAG_PATHS[r.fieldPath] ?? r.fieldPath)]);
  const filled: string[] = [];
  for (const v of article.values) {
    if (handled.has(v.fieldPath)) continue;
    values.push(v);
    filled.push(v.fieldPath);
  }
  for (const r of article.refused) if (!handled.has(r.fieldPath)) refused.push({ fieldPath: r.fieldPath, reason: `whole-text reading: ${r.reason}` });
  // Labelled lines of pasted text, read by code (I1), beside what the AI read: the same value is one item with both
  // quotes; a different one is a second value of the field, so the two are shown and neither is ticked.
  if (opts.labelledLines) {
    const lines = readLabelledLines(plain, { stageType: selectionStageType });
    for (const v of lines.values) {
      values.push({ fieldPath: v.fieldPath, value: v.value, quote: v.quote, page: pageOf(plain, v.quote), ...(v.doubt ? { doubt: v.doubt } : {}),
        notes: [`read by code from a labelled line`, ...(v.notes ?? [])] });
      filled.push(v.fieldPath);
    }
    for (const r of lines.refused) refused.push({ fieldPath: r.fieldPath, reason: `labelled line: ${r.reason}` });
  }
  const NOT_FOUND_LABEL: Record<string, RegExp> = {
    "vacancies.total": /^Total Vacancies/, "vacancies.breakdown": /^Vacancy Breakdown/, "financial.feeGeneral": /^Application fee \(General/,
    "financial.feeSCST": /^Application fee \(SC/, "eligibility": /^Post-wise Eligibility/, "age": /^Age Limit/, "selection": /^Selection Process/,
    "howToApply": /^How to Apply/, "financial.payScale": /^Pay Scale/, "examPattern": /^Exam Pattern/, "syllabus": /^Syllabus/,
    "identity.notificationNumber": /^Notification Number/, "dates.notificationDate": /^Notification Date/, "dates.feePaymentCloseDate": /^Fee Payment Deadline/,
    "dates.correctionWindowEnd": /^Correction Window End/, "dates.applicationOpenDate": /^Application Opens/,
    "dates.applicationCloseDate": /^Application Closes/,
  };
  // Ages printed in the notice's list of posts, read by code (SSC CGL): each post's own range, with its row as
  // the quote. They are the post-wise ages; where they differ, no one range is applied to every post. A row
  // with no age of its own is said, never given a neighbour's range.
  const postTable = readPostAgeTable(plain);
  if (postTable) {
    const at = values.findIndex((v) => v.fieldPath === "age");
    const before = at >= 0 ? (values[at].value as AgeCriteria) : { relaxations: [] } as AgeCriteria;
    const names = postTable.rows.map((r) => r.post);
    const postWise = postTable.rows.map((r) => {
      const level = r.group?.replace(/\s*\(.*$/, "") ?? null;
      const post = names.filter((n) => n === r.post).length > 1 && level ? `${r.post} — ${level}` : r.post;
      const page = pageOf(plain, r.quote);
      return { post, min: r.min, max: r.max, evidence: [{ about: "post", value: post, quote: r.quote, page }, { about: "min", value: String(r.min), quote: r.quote, page }, { about: "max", value: String(r.max), quote: r.quote, page }] };
    });
    const ranges = new Set(postTable.rows.map((r) => `${r.min}-${r.max}`));
    const next: AgeCriteria = { ...before, postWise };
    if (before.postWise?.length) refused.push({ fieldPath: "age", reason: `the reading's ${before.postWise.length} post-wise age rows are set aside: the notice's own table of posts gives each post's age (${postWise.length} posts, read by code)` });
    if (ranges.size > 1) {
      if (before.min !== undefined || before.max !== undefined) refused.push({ fieldPath: "age", reason: `one range (${before.min ?? "?"}-${before.max ?? "?"}) is not applied to every post: the notice prints each post's own age (${[...ranges].sort().join(", ")} years)` });
      delete next.min;
      delete next.max;
    } else {
      [next.min, next.max] = postTable.rows[0] ? [postTable.rows[0].min, postTable.rows[0].max] : [next.min, next.max];
    }
    for (const u of postTable.unread) {
      refused.push({ fieldPath: "age", reason: `post ${u.serial}${u.group ? ` (${u.group})` : ""}, “${u.text.slice(0, 100)}”: no age in its own row of the table of posts (a merged cell?); not given another post's range — enter it from the notice` });
    }
    const quote = postTable.rows[0].quote;
    if (at >= 0) values[at] = { ...values[at], value: next };
    else values.push({ fieldPath: "age", value: next, quote, page: pageOf(plain, quote) });
  }

  // Relaxations the notice prints as a lettered list (UPSC) or a coded table (SSC), read by code: a group the
  // reading left out is added with its clause or row as the quote; a group it gave a different number of years
  // is corrected to the printed figure, and said. Groups the notice's list does not print stay as read.
  const ageAt = values.findIndex((v) => v.fieldPath === "age");
  // The date the age is counted on, when the reading left it out but its own quote prints exactly one date
  // ("must not have attained the age of 32 years on the 1st of August, 2026").
  const ageQuote = ageAt >= 0 ? values[ageAt].quote : undefined;
  const ageNow = ageAt >= 0 ? (values[ageAt].value as AgeCriteria) : null;
  if (ageNow && !ageNow.asOf && ageQuote && (ageNow.min !== undefined || ageNow.max !== undefined)) {
    const dates = parseDatesInText(ageQuote);
    if (dates.length === 1 && /\b(?:as\s+on|as\s+of|on|by)\s+(?:the\s+)?\d/i.test(ageQuote)) {
      values[ageAt] = { ...values[ageAt], value: { ...ageNow, asOf: dates[0], evidence: [...(ageNow.evidence ?? []), { about: "asOf (read by code)", value: dates[0], quote: ageQuote, page: pageOf(plain, ageQuote) }] } };
    }
  }
  // Still no date, and the notice prints it in its age heading ("5. Age limit (As on 01-08-2026):", SSC CGL, where
  // the ages come from the table of posts): read by code from that one heading, when it prints exactly one date.
  const ageThen = ageAt >= 0 ? (values[ageAt].value as AgeCriteria) : null;
  if (ageThen && !ageThen.asOf) {
    const headings = plain.split("\n").map((l) => l.trim()).filter((l) => /^(?:\d+(?:\.\d+)*\.?\s+)?age\s*limits?\b[^\n]{0,20}\(?\s*as\s+(?:on|of)\b/i.test(l) && l.length <= 120);
    const dates = [...new Set(headings.flatMap((h) => parseDatesInText(h)))];
    if (headings.length >= 1 && dates.length === 1) {
      values[ageAt] = { ...values[ageAt], value: { ...ageThen, asOf: dates[0], evidence: [...(ageThen.evidence ?? []), { about: "asOf (read by code, from the age heading)", value: dates[0], quote: headings[0], page: pageOf(plain, headings[0]) }] } };
    }
  }
  const listed = ageAt >= 0 ? statedRelaxations(plain) : [];
  if (listed.length) {
    const age = values[ageAt].value as AgeCriteria;
    const relaxations = [...(age.relaxations ?? [])];
    const evidence = [...(age.evidence ?? [])];
    const key = (c: string) => relaxationMembers(c).join("+");
    for (const s of listed) {
      const members = relaxationMembers(s.category);
      if (!members.length) continue;
      // The reading's rows for exactly the same groups: "PwBD (OBC)" (both at once) is not "PwBD" or "OBC".
      const same = relaxations.filter((r) => key(r.category) === key(s.category));
      if (same.some((r) => r.years === s.years)) continue;
      for (const r of same) {
        refused.push({ fieldPath: "age", reason: `the reading gave ${r.years ?? "no number of"} years for ${r.category}; the notice prints ${s.years} (“${s.quote.replace(/\s+/g, " ").slice(0, 120)}”): the printed figure is kept` });
        relaxations.splice(relaxations.indexOf(r), 1);
      }
      relaxations.push({ category: s.category, years: s.years, ...(s.text ? { text: s.text } : {}) });
      // The age field keeps an evidence label of up to 120 characters and drops a longer one: kept within it.
      evidence.push({ about: `relaxation (read by code): ${s.category}`.slice(0, 120), value: String(s.years), quote: s.quote.slice(0, 600), page: pageOf(plain, s.quote) });
    }
    values[ageAt] = { ...values[ageAt], value: { ...age, relaxations, evidence } };
  }

  // The exam pattern from the notice's own tables, read by code: where the text
  // prints pattern tables, they are the pattern, and the AI's papers are not
  // used (they come and go between readings). Tables code could not read are
  // listed as missing, with their pages. The AI's pattern stays only where
  // the text has no pattern table (prose, or a scan not written out as one).
  const byCode = readPatternTables(plain);
  // No pattern table: the AI's papers stand, counted against the number of papers the notice states.
  const aiPattern = values.find((v) => v.fieldPath === "examPattern");
  const stated = byCode.coverage.expected === 0 ? statedCoverage(plain, Array.isArray(aiPattern?.value) ? aiPattern!.value.length : 0) : null;
  if (byCode.coverage.expected > 0) {
    for (let i = values.length - 1; i >= 0; i--) if (values[i].fieldPath === "examPattern") values.splice(i, 1);
    for (let i = refused.length - 1; i >= 0; i--) if (refused[i].fieldPath === "examPattern") refused.splice(i, 1);
    if (byCode.papers.length) add("examPattern", byCode.papers, byCode.quote ?? undefined);
    if (byCode.coverage.read > 0) filled.push("examPattern");
  }
  if (selectionFromSchedule(values, plain)) filled.push("selection");
  const stillMissing = notFound.filter((label) => !filled.some((p) => NOT_FOUND_LABEL[p]?.test(label)));
  checkSelection(values, plain);

  return { values, links: linksInText(plain, opts.organizationId), notFound: stillMissing, refused, summary: details.summary,
           ...(article.skipped ? { articleSkipped: article.skipped } : {}), readingCoverage: article.coverage,
           ...(byCode.coverage.expected > 0 ? { patternCoverage: byCode.coverage } : stated ? { patternCoverage: stated } : {}) };
}

// A stage's type as its printed name states it; null when the name does not say (written or computer-based).
const TYPE_BY_NAME: Array<[SelectionStageType, RegExp]> = [
  ["DOCUMENT_VERIFICATION", /\bdocument\s+verification\b|\bdv\b|\bverification\s+of\s+(?:documents|certificates)\b/i],
  ["INTERVIEW", /\binterviews?\b|\bpersonality\s+test\b|\bviva\b/i],
  ["SKILL_TEST", /\bskill\s+test\b|\btyping\b|\bstenography\b|\btrade\s+test\b/i],
  ["PHYSICAL", /\bphysical\b|\bp\.?e\.?t\b|\bp\.?s\.?t\b|\bp\.?m\.?t\b/i],
];
const GENERIC_EXAM = /^(?:computer[\s-]*based|online|written|offline)\s+(?:examination|exam|test)s?$/i;

/**
 * The selection process against the stage names and the notice's own schedule (B2.6), by code. Every change
 * is said on the item:
 *   - a "stage" whose printed name is an announcement or a step after selection (an admit card, a result,
 *     training, appointment, allotment) is not a stage of selection: taken out (it stays in the schedule
 *     when the notice dates it);
 *   - a type its name contradicts ("Document Verification" read as an interview) is set to what the name says;
 *   - an interview the schedule dates but the selection process left out (IBPS's officers) is added from
 *     the schedule, to be checked for which posts it is for;
 *   - a generic "Computer Based Examination" beside named tiers of the same kind is flagged, not removed.
 */
/**
 * No selection process from the reading, but the notice's own schedule dates its selection stages (B2.6: IBPS,
 * whose reading once left the selection process out): the process is built from those schedule entries, by code.
 * Only entries the stage classifier calls selection stages, each as printed (so "(For Officers Scale I, II and
 * III)" stays with its interview), in the schedule's order, the schedule's quote and page as the evidence, and a
 * note that it was built from the schedule. Nothing the schedule does not print; a reading's own selection process
 * is never replaced. True when built.
 */
/** A selection stage's type as its name says it: by its kind, else computer-based or written, else other. */
export function selectionStageType(name: string): SelectionStageType {
  return TYPE_BY_NAME.find(([, re]) => re.test(name))?.[0]
    ?? (/\bonline\b|\bcomputer[\s-]*based\b|\bcbt\b/i.test(name) ? "CBT" : /\bwritten\b|\boffline\b|\bpen[\s-]*and[\s-]*paper\b/i.test(name) ? "WRITTEN" : "OTHER");
}

function selectionFromSchedule(values: ExtractedValue[], plain: string): boolean {
  const had = values.find((v) => v.fieldPath === "selection");
  if (had && ((had.value as CmsSelectionInformation)?.stages?.length ?? 0) > 0) return false;
  const schedule = values.find((v) => v.fieldPath === "examStages");
  const entries = (Array.isArray(schedule?.value) ? (schedule!.value as ExamStage[]) : [])
    .filter((e) => classifyStageName(e.name) === "SELECTION")
    .sort((a, b) => a.order - b.order);
  if (!schedule || entries.length === 0) return false;
  const stages: CmsSelectionStage[] = entries.map((e, i) => ({ name: e.name, order: i + 1, type: selectionStageType(e.name) }));
  const page = schedule.page ?? (schedule.quote ? pageOf(plain, schedule.quote) : null);
  const note = `built from the notice's schedule${page ? ` (page ${page})` : ""}: the reading gave no selection process, so its ${stages.length} selection stage${stages.length === 1 ? "" : "s"} are the schedule's own entries, as printed — check them against the notice`;
  const value = { fieldPath: "selection", value: { stages } satisfies CmsSelectionInformation, ...(schedule.quote ? { quote: schedule.quote } : {}), page,
    ...(schedule.fromImage ? { fromImage: true } : {}), notes: [note] };
  if (had) values[values.indexOf(had)] = value; else values.push(value);
  return true;
}

function checkSelection(values: ExtractedValue[], plain: string): void {
  const at = values.findIndex((v) => v.fieldPath === "selection");
  if (at < 0) return;
  const info = values[at].value as CmsSelectionInformation;
  if (!info?.stages?.length) return;
  const notes: string[] = [];
  const stages: CmsSelectionStage[] = [];
  for (const s of info.stages) {
    const kind = classifyStageName(s.name);
    if (kind !== "SELECTION" && kind !== "UNCLASSIFIED") {
      notes.push(`“${s.name}” is left out of the selection process: ${STAGE_KIND_LABEL[kind].toLowerCase()} is not a stage of selection (it stays in the schedule if the notice dates it)`);
      continue;
    }
    const named = TYPE_BY_NAME.find(([, re]) => re.test(s.name))?.[0];
    if (named && named !== s.type) {
      notes.push(`“${s.name}” was read as ${s.type.toLowerCase().replace(/_/g, " ")}; its name says ${named.toLowerCase().replace(/_/g, " ")}: set so`);
      stages.push({ ...s, type: named });
    } else stages.push(s);
  }
  const schedule = values.find((v) => v.fieldPath === "examStages");
  const interview = (Array.isArray(schedule?.value) ? (schedule!.value as ExamStage[]) : []).find((e) => classifyStageName(e.name) === "SELECTION" && TYPE_BY_NAME[1][1].test(e.name));
  if (interview && !stages.some((s) => s.type === "INTERVIEW")) {
    stages.push({ name: interview.name, order: stages.length + 1, type: "INTERVIEW" });
    const page = schedule?.quote ? pageOf(plain, schedule.quote) : null;
    notes.push(`“${interview.name}” added from the notice's schedule${page ? ` (page ${page})` : ""}: the selection process read did not include it — check which posts it is for`);
  }
  for (const s of stages) {
    const sameKind = stages.filter((x) => x !== s && x.type === s.type && !GENERIC_EXAM.test(x.name));
    if (GENERIC_EXAM.test(s.name) && sameKind.length >= 2) {
      notes.push(`“${s.name}” may be the same as ${sameKind.map((x) => `“${x.name}”`).join(" and ")}: check, and remove it if so`);
    }
  }
  if (!notes.length) return;
  values[at] = { ...values[at], value: { ...info, stages: stages.map((s, i) => ({ ...s, order: i + 1 })) }, notes: [...(values[at].notes ?? []), ...notes] };
}
