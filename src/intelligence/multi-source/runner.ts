// ═══════════════════════════════════════════════════════════
// Phase 9A: Multi-Source Discovery Runner
// ═══════════════════════════════════════════════════════════
//
// Orchestrates multi-source discovery:
//   1. Fetch each configured source (RSS or HTML_LINKS)
//   2. Cluster RawDiscovery items across all sources
//   3. Convert clusters to CandidateNewRecruitment objects
//   4. Deduplicate against canonical records + existing candidates
//   5. In dry-run mode (default): write report, do NOT create PRs
//
// INVARIANTS:
//   - Never writes to government.ts or any canonical data file
//   - Never creates GitHub PRs automatically
//   - Scheduler must remain disabled; this is CLI-triggered only
//   - Third-party sources may contribute additionalSourceIds only —
//     primarySourceUrl on a candidate must come from the highest-tier
//     source that found the notice (tier 3+ preferred over tier 5)

import { randomUUID } from "node:crypto";
import type { GovernmentRecruitment } from "@/types";
import type { CandidateNewRecruitment } from "../types";
import {
  buildCandidateId,
  isDuplicateOfCanonical,
  isDuplicateCandidate,
  normalizeNotificationNumber,
  normalizeSourceUrl,
  buildTitleSimilarityKey,
} from "../dedup";
import { RssAdapter } from "./adapters/rss-adapter";
import { HtmlLinkAdapter } from "./adapters/html-link-adapter";
import { clusterDiscoveries } from "./clusterer";
import type {
  MultiSourceConfig,
  MultiSourceRunResult,
  RawDiscovery,
  DiscoveryCluster,
  SourceFetchResult,
} from "./types";

// ─── Adapter factory ──────────────────────────────────────────

function makeAdapter(config: MultiSourceConfig) {
  if (config.type === "RSS") return new RssAdapter(config.id);
  return new HtmlLinkAdapter(config.id);
}

// ─── Evidence merger ──────────────────────────────────────────

function mergeToCandidateSource(cluster: DiscoveryCluster): {
  primarySourceId: string;
  primarySourceUrl: string;
  primarySourceTier: number;
  additionalSourceIds: string[];
} {
  const all = [cluster.primaryHit, ...cluster.additionalHits];

  // Pick the most authoritative source URL (lowest tier number = most official)
  const best = all.reduce((acc, hit) =>
    hit.sourceTier < acc.sourceTier ? hit : acc
  );

  const additionalSourceIds = all
    .filter((h) => h.sourceId !== best.sourceId)
    .map((h) => h.sourceId);

  return {
    primarySourceId: best.sourceId,
    primarySourceUrl: best.sourceUrl,
    primarySourceTier: best.sourceTier,
    additionalSourceIds,
  };
}

// ─── Cluster → CandidateNewRecruitment ────────────────────────

function buildCandidate(
  cluster: DiscoveryCluster,
  existingCandidates: CandidateNewRecruitment[]
): CandidateNewRecruitment {
  const hit = cluster.primaryHit;
  const all = [hit, ...cluster.additionalHits];

  // Prefer the hit with the most extracted information
  const richest = all.reduce((best, h) => {
    const score =
      (h.notificationNumber ? 2 : 0) +
      (h.nearbyDate ? 1 : 0) +
      (h.pdfUrl ? 2 : 0) +
      h.confidence;
    const bestScore =
      (best.notificationNumber ? 2 : 0) +
      (best.nearbyDate ? 1 : 0) +
      (best.pdfUrl ? 2 : 0) +
      best.confidence;
    return score > bestScore ? h : best;
  });

  const { primarySourceId, primarySourceUrl, additionalSourceIds } = mergeToCandidateSource(cluster);

  // Use richest hit for field extraction, best hit for source attribution
  const title = richest.title ?? hit.title;
  const notifPdfUrl = richest.pdfUrl ?? hit.pdfUrl;
  const postDate = richest.nearbyDate ?? hit.nearbyDate;
  const notificationNumber = richest.notificationNumber ?? hit.notificationNumber;
  const normalizedNotifNumber = richest.normalizedNotifNumber;

  const candidateId = buildCandidateId(hit.organizationId, normalizedNotifNumber);

  // Composite confidence: average confidence + corroboration bonus
  const avgConfidence = all.reduce((s, h) => s + h.confidence, 0) / all.length;
  const corroborationBonus = Math.min(0.1, (all.length - 1) * 0.05);
  const confidence = Math.min(1.0, avgConfidence + corroborationBonus);

  const clusterNote =
    cluster.status === "POSSIBLE_MATCH"
      ? ` POSSIBLE_MATCH: ${cluster.mergeReason}. Human verification required before treating as same recruitment.`
      : cluster.additionalHits.length > 0
      ? ` Corroborated by ${cluster.additionalHits.length} additional source(s): ${cluster.additionalHits.map((h) => h.sourceName).join(", ")}.`
      : "";

  return {
    candidateId,
    discoverySourceId: primarySourceId,
    discoverySourceUrl: primarySourceUrl,
    discoverySourceTier: hit.sourceTier,
    discoveredAt: hit.discoveredAt,
    organizationId: hit.organizationId,
    organizationName: hit.organizationName,
    additionalSourceIds: additionalSourceIds.length > 0 ? additionalSourceIds : undefined,
    title,
    notificationNumber,
    notifPdfUrl,
    postDate,
    normalizedNotifNumber,
    sourceUrlFingerprint: normalizeSourceUrl(notifPdfUrl ?? richest.href),
    titleSimilarityKey: buildTitleSimilarityKey(title ?? ""),
    rawExcerpt: (richest.rawExcerpt + clusterNote).slice(0, 500),
    confidence,
    status: cluster.status === "POSSIBLE_MATCH" ? "PENDING_REVIEW" : "PENDING_REVIEW",
  };
}

