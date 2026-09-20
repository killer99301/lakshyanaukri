// ═══════════════════════════════════════════════════════════
// CMS Field Update Router — Pure dispatcher
// ═══════════════════════════════════════════════════════════
//
// Maps a fieldPath from the API body to the correct typed
// update function in record-ops.ts.
//
// This is the single chokepoint that enforces:
//   CMS form → typed writer → validation → FieldRevision → DB
//
// Every update goes through here. No direct field assignments.
// ═══════════════════════════════════════════════════════════

import type {
  RecruitmentRecord,
  ProvenanceField,
  RecruitmentIdentity,
  RecruitmentDates,
  FinancialInformation,
  CmsRecruitmentPost,
  AgeCriteria,
  CmsSelectionInformation,
} from "@/types/recruitment-record";

import type { VacancyRow } from "@/types";

import {
  updateIdentityField,
  updateDateField,
  updateVacancyTotal,
  updateVacancyBreakdown,
  updateEligibility,
  updateAge,
  updateSelection,
  updateFinancialField,
  type FieldUpdateResult,
} from "@/lib/cms/record-ops";

// ─── Known block paths ────────────────────────────────────

const BLOCK_PATHS = new Set([
  "eligibility",
  "age",
  "selection",
  "vacancies.breakdown",
  "vacancies.total",
]);

export function isBlockPath(fieldPath: string): boolean {
  return BLOCK_PATHS.has(fieldPath);
}

// ─── Router ───────────────────────────────────────────────

/**
 * Dispatch a field update to the correct typed record-ops function.
 *
 * @param record     The current record
 * @param fieldPath  Dot-notation path from the API request body
 * @param newField   The full ProvenanceField<T> (cast to unknown at the boundary)
 * @param adminId    UUID of the acting admin
 * @param reason     Optional human note for the FieldRevision
 */
export function routeFieldUpdate(
  record: RecruitmentRecord,
  fieldPath: string,
  newField: ProvenanceField<unknown>,
  adminId: string,
  reason?: string,
): FieldUpdateResult {
  // ── ProvenanceField blocks ──
  if (fieldPath === "eligibility") {
    return updateEligibility(
      record,
      newField as ProvenanceField<CmsRecruitmentPost[]>,
      adminId,
      reason,
    );
  }

  if (fieldPath === "age") {
    return updateAge(
      record,
      newField as ProvenanceField<AgeCriteria>,
      adminId,
      reason,
    );
  }

  if (fieldPath === "selection") {
    return updateSelection(
      record,
      newField as ProvenanceField<CmsSelectionInformation>,
      adminId,
      reason,
    );
  }

  if (fieldPath === "vacancies.breakdown") {
    return updateVacancyBreakdown(
      record,
      newField as ProvenanceField<VacancyRow[]>,
      adminId,
      reason,
    );
  }

  // ── vacancies.total (individual, not a ProvenanceField block) ──
  if (fieldPath === "vacancies.total") {
    return updateVacancyTotal(
      record,
      newField as ProvenanceField<number | null>,
      adminId,
      reason,
    );
  }

  // ── Namespace blocks ──
  if (fieldPath.startsWith("identity.")) {
    const key = fieldPath.slice("identity.".length) as keyof RecruitmentIdentity;
    const allowed: Array<keyof RecruitmentIdentity> = [
      "title",
      "shortTitle",
      "notificationNumber",
      "advertisementNumber",
    ];
    if (!allowed.includes(key)) {
      throw new Error(
        `identity.${key} is not an editable ProvenanceField — use the create endpoint for organizationId, govType, etc.`,
      );
    }
    return updateIdentityField(record, key, newField, adminId, reason);
  }

  if (fieldPath.startsWith("dates.")) {
    const key = fieldPath.slice("dates.".length) as keyof RecruitmentDates;
    return updateDateField(
      record,
      key,
      newField as ProvenanceField<string | null>,
      adminId,
      reason,
    );
  }

  if (fieldPath.startsWith("financial.")) {
    const key = fieldPath.slice("financial.".length) as keyof FinancialInformation;
    const allowed: Array<keyof FinancialInformation> = [
      "feeGeneral",
      "feeSCST",
      "payScale",
    ];
    if (!allowed.includes(key)) {
      throw new Error(
        `financial.${key} is not an editable ProvenanceField — paymentModes is a plain string[]`,
      );
    }
    return updateFinancialField(
      record,
      key,
      newField as ProvenanceField<number | null> | ProvenanceField<string>,
      adminId,
      reason,
    );
  }

  throw new Error(
    `Unknown or unroutable fieldPath: "${fieldPath}". ` +
      `Known blocks: eligibility, age, selection, vacancies.breakdown, vacancies.total. ` +
      `Namespace prefixes: identity., dates., financial.`,
  );
}
