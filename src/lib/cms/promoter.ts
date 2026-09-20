// ═══════════════════════════════════════════════════════════
// CMS Promoter — Intelligence Draft → CMS Record
// ═══════════════════════════════════════════════════════════
//
// Converts RecruitmentIntelligenceDraft (FieldValue<T>) to the
// initial RecruitmentRecord shape (ProvenanceField<T>).
//
// Promotion mapping (Phase E — locked):
//   conflict=true  → CONFLICTED, conflict=true
//   value present  → PENDING, conflict=false
//   value absent   → NOT_SPECIFIED, value=null
//   NEVER          → VERIFIED (intelligence fields are never auto-verified)
//   machineValue   → preserved
//   evidenceIds    → FieldEvidence[].sourceId
//
// BOUNDARY: This file imports from src/intelligence/draft-types.ts.
// src/intelligence/ MUST NOT import from src/lib/cms/repository.ts.
// ═══════════════════════════════════════════════════════════

import type {
  FieldValue,
  RecruitmentIntelligenceDraft,
  RecruitmentDate as DraftDate,
} from "@/intelligence/draft-types";

import type {
  ProvenanceField,
  RecruitmentIdentity,
  RecruitmentDates,
  VacancyInformation,
  FinancialInformation,
  CmsRecruitmentLink,
} from "@/types/recruitment-record";

import type { Provenance } from "@/types";

// ─── Core field mapper ────────────────────────────────────

function promoteField<T>(fv: FieldValue<T> | undefined): ProvenanceField<T> {
  if (!fv) {
    return { value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: false };
  }

  const evidenceIds = fv.evidence.map((e) => e.sourceId);
  const base = { evidenceIds, manuallyEdited: false, machineValue: fv.machineValue };

  if (fv.conflict) {
    return { ...base, value: fv.value ?? null, status: "CONFLICTED", conflict: true };
  }
  if (fv.value !== undefined) {
    return { ...base, value: fv.value, status: "PENDING", conflict: false };
  }
  return { ...base, value: null, status: "NOT_SPECIFIED", conflict: false };
}

// ─── Date field mapper ────────────────────────────────────
// Maps intelligence RecruitmentDate → ProvenanceField<string | null>

function promoteDateField(rd: DraftDate | undefined): ProvenanceField<string | null> | undefined {
  if (!rd) return undefined;

  const evidenceIds = rd.sourceEvidence.map((e) => e.sourceId);
  const base = { evidenceIds, manuallyEdited: rd.manuallyEdited };

  if (rd.conflict) {
    return { ...base, value: rd.date ?? null, status: "CONFLICTED" as const, conflict: true };
  }
  if (rd.date !== undefined) {
    return { ...base, value: rd.date, status: "PENDING" as const, conflict: false };
  }
  return { ...base, value: null, status: "NOT_SPECIFIED" as const, conflict: false };
}

// ─── Slug generation ──────────────────────────────────────

function generateSlug(draft: RecruitmentIntelligenceDraft): string {
  const title = draft.identity.title.value;
  const suffix = draft.id.slice(0, 8);
  if (title) {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    return base ? `${base}-${suffix}` : `draft-${suffix}`;
  }
  return `draft-${suffix}`;
}

// ─── Link mapper ──────────────────────────────────────────

function promoteLinks(draft: RecruitmentIntelligenceDraft): CmsRecruitmentLink[] {
  return draft.links.map((l) => ({
    type: l.type as CmsRecruitmentLink["type"],
    label: l.label,
    url: l.url,
    official: l.official,
    sourceId: l.sourceId,
  }));
}

// ─── Public API ───────────────────────────────────────────

export interface PromotionInput {
  draft: RecruitmentIntelligenceDraft;
  adminId: string;
}

export interface PromotedFields {
  slug: string;
  identity: RecruitmentIdentity;
  dates: RecruitmentDates;
  vacancies: VacancyInformation;
  financial: FinancialInformation;
  links: CmsRecruitmentLink[];
  provenance: Provenance;
}

export function promoteDraft({ draft, adminId: _adminId }: PromotionInput): PromotedFields {
  // ── Identity ──────────────────────────────────────────────
  const identity: RecruitmentIdentity = {
    organizationId:    draft.identity.organizationId.value ?? "UNKNOWN",
    organizationName:  draft.identity.organizationName.value ?? "",
    recruitmentYear:   draft.identity.recruitmentYear.value ?? new Date().getFullYear(),
    title:             promoteField(draft.identity.title),
    shortTitle:        draft.identity.shortTitle.value !== undefined ? promoteField(draft.identity.shortTitle) : undefined,
    notificationNumber:  draft.identity.notificationNumber.value !== undefined ? promoteField(draft.identity.notificationNumber) : undefined,
    advertisementNumber: draft.identity.advertisementNumber.value !== undefined ? promoteField(draft.identity.advertisementNumber) : undefined,
  };

  // ── Dates ─────────────────────────────────────────────────
  const dates: RecruitmentDates = {
    notificationDate:        promoteDateField(draft.dates.notificationDate),
    applicationOpenDate:     promoteDateField(draft.dates.applicationOpenDate),
    applicationCloseDate:    promoteDateField(draft.dates.applicationCloseDate),
    feePaymentCloseDate:     promoteDateField(draft.dates.feePaymentCloseDate),
    examDate:                promoteDateField(draft.dates.examDate),
    prelimsDate:             promoteDateField(draft.dates.prelimsDate),
    mainsDate:               promoteDateField(draft.dates.mainsDate),
    interviewDate:           promoteDateField(draft.dates.interviewDate),
    resultDate:              promoteDateField(draft.dates.resultDate),
    documentVerificationDate: promoteDateField(draft.dates.documentVerificationDate),
    joiningDate:             promoteDateField(draft.dates.joiningDate),
  };

  // ── Vacancies ─────────────────────────────────────────────
  // Promote the total; breakdown structure diverges between intelligence and CMS types.
  const vacancies: VacancyInformation = {
    total: draft.vacancies.total ? promoteField(draft.vacancies.total) : undefined,
  };

  // ── Financial ─────────────────────────────────────────────
  // Intelligence draft has pay info nested, not as ProvenanceField fees.
  // Start empty; admin fills via CMS editor.
  const financial: FinancialInformation = {};

  // ── Provenance ────────────────────────────────────────────
  const primarySource = draft.sources.find((s) => s.kind === "OFFICIAL");
  const provenance: Provenance = {
    status: "NOT_VERIFIED",
    primarySourceType: "NOT_VERIFIED",
    lastVerifiedAt: new Date().toISOString().split("T")[0],
    ...(primarySource ? { primarySourceUrl: primarySource.url, primarySourceType: "OFFICIAL_NOTIFICATION" } : {}),
    sourceDraftId: draft.id,
  };

  return {
    slug: generateSlug(draft),
    identity,
    dates,
    vacancies,
    financial,
    links: promoteLinks(draft),
    provenance,
  };
}
