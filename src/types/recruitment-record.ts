// ═══════════════════════════════════════════════════════════
// CMS Domain Model — RecruitmentRecord Types
// ═══════════════════════════════════════════════════════════
//
// This is the canonical CMS domain model, distinct from:
//   - GovernmentRecruitment (legacy migration reference)
//   - RecruitmentIntelligenceDraft (transient AI output)
//   - PublishedRecruitment (deterministic projection — see cms/projection.ts)
//
// INVARIANTS (enforced by src/lib/cms/validation.ts):
//   I1: status === "NOT_SPECIFIED" ↔ value === null
//   I2: status !== "NOT_SPECIFIED" → value !== null
//   I3: conflict === true ↔ status === "CONFLICTED"
// ═══════════════════════════════════════════════════════════

import type { AgeRelaxation, VacancyRow, Provenance, UpdateRecord, DateCertainty } from "@/types";

// ─── Core State ───────────────────────────────────────────

export type DraftState = "DRAFT" | "APPROVED" | "PUBLISHED" | "ARCHIVED";

export type GovernmentType = "Central Govt" | "State Govt" | "PSU";

export type RecruitmentStatus =
  | "DRAFT"
  | "UPCOMING"
  | "OPEN"
  | "CLOSING_SOON"
  | "APPLICATIONS_CLOSED"
  | "EXAM_SCHEDULED"
  | "RESULT_PENDING"
  | "COMPLETED"
  | "CANCELLED"
  | "PAUSED";

// ─── ProvenanceField<T> ───────────────────────────────────
//
// Wrapper for all operationally significant fields.
// Invariants I1–I3 must hold at every boundary.
//
// machineValue: set once, on the first admin edit of a field that was
// machine-extracted. Never overwritten afterward — permanent record of
// what the extraction engine originally found.

export type FieldStatus =
  | "VERIFIED"
  | "PENDING"
  | "CONFLICTED"
  | "NEEDS_UPDATE"
  | "NOT_SPECIFIED";

export interface ProvenanceField<T> {
  value: T | null;
  status: FieldStatus;
  evidenceIds: string[];
  conflict: boolean;
  machineValue?: T;
  manuallyEdited: boolean;
}

// ─── Evidence ─────────────────────────────────────────────

export type EvidenceSourceType =
  | "OFFICIAL_NOTIFICATION"
  | "OFFICIAL_PORTAL"
  | "OFFICIAL_CORRIGENDUM"
  | "PRESS_RELEASE"
  | "SECONDARY"
  | "MANUAL";

export interface EvidenceExcerpt {
  id: string;
  fieldPath: string;
  quote: string;
  extractionMethod: "STRUCTURED" | "LLM" | "MANUAL";
  extractedAt: string;
  // LLM self-reported extraction confidence (0.0–1.0).
  // Absent for STRUCTURED and MANUAL — use sourceType for authority.
  extractionConfidence?: number;
}

export interface CmsEvidence {
  id: string;
  recruitmentId: string;
  url: string;
  title?: string;
  sourceType: EvidenceSourceType;
  authorityRank: number;  // 1 = highest (official notification)
  fetchedAt: string;
  excerpts: EvidenceExcerpt[];
}

// ─── Field Revision (append-only log) ────────────────────
//
// Every write through the writer creates a FieldRevision.
// fieldPath uses dot-notation:
//   namespace fields:     "dates.applicationCloseDate"
//   ProvenanceField blocks: "eligibility", "age", "selection",
//                           "vacancies.breakdown"

export interface FieldRevision {
  id: string;
  recruitmentId: string;
  fieldPath: string;
  revisedBy: string;      // admin UUID
  revisedAt: string;      // ISO
  oldValue: unknown;
  newValue: unknown;
  reason?: string;
}

// ─── Lifecycle ────────────────────────────────────────────

export type LifecycleEventType =
  | "NOTIFICATION_RELEASED"
  | "APPLICATION_OPEN"
  | "APPLICATION_CLOSED"
  | "EXAM"
  | "RESULT"
  | "CORRIGENDUM_ISSUED"
  | "EXAM_POSTPONED"
  | "VACANCY_REVISED"
  | "INTERVIEW"
  | "DOCUMENT_VERIFICATION"
  | "ADMIT_CARD_RELEASED"
  | "JOINING";

export interface CmsLifecycleEvent {
  id: string;
  type: LifecycleEventType;
  certainty: DateCertainty;
  official: boolean;
  evidenceId?: string;
  date?: string;          // ISO
  notes?: string;
}

export interface CmsConflict {
  fieldPath: string;
  machineValue: unknown;
  adminValue: unknown;
  evidenceIds: string[];
  detectedAt: string;
  resolvedAt?: string;
}

export interface RecruitmentLifecycle {
  status: RecruitmentStatus;
  statusOverride?: RecruitmentStatus;
  conflicts: CmsConflict[];
  events: CmsLifecycleEvent[];
}

// ─── AgeCriteria — block type for age: ProvenanceField<AgeCriteria> ──

export interface AgeCriteria {
  min?: number;
  max?: number;
  asOf?: string;              // ISO reference date for age calculation
  relaxations: AgeRelaxation[];
}

// ─── RecruitmentPost — block element for eligibility ─────

export interface CmsRecruitmentPost {
  post: string;
  qualification?: string[];
  experience?: string[];
  ageOverride?: AgeCriteria;
  payScale?: string;
  vacancies?: number;
  selectionStages?: string[];
}

