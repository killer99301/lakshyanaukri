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
//   - provenance.lastVerifiedAt = the day a person actually checked the job
//     (the import checks in force, or the record's own verified date); empty
//     when nobody has. Never the projection time, which is pageUpdatedAt (G1).
//   - provenance.primarySourceType = the source standing the job's links show:
//     an official notification link, an official website link, or none (G1).
// ═══════════════════════════════════════════════════════════

import type {
  GovernmentRecruitment, VerificationStatus, SourceType,
  ExamStage, AgeLimit, AgeRelaxation, VacancyRow, UpdateRecord,
} from "@/types";
import type { FeeRow } from "@/types";
import { GENERAL_FEE_LABEL, RESERVED_FEE_LABEL } from "@/lib/fee-labels";
import type { AgeCriteria, CmsRecruitmentPost, CmsSelectionInformation, ExamPatternPaper, SyllabusSubject } from "@/types/recruitment-record";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";
import { lifecycleLinksOf } from "@/lib/cms/lifecycle-links";
import { toPublicUpdates } from "@/lib/cms/announcements";
import { EXPERIENCE_PREFIX } from "@/lib/eligibility-lines";
import { fieldDef } from "@/lib/cms/importer/fields";
import { isAggregatorHost } from "@/lib/public-link-labels";
import { hostOf } from "@/lib/cms/importer/trusted-domains";
import { feeOverlaps } from "@/lib/cms/importer/fee-table";

/** U5: the same portal twice (case, "www.", a trailing slash) is one portal. */
const portalKey = (url: string) => {
  try { const u = new URL(url); return `${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`; } catch { return url.trim(); }
};

/**
 * U5: every distinct Apply Online portal of a job, in the order saved, with who each is for. A repeat of the same
 * address is shown once (its "for whom" kept when the first had none); an aggregator page is never an Apply portal.
 * Only when there is more than one, or one whose audience is stated: any other job keeps its page exactly as before.
 */
export function applyPortalsOf(links: PublishedRecruitmentSnapshot["links"]): Array<{ label: string; url: string; host: string | null; appliesTo?: string }> | undefined {
  const seen = new Map<string, { label: string; url: string; host: string | null; appliesTo?: string }>();
  for (const l of links) {
    if (l.type !== "APPLY_ONLINE" || l.savedFrom) continue;
    const host = hostOf(l.url);
    if (isAggregatorHost(host)) continue;
    const k = portalKey(l.url);
    const had = seen.get(k);
    if (had) { if (!had.appliesTo && l.appliesTo) had.appliesTo = l.appliesTo; continue; }
    seen.set(k, { label: l.label, url: l.url, host, ...(l.appliesTo ? { appliesTo: l.appliesTo } : {}) });
  }
  // One portal is listed too when the notice says who it is for, so that is never hidden.
  return seen.size > 1 || [...seen.values()].some((p) => p.appliesTo) ? [...seen.values()] : undefined;
}

// ─── Internal helpers ─────────────────────────────────────

/**
 * What the job's sources are, as its links and documents show it (G1): the official notification when a link or
 * document of that kind is marked official, else the official website, else research only. A standing, never a
 * check: a trusted host or an official link says where a document is from, not that any value was verified.
 */
export function sourceStanding(snapshot: Pick<PublishedRecruitmentSnapshot, "links" | "documents" | "sourceType">): SourceType {
  const official = [...snapshot.links.filter((l) => !l.savedFrom), ...snapshot.documents].filter((l) => l.official);
  const has = (...types: string[]) => official.some((l) => types.includes(l.type));
  if (has("OFFICIAL_NOTIFICATION", "NOTIFICATION")) return "OFFICIAL_NOTIFICATION";
  if (has("CORRIGENDUM", "OFFICIAL_CORRIGENDUM")) return "OFFICIAL_CORRIGENDUM";
  const own = snapshot.sourceType;
  if (official.length > 0 && own && own.startsWith("OFFICIAL_")) return own as SourceType;
  if (official.length > 0) return "OFFICIAL_WEBSITE";
  return snapshot.links.length + snapshot.documents.length > 0 ? "SECONDARY_SOURCE" : "NOT_VERIFIED";
}

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
    categoryMax: age.categoryMax && age.categoryMax.length > 0 ? age.categoryMax : undefined,
    postWise:  age.postWise && age.postWise.length > 0 ? age.postWise : undefined,
    bornFrom:  age.bornFrom,
    bornTo:    age.bornTo,
  };
}

