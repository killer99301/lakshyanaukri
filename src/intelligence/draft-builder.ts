// ═══════════════════════════════════════════════════════════
// Phase 10: URL-First Intelligence Pipeline — Draft Builder
// ═══════════════════════════════════════════════════════════
//
// Architecture:
//   URL → HttpRetriever → RetrievedSource (html, links)
//     → extractIntakeFields() [Stage A/B engine, unchanged]
//     → IntakeExtraction
//     → mapExtractionsToDraft() [Phase 10 field mapper]
//     → RecruitmentIntelligenceDraft
//
// Stage A/B is the single extraction engine. This module adds
// FieldValue<T> provenance wrapping, multi-source conflict
// detection, and the Phase 10 schema — not a new extractor.
//
// INVARIANTS (matches draft-types.ts):
//   - derivedTotal only set when vacancyDerived=true
//   - conflict=true preserves ALL evidence; the losing value is never discarded
//   - dates route through the same FieldValue evidence mechanism as other fields
//   - missingFields lists paths where no source supplied a value
//   - readyForReview=false blocks until blocking issues are resolved
//   - No database writes, no PR creation, no candidates

import { randomUUID } from "node:crypto";
import {
  classifySourceUrl,
  extractIntakeFields,
  type IntakeExtraction,
  type ExtractionSourceKind,
} from "./intake";
import { HttpRetriever } from "./http-retriever";
import type {
  SourceRetriever,
  IntelligenceSource,
  RecruitmentIntelligenceDraft,
  FieldValue,
  FieldEvidence,
  RecruitmentIdentity,
  RecruitmentDates,
  RecruitmentDate,
  VacancyData,
  VacancyRow,
  IntelligenceConflict,
  ConflictValue,
  DraftReadiness,
  SourceKind,
  RecruitmentLink,
} from "./draft-types";

// ─── Internal type ────────────────────────────────────────────

export interface ExtractionWithSource {
  source: IntelligenceSource;
  extraction: IntakeExtraction;
  // Organization name resolved from the official domain registry during retrieval.
  // Absent for secondary/third-party sources that have no registry entry.
  orgName?: string;
}

// ─── Authority rank ───────────────────────────────────────────

function extractionAuthorityRank(sourceKind: ExtractionSourceKind): number {
  switch (sourceKind) {
    case "OFFICIAL_PDF":      return 5;
    case "OFFICIAL_SPECIFIC": return 4;
    case "OFFICIAL_GENERIC":  return 3;
    case "THIRD_PARTY":       return 1;
    default:                  return 0;
  }
}

// ─── FieldValue builder ───────────────────────────────────────

interface EvidenceInput<T> {
  value: T | undefined;
  sourceId: string;
  url: string;
  confidence: number;
  authorityRank: number;
  extractedText?: string;
}

function buildFieldValue<T>(
  inputs: EvidenceInput<T>[],
  extractedAt: string,
): FieldValue<T> {
  const withValues = inputs.filter(
    (e): e is EvidenceInput<T> & { value: T } => e.value !== undefined,
  );

  if (withValues.length === 0) {
    return { confidence: 0, evidence: [], manuallyEdited: false, conflict: false };
  }

  const evidence: FieldEvidence[] = withValues.map((e) => ({
    sourceId: e.sourceId,
    url: e.url,
    value: e.value,
    extractedText: e.extractedText,
    confidence: e.confidence,
    authorityRank: e.authorityRank,
    extractionMethod: "TEXT" as const,
    extractedAt,
  }));

  const sorted = [...withValues].sort(
    (a, b) =>
      b.authorityRank - a.authorityRank || b.confidence - a.confidence,
  );
  const winner = sorted[0];

  // Conflict = any source disagrees with the winning value; losing value is preserved in evidence
  const conflict = sorted.some((e) => e.value !== winner.value);

  return {
    value: winner.value,
    confidence: Math.max(...withValues.map((e) => e.confidence)),
    selectedSourceId: winner.sourceId,
    evidence,
    manuallyEdited: false,
    conflict,
  };
}

function emptyFieldValue<T>(): FieldValue<T> {
  return { confidence: 0, evidence: [], manuallyEdited: false, conflict: false };
}

// ─── Conflict recorder ────────────────────────────────────────

