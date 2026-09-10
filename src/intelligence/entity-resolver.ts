// ═══════════════════════════════════════════════════════════
// Phase 9D: Multi-Source Entity Resolution
// ═══════════════════════════════════════════════════════════
//
// Takes N IntakeResult objects (from N URLs or PDFs submitted
// together) and groups them by recruitment entity, then merges
// the highest-authority fields across all results in each group.
//
// INVARIANTS:
//   - Never modifies input IntakeResult objects
//   - Merge rules mirror scheduled-intake.ts: OFFICIAL_PDF >
//     OFFICIAL_SPECIFIC > OFFICIAL_GENERIC > THIRD_PARTY > UNKNOWN
//   - A group is "ambiguous" if org or notif number is unknown
//     AND multiple results could be different recruitments
//   - Local file paths NEVER appear in merged fields
// ═══════════════════════════════════════════════════════════

import type { IntakeResult } from "./intake";

// ─── Types ───────────────────────────────────────────────────

export interface MergedFields {
  title?: string;
  notificationNumber?: string;
  organizationId?: string;
  organizationName?: string;
  totalVacancies?: number;
  applicationOpenDate?: string;
  applicationCloseDate?: string;
  postDate?: string;
  notifPdfUrl?: string;
  primarySourceUrl?: string;
  fieldSources: Record<string, string>;
  confidence: number;
  officialSourceFound: boolean;
  officialSourceUrl?: string;
  trustGatePassed: boolean;
  trustGateErrors: string[];
  trustGateWarnings: string[];
  missingFields: string[];
  analysisNotes: string[];
  evidenceChainSummary: string[];
}

export interface EntityGroup {
  mergeKey: string;
  results: IntakeResult[];
  merged: MergedFields;
  ambiguous: boolean;
  ambiguityReason?: string;
}

// ─── Authority ranking ────────────────────────────────────────

const AUTHORITY: Record<string, number> = {
  OFFICIAL_PDF: 4,
  OFFICIAL_SPECIFIC: 3,
  OFFICIAL_GENERIC: 2,
  THIRD_PARTY: 1,
  UNKNOWN: 0,
};

function rank(source: string | undefined): number {
  return AUTHORITY[source ?? ""] ?? 0;
}

// ─── Merge key derivation ─────────────────────────────────────

function normalizeNotif(s: string | undefined): string {
  if (!s) return "";
  return s.toUpperCase().replace(/[\s\-\/]+/g, "-").trim();
}

function deriveMergeKey(result: IntakeResult): string {
  const orgId = result.classification.orgId ?? "unknown";
  const notif = normalizeNotif(result.extraction.notificationNumber) || "unknown";
  return `${orgId}::${notif}`;
}

// ─── Field merger ─────────────────────────────────────────────

function bestField<T>(
  results: IntakeResult[],
  getter: (r: IntakeResult) => T | undefined,
  fieldName: string
): { value: T | undefined; source: string | undefined } {
  let bestValue: T | undefined;
  let bestRank = -1;
  let bestSource: string | undefined;
  for (const r of results) {
    const v = getter(r);
    if (v === undefined || v === null) continue;
    const src = r.fieldSources[fieldName] ?? "UNKNOWN";
    const rk = rank(src);
    if (rk > bestRank) {
      bestRank = rk;
      bestValue = v;
      bestSource = src;
    }
  }
  return { value: bestValue, source: bestSource };
}

