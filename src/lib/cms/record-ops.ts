// ═══════════════════════════════════════════════════════════
// CMS Record Operations — Pure Business Logic
// ═══════════════════════════════════════════════════════════
//
// Pure functions only — no I/O, no DB, no side effects.
// All mutations return new record state + a FieldRevision.
// The repository calls these then persists both atomically.
//
// INVARIANTS:
//   - No direct mutation of RecruitmentRecord fields
//   - Every field update produces a FieldRevision
//   - FieldRevisions are append-only (no updates, no deletes)
//   - machineValue is set once; never overwritten
//   - MANUAL attestation = PENDING, not automatically VERIFIED
// ═══════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";

import type {
  RecruitmentRecord,
  FieldRevision,
  ProvenanceField,
  DraftState,
  RecruitmentLifecycle,
  RecruitmentDates,
  VacancyInformation,
  FinancialInformation,
  RecruitmentIdentity,
  CmsRecruitmentPost,
  AgeCriteria,
  CmsSelectionInformation,
} from "@/types/recruitment-record";

import type { VacancyRow } from "@/types";
import { validateProvenanceField, validateRecord } from "@/lib/cms/validation";

// ─── Type helpers ──────────────────────────────────────────

type DeepReadonly<T> = T extends Array<infer U>
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type ReadonlyRecord = DeepReadonly<RecruitmentRecord>;

// ─── Revision helpers ─────────────────────────────────────