function recordConflict(
  conflicts: IntelligenceConflict[],
  field: string,
  fv: FieldValue<unknown>,
  sourceKindBySourceId: Map<string, SourceKind>,
): void {
  if (!fv.conflict) return;
  const values: ConflictValue[] = fv.evidence.map((e) => ({
    value: e.value,
    sourceId: e.sourceId,
    url: e.url,
    sourceKind: sourceKindBySourceId.get(e.sourceId) ?? "OTHER",
    confidence: e.confidence,
  }));
  conflicts.push({
    field,
    values,
    resolution: fv.selectedSourceId
      ? {
          selectedValue: fv.value,
          reason: "Highest authority source selected",
          selectedSourceId: fv.selectedSourceId,
        }
      : undefined,
    severity: "WARNING",
  });
}

// ─── Date field builder ───────────────────────────────────────
//
// Routes dates through the same FieldValue evidence mechanism as other fields.
// When sources disagree on a date, the conflict is preserved — never discarded.
// The higher-authority source's value is selected; the losing value stays in evidence.

function buildDateField(
  field: string,
  dateInputs: EvidenceInput<string>[],
  extractedAt: string,
  conflicts: IntelligenceConflict[],
  sourceKindBySourceId: Map<string, SourceKind>,
): RecruitmentDate | undefined {
  const fv = buildFieldValue(dateInputs, extractedAt);
  if (!fv.value) return undefined;
  if (fv.conflict) {
    recordConflict(conflicts, field, fv as FieldValue<unknown>, sourceKindBySourceId);
  }
  return {
    date: fv.value,
    certainty: "CONFIRMED",
    sourceEvidence: fv.evidence,
    manuallyEdited: false,
    conflict: fv.conflict,
    selectedSourceId: fv.selectedSourceId,
  };
}

// ─── Vacancy rows builder ─────────────────────────────────────

function buildVacancyRows(
  rows: Array<{ label: string; count: number }>,
  sourceId: string,
  url: string,
  authorityRank: number,
  extractedAt: string,
): VacancyRow[] {
  return rows.map((r, i) => ({
    id: `${sourceId}-row-${i}`,
    postName: r.label,
    total: r.count,
    sourceEvidence: [
      {
        sourceId,
        url,
        value: r.count,
        confidence: 0.8,
        authorityRank,
        extractionMethod: "TEXT" as const,
        extractedAt,
      },
    ],
    manuallyEdited: false,
  }));
}

// ─── Readiness ────────────────────────────────────────────────

function computeReadiness(
  identity: RecruitmentIdentity,
  vacancies: VacancyData,
  dates: RecruitmentDates,
  conflicts: IntelligenceConflict[],
  missingFields: string[],
): DraftReadiness {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!identity.title.value) blocking.push("Missing recruitment title");
  if (!identity.notificationNumber.value)
    warnings.push("Missing notification number");
  if (vacancies.total?.value === undefined && vacancies.derivedTotal === undefined)
    warnings.push("Missing vacancy count");
  if (!dates.applicationCloseDate?.date)
    warnings.push("Missing application close date");
  if (conflicts.some((c) => c.severity === "BLOCKING"))
    blocking.push("Unresolved blocking conflicts");
  if (missingFields.length > 3)
    warnings.push(`${missingFields.length} fields could not be extracted`);

  return {
    readyForReview: blocking.length === 0,
    blockingIssues: blocking,
    warnings,
  };
}

// ─── Overall confidence ────────────────────────────────────────

function computeOverallConfidence(
  identity: RecruitmentIdentity,
  dates: RecruitmentDates,
  vacancies: VacancyData,
): number {
  const scores = [
    identity.title.confidence,
    identity.notificationNumber.confidence,
    dates.applicationCloseDate ? 0.8 : 0,
    vacancies.total?.confidence ?? (vacancies.derivedTotal ? 0.7 : 0),
  ];
  const nonZero = scores.filter((v) => v > 0);
  if (nonZero.length === 0) return 0;
  return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
}

// ─── Core mapper (exported for testing) ──────────────────────

