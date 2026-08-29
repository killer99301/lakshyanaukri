#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Career Campus — Trust Gate Validation Script
// ═══════════════════════════════════════════════════════════
// Run: npm run validate
//
// Validates:
//   1. ALL recruitment records (including NOT_VERIFIED, for audit)
//   2. Homepage satellite data (UPCOMING_EXAMS, HOMEPAGE_RESULTS,
//      HOMEPAGE_ADMIT_CARDS, HOMEPAGE_ANSWER_KEYS) for structural
//      integrity and slug consistency with the canonical repository.
//
// Exit codes:
//   0 = all records pass (or warnings only)
//   1 = one or more ERROR-severity violations found
//
// Build integration: runs before `next build` so the
// production build always contains clean data.
// ═══════════════════════════════════════════════════════════

import { getAllOpportunities, getAllSlugs } from "@/lib/repository";
import { validateAllRecords, printValidationResults } from "@/lib/validation";
import {
  UPCOMING_EXAMS,
  HOMEPAGE_RESULTS,
  HOMEPAGE_ADMIT_CARDS,
  HOMEPAGE_ANSWER_KEYS,
} from "@/data/homepage";

// ─── Satellite Data Validation ───────────────────────────────────────────────

interface SatelliteError {
  severity: "ERROR" | "WARN";
  recordId: string;
  field: string;
  message: string;
}

function validateUpcomingExams(canonicalSlugs: string[]): SatelliteError[] {
  const errors: SatelliteError[] = [];

  for (const exam of UPCOMING_EXAMS) {
    // Slug must match a canonical record OR be empty (for postponed/unscheduled)
    if (exam.slug && !canonicalSlugs.includes(exam.slug)) {
      errors.push({
        severity: "ERROR",
        recordId: exam.id,
        field: "slug",
        message: `UPCOMING_EXAMS slug "${exam.slug}" does not match any canonical opportunity slug. Broken link.`,
      });
    }

    // statusText must be present (check first so it's narrowed below)
    if (!exam.statusText) {
      errors.push({
        severity: "ERROR",
        recordId: exam.id,
        field: "statusText",
        message: `UPCOMING_EXAMS "${exam.id}" is missing statusText.`,
      });
    }

    // examDateIso must not be a past date unless status explicitly says conducted
    if (exam.examDateIso && exam.statusText) {
      const examDate = new Date(exam.examDateIso);
      const now = new Date();
      const st = exam.statusText.toLowerCase();
      if (
        examDate < now &&
        !st.includes("progress") &&
        !st.includes("conducted") &&
        !st.includes("declared") &&
        !st.includes("result")
      ) {
        errors.push({
          severity: "WARN",
          recordId: exam.id,
          field: "examDateIso",
          message: `UPCOMING_EXAMS "${exam.id}" has a past examDateIso (${exam.examDateIso}) but statusText does not indicate it was conducted. Review this record.`,
        });
      }
    }
  }

  return errors;
}

function validateHomepageResultItems(): SatelliteError[] {
  const errors: SatelliteError[] = [];

  for (const result of HOMEPAGE_RESULTS) {
    if (!result.officialUrl || !result.officialUrl.startsWith("http")) {
      errors.push({
        severity: "ERROR",
        recordId: result.id,
        field: "officialUrl",
        message: `HOMEPAGE_RESULTS "${result.id}" is missing a valid officialUrl.`,
      });
    }
    if (!result.resultDateIso) {
      errors.push({
        severity: "WARN",
        recordId: result.id,
        field: "resultDateIso",
        message: `HOMEPAGE_RESULTS "${result.id}" is missing resultDateIso.`,
      });
    }
    if (result.documentUrl && !result.documentUrl.startsWith("http")) {
      errors.push({
        severity: "WARN",
        recordId: result.id,
        field: "documentUrl",
        message: `HOMEPAGE_RESULTS "${result.id}" documentUrl does not appear to be a valid URL.`,
      });
    }
  }

  return errors;
}

