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
  type FeeOutcome,
  type SourceKind,
} from "@/lib/cms/ai-assist";
import { DETAIL_FIELDS, buildDetailSections, extractDetails } from "@/lib/cms/ai-assist-details";
import { SYLLABUS_FIELDS, buildSyllabusSections, extractPatternAndSyllabus } from "@/lib/cms/ai-assist-syllabus";
import { pageOf } from "@/lib/cms/importer/evidence-text";
import { linksInText, type FoundLink } from "@/lib/cms/importer/links";
import { readArticle } from "@/lib/cms/importer/article";
import type { ExtractedValue } from "@/lib/cms/importer/proposal";

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

export async function readSource(opts: {
  content: string;
  kind: SourceKind;
  url: string;
  /** Title and organisation, so facts about other jobs in the same source are ignored. */
  subject: string;
  organizationId: string;
  apiKey: string | undefined;
  fetchFn?: typeof fetch;
}): Promise<SourceReading> {
  const { content, kind, url, subject, apiKey, fetchFn } = opts;
  const plain = kind === "html" ? htmlToText(content) : content;
  const values: ExtractedValue[] = [];
  const notFound: string[] = [];
  const refused: SourceReading["refused"] = [];
  const add = (fieldPath: string, value: unknown, quote?: string) =>
    values.push({ fieldPath, value, ...(quote ? { quote, page: pageOf(plain, quote) } : {}) });

  const base = buildAssistCandidates(content, kind, url);
  const [ai, details, pattern, article] = await Promise.all([
    extractWithAi({ sections: buildAiSections(content, kind, url), url, apiKey, fetchFn }),
    extractDetails({ sections: buildDetailSections(content, kind, url, subject), url, apiKey, subject, fetchFn }),
    extractPatternAndSyllabus({ sections: buildSyllabusSections(content, kind, url, subject), url, apiKey, subject, fetchFn }),
    readArticle({ text: plain, subject, apiKey, fetchFn }),
  ]);

  const merged = mergeAiDates(mergeAiNotificationNumber(base, ai.notificationNumber), ai.dates);
  for (const f of merged.flagged) refused.push({ fieldPath: f.label, reason: f.reason });
  const quoteFor = (fieldPath: string): string | undefined => {
    if (fieldPath === "identity.notificationNumber" && ai.notificationNumber.status === "accepted") return ai.notificationNumber.quote;
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
  const stillMissing = notFound.filter((label) => !filled.some((p) => NOT_FOUND_LABEL[p]?.test(label)));

  return { values, links: linksInText(plain, opts.organizationId), notFound: stillMissing, refused, summary: details.summary,
           ...(article.skipped ? { articleSkipped: article.skipped } : {}) };
}
