#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// CMS Legacy Import — Phase G
// ═══════════════════════════════════════════════════════════
//
// Two exports:
//
//   legacyToRecord(gr)      — pure function; maps a GovernmentRecruitment
//                             to a full RecruitmentRecord ready for CMS
//                             insertion. Does NOT touch the database.
//
//   roundTripCheck(gr)      — pure function; pipes a GovernmentRecruitment
//                             through the full pipeline and reports every
//                             field that would be lost or degraded:
//
//                             gr → legacyToRecord → projectToPublished
//                                → snapshotToGovernmentRecruitment → gr2
//                                → field-by-field diff
//
// Usage:
//   npx tsx scripts/cms-legacy-import.ts
//
// Runs the round-trip validator against all 6 PARTIALLY_VERIFIED records
// and reports any information loss. No DB access required.
// ═══════════════════════════════════════════════════════════

import type {
  GovernmentRecruitment,
  ExamStage,
  VacancyRow,
  AgeLimit,
} from "@/types";

import type {
  RecruitmentRecord,
  RecruitmentIdentity,
  RecruitmentDates,
  VacancyInformation,
  FinancialInformation,
  RecruitmentLifecycle,
  ProvenanceField,
  AgeCriteria,
  CmsRecruitmentPost,
  CmsSelectionInformation,
  CmsSelectionStage,
  SelectionStageType,
  CmsRecruitmentLink,
} from "@/types/recruitment-record";

import type { Provenance } from "@/types";

// government.ts retired in G7D — no import needed (migration complete)
import { projectToPublished } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";

// ─── Helpers ─────────────────────────────────────────────

