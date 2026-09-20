// ═══════════════════════════════════════════════════════════
// CMS Projector — RecruitmentRecord → PublishedRecruitment snapshot
// ═══════════════════════════════════════════════════════════
//
// Deterministic, pure, fail-closed projection that strips all
// ProvenanceField wrappers and produces the canonical public snapshot.
//
// Design (Phase E, Option B):
//   - Pure function: no DB, no I/O, no side effects
//   - Fail-closed: throws on any unexpected state; never silently omits
//   - Takes .value from every ProvenanceField<T>
//   - Null values are preserved as null in the snapshot
//   - Snake_case output matches what the public API serves
//
// PROJECTION_VERSION must be bumped when the output shape changes.
// ═══════════════════════════════════════════════════════════

import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";

export const PROJECTION_VERSION = "1.0";

// ─── Helpers ─────────────────────────────────────────────

function pv<T>(f: ProvenanceField<T> | undefined | null): T | null {
  if (f == null) return null;
  return f.value ?? null;
}

// ─── Projection result shape ──────────────────────────────
// The public snapshot stored in published_recruitments.snapshot.

export interface PublishedRecruitmentSnapshot {
  id: string;
  slug: string;
  organizationId: string;
  organizationName: string;
  govType: string | null;
  recruitmentYear: number;
  title: string | null;
  shortTitle: string | null;
  notificationNumber: string | null;
  advertisementNumber: string | null;
  dates: {
    notificationDate: string | null;
    applicationOpenDate: string | null;
    applicationCloseDate: string | null;
    feePaymentCloseDate: string | null;
    correctionWindowEnd: string | null;
    examDate: string | null;
    prelimsDate: string | null;
    mainsDate: string | null;
    admitCardDate: string | null;
    resultDate: string | null;
    interviewDate: string | null;
    documentVerificationDate: string | null;
    joiningDate: string | null;
  };
  vacancies: {
    total: number | null;
    breakdown: unknown[] | null;
  };
  financial: {
    feeGeneral: number | null;
    feeSCST: number | null;
    payScale: string | null;
    paymentModes: string[];
  };
  eligibility: unknown | null;
  age: unknown | null;
  selection: unknown | null;
  howToApply: string[];
  links: Array<{ type: string; label: string; url: string; official: boolean }>;
  documents: Array<{ type: string; label: string; url: string; official: boolean; datePublished?: string }>;
  provenanceStatus: string;
  primarySourceUrl: string | null;
  projectedAt: string;
  projectionVersion: string;
  sourceRecordRevision: string;
}

// ─── Main projection function ─────────────────────────────

export function projectToPublished(record: RecruitmentRecord): PublishedRecruitmentSnapshot {
  if (record.draftState !== "APPROVED") {
    throw new Error(
      `Cannot project: record is in state ${record.draftState} (must be APPROVED)`,
    );
  }

  return {
    id:                  record.id,
    slug:                record.slug,
    organizationId:      record.identity.organizationId,
    organizationName:    record.identity.organizationName,
    govType:             record.identity.govType ?? null,
    recruitmentYear:     record.identity.recruitmentYear,
    title:               pv(record.identity.title),
    shortTitle:          pv(record.identity.shortTitle),
    notificationNumber:  pv(record.identity.notificationNumber),
    advertisementNumber: pv(record.identity.advertisementNumber),

    dates: {
      notificationDate:        pv(record.dates.notificationDate),
      applicationOpenDate:     pv(record.dates.applicationOpenDate),
      applicationCloseDate:    pv(record.dates.applicationCloseDate),
      feePaymentCloseDate:     pv(record.dates.feePaymentCloseDate),
      correctionWindowEnd:     pv(record.dates.correctionWindowEnd),
      examDate:                pv(record.dates.examDate),
      prelimsDate:             pv(record.dates.prelimsDate),
      mainsDate:               pv(record.dates.mainsDate),
      admitCardDate:           pv(record.dates.admitCardDate),
      resultDate:              pv(record.dates.resultDate),
      interviewDate:           pv(record.dates.interviewDate),
      documentVerificationDate: pv(record.dates.documentVerificationDate),
      joiningDate:             pv(record.dates.joiningDate),
    },

    vacancies: {
      total:     pv(record.vacancies.total),
      breakdown: pv(record.vacancies.breakdown) ?? null,
    },

    financial: {
      feeGeneral:   pv(record.financial.feeGeneral),
      feeSCST:      pv(record.financial.feeSCST),
      payScale:     pv(record.financial.payScale),
      paymentModes: record.financial.paymentModes ?? [],
    },

    eligibility: pv(record.eligibility),
    age:         pv(record.age),
    selection:   pv(record.selection),
    howToApply:  record.howToApply ?? [],

    links: record.links.map((l) => ({
      type:     l.type,
      label:    l.label,
      url:      l.url,
      official: l.official,
    })),

    documents: record.documents.map((d) => ({
      type:          d.type,
      label:         d.label,
      url:           d.url,
      official:      d.official,
      datePublished: d.datePublished,
    })),

    provenanceStatus:   record.provenance.status,
    primarySourceUrl:   record.provenance.primarySourceUrl ?? null,

    projectedAt:          new Date().toISOString(),
    projectionVersion:    PROJECTION_VERSION,
    sourceRecordRevision: record.recordRevision,
  };
}
