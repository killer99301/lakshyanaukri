// ═══════════════════════════════════════════════════════════
// CMS Validation — ProvenanceField<T> invariant checks
// ═══════════════════════════════════════════════════════════
//
// Pure functions only — no I/O, no DB, no side effects.
//
// INVARIANTS:
//   I1: status === "NOT_SPECIFIED" ↔ value === null
//   I2: status !== "NOT_SPECIFIED" → value !== null
//   I3: conflict === true ↔ status === "CONFLICTED"
// ═══════════════════════════════════════════════════════════

import type {
  ProvenanceField,
  FieldStatus,
  RecruitmentRecord,
  ValidationResult,
  ValidationError,
  RecruitmentIdentity,
  RecruitmentDates,
  VacancyInformation,
  FinancialInformation,
} from "@/types/recruitment-record";

// ─── Single-field validation ──────────────────────────────

export interface FieldValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate all invariants for a single ProvenanceField<T>.
 *
 * @param field  The field to validate
 * @param path   Dot-notation path for error messages (e.g. "dates.applicationCloseDate")
 */
export function validateProvenanceField<T>(
  field: ProvenanceField<T>,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // I1a: NOT_SPECIFIED → value must be null
  if (field.status === "NOT_SPECIFIED" && field.value !== null) {
    errors.push({
      fieldPath: path,
      invariant: "I1",
      message: `${path}: status is NOT_SPECIFIED but value is not null (got ${JSON.stringify(field.value)})`,
    });
  }

  // I1b: value is null → status must be NOT_SPECIFIED
  if (field.value === null && field.status !== "NOT_SPECIFIED") {
    errors.push({
      fieldPath: path,
      invariant: "I1",
      message: `${path}: value is null but status is ${field.status} (must be NOT_SPECIFIED)`,
    });
  }

  // I2: non-NOT_SPECIFIED → value must not be null (already covered by I1b above,
  // but kept explicit for clarity)

  // I3a: CONFLICTED status → conflict flag must be true
  if (field.status === "CONFLICTED" && !field.conflict) {
    errors.push({
      fieldPath: path,
      invariant: "I3",
      message: `${path}: status is CONFLICTED but conflict flag is false`,
    });
  }

  // I3b: conflict flag is true → status must be CONFLICTED
  if (field.conflict && field.status !== "CONFLICTED") {
    errors.push({
      fieldPath: path,
      invariant: "I3",
      message: `${path}: conflict flag is true but status is ${field.status} (must be CONFLICTED)`,
    });
  }

  return errors;
}

/**
 * Build a valid ProvenanceField with all invariants satisfied.
 * Use this helper instead of constructing the literal inline.
 */
export function makeProvenanceField<T>(params: {
  value: T | null;
  status: FieldStatus;
  evidenceIds?: string[];
  machineValue?: T;
  manuallyEdited?: boolean;
}): ProvenanceField<T> {
  const { value, status, evidenceIds = [], machineValue, manuallyEdited = false } = params;

  const conflict = status === "CONFLICTED";
  const field: ProvenanceField<T> = {
    value,
    status,
    evidenceIds,
    conflict,
    manuallyEdited,
  };
  if (machineValue !== undefined) {
    field.machineValue = machineValue;
  }

  const errors = validateProvenanceField(field, "makeProvenanceField");
  if (errors.length > 0) {
    throw new Error(
      `Invalid ProvenanceField: ${errors.map((e) => e.message).join("; ")}`,
    );
  }

  return field;
}

/**
 * Create a NOT_SPECIFIED ProvenanceField.
 * Invariant: value must be null; status is NOT_SPECIFIED.
 */