// Each post, its qualifications and its experience, as written: alternative pathways stay in the words
// they were given in, under the post they belong to (never merged into one general requirement).
function postsToEligibilityStrings(posts: CmsRecruitmentPost[]): string[] {
  return posts.flatMap((p) => [p.post, ...(p.qualification ?? []), ...(p.experience ?? []).map((e) => `${EXPERIENCE_PREFIX}${e}`)]);
}

function selectionInfoToProcessStrings(info: CmsSelectionInformation): string[] {
  const steps = info.stages?.map((s) => (s.description ? `${s.name} — ${s.description}` : s.name)) ?? [];
  if (steps.length > 0 && info.negativeMarking) steps.push(`Negative marking: ${info.negativeMarking}`);
  return steps;
}

// ─── Main adapter ─────────────────────────────────────────

export function snapshotToGovernmentRecruitment(
  snapshot: PublishedRecruitmentSnapshot,
): GovernmentRecruitment {
  // A saved copy is never used where the page presents "the" link of a type.
  const linkByType = (type: string) =>
    snapshot.links.find((l) => l.type === type && !l.savedFrom)?.url;

  const govType = (() => {
    // "PSU Bank" only for a bank; any other public sector body (IBPS, an insurer, a PSU) is shown as "PSU".
    if (snapshot.govType === "PSU") return /\bbank\b/i.test(snapshot.organizationName ?? "") ? "PSU Bank" as const : "PSU" as const;
    if (snapshot.govType === "State Govt") return "State Govt" as const;
    return "Central Govt" as const;
  })();

  // Imported jobs: what a person recorded about a field the notice does not
  // fill in. "Not applicable" shows the notice's own words ("No application
  // fee"); "not stated" says so plainly. Other jobs have neither map.
  const noticeNote = (fieldPath: string): string | undefined => {
    if (snapshot.notApplicable && fieldPath in snapshot.notApplicable) {
      return snapshot.notApplicable[fieldPath] || "Not applicable, as per the official notification";
    }
    if (snapshot.notStated && fieldPath in snapshot.notStated) {
      const words = snapshot.notStated[fieldPath];
      return words ? `Not stated in the official notification — ${words}` : "Not stated in the official notification";
    }
    return undefined;
  };
  const noticeNotes = [...Object.keys(snapshot.notApplicable ?? {}), ...Object.keys(snapshot.notStated ?? {})]
    // The General fee's public name follows the fee table's ("General (UR)"), not the CMS field's.
    .map((path) => ({ label: path === "financial.feeGeneral" ? `Fee (${GENERAL_FEE_LABEL})` : fieldDef(path).label, text: noticeNote(path)! }));

  // Each fee row stands by itself: an amount, or "not specified" when the
  // notice gives none. A group nobody has filled in is simply left out.
  const NOT_SPECIFIED_FEE = "Not specified in the notice";
  const feeRows: FeeRow[] = [];
  if (snapshot.financial.feeGeneral !== null) {
    feeRows.push({ category: GENERAL_FEE_LABEL, amount: snapshot.financial.feeGeneral });
  } else if (noticeNote("financial.feeGeneral") || snapshot.financial.feeGeneralNotSpecified) {
    feeRows.push({ category: GENERAL_FEE_LABEL, amount: null, note: noticeNote("financial.feeGeneral") ?? NOT_SPECIFIED_FEE });
  }
  if (snapshot.financial.feeSCST !== null) {
    feeRows.push({ category: RESERVED_FEE_LABEL, amount: snapshot.financial.feeSCST });
  } else if (noticeNote("financial.feeSCST") || snapshot.financial.feeSCSTNotSpecified) {
    feeRows.push({ category: RESERVED_FEE_LABEL, amount: null, note: noticeNote("financial.feeSCST") ?? NOT_SPECIFIED_FEE });
  }
  const payScale = snapshot.financial.payScale?.trim() || undefined;

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
  const noWrittenExam = (snapshot.selection as CmsSelectionInformation | null)?.noWrittenExam === true;

  // Snapshots published before these fields existed simply have none.
  const examPattern = Array.isArray(snapshot.examPattern) ? (snapshot.examPattern as ExamPatternPaper[]) : [];
  const syllabus = Array.isArray(snapshot.syllabus) ? (snapshot.syllabus as SyllabusSubject[]) : [];

  // Public pages receive an allowlisted copy of the announcements: never a superseded note's reason or author,
  // nor a superseded announcement's old wording (they stay in the record and its history).
  const updates = toPublicUpdates(snapshot.updates ? (snapshot.updates as UpdateRecord[]) : []);

  // U5: the fee table as the notice gives it (category, amount or exemption, post, note), copied field by field.
  const feeTable = Array.isArray(snapshot.financial.feeTable) && snapshot.financial.feeTable.length
    ? snapshot.financial.feeTable.map((r) => ({ category: r.category, amount: r.amount, ...(r.exempt ? { exempt: true } : {}), ...(r.post ? { post: r.post } : {}), ...(r.note ? { note: r.note } : {}) }))
    : undefined;
  const applyPortals = applyPortalsOf(snapshot.links);
  // Two rows giving the same candidates different fees are said on the page, never settled by guessing.
  const feeTableOverlaps = feeTable ? feeOverlaps((snapshot.financial.feeTable ?? []).map((r) => ({ ...r, groups: r.groups as never, exceptGroups: r.exceptGroups as never }))) : [];

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

    addedAt:          snapshot.firstPublishedAt,
    // The job page lists real documents; a stage's status is already shown in its timeline.
    downloads:        lifecycleLinksOf(snapshot).filter((l) => !l.fromStage),

    govType,
    notificationNumber: snapshot.notificationNumber ?? "",
    totalVacancies:   snapshot.vacancies.total ?? 0,
    // An incomplete total (a bank or city not reported) is never shown as the whole.
    vacanciesDisplay: snapshot.vacancies.total !== null
      ? `${snapshot.vacancies.totalComplete === false ? "At least " : ""}${snapshot.vacancies.total.toLocaleString("en-IN")} Posts`
      : snapshot.notStated && "vacancies.total" in snapshot.notStated
        ? "Not stated in the notice"
        : "Vacancies TBC",
    ...(noticeNotes.length > 0 ? { noticeNotes } : {}),

    application: {
      notificationDate:    snapshot.dates.notificationDate ?? undefined,
      openDate:            snapshot.dates.applicationOpenDate ?? "",
      closeDate:           snapshot.dates.applicationCloseDate ?? "",
      feeDeadline:         snapshot.dates.feePaymentCloseDate ?? undefined,
      correctionWindowEnd: snapshot.dates.correctionWindowEnd ?? undefined,
    },

    examStages,
    vacancyBreakdown,
    ...(snapshot.vacancies.table ? {
      vacancyTable: snapshot.vacancies.table,
      ...(snapshot.vacancies.totalComplete !== undefined ? { vacancyTotalComplete: snapshot.vacancies.totalComplete } : {}),
      ...(snapshot.vacancies.totalBasis ? { vacancyTotalBasis: snapshot.vacancies.totalBasis } : {}),
    } : {}),
    fee: feeRows.length > 0
      ? { rows: feeRows, modes: snapshot.financial.paymentModes }
      : undefined,
    ...(feeTable ? { feeTable } : {}),
    ...(feeTableOverlaps.length ? { feeTableOverlaps } : {}),
    ...(applyPortals ? { applyPortals } : {}),
    payScale,
    ageLimit,
    eligibility:      eligibility && eligibility.length > 0 ? eligibility : undefined,
    selectionProcess: selectionProcess && selectionProcess.length > 0 ? selectionProcess : undefined,
    ...(noWrittenExam ? { noWrittenExam: true } : {}),
    examPattern:      examPattern.length > 0 ? examPattern : undefined,
    syllabus:         syllabus.length > 0 ? syllabus : undefined,
    howToApply:       snapshot.howToApply.length > 0 ? snapshot.howToApply : undefined,

    links: {
      notification: linkByType("OFFICIAL_NOTIFICATION"),
      // Only a real application link is "Apply Online"; a general website is shown as the website (G1).
      apply:        linkByType("APPLY_ONLINE") ?? "",
      website:      linkByType("OFFICIAL_WEBSITE") ?? "",
      correction:   linkByType("CORRIGENDUM"),
      admitCard:    linkByType("ADMIT_CARD"),
      result:       linkByType("RESULT"),
    },

    ecosystem: undefined,  // deferred: add per-record via admin UI post-migration

    provenance: {
      status:            snapshot.provenanceStatus as VerificationStatus,
      lastVerifiedAt:    (snapshot.keyDetailsChecked ? snapshot.keyDetailsCheckedOn : snapshot.verifiedOn) ?? "",
      pageUpdatedAt:     snapshot.projectedAt,
      primarySourceUrl:  snapshot.primarySourceUrl ?? undefined,
      primarySourceType: sourceStanding(snapshot),
      ...(snapshot.keyDetailsChecked ? { keyDetailsChecked: true } : {}),
    },
    updates,
    // Only while the job gives no Apply Online link: a verified link always replaces it (revision 3).
    ...(snapshot.applyLinkLater && !linkByType("APPLY_ONLINE") ? { applyLinkLater: snapshot.applyLinkLater } : {}),
  };
}
