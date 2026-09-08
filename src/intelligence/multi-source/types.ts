// ═══════════════════════════════════════════════════════════
// Phase 9A: Multi-Source Discovery — Internal Types
// ═══════════════════════════════════════════════════════════

import type { SourceTier } from "../types";

// ─── Raw hit from one source adapter ─────────────────────────

export interface RawDiscovery {
  sourceId: string;
  sourceName: string;
  sourceTier: SourceTier;
  sourceUrl: string;
  organizationId: string;
  organizationName: string;
  title: string;
  href: string;
  notificationNumber?: string;
  normalizedNotifNumber: string;
  pdfUrl?: string;
  nearbyDate?: string;
  titleSimilarityKey: string;
  sourceUrlFingerprint: string;
  confidence: number;
  discoveredAt: string;
  rawExcerpt: string;
}

// ─── Clustering ───────────────────────────────────────────────

// MERGED:        Strong identity: exact notif# OR exact URL OR PDF hash match.
//                Safe to produce one candidate.
// POSSIBLE_MATCH: Title similarity >= 0.75 across sources — supporting signal only.
//                 Human must verify before treating as same recruitment.
// HELD:          No match basis, not enough evidence even for POSSIBLE_MATCH.
//                Not surfaced; logged only.
export type ClusterStatus = "MERGED" | "POSSIBLE_MATCH" | "HELD";

export interface DiscoveryCluster {
  clusterId: string;
  organizationId: string;
  status: ClusterStatus;
  mergeReason: string;
  titleSimilarityScore?: number;
  primaryHit: RawDiscovery;
  additionalHits: RawDiscovery[];
}

// ─── Source fetch result ──────────────────────────────────────

export type SourceFetchStatus =
  | "OK"
  | "EMPTY"
  | "UNAVAILABLE"
  | "BLOCKED"
  | "PARSE_ERROR";

export interface SourceFetchResult {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  status: SourceFetchStatus;
  hitCount: number;
  httpStatus?: number;
  error?: string;
  fetchedAt: string;
}

// ─── Source configuration ─────────────────────────────────────

export type DiscoveryAdapterType = "RSS" | "HTML_LINKS";

export interface MultiSourceConfig {
  id: string;
  name: string;
  type: DiscoveryAdapterType;
  url: string;
  tier: SourceTier;
  enabled: boolean;
  orgFilter?: string[];
  rateLimitDelayMs?: number;
  notes?: string;
}

// ─── Run result ───────────────────────────────────────────────

export interface MultiSourceRunResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  isDryRun: boolean;
  sourceResults: SourceFetchResult[];
  rawHitCount: number;
  clusterCount: number;
  mergedClusters: number;
  possibleMatchClusters: number;
  heldClusters: number;
  clusters: DiscoveryCluster[];
  candidatesProduced: number;
  candidatesSkipped: number;
  errors: Array<{ sourceId: string; message: string }>;
}
