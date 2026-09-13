// ═══════════════════════════════════════════════════════════
// Phase 10: URL-First Recruitment Intelligence — Draft Types
// ═══════════════════════════════════════════════════════════
//
// These types define the RecruitmentIntelligenceDraft produced by
// the URL intelligence pipeline. Every extracted field is attributed
// to a source; conflicts are surfaced, never silently resolved.
//
// INVARIANTS:
//   - No field is inferred without evidence; absent means unknown
//   - derivedTotal must be marked separately from an explicit total
//   - Official source authority always wins over secondary
//   - Manual edits are tracked but never erase machine evidence
//   - A draft is NEVER automatically published; it requires explicit
//     human approval (Approve & Publish) to enter the canonical path
// ═══════════════════════════════════════════════════════════

// ─── Source Model ────────────────────────────────────────────

export type SourceKind =
  | "OFFICIAL"
  | "SECONDARY"
  | "APPLICATION_PORTAL"
  | "RESULT_PORTAL"
  | "OTHER";

export type RetrievalMethod =
  | "HTML"
  | "RSS"
  | "BROWSER"
  | "PDF"
  | "MANUAL";

export interface IntelligenceSource {
  id: string;

  url: string;

  canonicalUrl?: string;

  domain: string;

  kind: SourceKind;

  organizationId?: string;

  retrievalMethod?: RetrievalMethod;

  title?: string;

  retrievedAt: string;

  httpStatus?: number;

  success: boolean;

  contentHash?: string;

  // If this source was found by following a link from another source
  parentSourceId?: string;

  // If this source was discovered by the engine from another source
  discoveredFromSourceId?: string;
}

// ─── Source Authority ─────────────────────────────────────────
//
// Authority rank governs conflict resolution: higher rank wins.
// Uses a single centralized resolver so extraction code never
// hard-codes authority numbers.

const SOURCE_AUTHORITY_RANK: Record<SourceKind, number> = {
  OFFICIAL: 4,
  APPLICATION_PORTAL: 3,
  RESULT_PORTAL: 3,
  SECONDARY: 1,
  OTHER: 0,
};

export function resolveSourceAuthority(kind: SourceKind): number {
  return SOURCE_AUTHORITY_RANK[kind] ?? 0;
}

// ─── Field Provenance ─────────────────────────────────────────
//
// Every extracted value is wrapped with evidence so the admin can
// see exactly where each fact came from.

export interface FieldEvidence {
  sourceId: string;

  url: string;

  value: unknown;

  // ≤300 chars of surrounding text from which the value was extracted
  extractedText?: string;

  // 0.0–1.0
  confidence: number;

  // Higher = more authoritative source
  authorityRank: number;

  extractionMethod: "STRUCTURED" | "TEXT" | "LINK" | "MANUAL";

  extractedAt: string;
}

export interface FieldValue<T> {
  // The resolved value (highest-authority non-conflicting, or manually overridden)
  value?: T;

  // Original machine-extracted value — set once on the first manual edit.
  // Never overwritten after that; forms the permanent evidence of what the engine found.
  machineValue?: T;

  // 0.0–1.0 composite across all evidence
  confidence: number;

  // Which source's evidence was selected as the winning value
  selectedSourceId?: string;

  // All gathered evidence for this field (may include conflicting values)
  evidence: FieldEvidence[];

  // True if an admin has overridden the machine-extracted value
  manuallyEdited: boolean;

  // True if evidence from different sources disagrees; admin must resolve
  conflict: boolean;

  // Manual edit provenance — all undefined on machine-extracted fields
  editedBy?: string;
  editedAt?: string;
  editReason?: string;
}

// ─── Recruitment Identity ─────────────────────────────────────

export interface RecruitmentIdentity {
  title: FieldValue<string>;

  shortTitle: FieldValue<string>;

  organizationId: FieldValue<string>;

  organizationName: FieldValue<string>;

  recruitmentYear: FieldValue<number>;

  // Raw string as found on the page (e.g. "AO/2026", "CEN 01/2026")
  notificationNumber: FieldValue<string>;

  // Separate from notificationNumber — e.g. "2026-27/02" vs "AO/2026"
  advertisementNumber: FieldValue<string>;

  // "new_notice" | "corrigendum" | "extension" | "vacancy_revision" |
  // "exam_date_change" | "postponement" | "result" | "admit_card" |
  // "answer_key" | "other"
  recruitmentType: FieldValue<string>;
}

// ─── Lifecycle ────────────────────────────────────────────────

