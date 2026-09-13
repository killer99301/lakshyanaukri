// ═══════════════════════════════════════════════════════════
// Phase 10E: Draft Editor — Pure Edit Operations
// ═══════════════════════════════════════════════════════════
//
// All functions are pure: they return a new object and never
// mutate their arguments. This makes them safe to call from
// React state updaters and straightforward to test.
//
// INVARIANTS:
//   - Machine-extracted values are NEVER destroyed by an edit.
//     machineValue / machineDate is set once (on the first edit)
//     and preserved thereafter, even through resets.
//   - machineValue is only captured when the engine actually produced a
//     value. If the field was originally empty (undefined), machineValue
//     stays undefined; reset correctly clears to undefined — it must not
//     restore a manually-entered value as if the engine had extracted it.
//   - A reset restores value to machineValue and keeps machineValue in
//     place so the audit trail survives.
//   - isDeleted is a soft-delete flag; removed rows are never
//     physically discarded — they remain in the rows array.
//   - saveDraft stamps savedAt but writes to NO external store.
//
// editedBy CONTRACT:
//   All callers currently pass "admin" as a placeholder. This must be
//   replaced with the authenticated user's identity (userId + display name)
//   derived server-side from the session — never supplied by the client.
//   Implemented as part of the future durable-draft-persistence commit.
// ═══════════════════════════════════════════════════════════

import type {
  FieldValue,
  RecruitmentDate,
  DateCertainty,
  VacancyData,
  VacancyRow,
  IntelligenceConflict,
  ConflictResolution,
  RecruitmentIntelligenceDraft,
  CategoryBreakdown,
} from "./draft-types";

// ─── FieldValue<T> edit ───────────────────────────────────

export function applyFieldEdit<T>(
  fv: FieldValue<T>,
  newValue: T,
  editedBy: string,
  editReason?: string,
): FieldValue<T> {
  return {
    ...fv,
    machineValue: fv.machineValue !== undefined ? fv.machineValue : fv.value,
    value: newValue,
    manuallyEdited: true,
    editedBy,
    editedAt: new Date().toISOString(),
    editReason,
  };
}

export function resetFieldToMachine<T>(fv: FieldValue<T>): FieldValue<T> {
  // Use machineValue directly — if it is undefined, the machine never had a value
  // and reset correctly clears the field. Never fall back to fv.value here, as that
  // would "restore" a manually-entered value as if the machine had extracted it.
  return {
    ...fv,
    value: fv.machineValue,
    manuallyEdited: false,
    editedBy: undefined,
    editedAt: undefined,
    editReason: undefined,
    // machineValue intentionally kept — preserves audit trail that an edit occurred
  };
}

// ─── RecruitmentDate edit ─────────────────────────────────

export function applyDateEdit(
  rd: RecruitmentDate,
  newDate: string | undefined,
  newCertainty: DateCertainty,
  editedBy: string,
  editReason?: string,
): RecruitmentDate {
  return {
    ...rd,
    machineDate: rd.machineDate !== undefined ? rd.machineDate : rd.date,
    date: newDate,
    certainty: newCertainty,
    manuallyEdited: true,
    editedBy,
    editedAt: new Date().toISOString(),
    editReason,
  };
}

export function resetDateToMachine(rd: RecruitmentDate): RecruitmentDate {
  // Use machineDate directly — if undefined, the machine never had a date and
  // reset correctly clears it. Never fall back to rd.date (the current value).
  return {
    ...rd,
    date: rd.machineDate,
    manuallyEdited: false,
    editedBy: undefined,
    editedAt: undefined,
    editReason: undefined,
    // machineDate intentionally kept
  };
}

// ─── VacancyRow edit ──────────────────────────────────────

export function applyVacancyRowEdit(
  row: VacancyRow,
  updates: Partial<Pick<VacancyRow, "postName" | "postCode" | "grade" | "total" | "categoryBreakdown">>,
  editedBy: string,
): VacancyRow {
  return {
    ...row,
    ...updates,
    manuallyEdited: true,
    editedBy,
    editedAt: new Date().toISOString(),
  };
}

export function addVacancyRow(
  vacData: VacancyData,
  newRow: {
    id: string;
    postName: string;
    postCode?: string;
    grade?: string;
    total?: number;
    categoryBreakdown?: CategoryBreakdown;
  },
  editedBy: string,
): VacancyData {
  const row: VacancyRow = {
    ...newRow,
    sourceEvidence: [],
    manuallyEdited: true,
    isAdminAdded: true,
    editedBy,
    editedAt: new Date().toISOString(),
  };
  return recalculateDerivedTotal({ ...vacData, rows: [...vacData.rows, row] });
}

export function removeVacancyRow(vacData: VacancyData, rowId: string): VacancyData {
  const rows = vacData.rows.map((r) =>
    r.id === rowId ? { ...r, isDeleted: true } : r,
  );
  return recalculateDerivedTotal({ ...vacData, rows });
}

export function recalculateDerivedTotal(vacData: VacancyData): VacancyData {
  const activeRows = vacData.rows.filter((r) => !r.isDeleted);
  if (activeRows.length === 0) {
    return { ...vacData, derivedTotal: undefined, derivedTotalExplanation: undefined };
  }
  const sum = activeRows.reduce((acc, r) => acc + (r.total ?? 0), 0);
  const explanation = activeRows
    .map((r) => `${r.postName} ${r.total ?? 0}`)
    .join(" + ");
  return {
    ...vacData,
    derivedTotal: sum,
    derivedTotalExplanation: explanation,
  };
}

// ─── Conflict admin decision ──────────────────────────────

export function resolveConflict(
  conflict: IntelligenceConflict,
  selectedValue: unknown,
  selectedSourceId: string,
  decidedBy: string,
  reason: string,
): IntelligenceConflict {
  const adminDecision: ConflictResolution & { decidedAt: string; decidedBy: string } = {
    selectedValue,
    selectedSourceId,
    reason,
    decidedAt: new Date().toISOString(),
    decidedBy,
  };
  return { ...conflict, adminDecision };
}

// ─── Save Draft ───────────────────────────────────────────
//
// Stamps savedAt on the draft. Does NOT write to any canonical
// store — in-session only for Phase 10E.

export function saveDraft(
  draft: RecruitmentIntelligenceDraft,
): RecruitmentIntelligenceDraft {
  return { ...draft, savedAt: new Date().toISOString() };
}