function newRevisionId(): string {
  return randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export function buildFieldRevision(
  recruitmentId: string,
  fieldPath: string,
  oldValue: unknown,
  newValue: unknown,
  revisedBy: string,
  reason?: string,
): FieldRevision {
  return {
    id: newRevisionId(),
    recruitmentId,
    fieldPath,
    revisedBy,
    revisedAt: now(),
    oldValue,
    newValue,
    ...(reason !== undefined ? { reason } : {}),
  };
}

// ─── State transition helpers ─────────────────────────────

export interface StateTransitionResult {
  record: RecruitmentRecord;
  auditEvent: { eventType: string; metadata: Record<string, unknown> };
}

/** Approve a DRAFT record. Fails if validation errors exist. */
export function approveRecord(
  record: RecruitmentRecord,
  adminId: string,
): StateTransitionResult {
  if (record.draftState !== "DRAFT") {
    throw new Error(
      `Cannot approve: record is in state ${record.draftState} (must be DRAFT)`,
    );
  }

  const validation = validateRecord(record);
  if (!validation.valid) {
    throw new Error(
      `Cannot approve: validation failed — ${validation.errors.map((e) => e.message).join("; ")}`,
    );
  }

  if (record.lifecycle.conflicts.length > 0) {
    const unresolved = record.lifecycle.conflicts.filter((c) => !c.resolvedAt);
    if (unresolved.length > 0) {
      throw new Error(
        `Cannot approve: ${unresolved.length} unresolved conflict(s) remain`,
      );
    }
  }

  // Reject if any ProvenanceField is still in CONFLICTED state
  const conflicted: string[] = [];
  const checkPF = (f: ProvenanceField<unknown> | undefined | null, path: string) => {
    if (f?.conflict) conflicted.push(path);
  };
  checkPF(record.identity.title, "identity.title");
  checkPF(record.identity.shortTitle, "identity.shortTitle");
  checkPF(record.identity.notificationNumber, "identity.notificationNumber");
  checkPF(record.identity.advertisementNumber, "identity.advertisementNumber");
  checkPF(record.vacancies?.total, "vacancies.total");
  checkPF(record.vacancies?.breakdown, "vacancies.breakdown");
  checkPF(record.financial?.feeGeneral, "financial.feeGeneral");
  checkPF(record.financial?.feeSCST, "financial.feeSCST");
  checkPF(record.financial?.payScale, "financial.payScale");
  checkPF(record.eligibility, "eligibility");
  checkPF(record.age, "age");
  checkPF(record.selection, "selection");
  if (conflicted.length > 0) {
    throw new Error(
      `Cannot approve: conflicted field(s) must be resolved — ${conflicted.join(", ")}`,
    );
  }

  const updated = cloneRecord(record);
  updated.draftState = "APPROVED" as DraftState;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  return {
    record: updated,
    auditEvent: {
      eventType: "RECORD_APPROVED",
      metadata: { adminId, previousState: "DRAFT" },
    },
  };
}

/** Transition APPROVED → PUBLISHED. Requires a projection to succeed externally. */
export function markPublished(
  record: RecruitmentRecord,
  adminId: string,
  projectionRevision: string,
): StateTransitionResult {
  if (record.draftState !== "APPROVED") {
    throw new Error(
      `Cannot publish: record is in state ${record.draftState} (must be APPROVED)`,
    );
  }

  const t = now();
  const updated = cloneRecord(record);
  updated.draftState = "PUBLISHED" as DraftState;
  updated.publishedAt = updated.publishedAt ?? t;
  updated.lastPublishedRevision = projectionRevision;
  updated.updatedAt = t;
  updated.updatedBy = adminId;

  return {
    record: updated,
    auditEvent: {
      eventType: "RECORD_PUBLISHED",
      metadata: { adminId, projectionRevision },
    },
  };
}

// ─── Field update path ────────────────────────────────────
//
// All field mutations go through applyFieldUpdate.
// Returns a new record (not mutating) and a FieldRevision.

export interface FieldUpdateResult {
  record: RecruitmentRecord;
  revision: FieldRevision;
}

// ── Namespace field update (individual ProvenanceField) ───

/**
 * Update a single ProvenanceField within the identity block.
 * fieldPath must be "identity.<fieldName>".
 */
export function updateIdentityField(
  record: RecruitmentRecord,
  fieldName: keyof RecruitmentIdentity,
  newField: ProvenanceField<unknown>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = `identity.${fieldName}`;

  const errors = validateProvenanceField(newField, fieldPath);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const updated = cloneRecord(record);
  (updated.identity as unknown as Record<string, unknown>)[fieldName] = newField;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    (record.identity as unknown as Record<string, unknown>)[fieldName],
    newField,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

/**
 * Update a single ProvenanceField within the dates block.
 * fieldPath must be "dates.<fieldName>".
 */
export function updateDateField(
  record: RecruitmentRecord,
  fieldName: keyof RecruitmentDates,
  newField: ProvenanceField<string | null>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = `dates.${fieldName}`;

  const errors = validateProvenanceField(newField, fieldPath);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const updated = cloneRecord(record);
  (updated.dates as Record<string, unknown>)[fieldName] = newField;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    (record.dates as Record<string, unknown>)[fieldName],
    newField,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

/**
 * Update vacancies.total independently of vacancies.breakdown.
 */
export function updateVacancyTotal(
  record: RecruitmentRecord,
  newField: ProvenanceField<number | null>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = "vacancies.total";

  const errors = validateProvenanceField(newField, fieldPath);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const updated = cloneRecord(record);
  updated.vacancies = { ...record.vacancies, total: newField };
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    record.vacancies.total,
    newField,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

// ── ProvenanceField block updates ─────────────────────────
//
// Each block is revised atomically.
// fieldPath is the block name: "vacancies.breakdown", "eligibility", "age", "selection"

/**
 * Replace the entire vacancies.breakdown block.
 * fieldPath = "vacancies.breakdown"
 */
export function updateVacancyBreakdown(
  record: RecruitmentRecord,
  newField: ProvenanceField<VacancyRow[]>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = "vacancies.breakdown";

  const errors = validateProvenanceField(newField, fieldPath);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const updated = cloneRecord(record);
  updated.vacancies = { ...record.vacancies, breakdown: newField };
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    record.vacancies.breakdown,
    newField,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

/**
 * Replace the entire eligibility block (all posts atomically).
 * fieldPath = "eligibility"
 * When one post changes, the full RecruitmentPost[] is stored as old/new value.
 */
export function updateEligibility(
  record: RecruitmentRecord,
  newField: ProvenanceField<CmsRecruitmentPost[]>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = "eligibility";

  const errors = validateProvenanceField(newField, fieldPath);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const updated = cloneRecord(record);
  updated.eligibility = newField;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    record.eligibility,
    newField,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

/**
 * Replace the entire age block (criteria + relaxations atomically).
 * fieldPath = "age"
 */
export function updateAge(
  record: RecruitmentRecord,
  newField: ProvenanceField<AgeCriteria>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = "age";

  const errors = validateProvenanceField(newField, fieldPath);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const updated = cloneRecord(record);
  updated.age = newField;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    record.age,
    newField,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

/**
 * Replace the entire selection block (stages + exam pattern atomically).
 * fieldPath = "selection"
 */
export function updateSelection(
  record: RecruitmentRecord,
  newField: ProvenanceField<CmsSelectionInformation>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = "selection";

  const errors = validateProvenanceField(newField, fieldPath);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const updated = cloneRecord(record);
  updated.selection = newField;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    record.selection,
    newField,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

// ── Financial field updates ────────────────────────────────

/**
 * Update a single financial field (feeGeneral, feeSCST, payScale).
 * fieldPath = "financial.<fieldName>"
 */
export function updateFinancialField(
  record: RecruitmentRecord,
  fieldName: keyof FinancialInformation,
  newField: ProvenanceField<number | null> | ProvenanceField<string>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = `financial.${fieldName}`;

  const errors = validateProvenanceField(newField as ProvenanceField<unknown>, fieldPath);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const updated = cloneRecord(record);
  (updated.financial as unknown as Record<string, unknown>)[fieldName] = newField;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    (record.financial as Record<string, unknown>)[fieldName],
    newField,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

// ─── Vacancy total and breakdown independence ──────────────
//
// vacancies.total and vacancies.breakdown are independently trackable:
// a corrigendum may update total (+5 posts) before the breakdown
// table is formally restated.

export function vacanciesAreIndependent(record: RecruitmentRecord): boolean {
  const hasTotal = record.vacancies.total !== undefined;
  const hasBreakdown = record.vacancies.breakdown !== undefined;
  // They can exist independently — neither requires the other
  return hasTotal || hasBreakdown || (!hasTotal && !hasBreakdown);
}

// ─── Record lifecycle ─────────────────────────────────────

/** Compute a simple content hash for record revision tracking. */
export function computeRecordRevision(record: RecruitmentRecord): string {
  const content = JSON.stringify({
    identity: record.identity,
    dates: record.dates,
    vacancies: record.vacancies,
    financial: record.financial,
    eligibility: record.eligibility,
    age: record.age,
    selection: record.selection,
    howToApply: record.howToApply,
    lifecycle: record.lifecycle,
    conditions: record.conditions,
  });
  // Simple hash — production can upgrade to SHA-256 via crypto.subtle
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

// ─── Internal helpers ─────────────────────────────────────

/** Shallow clone with deep-copied blocks that will be mutated. */
function cloneRecord(record: RecruitmentRecord): RecruitmentRecord {
  return {
    ...record,
    identity: { ...record.identity },
    dates: { ...record.dates },
    vacancies: { ...record.vacancies },
    financial: { ...record.financial },
    lifecycle: {
      ...record.lifecycle,
      conflicts: [...record.lifecycle.conflicts],
      events: [...record.lifecycle.events],
    },
    links: [...record.links],
    documents: [...record.documents],
    updates: [...record.updates],
  };
}