export type RecruitmentStatus =
  | "UPCOMING"
  | "OPEN"
  | "CLOSED"
  | "EXAM_SCHEDULED"
  | "EXAM_CONDUCTED"
  | "RESULT_OUT"
  | "ADMIT_CARD_OUT"
  | "ANSWER_KEY_OUT"
  | "INTERVIEW"
  | "FINAL_RESULT"
  | "JOINING"
  | "CANCELLED";

export type DateCertainty =
  | "CONFIRMED"
  | "TENTATIVE"
  | "TBA"
  | "POSTPONED"
  | "CANCELLED";

export interface LifecycleEvent {
  id: string;

  type: string;

  label: string;

  // ISO date string (absent = TBA)
  date?: string;

  certainty: DateCertainty;

  sourceEvidence: FieldEvidence[];

  notes?: string;
}

// ─── Dates ────────────────────────────────────────────────────

export interface RecruitmentDate {
  // ISO date string (current value — may be machine-extracted or admin-overridden)
  date?: string;

  // Original machine-extracted date — set once on first manual edit, never overwritten.
  machineDate?: string;

  certainty: DateCertainty;

  // All gathered evidence for this date (may include conflicting values from different sources)
  sourceEvidence: FieldEvidence[];

  manuallyEdited: boolean;

  // True when sources disagree on this date; both values preserved in sourceEvidence
  conflict?: boolean;

  // Which source's date was selected as the winning value
  selectedSourceId?: string;

  // Manual edit provenance
  editedBy?: string;
  editedAt?: string;
  editReason?: string;
}

export interface RecruitmentDates {
  notificationDate?: RecruitmentDate;

  applicationOpenDate?: RecruitmentDate;

  applicationCloseDate?: RecruitmentDate;

  feePaymentOpenDate?: RecruitmentDate;

  feePaymentCloseDate?: RecruitmentDate;

  correctionOpenDate?: RecruitmentDate;

  correctionCloseDate?: RecruitmentDate;

  examDate?: RecruitmentDate;

  prelimsDate?: RecruitmentDate;

  mainsDate?: RecruitmentDate;

  interviewDate?: RecruitmentDate;

  resultDate?: RecruitmentDate;

  documentVerificationDate?: RecruitmentDate;

  joiningDate?: RecruitmentDate;
}

// ─── Vacancies ────────────────────────────────────────────────

export interface CategoryBreakdown {
  UR?: number;
  OBC?: number;
  SC?: number;
  ST?: number;
  EWS?: number;
  PwBD?: number;
  ESM?: number;
  other?: Record<string, number>;
}

export interface VacancyRow {
  id: string;

  postName: string;

  postCode?: string;

  grade?: string;

  total?: number;

  categoryBreakdown?: CategoryBreakdown;

  sourceEvidence: FieldEvidence[];

  manuallyEdited: boolean;

  // Manual edit provenance
  editedBy?: string;
  editedAt?: string;

  // True for rows added by an admin (not machine-extracted)
  isAdminAdded?: boolean;

  // Soft-delete: row excluded from totals but preserved in audit trail
  isDeleted?: boolean;
}

export interface VacancyData {
  // Explicitly stated total from a source, if any
  total?: FieldValue<number>;

  // True when total was stated directly in source (e.g. "Total: 225")
  // False when derivedTotal was computed by summing rows
  isIndicative?: boolean;

  // Post-level breakdown rows
  rows: VacancyRow[];

  // Sum of rows[].total — populated when source gave no explicit total
  derivedTotal?: number;

  // Human-readable explanation of how derivedTotal was calculated
  derivedTotalExplanation?: string;
}

// ─── Eligibility ──────────────────────────────────────────────

export interface Eligibility {
  qualification?: string;

  specialization?: string;

  experience?: string;

  minimumExperienceYears?: number;

  ageMinimum?: number;

  ageMaximum?: number;

  ageRelaxation?: string;

  nationality?: string;

  otherConditions?: string[];

  sourceEvidence: FieldEvidence[];
}

export interface PostEligibility {
  postId: string;

  eligibility: Eligibility;
}

// ─── Pay / Financial ──────────────────────────────────────────

export interface FeeEntry {
  category: string;
  amount?: number;
  description?: string;
}

export interface PayInformation {
  payScale?: string;

  payLevel?: string;

  basicPay?: string;

  // Never inferred; only set when the source explicitly states it
  salary?: string;

  allowances?: string[];

  probation?: string;

  bond?: string;

  applicationFee?: FeeEntry[];

  sourceEvidence: FieldEvidence[];
}