export function makeNotSpecified<T>(): ProvenanceField<T> {
  return {
    value: null,
    status: "NOT_SPECIFIED",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
}

/**
 * Create a PENDING ProvenanceField for admin-attested values.
 * MANUAL means admin-attested, not automatically VERIFIED.
 */
export function makePendingField<T>(value: T): ProvenanceField<T> {
  if (value === null || value === undefined) {
    throw new Error("PENDING field must have a non-null value. Use makeNotSpecified() instead.");
  }
  return {
    value,
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
}

/**
 * Create a VERIFIED ProvenanceField backed by evidence.
 * Requires at least one evidenceId — VERIFIED without a source is invalid.
 */
export function makeVerifiedField<T>(value: T, evidenceIds: string[]): ProvenanceField<T> {
  if (value === null || value === undefined) {
    throw new Error("VERIFIED field must have a non-null value.");
  }
  if (evidenceIds.length === 0) {
    throw new Error("VERIFIED field requires at least one evidenceId. Use makePendingField() for admin-only attestation.");
  }
  return {
    value,
    status: "VERIFIED",
    evidenceIds,
    conflict: false,
    manuallyEdited: false,
  };
}

/**
 * Apply a manual admin edit to a ProvenanceField.
 *
 * Rules:
 * - If the field had a machine-extracted value and this is the first edit,
 *   preserve the original in machineValue (never overwrite machineValue).
 * - New status is PENDING (admin-attested) unless evidenceIds are supplied.
 * - If evidenceIds supplied, status becomes VERIFIED.
 * - Setting value=null produces a NOT_SPECIFIED field.
 */
export function applyAdminEdit<T>(
  current: ProvenanceField<T>,
  newValue: T | null,
  evidenceIds?: string[],
): ProvenanceField<T> {
  const isNotSpecified = newValue === null;

  let newStatus: FieldStatus;
  if (isNotSpecified) {
    newStatus = "NOT_SPECIFIED";
  } else if (evidenceIds && evidenceIds.length > 0) {
    newStatus = "VERIFIED";
  } else {
    newStatus = "PENDING";
  }

  // Preserve machineValue on first edit — never overwrite it afterward
  const machineValue =
    current.machineValue !== undefined
      ? current.machineValue
      : current.manuallyEdited === false && current.value !== undefined
        ? (current.value as T)
        : undefined;

  const updated: ProvenanceField<T> = {
    value: newValue,
    status: newStatus,
    evidenceIds: isNotSpecified ? [] : (evidenceIds ?? current.evidenceIds),
    conflict: false,
    manuallyEdited: true,
  };

  if (machineValue !== undefined) {
    updated.machineValue = machineValue;
  }

  return updated;
}

// ─── Record-level validation ──────────────────────────────

/**
 * Validate all ProvenanceField<T> values in a RecruitmentRecord.
 * Returns a list of errors — empty means valid.
 */
export function validateRecord(record: RecruitmentRecord): ValidationResult {
  const errors: ValidationError[] = [];

  // --- Identity ---
  errors.push(...validateIdentityBlock(record.identity));

  // --- Dates ---
  errors.push(...validateDatesBlock(record.dates));

  // --- Vacancies ---
  errors.push(...validateVacanciesBlock(record.vacancies));

  // --- Financial ---
  errors.push(...validateFinancialBlock(record.financial));

  // --- ProvenanceField blocks ---
  if (record.eligibility) {
    errors.push(...validateProvenanceField(record.eligibility, "eligibility"));
  }
  if (record.age) {
    errors.push(...validateProvenanceField(record.age, "age"));
  }
  if (record.selection) {
    errors.push(...validateProvenanceField(record.selection, "selection"));
  }

  // --- Required fields (SAVE boundary) ---
  if (!record.identity.organizationId) {
    errors.push({
      fieldPath: "identity.organizationId",
      invariant: "REQUIRED",
      message: "identity.organizationId is required",
    });
  }

  const titleErrors = validateProvenanceField(record.identity.title, "identity.title");
  errors.push(...titleErrors);
  if (record.identity.title.status === "NOT_SPECIFIED") {
    errors.push({
      fieldPath: "identity.title",
      invariant: "CONSTRAINT",
      message: "identity.title cannot be NOT_SPECIFIED — title is always required",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Block validators ─────────────────────────────────────

function validateIdentityBlock(identity: RecruitmentIdentity): ValidationError[] {
  const errors: ValidationError[] = [];
  errors.push(...validateProvenanceField(identity.title, "identity.title"));
  if (identity.shortTitle) {
    errors.push(...validateProvenanceField(identity.shortTitle, "identity.shortTitle"));
  }
  if (identity.notificationNumber) {
    errors.push(...validateProvenanceField(identity.notificationNumber, "identity.notificationNumber"));
  }
  if (identity.advertisementNumber) {
    errors.push(...validateProvenanceField(identity.advertisementNumber, "identity.advertisementNumber"));
  }
  return errors;
}

function validateDatesBlock(dates: RecruitmentDates): ValidationError[] {
  const errors: ValidationError[] = [];
  const dateFields: Array<keyof RecruitmentDates> = [
    "notificationDate",
    "applicationOpenDate",
    "applicationCloseDate",
    "feePaymentCloseDate",
    "correctionWindowEnd",
    "examDate",
    "prelimsDate",
    "mainsDate",
    "admitCardDate",
    "resultDate",
    "interviewDate",
    "documentVerificationDate",
    "joiningDate",
  ];
  for (const key of dateFields) {
    const f = dates[key];
    if (f) {
      errors.push(...validateProvenanceField(f, `dates.${key}`));
    }
  }
  return errors;
}

function validateVacanciesBlock(vacancies: VacancyInformation): ValidationError[] {
  const errors: ValidationError[] = [];
  if (vacancies.total) {
    errors.push(...validateProvenanceField(vacancies.total, "vacancies.total"));
  }
  if (vacancies.breakdown) {
    errors.push(...validateProvenanceField(vacancies.breakdown, "vacancies.breakdown"));
  }
  return errors;
}

function validateFinancialBlock(financial: FinancialInformation): ValidationError[] {
  const errors: ValidationError[] = [];
  if (financial.feeGeneral) {
    errors.push(...validateProvenanceField(financial.feeGeneral, "financial.feeGeneral"));
  }
  if (financial.feeSCST) {
    errors.push(...validateProvenanceField(financial.feeSCST, "financial.feeSCST"));
  }
  if (financial.payScale) {
    errors.push(...validateProvenanceField(financial.payScale, "financial.payScale"));
  }
  return errors;
}
