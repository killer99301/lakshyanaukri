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
  RecruitmentStatus,
  CmsRecruitmentPost,
  AgeCriteria,
  CmsSelectionInformation,
  CmsRecruitmentLink,
  RecruitmentClassification,
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

// ─── Approval readiness ───────────────────────────────────

export interface ApprovalReadiness {
  blocking: string[];
  warnings: string[];
}

/**
 * Advisory pre-flight check before approving a record.
 * Returns blocking issues (prevent approval) and warnings (advisory).
 * Does NOT throw — callers decide what to do with the result.
 */
export function checkApprovalReadiness(record: RecruitmentRecord): ApprovalReadiness {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!record.identity.organizationId) {
    blocking.push("identity.organizationId must be set");
  }
  if (!record.identity.title.value) {
    blocking.push("identity.title must have a value");
  }

  const checkConflict = (f: ProvenanceField<unknown> | undefined | null, path: string) => {
    if (f?.conflict) blocking.push(`${path} is CONFLICTED — resolve before approval`);
  };
  checkConflict(record.identity.title, "identity.title");
  checkConflict(record.identity.shortTitle, "identity.shortTitle");
  checkConflict(record.identity.notificationNumber, "identity.notificationNumber");
  checkConflict(record.identity.advertisementNumber, "identity.advertisementNumber");
  checkConflict(record.vacancies?.total, "vacancies.total");
  checkConflict(record.vacancies?.breakdown, "vacancies.breakdown");
  checkConflict(record.financial?.feeGeneral, "financial.feeGeneral");
  checkConflict(record.financial?.feeSCST, "financial.feeSCST");
  checkConflict(record.financial?.payScale, "financial.payScale");
  checkConflict(record.eligibility, "eligibility");
  checkConflict(record.age, "age");
  checkConflict(record.selection, "selection");

  if (record.lifecycle.conflicts.some((c) => !c.resolvedAt)) {
    blocking.push("Unresolved lifecycle conflicts remain");
  }

  if (!record.vacancies.total?.value) {
    warnings.push("vacancies.total is not set");
  }
  if (record.identity.title.status === "PENDING") {
    warnings.push("identity.title is PENDING — consider verifying against official source");
  }
  if (!record.dates.applicationCloseDate?.value) {
    warnings.push("dates.applicationCloseDate is not set");
  }

  return { blocking, warnings };
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

/** Revert a PUBLISHED record back to DRAFT for editing.
 * lastPublishedRevision is preserved — the published snapshot stays intact
 * and public pages continue to serve it while the record is being edited.
 */
export function revertRecord(
  record: RecruitmentRecord,
  adminId: string,
): StateTransitionResult {
  if (record.draftState !== "PUBLISHED") {
    throw new Error(
      `Cannot revert: record is in state ${record.draftState} (must be PUBLISHED)`,
    );
  }

  const updated = cloneRecord(record);
  updated.draftState = "DRAFT" as DraftState;
  updated.updatedAt = now();
  updated.updatedBy = adminId;
  // lastPublishedRevision intentionally preserved — still points to last snapshot.

  return {
    record: updated,
    auditEvent: {
      eventType: "RECORD_REVERTED",
      metadata: {
        adminId,
        lastPublishedRevision: record.lastPublishedRevision ?? null,
      },
    },
  };
}

// ─── Internal helpers ─────────────────────────────────────

/**
 * Update lifecycle.statusOverride (manual status override).
 * Pass newField.value = null to clear the override.
 */
export function updateLifecycleStatusOverride(
  record: RecruitmentRecord,
  newField: ProvenanceField<RecruitmentStatus | null>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  const fieldPath = "lifecycle.statusOverride";
  const oldValue = record.lifecycle.statusOverride ?? null;

  const updated = cloneRecord(record);
  if (newField.value === null || newField.value === undefined) {
    delete updated.lifecycle.statusOverride;
  } else {
    updated.lifecycle.statusOverride = newField.value;
  }
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  const revision = buildFieldRevision(
    record.id,
    fieldPath,
    oldValue,
    newField.value ?? null,
    adminId,
    reason,
  );

  return { record: updated, revision };
}

// ─── Plain-array blocks: links and how-to-apply ───────────
//
// Not ProvenanceField-wrapped, but they still go through the typed writer so
// every change is validated and leaves a FieldRevision.

