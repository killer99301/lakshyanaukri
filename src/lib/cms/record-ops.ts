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

import type { ExamStage } from "@/types";

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
  ExamPatternPaper,
  ExamPatternSection,
  SyllabusSubject,
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
    // Absent on older records, so their fingerprint is unchanged.
    examPattern: record.examPattern,
    syllabus: record.syllabus,
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
  "ADMIT_CARD", "RESULT", "ANSWER_KEY", "CUT_OFF", "EXAM_NOTICE", "OTHER",
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

    // A saved copy: our own copy of a document, with the official address it came from.
    const saved: Pick<CmsRecruitmentLink, "savedFrom" | "savedOn"> = {};
    if (l.savedFrom !== undefined && l.savedFrom !== null && l.savedFrom !== "") {
      if (!isHttpUrl(l.savedFrom)) {
        throw new Error(`links invariant: link ${i + 1} is a saved copy and needs the official http(s) address it came from`);
      }
      if (l.official) {
        throw new Error(`links invariant: link ${i + 1} is a saved copy, so it cannot be marked official`);
      }
      const from = l.savedFrom.trim();
      if (new URL(from).hostname === new URL(l.url.trim()).hostname) {
        throw new Error(`links invariant: link ${i + 1}: the source address is on the same site as the copy — enter the official page the file came from`);
      }
      const on = typeof l.savedOn === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(l.savedOn) ? l.savedOn : now().slice(0, 10);
      saved.savedFrom = from;
      saved.savedOn = on;
    }

    return {
      type: l.type as CmsRecruitmentLink["type"],
      label,
      url: l.url.trim(),
      official: l.official,
      ...(typeof l.sourceId === "string" ? { sourceId: l.sourceId } : {}),
      ...saved,
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

// ─── Exam pattern and syllabus ────────────────────────────
//
// Both are whole-block provenance fields, like eligibility. The value is
// cleaned and bounded here so a bad paste or a bad AI answer cannot store junk.

const tidy = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= max ? t : undefined;
};

const wholeNumber = (v: unknown, max: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max ? v : undefined;

/** A marks figure: positive, at most `max`, whole or with a simple decimal part. */
const marksNumber = (v: unknown, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : undefined;

export function cleanExamPattern(value: unknown): ExamPatternPaper[] {
  if (!Array.isArray(value)) throw new Error("examPattern invariant: value must be an array of papers");
  if (value.length > 8) throw new Error("examPattern invariant: at most 8 papers");
  return value.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = tidy(p.name, 80);
    if (!name) throw new Error(`examPattern invariant: paper ${i + 1} needs a name`);
    if (p.sections !== undefined && !Array.isArray(p.sections)) {
      throw new Error(`examPattern invariant: paper ${i + 1} sections must be a list`);
    }
    const rawSections = (p.sections as unknown[] | undefined) ?? [];
    if (rawSections.length > 15) throw new Error(`examPattern invariant: paper ${i + 1} has more than 15 subjects`);
    const sections: ExamPatternSection[] = rawSections.map((rs, j) => {
      const s = (rs ?? {}) as Record<string, unknown>;
      const subject = tidy(s.subject, 100);
      if (!subject) throw new Error(`examPattern invariant: paper ${i + 1}, subject ${j + 1} needs a name`);
      const questions = wholeNumber(s.questions, 1000);
      const marks = marksNumber(s.marks, 2000);
      return { subject, ...(questions ? { questions } : {}), ...(marks ? { marks } : {}) };
    });
    const mode = tidy(p.mode, 80);
    const durationMinutes = wholeNumber(p.durationMinutes, 600);
    const negativeMarking = tidy(p.negativeMarking, 160);
    const totalQuestions = wholeNumber(p.totalQuestions, 2000);
    const totalMarks = marksNumber(p.totalMarks, 5000);
    const note = tidy(p.note, 200);
    return {
      name,
      ...(mode ? { mode } : {}),
      ...(durationMinutes ? { durationMinutes } : {}),
      ...(negativeMarking ? { negativeMarking } : {}),
      sections,
      ...(totalQuestions ? { totalQuestions } : {}),
      ...(totalMarks ? { totalMarks } : {}),
      ...(note ? { note } : {}),
    };
  });
}

export function cleanSyllabus(value: unknown): SyllabusSubject[] {
  if (!Array.isArray(value)) throw new Error("syllabus invariant: value must be an array of subjects");
  if (value.length > 40) throw new Error("syllabus invariant: at most 40 subjects");
  return value.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const subject = tidy(s.subject, 100);
    if (!subject) throw new Error(`syllabus invariant: subject ${i + 1} needs a name`);
    if (!Array.isArray(s.topics)) throw new Error(`syllabus invariant: subject ${i + 1} topics must be a list`);
    if (s.topics.length > 80) throw new Error(`syllabus invariant: subject ${i + 1} has more than 80 topics`);
    const topics = s.topics.map((t) => tidy(t, 160)).filter((t): t is string => t !== undefined);
    if (topics.length === 0) throw new Error(`syllabus invariant: subject ${i + 1} needs at least one topic`);
    const paper = tidy(s.paper, 80);
    return { ...(paper ? { paper } : {}), subject, topics: Array.from(new Set(topics)) };
  });
}