// ─── SelectionStage / SelectionInformation ───────────────

export type SelectionStageType =
  | "WRITTEN"
  | "CBT"
  | "INTERVIEW"
  | "SKILL_TEST"
  | "DOCUMENT_VERIFICATION"
  | "PHYSICAL"
  | "OTHER";

export interface CmsSelectionStage {
  name: string;
  order: number;
  type: SelectionStageType;
  description?: string;
  qualifying?: boolean;   // marks but doesn't count in merit
}

export interface CmsSelectionInformation {
  stages?: CmsSelectionStage[];
  examPattern?: string;
  negativeMarking?: string;
  finalMeritFormula?: string;
}

// ─── Links and Documents ──────────────────────────────────

export type RecruitmentLinkType =
  | "OFFICIAL_NOTIFICATION"
  | "APPLY_ONLINE"
  | "OFFICIAL_WEBSITE"
  | "CORRIGENDUM"
  | "ADMIT_CARD"
  | "RESULT"
  | "ANSWER_KEY"
  | "EXAM_NOTICE"
  | "OTHER";

export interface CmsRecruitmentLink {
  type: RecruitmentLinkType;
  label: string;
  url: string;
  official: boolean;
  sourceId?: string;  // FK → CmsEvidence if engine-discovered
}

export type RecruitmentDocumentType =
  | "NOTIFICATION"
  | "CORRIGENDUM"
  | "ADDENDUM"
  | "ADMIT_CARD"
  | "ANSWER_KEY"
  | "RESULT"
  | "CUTOFF"
  | "EXAM_NOTICE"
  | "VACANCY_REVISION"
  | "OTHER";

export interface CmsRecruitmentDocument {
  type: RecruitmentDocumentType;
  label: string;
  url: string;
  official: boolean;
  datePublished?: string;
  evidenceId?: string;  // FK → CmsEvidence if also in evidence store
}

// ─── Domain Blocks (namespace blocks — individual ProvenanceField per field) ──

export interface RecruitmentIdentity {
  organizationId: string;
  organizationName: string;  // denormalized snapshot
  govType?: GovernmentType;
  recruitmentYear: number;
  title: ProvenanceField<string>;
  shortTitle?: ProvenanceField<string>;
  notificationNumber?: ProvenanceField<string>;
  advertisementNumber?: ProvenanceField<string>;
}

export interface RecruitmentDates {
  notificationDate?: ProvenanceField<string | null>;
  applicationOpenDate?: ProvenanceField<string | null>;
  applicationCloseDate?: ProvenanceField<string | null>;
  feePaymentCloseDate?: ProvenanceField<string | null>;
  correctionWindowEnd?: ProvenanceField<string | null>;
  examDate?: ProvenanceField<string | null>;
  prelimsDate?: ProvenanceField<string | null>;
  mainsDate?: ProvenanceField<string | null>;
  admitCardDate?: ProvenanceField<string | null>;
  resultDate?: ProvenanceField<string | null>;
  interviewDate?: ProvenanceField<string | null>;
  documentVerificationDate?: ProvenanceField<string | null>;
  joiningDate?: ProvenanceField<string | null>;
}

export interface VacancyInformation {
  total?: ProvenanceField<number | null>;
  breakdown?: ProvenanceField<VacancyRow[]>;  // BLOCK — fieldPath "vacancies.breakdown"
}

export interface FinancialInformation {
  feeGeneral?: ProvenanceField<number | null>;
  feeSCST?: ProvenanceField<number | null>;
  paymentModes?: string[];
  payScale?: ProvenanceField<string>;
}

export interface SpecialConditions {
  items: string[];
  notes?: string;   // admin-only, never published
}

// ─── Canonical CMS Record ─────────────────────────────────
//
// Domain-block shape is the implementation target from day one.
// Never build a flat version first. See architecture §20.

export interface RecruitmentRecord {
  id: string;
  slug: string;
  draftState: DraftState;
  recordRevision: string;     // content hash; incremented on every approved edit
  publishedAt?: string;       // ISO
  lastPublishedRevision?: string;

  // Namespace blocks (individual ProvenanceField per field)
  identity:  RecruitmentIdentity;
  dates:     RecruitmentDates;
  vacancies: VacancyInformation;
  financial: FinancialInformation;

  // ProvenanceField blocks (one evidence set covers the entire block)
  eligibility?: ProvenanceField<CmsRecruitmentPost[]>;  // fieldPath "eligibility"
  age?:         ProvenanceField<AgeCriteria>;            // fieldPath "age"
  selection?:   ProvenanceField<CmsSelectionInformation>; // fieldPath "selection"

  howToApply?: string[];
  links:       CmsRecruitmentLink[];
  documents:   CmsRecruitmentDocument[];
  lifecycle:   RecruitmentLifecycle;
  conditions?: SpecialConditions;

  // Record-level verification (re-uses the existing Provenance shape)
  provenance: Provenance;
  updates:    UpdateRecord[];

  createdAt: string;
  updatedAt: string;
  createdBy?: string;   // admin UUID
  updatedBy?: string;   // admin UUID
}

// ─── Validation Result ────────────────────────────────────

export interface ValidationError {
  fieldPath: string;
  invariant: "I1" | "I2" | "I3" | "REQUIRED" | "FORMAT" | "CONSTRAINT";
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