// ─── Main runner ──────────────────────────────────────────────

export async function runMultiSourceDiscovery(
  sources: MultiSourceConfig[],
  canonicalRecords: GovernmentRecruitment[],
  existingCandidates: CandidateNewRecruitment[],
  options: { isDryRun: boolean } = { isDryRun: true }
): Promise<MultiSourceRunResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  const sourceResults: SourceFetchResult[] = [];
  const allDiscoveries: RawDiscovery[] = [];
  const errors: Array<{ sourceId: string; message: string }> = [];

  // Phase 1: Fetch all sources
  for (const config of sources) {
    const adapter = makeAdapter(config);
    try {
      const { fetchResult, discoveries } = await adapter.fetch(config);
      sourceResults.push(fetchResult);
      allDiscoveries.push(...discoveries);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ sourceId: config.id, message: msg });
      sourceResults.push({
        sourceId: config.id,
        sourceName: config.name,
        sourceUrl: config.url,
        status: "UNAVAILABLE",
        hitCount: 0,
        fetchedAt: new Date().toISOString(),
        error: msg,
      });
    }
  }

  // Phase 2: Cluster
  const clusters = clusterDiscoveries(allDiscoveries);

  const mergedClusters = clusters.filter((c) => c.status === "MERGED").length;
  const possibleMatchClusters = clusters.filter((c) => c.status === "POSSIBLE_MATCH").length;
  const heldClusters = clusters.filter((c) => c.status === "HELD").length;

  // Phase 3: Convert clusters to candidates (dedup against canonical + in-flight)
  let candidatesProduced = 0;
  let candidatesSkipped = 0;
  const producedCandidates: CandidateNewRecruitment[] = [];

  for (const cluster of clusters) {
    // HELD clusters are not surfaced
    if (cluster.status === "HELD") continue;

    const candidate = buildCandidate(cluster, existingCandidates);

    // Dedup against canonical
    const canonicalCheck = isDuplicateOfCanonical(candidate, canonicalRecords);
    if (canonicalCheck.isDuplicate) {
      candidatesSkipped++;
      continue;
    }

    // Dedup against already-produced candidates this run + existing in-flight
    if (isDuplicateCandidate(candidate, [...existingCandidates, ...producedCandidates])) {
      candidatesSkipped++;
      continue;
    }

    producedCandidates.push(candidate);
    candidatesProduced++;
  }

  const completedAt = new Date().toISOString();

  return {
    runId,
    startedAt,
    completedAt,
    isDryRun: options.isDryRun,
    sourceResults,
    rawHitCount: allDiscoveries.length,
    clusterCount: clusters.length,
    mergedClusters,
    possibleMatchClusters,
    heldClusters,
    clusters: clusters.map((c) => ({
      ...c,
      // Attach the candidate that was/would-be produced for this cluster
      candidate: producedCandidates.find(
        (p) => p.candidateId === buildCandidateId(c.primaryHit.organizationId, c.primaryHit.normalizedNotifNumber)
      ),
    })) as DiscoveryCluster[],
    candidatesProduced,
    candidatesSkipped,
    errors,
  };
}
