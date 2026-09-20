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
//   - examStages: [] — renderer guards on length > 0; safe to omit.
//   - provenance.lastVerifiedAt = snapshot.projectedAt (projection time).
//   - provenance.primarySourceType = OFFICIAL_NOTIFICATION (CMS requirement
//     for publication: must have official evidence before publish is allowed).
// ═══════════════════════════════════════════════════════════

import type { GovernmentRecruitment, VerificationStatus, SourceType } from "@/types";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

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

  return {
    id:               snapshot.id,
    slug:             snapshot.slug,
    type:             "government",
    title:            snapshot.title ?? "",
    organizationId:   snapshot.organizationId,
    organizationName: snapshot.organizationName,

    // Classification — use null-safe values; empty string signals "not set",
    // never invents a state, qualification, or category that isn't in the record.
    // Exception: category defaults to "government" because all CMS records are
    // government recruitments and this is the correct parent category.
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

    examStages:        [],
    vacancyBreakdown:  undefined,
    fee: feeRows.length > 0
      ? { rows: feeRows, modes: snapshot.financial.paymentModes }
      : undefined,
    ageLimit:          undefined,
    eligibility:       undefined,
    selectionProcess:  undefined,
    howToApply:        snapshot.howToApply.length > 0 ? snapshot.howToApply : undefined,

    links: {
      notification: linkByType("OFFICIAL_NOTIFICATION"),
      apply:        linkByType("APPLY_ONLINE") ?? linkByType("OFFICIAL_WEBSITE") ?? "",
      website:      linkByType("OFFICIAL_WEBSITE") ?? "",
      correction:   linkByType("CORRIGENDUM"),
      admitCard:    linkByType("ADMIT_CARD"),
      result:       linkByType("RESULT"),
    },

    ecosystem: undefined,

    provenance: {
      status:           snapshot.provenanceStatus as VerificationStatus,
      lastVerifiedAt:   snapshot.projectedAt,
      primarySourceUrl: snapshot.primarySourceUrl ?? undefined,
      primarySourceType: "OFFICIAL_NOTIFICATION" as SourceType,
    },
    updates: [],
  };
}
