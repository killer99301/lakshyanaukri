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
import type { AgeCriteria } from "@/types/recruitment-record";

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
  }

  const fee = (fieldPath: string, label: string, o: FeeOutcome) => {
    if (o.status === "accepted") add(fieldPath, o.value, o.quote);
    else if (o.status === "rejected") refused.push({ fieldPath, reason: o.reason });
    else notFound.push(o.status === "skipped" ? `${label} (${o.reason})` : label);
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
    else notFound.push(outcome.status === "skipped" ? `${label} (${outcome.reason})` : label);
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
  const NOT_FOUND_LABEL: Record<string, RegExp> = {
    "vacancies.total": /^Total Vacancies/, "vacancies.breakdown": /^Vacancy Breakdown/, "financial.feeGeneral": /^Application fee \(General/,
    "financial.feeSCST": /^Application fee \(SC/, "eligibility": /^Post-wise Eligibility/, "age": /^Age Limit/, "selection": /^Selection Process/,
    "howToApply": /^How to Apply/, "financial.payScale": /^Pay Scale/, "examPattern": /^Exam Pattern/, "syllabus": /^Syllabus/,
    "identity.notificationNumber": /^Notification Number/, "dates.notificationDate": /^Notification Date/, "dates.feePaymentCloseDate": /^Fee Payment Deadline/,
    "dates.correctionWindowEnd": /^Correction Window End/, "dates.applicationOpenDate": /^Application Opens/,
    "dates.applicationCloseDate": /^Application Closes/,
  };
  // Relaxations the notice prints as a lettered list, read by code (UPSC): a group the reading left out is
  // added with its clause as the quote; a group it gave a different number of years is corrected to the
  // clause, and said. Groups the list does not print stay as read.
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
  const listed = ageAt >= 0 ? statedRelaxations(plain) : [];
  if (listed.length) {
    const age = values[ageAt].value as AgeCriteria;
    const relaxations = [...(age.relaxations ?? [])];
    const evidence = [...(age.evidence ?? [])];
    for (const s of listed) {
      const members = relaxationMembers(s.category);
      const had = relaxations.findIndex((r) => relaxationMembers(r.category).some((m) => members.includes(m)));
      if (had >= 0 && relaxations[had].years === s.years) continue;
      if (had >= 0) {
        refused.push({ fieldPath: "age", reason: `the reading gave ${relaxations[had].years ?? "no number of"} years for ${relaxations[had].category}; the notice's clause says ${s.years} (“${s.quote.slice(0, 120)}”): the printed figure is kept` });
        relaxations.splice(had, 1);
      }
      relaxations.push({ category: s.category, years: s.years });
      evidence.push({ about: `relaxation: ${s.category} (read by code)`, value: String(s.years), quote: s.quote, page: pageOf(plain, s.quote) });
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
  const stillMissing = notFound.filter((label) => !filled.some((p) => NOT_FOUND_LABEL[p]?.test(label)));

  return { values, links: linksInText(plain, opts.organizationId), notFound: stillMissing, refused, summary: details.summary,
           ...(article.skipped ? { articleSkipped: article.skipped } : {}), readingCoverage: article.coverage,
           ...(byCode.coverage.expected > 0 ? { patternCoverage: byCode.coverage } : stated ? { patternCoverage: stated } : {}) };
}