function validateHomepageAdmitCards(): SatelliteError[] {
  const errors: SatelliteError[] = [];

  for (const card of HOMEPAGE_ADMIT_CARDS) {
    if (!card.officialUrl || !card.officialUrl.startsWith("http")) {
      errors.push({
        severity: "ERROR",
        recordId: card.id,
        field: "officialUrl",
        message: `HOMEPAGE_ADMIT_CARDS "${card.id}" is missing a valid officialUrl.`,
      });
    }
    if (!card.releaseDateIso) {
      errors.push({
        severity: "WARN",
        recordId: card.id,
        field: "releaseDateIso",
        message: `HOMEPAGE_ADMIT_CARDS "${card.id}" is missing releaseDateIso.`,
      });
    }
  }

  return errors;
}

function validateHomepageAnswerKeys(): SatelliteError[] {
  const errors: SatelliteError[] = [];

  for (const key of HOMEPAGE_ANSWER_KEYS) {
    if (!key.officialUrl || !key.officialUrl.startsWith("http")) {
      errors.push({
        severity: "ERROR",
        recordId: key.id,
        field: "officialUrl",
        message: `HOMEPAGE_ANSWER_KEYS "${key.id}" is missing a valid officialUrl.`,
      });
    }
    if (!key.releaseDateIso) {
      errors.push({
        severity: "WARN",
        recordId: key.id,
        field: "releaseDateIso",
        message: `HOMEPAGE_ANSWER_KEYS "${key.id}" is missing releaseDateIso.`,
      });
    }
  }

  return errors;
}

function printSatelliteResults(errors: SatelliteError[]): boolean {
  let hasErrors = false;

  for (const e of errors) {
    const prefix = e.severity === "ERROR" ? "  ❌ ERROR" : "  ⚠️  WARN";
    console.log(`${prefix} [${e.recordId}] ${e.field}: ${e.message}`);
    if (e.severity === "ERROR") hasErrors = true;
  }

  return !hasErrors;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🔒 Career Campus Trust Gate\n");

  // 1. Validate canonical opportunity records
  const opportunities = getAllOpportunities();
  const canonicalSlugs = getAllSlugs(); // verified slugs only
  console.log(`   Validating ${opportunities.length} canonical records...\n`);

  const opportunityErrors = validateAllRecords(opportunities);

  // Enforce explicit certainty on all canonical exam stages
  for (const opp of opportunities) {
    if (opp.type === "government" && opp.examStages) {
      for (const stage of opp.examStages) {
        if (!stage.certainty) {
          opportunityErrors.push({
            recordId: opp.id,
            field: `examStages[${stage.order}].certainty`,
            message: `Canonical stage "${stage.name}" is missing explicit certainty ("CONFIRMED" | "TENTATIVE" | "POSTPONED" | "TBA").`,
            severity: "error",
          });
        }
      }
    }
  }

  const opportunitiesPassed = printValidationResults(opportunityErrors);

  // 2. Validate homepage satellite data
  console.log("\n─── Homepage Satellite Data Validation ───\n");

  const upcomingErrors = validateUpcomingExams(canonicalSlugs);
  const resultErrors = validateHomepageResultItems();
  const admitCardErrors = validateHomepageAdmitCards();
  const answerKeyErrors = validateHomepageAnswerKeys();

  const allSatelliteErrors = [
    ...upcomingErrors,
    ...resultErrors,
    ...admitCardErrors,
    ...answerKeyErrors,
  ];

  console.log(`   UPCOMING_EXAMS: ${UPCOMING_EXAMS.length} records`);
  console.log(`   HOMEPAGE_RESULTS: ${HOMEPAGE_RESULTS.length} records`);
  console.log(`   HOMEPAGE_ADMIT_CARDS: ${HOMEPAGE_ADMIT_CARDS.length} records`);
  console.log(`   HOMEPAGE_ANSWER_KEYS: ${HOMEPAGE_ANSWER_KEYS.length} records\n`);

  const satellitePassed = allSatelliteErrors.length === 0
    ? true
    : printSatelliteResults(allSatelliteErrors);

  if (allSatelliteErrors.length === 0) {
    console.log("   ✅ All satellite data passed validation.");
  }

  // 3. Report
  const allPassed = opportunitiesPassed && satellitePassed;

  if (!allPassed) {
    console.log("\n🚫 Build blocked. Fix all errors before deploying.\n");
    process.exit(1);
  }

  console.log("\n✅ All records passed. Build may proceed.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Trust Gate script crashed:", err);
  process.exit(1);
});
