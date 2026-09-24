// ═══════════════════════════════════════════════════════════
// CMS → Public Adapter
// ═══════════════════════════════════════════════════════════
//
// Maps a PublishedRecruitmentSnapshot (CMS canonical output) into
// GovernmentRecruitment (the public domain type the renderer consumes).
//
// Rules:
//   - Never invent classification facts (category/state/qualification).
//     Null snapshot values become empty strings, not guessed defaults.
//   - "government" for category is the only safe non-empty fallback:
//     every CMS record IS a government recruitment by definition.
//   - examStages: mapped directly from snapshot — ExamStage[] is shared.
//   - ageLimit: AgeCriteria → AgeLimit (relaxations → relaxation rename).
//   - eligibility: CmsRecruitmentPost[] → string[] (post field per item).
//   - selectionProcess: CmsSelectionInformation → string[] (stage names).
//   - vacancyBreakdown: VacancyRow[] shared type — cast directly.
//   - provenance.lastVerifiedAt = snapshot.projectedAt (projection time).
//   - provenance.primarySourceType = OFFICIAL_NOTIFICATION (CMS requirement
//     for publication: must have official evidence before publish is allowed).
// ═══════════════════════════════════════════════════════════

import type {
  GovernmentRecruitment, VerificationStatus, SourceType,
  ExamStage, AgeLimit, AgeRelaxation, VacancyRow, UpdateRecord,
} from "@/types";
import type { AgeCriteria, CmsRecruitmentPost, CmsSelectionInformation } from "@/types/recruitment-record";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

// ─── Internal helpers ─────────────────────────────────────

function ageCriteriaToAgeLimit(age: AgeCriteria): AgeLimit {
  const relaxation: AgeRelaxation[] = (age.relaxations ?? []).map((r) => ({
    category: r.category,
    years:    r.years,
    text:     r.text,
  }));
  return {
    min:       age.min,
    max:       age.max,
    asOf:      age.asOf,
    relaxation: relaxation.length > 0 ? relaxation : undefined,
  };
}

function postsToEligibilityStrings(posts: CmsRecruitmentPost[]): string[] {
  return posts.flatMap((p) => [p.post, ...(p.qualification ?? [])]);
}

function selectionInfoToProcessStrings(info: CmsSelectionInformation): string[] {
  return info.stages?.map((s) => s.name) ?? [];
}

// ─── Main adapter ─────────────────────────────────────────

export function snapshotToGovernmentRecruitment(
  snapshot: PublishedRecruitmentSnapshot,
): GovernmentRecruitment {
  const linkByType = (type: string) =>
    snapshot.links.find((l) => l.type === type)?.url;

  const govType = (() => {
    if (snapshot.govType === "PSU") return "PSU Bank" as const;
    if (snapshot.govType === "State Govt") return "State Govt" as const;
    return "Central Govt" as const;
  })();

  const feeRows = [];
  if (snapshot.financial.feeGeneral !== null) {
    feeRows.push({ category: "General / OBC", amount: snapshot.financial.feeGeneral });
  }
  if (snapshot.financial.feeSCST !== null) {
    feeRows.push({ category: "SC / ST / PwBD", amount: snapshot.financial.feeSCST });
  }

  // ─── Gap fields — now fully mapped ──────────────────────

  const examStages = (snapshot.examStages ?? []) as ExamStage[];

  const vacancyBreakdown = snapshot.vacancies.breakdown
    ? (snapshot.vacancies.breakdown as VacancyRow[])
    : undefined;

  const ageLimit = snapshot.age
    ? ageCriteriaToAgeLimit(snapshot.age as AgeCriteria)
    : undefined;

  const eligibility = snapshot.eligibility
    ? postsToEligibilityStrings(snapshot.eligibility as CmsRecruitmentPost[])
    : undefined;

  const selectionProcess = snapshot.selection
    ? selectionInfoToProcessStrings(snapshot.selection as CmsSelectionInformation)
    : undefined;

  const updates = snapshot.updates
    ? (snapshot.updates as UpdateRecord[])
    : [];

  // ─── Assemble ────────────────────────────────────────────

  return {
    id:               snapshot.id,
    slug:             snapshot.slug,
    type:             "government",
    title:            snapshot.title ?? "",
    organizationId:   snapshot.organizationId,
    organizationName: snapshot.organizationName,

    // Classification — null-safe; empty string signals "not set",
    // never invents a state, qualification, or category.
    // "government" for category is factually correct for all CMS records.
    shortDescription: snapshot.classification.shortDescription ?? "",
    category:         (snapshot.classification.category ?? "government") as GovernmentRecruitment["category"],
    state:            snapshot.classification.state ?? "",
    qualification:    (snapshot.classification.qualification ?? "") as GovernmentRecruitment["qualification"],

    govType,
    notificationNumber: snapshot.notificationNumber ?? "",
    totalVacancies:   snapshot.vacancies.total ?? 0,
    vacanciesDisplay: snapshot.vacancies.total !== null
      ? `${snapshot.vacancies.total.toLocaleString("en-IN")} Posts`
      : "Vacancies TBC",

    application: {
      notificationDate:    snapshot.dates.notificationDate ?? undefined,
      openDate:            snapshot.dates.applicationOpenDate ?? "",
      closeDate:           snapshot.dates.applicationCloseDate ?? "",
      feeDeadline:         snapshot.dates.feePaymentCloseDate ?? undefined,
      correctionWindowEnd: snapshot.dates.correctionWindowEnd ?? undefined,
    },

    examStages,
    vacancyBreakdown,
    fee: feeRows.length > 0
      ? { rows: feeRows, modes: snapshot.financial.paymentModes }
      : undefined,
    ageLimit,
    eligibility:      eligibility && eligibility.length > 0 ? eligibility : undefined,
    selectionProcess: selectionProcess && selectionProcess.length > 0 ? selectionProcess : undefined,
    howToApply:       snapshot.howToApply.length > 0 ? snapshot.howToApply : undefined,

    links: {
      notification: linkByType("OFFICIAL_NOTIFICATION"),
      apply:        linkByType("APPLY_ONLINE") ?? linkByType("OFFICIAL_WEBSITE") ?? "",
      website:      linkByType("OFFICIAL_WEBSITE") ?? "",
      correction:   linkByType("CORRIGENDUM"),
      admitCard:    linkByType("ADMIT_CARD"),
      result:       linkByType("RESULT"),
    },

    ecosystem: undefined,  // deferred: add per-record via admin UI post-migration

    provenance: {
      status:            snapshot.provenanceStatus as VerificationStatus,
      lastVerifiedAt:    snapshot.projectedAt,
      primarySourceUrl:  snapshot.primarySourceUrl ?? undefined,
      primarySourceType: "OFFICIAL_NOTIFICATION" as SourceType,
    },
    updates,
  };
}
