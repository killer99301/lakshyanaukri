#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Career Campus — Trust Gate Validation Script
// ═══════════════════════════════════════════════════════════
// Run: npm run validate
//
// Validates:
//   1. ALL recruitment records (including NOT_VERIFIED, for audit)
//   2. Homepage satellite data (UPCOMING_EXAMS) for structural integrity
//      and slug consistency with the canonical repository. Results, admit
//      cards and answer keys are no longer hand-maintained lists: they come
//      from CMS records (src/lib/cms/lifecycle-links.ts).
//
// Exit codes:
//   0 = all records pass (or warnings only)
//   1 = one or more ERROR-severity violations found
//
// Build integration: runs before `next build` so the
// production build always contains clean data.
// ═══════════════════════════════════════════════════════════

// Load .env.local (and .env.*) so DATABASE_URL is available for the
// CMS slug query below. Next.js build does this automatically; tsx does not.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getAllOpportunities, getAllSlugs } from "@/lib/repository";
import { validateAllRecords, printValidationResults } from "@/lib/validation";
import {
  UPCOMING_EXAMS,
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
  const canonicalSlugs = await getAllSlugs(); // static + CMS published slugs
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

  const allSatelliteErrors = [
    ...upcomingErrors,
  ];

  console.log(`   UPCOMING_EXAMS: ${UPCOMING_EXAMS.length} records\n`);

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
