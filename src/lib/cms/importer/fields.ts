// ═══════════════════════════════════════════════════════════
// Importer: the fields it can propose, their purpose and their gate tier
// ═══════════════════════════════════════════════════════════
//
// Pure and client-safe. Paths are the same as field_revisions and the field
// save route. Links are proposed one by one as "links#<TYPE>" claims and
// written into the "links" list.

/** What a host must be trusted for before a value of this field can be verified from it. */
export type Purpose = "application" | "fee_payment" | "exam" | "recruitment_rules" | "general";

/** Tier A: must be known (verified or genuinely not applicable). Tier B: may also be honestly "not stated". */
export type Tier = "A" | "B";

export interface FieldDef {
  label: string;
  purpose: Purpose;
  tier?: Tier;
}

export const FIELD_DEFS: Record<string, FieldDef> = {
  "identity.title":               { label: "Title", purpose: "general" },
  "identity.shortTitle":          { label: "Short title", purpose: "general" },
  "identity.notificationNumber":  { label: "Notification number", purpose: "general" },
  "identity.advertisementNumber": { label: "Advertisement number", purpose: "general" },
  "dates.notificationDate":       { label: "Notification date", purpose: "general" },
  "dates.applicationOpenDate":    { label: "Applications open", purpose: "application", tier: "B" },
  "dates.applicationCloseDate":   { label: "Last date to apply", purpose: "application", tier: "A" },
  "dates.feePaymentCloseDate":    { label: "Fee payment deadline", purpose: "fee_payment", tier: "B" },
  "dates.correctionWindowEnd":    { label: "Correction window ends", purpose: "application" },
  "dates.examDate":               { label: "Exam date", purpose: "exam" },
  "dates.prelimsDate":            { label: "Prelims date", purpose: "exam" },
  "dates.mainsDate":              { label: "Mains date", purpose: "exam" },
  "dates.admitCardDate":          { label: "Admit card date", purpose: "exam" },
  "dates.interviewDate":          { label: "Interview date", purpose: "exam" },
  "dates.documentVerificationDate": { label: "Document verification date", purpose: "exam" },
  "dates.resultDate":             { label: "Result date", purpose: "exam" },
  "vacancies.total":              { label: "Total vacancies", purpose: "recruitment_rules", tier: "B" },
  "vacancies.breakdown":          { label: "Vacancy breakdown", purpose: "recruitment_rules" },
  "vacancies.table":              { label: "Vacancy table", purpose: "recruitment_rules" },
  "financial.feeGeneral":         { label: "Fee (General / OBC)", purpose: "fee_payment", tier: "B" },
  "financial.feeSCST":            { label: "Fee (SC / ST / PwBD)", purpose: "fee_payment", tier: "B" },
  "financial.payScale":           { label: "Pay scale / stipend", purpose: "recruitment_rules" },
  "eligibility":                  { label: "Eligibility", purpose: "recruitment_rules", tier: "A" },
  "age":                          { label: "Age limit", purpose: "recruitment_rules", tier: "A" },
  "selection":                    { label: "Selection process", purpose: "recruitment_rules" },
  "examPattern":                  { label: "Exam pattern", purpose: "exam" },
  "syllabus":                     { label: "Syllabus", purpose: "exam" },
  "howToApply":                   { label: "How to apply", purpose: "application" },
  "examStages":                   { label: "Exam stages", purpose: "exam" },
  "conditions":                   { label: "Notes (admin only, not published)", purpose: "general" },
  "links#APPLY_ONLINE":           { label: "Apply Online link", purpose: "application", tier: "A" },
  "links#OFFICIAL_NOTIFICATION":  { label: "Official notification link", purpose: "general", tier: "A" },
  "links#OFFICIAL_WEBSITE":       { label: "Official website link", purpose: "general" },
};

export const CRITICAL_FIELDS: string[] = Object.entries(FIELD_DEFS).filter(([, d]) => d.tier).map(([p]) => p);

export function fieldDef(path: string): FieldDef {
  return FIELD_DEFS[path] ?? (path.startsWith("links#") ? { label: `${path.slice(6).replace(/_/g, " ").toLowerCase()} link`, purpose: "general" } : { label: path, purpose: "general" });
}

/** The field_revisions path a claim's field is written to ("links#APPLY_ONLINE" → "links"). */
export const revisionPath = (fieldPath: string): string => fieldPath.split("#")[0];

/**
 * The revision paths that can make a decision on this field stale. A link is
 * decided on under its own path ("links#APPLY_ONLINE"), so deciding one link
 * does not unsettle another; any save of the whole list ("links") unsettles all.
 */
export const decisionRevisionPaths = (fieldPath: string): string[] =>
  fieldPath.includes("#") ? [fieldPath, revisionPath(fieldPath)] : [fieldPath];

/** Where a decision writes its own revision. */
export const decisionRevisionPath = (fieldPath: string): string => (fieldPath.includes("#") ? fieldPath : revisionPath(fieldPath));