function pf<T>(value: T): ProvenanceField<T> {
  return {
    value,
    status: "VERIFIED",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
}

function pfOpt<T>(value: T | null | undefined): ProvenanceField<T | null> {
  return {
    value: value ?? null,
    status: value != null ? "VERIFIED" : "NOT_SPECIFIED",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
}

function inferSelectionStageType(name: string): SelectionStageType {
  const n = name.toLowerCase();
  if (n.includes("interview"))                          return "INTERVIEW";
  if (n.includes("document") || n.includes("verif"))   return "DOCUMENT_VERIFICATION";
  if (n.includes("skill") || n.includes("typing"))     return "SKILL_TEST";
  if (n.includes("physical") || n.includes("fitness")) return "PHYSICAL";
  if (n.includes("cbt") || n.includes("computer"))     return "CBT";
  if (n.includes("written") || n.includes("mains"))    return "WRITTEN";
  if (n.includes("prelim") || n.includes("preliminary")) return "CBT";
  return "OTHER";
}

function ageLimitToAgeCriteria(al: AgeLimit): AgeCriteria {
  return {
    min:         al.min,
    max:         al.max,
    asOf:        al.asOf,
    relaxations: (al.relaxation ?? []).map((r) => ({
      category: r.category,
      years:    r.years,
      text:     r.text,
    })),
  };
}

function eligibilityStringsToPost(lines: string[]): CmsRecruitmentPost[] {
  return lines.map((line) => ({ post: line }));
}

function selectionProcessToCmsInfo(stages: string[]): CmsSelectionInformation {
  const cmsStages: CmsSelectionStage[] = stages.map((name, i) => ({
    name,
    order: i + 1,
    type:  inferSelectionStageType(name),
  }));
  return { stages: cmsStages };
}

function govTypeFromPublic(
  gt: "Central Govt" | "State Govt" | "PSU Bank",
): "Central Govt" | "State Govt" | "PSU" {
  if (gt === "PSU Bank") return "PSU";
  return gt;
}

function linksToTyped(
  links: GovernmentRecruitment["links"],
): CmsRecruitmentLink[] {
  const out: CmsRecruitmentLink[] = [];
  if (links.notification)
    out.push({ type: "OFFICIAL_NOTIFICATION", label: "Official Notification PDF", url: links.notification, official: true });
  if (links.apply)
    out.push({ type: "APPLY_ONLINE", label: "Apply Online", url: links.apply, official: true });
  if (links.website && links.website !== links.apply)
    out.push({ type: "OFFICIAL_WEBSITE", label: "Official Website", url: links.website, official: true });
  if (links.correction)
    out.push({ type: "CORRIGENDUM", label: "Corrigendum", url: links.correction, official: true });
  if (links.admitCard)
    out.push({ type: "ADMIT_CARD", label: "Admit Card", url: links.admitCard, official: true });
  if (links.result)
    out.push({ type: "RESULT", label: "Result", url: links.result, official: true });
  return out;
}

// ─── Import mapper ────────────────────────────────────────

export function legacyToRecord(gr: GovernmentRecruitment): RecruitmentRecord {
  const now = new Date().toISOString();
  const recruitmentYear = parseInt(gr.slug.match(/\d{4}/)?.[0] ?? "2026");

  const identity: RecruitmentIdentity = {
    organizationId:   gr.organizationId,
    organizationName: gr.organizationName,
    govType:          govTypeFromPublic(gr.govType),
    recruitmentYear,
    title:            pf(gr.title),
    notificationNumber: gr.notificationNumber ? pf(gr.notificationNumber) : undefined,
  };

  const dates: RecruitmentDates = {
    notificationDate:    pfOpt(gr.application.notificationDate),
    applicationOpenDate: pfOpt(gr.application.openDate),
    applicationCloseDate: pfOpt(gr.application.closeDate),
    feePaymentCloseDate: pfOpt(gr.application.feeDeadline),
    correctionWindowEnd: pfOpt(gr.application.correctionWindowEnd),
  };

  const vacancies: VacancyInformation = {
    total: pf(gr.totalVacancies),
    ...(gr.vacancyBreakdown ? { breakdown: pf(gr.vacancyBreakdown as VacancyRow[]) } : {}),
  };

  const financial: FinancialInformation = {
    feeGeneral:   gr.fee?.rows.find((r) => r.category.includes("General"))?.amount !== undefined
      ? pf(gr.fee!.rows.find((r) => r.category.includes("General"))!.amount)
      : undefined,
    feeSCST:      gr.fee?.rows.find((r) => r.category.includes("SC"))?.amount !== undefined
      ? pf(gr.fee!.rows.find((r) => r.category.includes("SC"))!.amount)
      : undefined,
    paymentModes: gr.fee?.modes ?? [],
  };

  const lifecycle: RecruitmentLifecycle = {
    status:    "APPLICATIONS_CLOSED",
    conflicts: [],
    events:    [],
  };

  const provenance: Provenance = {
    status:            gr.provenance.status,
    lastVerifiedAt:    gr.provenance.lastVerifiedAt,
    primarySourceUrl:  gr.provenance.primarySourceUrl,
    primarySourceType: gr.provenance.primarySourceType,
    notes:             gr.provenance.notes,
  };

  return {
    id:             `legacy-${gr.id}`,
    slug:           gr.slug,                              // MUST be preserved exactly
    draftState:     "APPROVED",                           // so projectToPublished() accepts it
    recordRevision: "00000000",
    identity,
    dates,
    vacancies,
    financial,

    examStages:      gr.examStages.length > 0 ? gr.examStages : undefined,

    eligibility:     gr.eligibility && gr.eligibility.length > 0
      ? pf(eligibilityStringsToPost(gr.eligibility))
      : undefined,

    age:             gr.ageLimit
      ? pf(ageLimitToAgeCriteria(gr.ageLimit))
      : undefined,

    selection:       gr.selectionProcess && gr.selectionProcess.length > 0
      ? pf(selectionProcessToCmsInfo(gr.selectionProcess))
      : undefined,

    howToApply:      gr.howToApply,
    links:           linksToTyped(gr.links),
    documents:       [],
    lifecycle,

    classification: {
      shortDescription: gr.shortDescription || undefined,
      category:         gr.category,
      state:            gr.state,
      qualification:    gr.qualification,
    },

    provenance,
    updates:   gr.updates ?? [],

    createdAt: now,
    updatedAt: now,
  };
}

// ─── Round-trip diff ──────────────────────────────────────

interface FieldCheck {
  field: string;
  status: "preserved" | "lost" | "degraded" | "deferred";
  note?: string;
}

function checkEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkExamStages(orig: ExamStage[], rt: ExamStage[]): FieldCheck {
  if (orig.length === 0 && rt.length === 0)
    return { field: "examStages", status: "preserved", note: "empty → empty" };
  if (orig.length !== rt.length)
    return { field: "examStages", status: "lost", note: `${orig.length} stages → ${rt.length}` };
  const allMatch = orig.every((s, i) =>
    s.name === rt[i].name &&
    s.order === rt[i].order &&
    s.status === rt[i].status &&
    s.certainty === rt[i].certainty &&
    s.dateIso === rt[i].dateIso
  );
  return allMatch
    ? { field: "examStages", status: "preserved", note: `${orig.length} stages` }
    : { field: "examStages", status: "degraded", note: "structure differs" };
}

function checkAgeLimit(orig: AgeLimit | undefined, rt: AgeLimit | undefined): FieldCheck {
  if (!orig && !rt) return { field: "ageLimit", status: "preserved", note: "absent → absent" };
  if (!orig || !rt)  return { field: "ageLimit", status: "lost", note: orig ? "lost in round-trip" : "gained unexpectedly" };
  const sameMin = orig.min === rt.min;
  const sameMax = orig.max === rt.max;
  const sameAsOf = orig.asOf === rt.asOf;
  const origRelax = JSON.stringify(orig.relaxation ?? []);
  const rtRelax   = JSON.stringify(rt.relaxation ?? []);
  const allMatch = sameMin && sameMax && sameAsOf && origRelax === rtRelax;
  return allMatch
    ? { field: "ageLimit", status: "preserved" }
    : { field: "ageLimit", status: "degraded", note: `min:${sameMin} max:${sameMax} asOf:${sameAsOf} relaxation:${origRelax === rtRelax}` };
}

function checkEligibility(orig: string[] | undefined, rt: string[] | undefined): FieldCheck {
  if (!orig && !rt) return { field: "eligibility", status: "preserved", note: "absent → absent" };
  if (!orig || !rt) return { field: "eligibility", status: "lost" };
  if (JSON.stringify(orig) === JSON.stringify(rt))
    return { field: "eligibility", status: "preserved", note: `${orig.length} items` };
  return { field: "eligibility", status: "degraded", note: `${orig.length} items → ${rt.length}` };
}

function checkSelectionProcess(orig: string[] | undefined, rt: string[] | undefined): FieldCheck {
  if (!orig && !rt) return { field: "selectionProcess", status: "preserved", note: "absent → absent" };
  if (!orig || !rt) return { field: "selectionProcess", status: "lost" };
  if (JSON.stringify(orig) === JSON.stringify(rt))
    return { field: "selectionProcess", status: "preserved", note: `${orig.length} stages` };
  return { field: "selectionProcess", status: "degraded", note: `${orig.length} → ${rt.length}` };
}

function checkVacancyBreakdown(
  orig: VacancyRow[] | undefined, rt: VacancyRow[] | undefined,
): FieldCheck {
  if (!orig && !rt) return { field: "vacancyBreakdown", status: "preserved", note: "absent → absent" };
  if (!orig || !rt) return { field: "vacancyBreakdown", status: "lost" };
  return checkEqual(orig, rt)
    ? { field: "vacancyBreakdown", status: "preserved", note: `${orig.length} rows` }
    : { field: "vacancyBreakdown", status: "degraded" };
}

export function roundTripCheck(gr: GovernmentRecruitment): FieldCheck[] {
  const record   = legacyToRecord(gr);
  const snapshot = projectToPublished(record);
  const rt       = snapshotToGovernmentRecruitment(snapshot);

  const checks: FieldCheck[] = [
    { field: "slug",             status: gr.slug === rt.slug             ? "preserved" : "lost" },
    { field: "title",            status: gr.title === rt.title           ? "preserved" : "lost" },
    { field: "organizationId",   status: gr.organizationId === rt.organizationId ? "preserved" : "lost" },
    { field: "organizationName", status: gr.organizationName === rt.organizationName ? "preserved" : "lost" },
    {
      field: "govType",
      status: (() => {
        if (gr.govType === "PSU Bank" && rt.govType === "PSU Bank") return "preserved";
        if (gr.govType === rt.govType) return "preserved";
        return "degraded";
      })(),
    },
    { field: "notificationNumber",  status: gr.notificationNumber === rt.notificationNumber ? "preserved" : "lost" },
    { field: "totalVacancies",      status: gr.totalVacancies === rt.totalVacancies ? "preserved" : "lost" },
    { field: "application.openDate",
      status: gr.application.openDate === rt.application.openDate ? "preserved" : "lost" },
    { field: "application.closeDate",
      status: gr.application.closeDate === rt.application.closeDate ? "preserved" : "lost" },
    { field: "application.notificationDate",
      status: (gr.application.notificationDate ?? null) === (rt.application.notificationDate ?? null)
        ? "preserved" : "lost" },
    {
      field: "fee",
      status: (() => {
        if (!gr.fee && !rt.fee) return "preserved";
        if (!gr.fee || !rt.fee) return "lost";
        const sameRows = gr.fee.rows.every((r, i) =>
          r.amount === rt.fee!.rows[i]?.amount
        );
        return sameRows ? "preserved" : "degraded";
      })(),
    },
    {
      field: "classification.shortDescription",
      status: (gr.shortDescription || "") === (rt.shortDescription || "") ? "preserved" : "lost",
    },
    {
      field: "classification.category",
      status: gr.category === rt.category ? "preserved" : "degraded",
    },
    {
      field: "classification.state",
      status: (gr.state || "") === (rt.state || "") ? "preserved" : "lost",
    },
    {
      field: "classification.qualification",
      status: (gr.qualification || "") === (rt.qualification || "") ? "preserved" : "lost",
    },
    checkExamStages(gr.examStages, rt.examStages),
    checkVacancyBreakdown(gr.vacancyBreakdown, rt.vacancyBreakdown),
    checkAgeLimit(gr.ageLimit, rt.ageLimit),
    checkEligibility(gr.eligibility, rt.eligibility),
    checkSelectionProcess(gr.selectionProcess, rt.selectionProcess),
    {
      field: "howToApply",
      status: checkEqual(gr.howToApply ?? [], rt.howToApply ?? []) ? "preserved" : "degraded",
      note: `${(gr.howToApply ?? []).length} items`,
    },
    {
      field: "links.notification",
      status: (gr.links.notification ?? "") === (rt.links.notification ?? "") ? "preserved" : "lost",
    },
    {
      field: "links.apply",
      status: gr.links.apply === rt.links.apply ? "preserved" : "degraded",
      note: rt.links.apply ? undefined : "apply URL missing",
    },
    {
      field: "links.website",
      status: (gr.links.website ?? "") === (rt.links.website ?? "") ? "preserved" : "degraded",
    },
    {
      field: "updates",
      status: checkEqual(gr.updates ?? [], rt.updates ?? []) ? "preserved" : "degraded",
      note: `${(gr.updates ?? []).length} records`,
    },
    { field: "provenance.status",  status: gr.provenance.status === rt.provenance.status ? "preserved" : "lost" },
    { field: "provenance.sourceUrl", status: (gr.provenance.primarySourceUrl ?? "") === (rt.provenance.primarySourceUrl ?? "") ? "preserved" : "lost" },
    {
      field: "ecosystem",
      status: "deferred",
      note: "add via admin UI post-migration",
    },
    {
      field: "originalVacancies",
      status: "deferred",
      note: "pre-corrigendum count — preserved in updates[] history",
    },
  ];

  return checks;
}

// ─── Main: retired ───────────────────────────────────────
// Migration complete (G6 — committed db6c390). government.ts retired in G7D.
// The 6 PARTIALLY_VERIFIED records are now in the CMS (published_recruitments).

async function main(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Phase G Round-Trip Validator — RETIRED");
  console.log("  Migration complete. government.ts was retired in G7D.");
  console.log("  All 6 records are now in published_recruitments.");
  console.log("═══════════════════════════════════════════════════\n");
  process.exit(0);
}

// Only execute when run directly (not when imported as a module)
const isEntryPoint = process.argv[1]?.replace(/\\/g, "/").endsWith("cms-legacy-import.ts") ||
                     process.argv[1]?.replace(/\\/g, "/").endsWith("cms-legacy-import");
if (isEntryPoint) {
  main().catch((err) => {
    console.error("Validator crashed:", err);
    process.exit(1);
  });
}