export function mapExtractionsToDraft(
  sources: IntelligenceSource[],
  extractionEntries: ExtractionWithSource[],
): RecruitmentIntelligenceDraft {
  const now = new Date().toISOString();
  const conflicts: IntelligenceConflict[] = [];

  const sourceKindBySourceId = new Map<string, SourceKind>(
    sources.map((s) => [s.id, s.kind]),
  );

  // Helper: build evidence inputs for a scalar field across all extractions
  function inputs<T>(
    getter: (e: IntakeExtraction) => T | undefined,
  ): EvidenceInput<T>[] {
    return extractionEntries.map(({ source, extraction }) => ({
      value: getter(extraction),
      sourceId: source.id,
      url: source.url,
      confidence: extraction.confidence,
      authorityRank: extractionAuthorityRank(extraction.sourceKind),
    }));
  }

  // ─── Identity fields ─────────────────────────────────────────
  const titleFV = buildFieldValue(inputs((e) => e.title), now);
  const notifNumFV = buildFieldValue(inputs((e) => e.notificationNumber), now);

  if (titleFV.conflict)
    recordConflict(conflicts, "identity.title", titleFV as FieldValue<unknown>, sourceKindBySourceId);
  if (notifNumFV.conflict)
    recordConflict(conflicts, "identity.notificationNumber", notifNumFV as FieldValue<unknown>, sourceKindBySourceId);

  // ─── Organization from official domain registry ───────────────
  // organizationId comes from IntelligenceSource (set by classifySourceUrl during retrieval).
  // organizationName comes from the classification's orgName, passed through ExtractionWithSource.
  // Only official sources with a registry entry contribute; secondary sources don't.
  const orgIdInputs: EvidenceInput<string>[] = extractionEntries
    .filter((e) => e.source.organizationId)
    .map((e) => ({
      value: e.source.organizationId!,
      sourceId: e.source.id,
      url: e.source.url,
      confidence: 1.0,
      authorityRank: extractionAuthorityRank(e.extraction.sourceKind),
    }));

  const orgNameInputs: EvidenceInput<string>[] = extractionEntries
    .filter((e) => e.orgName)
    .map((e) => ({
      value: e.orgName!,
      sourceId: e.source.id,
      url: e.source.url,
      confidence: 1.0,
      authorityRank: extractionAuthorityRank(e.extraction.sourceKind),
    }));

  const orgIdFV = buildFieldValue(orgIdInputs, now);
  const orgNameFV = buildFieldValue(orgNameInputs, now);

  const identity: RecruitmentIdentity = {
    title: titleFV,
    shortTitle: emptyFieldValue(),
    organizationId: orgIdFV,
    organizationName: orgNameFV,
    recruitmentYear: emptyFieldValue(),
    notificationNumber: notifNumFV,
    advertisementNumber: emptyFieldValue(),
    recruitmentType: emptyFieldValue(),
  };

  // ─── Dates — through the same evidence/conflict mechanism ─────
  // Each date field is built via buildFieldValue<string> so conflicts
  // are preserved, never silently discarded.
  const dates: RecruitmentDates = {
    notificationDate: buildDateField(
      "dates.notificationDate",
      inputs((e) => e.postDate),
      now, conflicts, sourceKindBySourceId,
    ),
    applicationOpenDate: buildDateField(
      "dates.applicationOpenDate",
      inputs((e) => e.applicationOpenDate),
      now, conflicts, sourceKindBySourceId,
    ),
    applicationCloseDate: buildDateField(
      "dates.applicationCloseDate",
      inputs((e) => e.applicationCloseDate),
      now, conflicts, sourceKindBySourceId,
    ),
  };

  // ─── Vacancies ────────────────────────────────────────────────
  const sortedByAuthority = [...extractionEntries].sort(
    (a, b) =>
      extractionAuthorityRank(b.extraction.sourceKind) -
      extractionAuthorityRank(a.extraction.sourceKind),
  );

  const bestVacancyEntry = sortedByAuthority.find(
    ({ extraction: e }) => e.totalVacancies !== undefined,
  );

  let vacancies: VacancyData;
  if (!bestVacancyEntry) {
    vacancies = { rows: [] };
  } else {
    const { source: vs, extraction: ve } = bestVacancyEntry;
    const authorityRank = extractionAuthorityRank(ve.sourceKind);

    if (ve.vacancyDerived && ve.vacancyRows && ve.vacancyRows.length > 0) {
      // Source summed discipline rows; no explicit total was printed
      vacancies = {
        isIndicative: false,
        rows: buildVacancyRows(ve.vacancyRows, vs.id, vs.url, authorityRank, now),
        derivedTotal: ve.totalVacancies,
        derivedTotalExplanation: `Derived by summing ${ve.vacancyRows.length} discipline row${ve.vacancyRows.length === 1 ? "" : "s"}`,
      };
    } else {
      const vacTotalFV = buildFieldValue(inputs((e) => e.totalVacancies), now);
      if (vacTotalFV.conflict)
        recordConflict(conflicts, "vacancies.total", vacTotalFV as FieldValue<unknown>, sourceKindBySourceId);
      vacancies = {
        total: vacTotalFV,
        isIndicative: true,
        rows: ve.vacancyRows
          ? buildVacancyRows(ve.vacancyRows, vs.id, vs.url, authorityRank, now)
          : [],
      };
    }
  }

  // ─── Links ────────────────────────────────────────────────────
  const links: RecruitmentLink[] = [];
  const seenLinkUrls = new Set<string>();

  for (const { source, extraction } of extractionEntries) {
    if (extraction.notifPdfUrl && !seenLinkUrls.has(extraction.notifPdfUrl)) {
      seenLinkUrls.add(extraction.notifPdfUrl);
      links.push({
        type: "OFFICIAL_NOTIFICATION",
        label: "Official Notification PDF",
        url: extraction.notifPdfUrl,
        sourceId: source.id,
        official: source.kind === "OFFICIAL",
      });
    }
    for (const officialUrl of extraction.officialLinksFound) {
      if (!seenLinkUrls.has(officialUrl)) {
        seenLinkUrls.add(officialUrl);
        links.push({
          type: "OFFICIAL_WEBSITE",
          label: "Official Website",
          url: officialUrl,
          sourceId: source.id,
          official: true,
        });
      }
    }
  }

  // ─── Missing fields ───────────────────────────────────────────
  const missingFields: string[] = [];
  if (!identity.title.value) missingFields.push("identity.title");
  if (!identity.notificationNumber.value)
    missingFields.push("identity.notificationNumber");
  if (vacancies.total?.value === undefined && vacancies.derivedTotal === undefined)
    missingFields.push("vacancies.total");
  if (!dates.applicationCloseDate?.date) missingFields.push("dates.applicationCloseDate");
  if (!dates.applicationOpenDate?.date) missingFields.push("dates.applicationOpenDate");

  const overallConfidence = computeOverallConfidence(identity, dates, vacancies);
  const readiness = computeReadiness(identity, vacancies, dates, conflicts, missingFields);

  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    sources,
    identity,
    dates,
    vacancies,
    posts: [],
    postEligibility: [],
    links,
    lifecycle: [],
    conflicts,
    missingFields,
    overallConfidence,
    readiness,
  };
}