function updateBlock<K extends "examPattern" | "syllabus">(
  record: RecruitmentRecord,
  fieldPath: K,
  newField: ProvenanceField<unknown>,
  clean: (value: unknown) => NonNullable<RecruitmentRecord[K]>["value"],
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  // A null value clears the block (used for "not specified").
  const field = (newField.value === null
    ? newField
    : { ...newField, value: clean(newField.value) }) as NonNullable<RecruitmentRecord[K]>;

  const errors = validateProvenanceField(field as ProvenanceField<unknown>, fieldPath);
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("; "));

  const updated = cloneRecord(record);
  (updated as Record<K, unknown>)[fieldPath] = field;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  return { record: updated, revision: buildFieldRevision(record.id, fieldPath, record[fieldPath], field, adminId, reason) };
}

export function updateExamPattern(record: RecruitmentRecord, newField: ProvenanceField<unknown>, adminId: string, reason?: string): FieldUpdateResult {
  return updateBlock(record, "examPattern", newField, cleanExamPattern, adminId, reason);
}

export function updateSyllabus(record: RecruitmentRecord, newField: ProvenanceField<unknown>, adminId: string, reason?: string): FieldUpdateResult {
  return updateBlock(record, "syllabus", newField, cleanSyllabus, adminId, reason);
}

// ─── Exam stages ──────────────────────────────────────────
//
// The ordered stages of a recruitment after the application window: Tier-I,
// Tier-II, document verification and so on. One list feeds the public dates
// table, the timeline, "What's next" and (later) the exam calendar.
//
// Nothing is inferred: a stage with no date is stored with no date.

export const EXAM_STAGE_STATUSES = [
  "NOT_DECLARED", "SCHEDULED", "ADMIT_CARD_OUT", "POSTPONED", "CONDUCTED", "RESULT_DECLARED",
] as const;
export const EXAM_STAGE_CERTAINTIES = ["CONFIRMED", "TENTATIVE", "POSTPONED", "TBA"] as const;
const MAX_EXAM_STAGES = 12;

const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export function updateExamStages(
  record: RecruitmentRecord,
  stages: unknown,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  if (!Array.isArray(stages)) throw new Error("examStages invariant: value must be an array");
  if (stages.length > MAX_EXAM_STAGES) throw new Error(`examStages invariant: at most ${MAX_EXAM_STAGES} stages`);

  const text = (v: unknown, max: number, what: string, i: number): string | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string") throw new Error(`examStages invariant: stage ${i + 1} ${what} must be text`);
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length > max) throw new Error(`examStages invariant: stage ${i + 1} ${what} is at most ${max} characters`);
    return t || undefined;
  };

  const cleaned: ExamStage[] = stages.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const name = text(s.name, 80, "name", i);
    if (!name) throw new Error(`examStages invariant: stage ${i + 1} needs a name`);
    if (typeof s.status !== "string" || !(EXAM_STAGE_STATUSES as readonly string[]).includes(s.status)) {
      throw new Error(`examStages invariant: stage ${i + 1} has an unknown status`);
    }
    if (s.dateIso !== undefined && s.dateIso !== null && s.dateIso !== "" && !isIsoDate(s.dateIso)) {
      throw new Error(`examStages invariant: stage ${i + 1} date must be a real date (YYYY-MM-DD)`);
    }
    const dateIso = isIsoDate(s.dateIso) ? s.dateIso : undefined;
    const dateDisplay = text(s.dateDisplay, 60, "date text", i);
    const hasDate = Boolean(dateIso || dateDisplay);

    let certainty: ExamStage["certainty"];
    if (s.certainty !== undefined && s.certainty !== null && s.certainty !== "") {
      if (typeof s.certainty !== "string" || !(EXAM_STAGE_CERTAINTIES as readonly string[]).includes(s.certainty)) {
        throw new Error(`examStages invariant: stage ${i + 1} has an unknown date certainty`);
      }
      certainty = s.certainty as ExamStage["certainty"];
    }
    // A date must say whether it is confirmed; a stage with no date cannot claim one.
    if (hasDate && (!certainty || certainty === "TBA")) {
      throw new Error(`examStages invariant: stage ${i + 1} has a date, so say whether it is confirmed or tentative`);
    }
    if (!hasDate && (certainty === "CONFIRMED" || certainty === "TENTATIVE")) {
      throw new Error(`examStages invariant: stage ${i + 1} is marked ${certainty.toLowerCase()} but has no date`);
    }
    if (s.status === "SCHEDULED" && !hasDate) {
      throw new Error(`examStages invariant: stage ${i + 1} is scheduled, so it needs a date`);
    }

    const noticeUrl = text(s.noticeUrl, 500, "notice link", i);
    if (noticeUrl && !isHttpUrl(noticeUrl)) {
      throw new Error(`examStages invariant: stage ${i + 1} notice link must be a valid http(s) URL`);
    }

    return {
      name,
      order: i + 1,
      status: s.status as ExamStage["status"],
      ...(certainty ? { certainty } : hasDate ? {} : { certainty: "TBA" as const }),
      ...(dateDisplay ? { dateDisplay } : {}),
      ...(dateIso ? { dateIso } : {}),
      ...(text(s.dateProvenance, 120, "date source", i) ? { dateProvenance: text(s.dateProvenance, 120, "date source", i) } : {}),
      ...(noticeUrl ? { noticeUrl } : {}),
      ...(text(s.notes, 200, "note", i) ? { notes: text(s.notes, 200, "note", i) } : {}),
    };
  });

  const updated = cloneRecord(record);
  updated.examStages = cleaned;
  updated.updatedAt = now();
  updated.updatedBy = adminId;

  return {
    record: updated,
    revision: buildFieldRevision(record.id, "examStages", record.examStages ?? [], cleaned, adminId, reason),
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
