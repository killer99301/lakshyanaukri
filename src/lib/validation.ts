// ═══════════════════════════════════════════════════════════
// Career Campus — Build-Time Trust Gate
// ═══════════════════════════════════════════════════════════
// Validates all recruitment data at build time.
// The build FAILS if any critical integrity rule is violated.
//
// Non-negotiable rules enforced:
//   Rule 1: No fake verification
//   Rule 2: Never invent missing data (validated at field level)
//   Rule 4: RRB CENs must be separate
//   Rule 5: Trust gate catches all structural violations
// ═══════════════════════════════════════════════════════════

import type {
  Opportunity,
  GovernmentRecruitment,
} from "@/types";
import { getAllOrganizationIds } from "@/data/organizations";

export interface ValidationError {
  recordId: string;
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Run ALL validation rules against the entire opportunity dataset.
 * Returns an array of errors. If any error has severity "error", the build should fail.
 */
export function validateAllRecords(opportunities: Opportunity[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // Global checks
  errors.push(...validateNoDuplicateSlugs(opportunities));
  errors.push(...validateNoDuplicateCENs(opportunities));
  errors.push(...validateOrganizationReferences(opportunities));

  // Per-record checks
  for (const opp of opportunities) {
    errors.push(...validateBaseRecord(opp));

    if (opp.type === "government") {
      errors.push(...validateGovernmentRecord(opp));
    }
  }

  return errors;
}

/**
 * No two records may share the same slug.
 */
function validateNoDuplicateSlugs(opportunities: Opportunity[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Map<string, string>();

  for (const opp of opportunities) {
    if (seen.has(opp.slug)) {
      errors.push({
        recordId: opp.id,
        field: "slug",
        message: `Slug collision: "${opp.slug}" is already used by record "${seen.get(opp.slug)}".`,
        severity: "error",
      });
    }
    seen.set(opp.slug, opp.id);
  }

  return errors;
}

/**
 * No two GovernmentRecruitment records may share the same organizationId + notificationNumber.
 * This prevents merging of RRB CENs, BPSC Advt numbers, etc.
 */
function validateNoDuplicateCENs(opportunities: Opportunity[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Map<string, string>();

  const govRecords = opportunities.filter(
    (o): o is GovernmentRecruitment => o.type === "government"
  );

  for (const rec of govRecords) {
    const key = `${rec.organizationId}::${rec.notificationNumber}`;
    if (seen.has(key)) {
      errors.push({
        recordId: rec.id,
        field: "notificationNumber",
        message: `Duplicate CEN/notification: "${key}" is already used by record "${seen.get(key)}".`,
        severity: "error",
      });
    }
    seen.set(key, rec.id);
  }

  return errors;
}

/**
 * Every organizationId must reference a registered organization.
 */
function validateOrganizationReferences(opportunities: Opportunity[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const validOrgIds = new Set(getAllOrganizationIds());

  for (const opp of opportunities) {
    if (!validOrgIds.has(opp.organizationId)) {
      errors.push({
        recordId: opp.id,
        field: "organizationId",
        message: `Unknown organizationId: "${opp.organizationId}". Add it to ORGANIZATIONS in data/organizations.ts.`,
        severity: "error",
      });
    }
  }

  return errors;
}

/**
 * Base-level validation for every opportunity record.
 */
function validateBaseRecord(opp: Opportunity): ValidationError[] {
  const errors: ValidationError[] = [];

  // Provenance must exist and be honest
  if (!opp.provenance) {
    errors.push({
      recordId: opp.id,
      field: "provenance",
      message: "Missing provenance object.",
      severity: "error",
    });
  } else {
    // Rule 1: VERIFIED status requires an official source type and URL
    if (opp.provenance.status === "VERIFIED") {
      if (
        opp.provenance.primarySourceType === "NOT_VERIFIED" ||
        opp.provenance.primarySourceType === "SECONDARY_SOURCE"
      ) {
        errors.push({
          recordId: opp.id,
          field: "provenance.primarySourceType",
          message: `Record marked VERIFIED but source type is "${opp.provenance.primarySourceType}". VERIFIED requires an official source type.`,
          severity: "error",
        });
      }

      if (!opp.provenance.primarySourceUrl) {
        errors.push({
          recordId: opp.id,
          field: "provenance.primarySourceUrl",
          message: "Record marked VERIFIED but no primarySourceUrl provided.",
          severity: "error",
        });
      }
    }

    if (!opp.provenance.lastVerifiedAt) {
      errors.push({
        recordId: opp.id,
        field: "provenance.lastVerifiedAt",
        message: "Missing lastVerifiedAt date.",
        severity: "error",
      });
    }
  }

  // Slug format: must be lowercase, hyphenated, no spaces
  if (opp.slug !== opp.slug.toLowerCase() || /\s/.test(opp.slug)) {
    errors.push({
      recordId: opp.id,
      field: "slug",
      message: `Slug "${opp.slug}" must be lowercase with no spaces.`,
      severity: "error",
    });
  }

  return errors;
}

/**
 * Government-specific validation rules.
 */
function validateGovernmentRecord(rec: GovernmentRecruitment): ValidationError[] {
  const errors: ValidationError[] = [];

  // Must have a notification number
  if (!rec.notificationNumber || rec.notificationNumber.trim() === "") {
    errors.push({
      recordId: rec.id,
      field: "notificationNumber",
      message: "Government recruitment must have a notificationNumber (CEN/Advt/Notice No.).",
      severity: "error",
    });
  }

  // Government record must have a primary source URL
  if (!rec.provenance.primarySourceUrl) {
    errors.push({
      recordId: rec.id,
      field: "provenance.primarySourceUrl",
      message: "Government recruitment must have a primary source URL for provenance.",
      severity: "error",
    });
  }

  // Application date sanity
  const appOpen = new Date(rec.application.openDate);
  const appClose = new Date(rec.application.closeDate);

  if (appClose < appOpen) {
    errors.push({
      recordId: rec.id,
      field: "application.closeDate",
      message: `Application closeDate (${rec.application.closeDate}) is before openDate (${rec.application.openDate}).`,
      severity: "error",
    });
  }

  // Extended deadline sanity
  if (rec.application.extendedCloseDate) {
    const extClose = new Date(rec.application.extendedCloseDate);
    if (extClose < appClose) {
      errors.push({
        recordId: rec.id,
        field: "application.extendedCloseDate",
        message: `extendedCloseDate (${rec.application.extendedCloseDate}) is earlier than original closeDate (${rec.application.closeDate}).`,
        severity: "error",
      });
    }
  }

  // Exam stage order uniqueness
  if (rec.examStages.length > 0) {
    const orders = rec.examStages.map((s) => s.order);
    const uniqueOrders = new Set(orders);
    if (uniqueOrders.size !== orders.length) {
      errors.push({
        recordId: rec.id,
        field: "examStages",
        message: "Exam stage order numbers are not unique.",
        severity: "error",
      });
    }

    // Exam stage validation: dates and explicit certainty
    const validCertainties = ["CONFIRMED", "TENTATIVE", "POSTPONED", "TBA"];
    for (const stage of rec.examStages) {
      if (stage.status === "CONDUCTED" && !stage.dateIso && !stage.dateDisplay) {
        errors.push({
          recordId: rec.id,
          field: `examStages[${stage.order}]`,
          message: `Stage "${stage.name}" is marked CONDUCTED but has no dateIso or dateDisplay.`,
          severity: "error",
        });
      }

      if (stage.certainty && !validCertainties.includes(stage.certainty)) {
        errors.push({
          recordId: rec.id,
          field: `examStages[${stage.order}].certainty`,
          message: `Stage "${stage.name}" has invalid certainty "${stage.certainty}". Must be one of: ${validCertainties.join(", ")}.`,
          severity: "error",
        });
      }
    }
  }

  // Vacancy breakdown consistency
  if (rec.vacancyBreakdown && rec.vacancyBreakdown.length > 0) {
    const breakdownTotal = rec.vacancyBreakdown.reduce((sum, row) => sum + row.count, 0);
    if (breakdownTotal !== rec.totalVacancies) {
      errors.push({
        recordId: rec.id,
        field: "vacancyBreakdown",
        message: `Vacancy breakdown total (${breakdownTotal}) does not match totalVacancies (${rec.totalVacancies}).`,
        severity: "warning",    // warning not error — breakdown may be partial
      });
    }
  }

  // Links: apply URL is required
  if (!rec.links.apply) {
    errors.push({
      recordId: rec.id,
      field: "links.apply",
      message: "Government recruitment must have an apply URL.",
      severity: "error",
    });
  }

  return errors;
}

/**
 * Pretty-print validation results to console.
 * Returns true if all checks passed, false if any errors exist.
 */
export function printValidationResults(errors: ValidationError[]): boolean {
  const errorCount = errors.filter((e) => e.severity === "error").length;
  const warningCount = errors.filter((e) => e.severity === "warning").length;

  if (errors.length === 0) {
    console.log("✅ Trust Gate: All records passed validation.");
    return true;
  }

  console.log(`\n🔒 TRUST GATE RESULTS`);
  console.log(`   ${errorCount} error(s), ${warningCount} warning(s)\n`);

  for (const err of errors) {
    const icon = err.severity === "error" ? "❌" : "⚠️";
    console.log(`${icon} [${err.recordId}] ${err.field}: ${err.message}`);
  }

  if (errorCount > 0) {
    console.log(`\n❌ Trust Gate FAILED: ${errorCount} error(s) must be fixed before deployment.`);
    return false;
  }

  console.log(`\n⚠️ Trust Gate passed with ${warningCount} warning(s).`);
  return true;
}