// ─── Source kind helpers ──────────────────────────────────────

function mapToPhase10SourceKind(
  kind: "OFFICIAL" | "THIRD_PARTY" | "UNKNOWN",
): SourceKind {
  if (kind === "OFFICIAL") return "OFFICIAL";
  if (kind === "THIRD_PARTY") return "SECONDARY";
  return "OTHER";
}

function toExtractionSourceKind(phase10Kind: SourceKind): ExtractionSourceKind {
  if (phase10Kind === "OFFICIAL") return "OFFICIAL_SPECIFIC";
  if (phase10Kind === "SECONDARY") return "THIRD_PARTY";
  return "UNKNOWN";
}

// ─── Main entry point ─────────────────────────────────────────

export async function buildDraft(
  urls: string[],
  retriever: SourceRetriever = new HttpRetriever(),
): Promise<RecruitmentIntelligenceDraft> {
  const sources: IntelligenceSource[] = [];
  const extractionEntries: ExtractionWithSource[] = [];

  for (const urlString of urls) {
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      continue;
    }

    if (!retriever.canHandle(url)) continue;

    const sourceId = randomUUID();
    const classification = classifySourceUrl(urlString);
    const kind = mapToPhase10SourceKind(classification.kind);

    const retrieved = await retriever.retrieve(url, sourceId, kind);
    sources.push(retrieved.source);

    if (!retrieved.success || !retrieved.html) continue;

    const extraction = extractIntakeFields(
      retrieved.html,
      urlString,
      undefined,
      undefined,
      toExtractionSourceKind(kind),
    );

    extractionEntries.push({
      source: retrieved.source,
      extraction,
      orgName: classification.orgName,
    });
  }

  return mapExtractionsToDraft(sources, extractionEntries);
}