function buildMerged(results: IntakeResult[]): MergedFields {
  const bf = <T>(getter: (r: IntakeResult) => T | undefined, field: string) =>
    bestField(results, getter, field);

  const title          = bf((r) => r.extraction.title, "title");
  const notif          = bf((r) => r.extraction.notificationNumber, "notificationNumber");
  const vacancies      = bf((r) => r.extraction.totalVacancies, "totalVacancies");
  const openDate       = bf((r) => r.extraction.applicationOpenDate, "applicationOpenDate");
  const closeDate      = bf((r) => r.extraction.applicationCloseDate, "applicationCloseDate");
  const postDate       = bf((r) => r.extraction.postDate, "postDate");
  const pdfUrl         = bf((r) => r.extraction.notifPdfUrl, "notifPdfUrl");
  const orgId          = bf((r) => r.classification.orgId, "organizationId");
  const orgName        = bf((r) => r.classification.orgName, "organizationName");

  // Merge field sources (keep highest authority per field)
  const fieldSources: Record<string, string> = {};
  if (title.source)    fieldSources.title = title.source;
  if (notif.source)    fieldSources.notificationNumber = notif.source;
  if (vacancies.source) fieldSources.totalVacancies = vacancies.source;
  if (openDate.source) fieldSources.applicationOpenDate = openDate.source;
  if (closeDate.source) fieldSources.applicationCloseDate = closeDate.source;
  if (postDate.source) fieldSources.postDate = postDate.source;
  if (pdfUrl.source)   fieldSources.notifPdfUrl = pdfUrl.source;

  // Best official source
  const bestOfficial = results.find((r) => r.officialSource.found);
  const officialSourceFound = !!bestOfficial;
  const officialSourceUrl = bestOfficial?.officialSource.url;
  const primarySourceUrl =
    officialSourceUrl ??
    results.find((r) => r.draft?.provenance.primarySourceUrl)?.draft?.provenance.primarySourceUrl;

  // Trust Gate: prefer passing result; fallback to first
  const passingResult = results.find((r) => r.trustGatePassed) ?? results[0];

  // Missing fields: intersection — only fields missing in ALL results
  const missingSetsList = results.map((r) => new Set(r.missingFields));
  const intersectedMissing =
    missingSetsList.length === 0
      ? []
      : [...missingSetsList[0]].filter((f) => missingSetsList.every((s) => s.has(f)));

  // Confidence: best across all results
  const confidence = Math.max(...results.map((r) => r.extraction.confidence));

  // Analysis notes: deduplicated union
  const analysisNotes = [...new Set(results.flatMap((r) => r.analysisNotes))];

  // Evidence chain: deduplicated summary lines
  const seen = new Set<string>();
  const evidenceChainSummary: string[] = [];
  for (const r of results) {
    for (const step of r.evidenceChain) {
      const line = `[${step.sourceKind}] ${step.label}${
        step.fieldsContributed.length ? ` — ${step.fieldsContributed.join(", ")}` : ""
      }`;
      if (!seen.has(line)) {
        seen.add(line);
        evidenceChainSummary.push(line);
      }
    }
  }

  return {
    title: title.value,
    notificationNumber: notif.value,
    organizationId: orgId.value,
    organizationName: orgName.value,
    totalVacancies: vacancies.value,
    applicationOpenDate: openDate.value,
    applicationCloseDate: closeDate.value,
    postDate: postDate.value,
    notifPdfUrl: pdfUrl.value,
    primarySourceUrl,
    fieldSources,
    confidence,
    officialSourceFound,
    officialSourceUrl,
    trustGatePassed: passingResult.trustGatePassed,
    trustGateErrors: passingResult.trustGateErrors.map((e) => e.message),
    trustGateWarnings: passingResult.trustGateWarnings.map((w) => w.message),
    missingFields: intersectedMissing,
    analysisNotes,
    evidenceChainSummary,
  };
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Group intake results by recruitment entity and merge fields.
 *
 * Results sharing the same (orgId, normalizedNotifNumber) are
 * consolidated into one EntityGroup. Ambiguity is flagged when
 * the merge key has unknown components and multiple results exist.
 */
export function resolveEntities(results: IntakeResult[]): EntityGroup[] {
  if (results.length === 0) return [];

  const groups = new Map<string, IntakeResult[]>();
  for (const r of results) {
    const key = deriveMergeKey(r);
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, r]);
  }

  return [...groups.entries()].map(([key, groupResults]) => {
    const [orgPart, notifPart] = key.split("::");
    const ambiguous =
      groupResults.length > 1 &&
      (orgPart === "unknown" || notifPart === "unknown");
    const ambiguityReason = ambiguous
      ? `${orgPart === "unknown" ? "Organization" : "Notification number"} could not be determined — sources may belong to different recruitments`
      : undefined;

    return {
      mergeKey: key,
      results: groupResults,
      merged: buildMerged(groupResults),
      ambiguous,
      ambiguityReason,
    };
  });
}