const LINK_TYPES: ReadonlySet<string> = new Set([
  "OFFICIAL_NOTIFICATION", "APPLY_ONLINE", "OFFICIAL_WEBSITE", "CORRIGENDUM",
  "ADMIT_CARD", "RESULT", "ANSWER_KEY", "EXAM_NOTICE", "OTHER",
]);
const MAX_LIST_ITEMS = 30;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function updateLinks(
  record: RecruitmentRecord,
  links: unknown,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  if (!Array.isArray(links)) throw new Error("links invariant: value must be an array");
  if (links.length > MAX_LIST_ITEMS) throw new Error(`links invariant: at most ${MAX_LIST_ITEMS} links`);

  const cleaned: CmsRecruitmentLink[] = links.map((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    const label = typeof l.label === "string" ? l.label.trim() : "";
    if (typeof l.type !== "string" || !LINK_TYPES.has(l.type)) {
      throw new Error(`links invariant: link ${i + 1} has an unknown type`);
    }
    if (!label || label.length > 120) {
      throw new Error(`links invariant: link ${i + 1} needs a label (1–120 characters)`);
    }
    if (!isHttpUrl(l.url)) {
      throw new Error(`links invariant: link ${i + 1} needs a valid http(s) URL`);
    }
    if (typeof l.official !== "boolean") {
      throw new Error(`links invariant: link ${i + 1} must state whether it is official`);
    }
    return {
      type: l.type as CmsRecruitmentLink["type"],
      label,
      url: l.url.trim(),
      official: l.official,
      ...(typeof l.sourceId === "string" ? { sourceId: l.sourceId } : {}),
    };
  });

  const updated = cloneRecord(record);
  updated.links = cleaned;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  return {
    record: updated,
    revision: buildFieldRevision(record.id, "links", record.links, cleaned, adminId, reason),
  };
}

export function updateHowToApply(
  record: RecruitmentRecord,
  steps: unknown,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  if (!Array.isArray(steps)) throw new Error("howToApply invariant: value must be an array");
  const cleaned = steps.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
  if (cleaned.length !== steps.length) {
    throw new Error("howToApply invariant: every step must be non-empty text");
  }
  if (cleaned.length > MAX_LIST_ITEMS || cleaned.some((s) => s.length > 500)) {
    throw new Error(`howToApply invariant: at most ${MAX_LIST_ITEMS} steps of up to 500 characters`);
  }

  const updated = cloneRecord(record);
  updated.howToApply = cleaned;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  return {
    record: updated,
    revision: buildFieldRevision(record.id, "howToApply", record.howToApply ?? [], cleaned, adminId, reason),
  };
}

// ─── Classification (listing details) ─────────────────────
//
// Plain metadata that drives the public header boxes and listing filters.

export const CLASSIFICATION_CATEGORIES = ["government", "ssc", "banking", "railway", "defence", "teaching", "state-psc"] as const;
export const CLASSIFICATION_QUALIFICATIONS = ["10th Pass", "12th Pass", "ITI", "Diploma", "Graduate", "Post Graduate"] as const;

export function updateClassification(
  record: RecruitmentRecord,
  value: unknown,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("classification invariant: value must be an object");
  }
  const v = value as Record<string, unknown>;
  const text = (key: string, max: number): string | undefined => {
    const raw = v[key];
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "string") throw new Error(`classification invariant: ${key} must be text`);
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length > max) throw new Error(`classification invariant: ${key} must be ${max} characters or fewer`);
    return t || undefined;
  };

  const category = text("category", 40);
  if (category !== undefined && !(CLASSIFICATION_CATEGORIES as readonly string[]).includes(category)) {
    throw new Error("classification invariant: unknown category");
  }
  const qualification = text("qualification", 40);
  if (qualification !== undefined && !(CLASSIFICATION_QUALIFICATIONS as readonly string[]).includes(qualification)) {
    throw new Error("classification invariant: unknown qualification level");
  }

  const cleaned: RecruitmentClassification = {};
  const shortDescription = text("shortDescription", 300);
  const state = text("state", 60);
  if (shortDescription) cleaned.shortDescription = shortDescription;
  if (category) cleaned.category = category;
  if (state) cleaned.state = state;
  if (qualification) cleaned.qualification = qualification;

  const updated = cloneRecord(record);
  updated.classification = cleaned;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  return {
    record: updated,
    revision: buildFieldRevision(record.id, "classification", record.classification ?? {}, cleaned, adminId, reason),
  };
}

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