// ─── Selection ────────────────────────────────────────────────

export interface SelectionStage {
  name: string;

  order: number;

  description?: string;

  sourceEvidence: FieldEvidence[];
}

export interface SelectionInformation {
  stages: SelectionStage[];

  examPattern?: string;

  totalMarks?: number;

  durationMinutes?: number;

  negativeMarking?: string;

  interviewWeightage?: string;

  finalMeritFormula?: string;
}

// ─── Posts ───────────────────────────────────────────────────

export interface RecruitmentPost {
  id: string;

  name: string;

  code?: string;

  department?: string;

  vacancies?: VacancyRow;

  eligibility?: Eligibility;

  pay?: PayInformation;

  selection?: SelectionInformation;
}

// ─── Links ────────────────────────────────────────────────────

export type RecruitmentLinkType =
  | "OFFICIAL_NOTIFICATION"
  | "APPLY_ONLINE"
  | "OFFICIAL_WEBSITE"
  | "RECRUITMENT_PORTAL"
  | "LOGIN"
  | "CORRIGENDUM"
  | "ADMIT_CARD"
  | "RESULT"
  | "ANSWER_KEY"
  | "SHORT_NOTICE"
  | "OTHER";

export interface RecruitmentLink {
  type: RecruitmentLinkType;

  label: string;

  url: string;

  // Which source surfaced this link
  sourceId: string;

  // True only when the link's domain is in the organization registry
  official: boolean;
}

// ─── Conflicts ───────────────────────────────────────────────

export type ConflictSeverity = "INFO" | "WARNING" | "BLOCKING";

export interface ConflictValue {
  value: unknown;
  sourceId: string;
  url: string;
  sourceKind: SourceKind;
  confidence: number;
}

export interface ConflictResolution {
  selectedValue: unknown;
  reason: string;
  selectedSourceId: string;
}

export interface IntelligenceConflict {
  // Dot-path to the field (e.g. "vacancies.total", "dates.applicationCloseDate.date")
  field: string;

  values: ConflictValue[];

  // Set when the engine auto-resolved by authority; null = admin must decide
  resolution?: ConflictResolution;

  // Admin-applied decision — overrides auto-resolution when set
  adminDecision?: ConflictResolution & { decidedAt: string; decidedBy: string };

  severity: ConflictSeverity;
}

// ─── Draft Readiness ──────────────────────────────────────────

export interface DraftReadiness {
  readyForReview: boolean;

  // Issues that prevent approval (must be fixed first)
  blockingIssues: string[];

  // Issues that the admin should be aware of but can proceed
  warnings: string[];
}

// ─── Complete Draft ───────────────────────────────────────────

export interface RecruitmentIntelligenceDraft {
  id: string;

  createdAt: string;

  updatedAt: string;

  // ISO 8601 — when admin last saved this draft. In-session only (Phase 10E).
  savedAt?: string;

  // All sources consulted — user-provided and engine-discovered
  sources: IntelligenceSource[];

  identity: RecruitmentIdentity;

  status?: FieldValue<RecruitmentStatus>;

  dates: RecruitmentDates;

  vacancies: VacancyData;

  // First-class post objects (for recruitments with multiple distinct posts)
  posts: RecruitmentPost[];

  // Recruitment-wide eligibility (applies when all posts share requirements)
  eligibility?: Eligibility;

  // Per-post eligibility (overrides recruitment-wide for that post)
  postEligibility: PostEligibility[];

  pay?: PayInformation;

  selection?: SelectionInformation;

  links: RecruitmentLink[];

  // Chronological events (may include future dates that are TBA)
  lifecycle: LifecycleEvent[];

  // All detected field disagreements between sources
  conflicts: IntelligenceConflict[];

  // Field paths where no source could supply a value
  missingFields: string[];

  // 0.0–1.0 composite across all FieldValue confidences
  overallConfidence: number;

  readiness: DraftReadiness;
}

// ─── URL Retriever Contract ───────────────────────────────────

export interface DiscoveredLink {
  url: string;
  label: string;
  type: RecruitmentLinkType;
}

export interface RetrievedSource {
  source: IntelligenceSource;

  success: boolean;

  // Raw HTML content when retrievalMethod is HTML or BROWSER
  html?: string;

  // Plain-text extraction of the page
  text?: string;

  // Links found on the page that may be useful
  links: DiscoveredLink[];

  error?: string;
}

export interface SourceRetriever {
  canHandle(url: URL): boolean;

  retrieve(url: URL, sourceId: string, kind: SourceKind): Promise<RetrievedSource>;
}
