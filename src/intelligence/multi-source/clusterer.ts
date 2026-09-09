// ═══════════════════════════════════════════════════════════
// Phase 9A: Safe Clustering
// ═══════════════════════════════════════════════════════════
//
// Groups RawDiscovery items from multiple sources into clusters.
//
// STRONG IDENTITY (→ MERGED):
//   - Exact normalized notification number (same org)
//   - Exact source URL fingerprint (same org)
//
// SUPPORTING SIGNAL ONLY (→ POSSIBLE_MATCH):
//   - Title bigram similarity >= 0.75 (same org, different notif numbers)
//   Fuzzy title similarity ALONE is never sufficient to merge two
//   recruitments. It produces POSSIBLE_MATCH, requiring human review.
//
// When evidence is ambiguous: prefer HELD / POSSIBLE_MATCH over
// incorrectly collapsing two different recruitments.
// False deduplication is more dangerous than duplicate candidates.

import { createHash } from "node:crypto";
import { bigramJaccard } from "../dedup";
import type { RawDiscovery, DiscoveryCluster, ClusterStatus } from "./types";

// ─── Cluster ID ───────────────────────────────────────────────

function makeClusterId(primaryHit: RawDiscovery): string {
  return createHash("sha256")
    .update(`${primaryHit.organizationId}::${primaryHit.normalizedNotifNumber}`)
    .digest("hex")
    .slice(0, 12);
}

// ─── Merge check ─────────────────────────────────────────────

interface MergeResult {
  shouldMerge: boolean;
  status: ClusterStatus;
  reason: string;
  titleSimilarityScore?: number;
}

function checkMergability(a: RawDiscovery, b: RawDiscovery): MergeResult {
  if (a.organizationId !== b.organizationId) {
    return { shouldMerge: false, status: "HELD", reason: "different org" };
  }

  // Strong identity: exact normalized notification number
  if (
    a.normalizedNotifNumber &&
    b.normalizedNotifNumber &&
    a.normalizedNotifNumber === b.normalizedNotifNumber &&
    a.normalizedNotifNumber.length >= 4
  ) {
    return {
      shouldMerge: true,
      status: "MERGED",
      reason: `exact notif number: ${a.normalizedNotifNumber}`,
    };
  }

  // Strong identity: exact URL fingerprint
  if (
    a.sourceUrlFingerprint &&
    b.sourceUrlFingerprint &&
    a.sourceUrlFingerprint === b.sourceUrlFingerprint &&
    a.sourceUrlFingerprint.length > 10
  ) {
    return {
      shouldMerge: true,
      status: "MERGED",
      reason: `exact URL fingerprint: ${a.sourceUrlFingerprint.slice(0, 60)}`,
    };
  }

  // Fuzzy title similarity — SUPPORTING SIGNAL ONLY, never sufficient alone
  const sim = bigramJaccard(a.titleSimilarityKey, b.titleSimilarityKey);
  if (sim >= 0.75) {
    return {
      shouldMerge: true,
      status: "POSSIBLE_MATCH",
      reason: `title similarity ${(sim * 100).toFixed(0)}% (supporting signal only — verify manually)`,
      titleSimilarityScore: sim,
    };
  }

  return { shouldMerge: false, status: "HELD", reason: "no identity match" };
}

// ─── Union-Find ───────────────────────────────────────────────

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    if (this.rank[rx] < this.rank[ry]) {
      this.parent[rx] = ry;
    } else if (this.rank[rx] > this.rank[ry]) {
      this.parent[ry] = rx;
    } else {
      this.parent[ry] = rx;
      this.rank[rx]++;
    }
  }
}

// ─── Primary hit selection ────────────────────────────────────

function selectPrimaryHit(hits: RawDiscovery[]): RawDiscovery {
  // Prefer: lower tier number (more official) > higher confidence > more fields
  return hits.reduce((best, hit) => {
    if (hit.sourceTier < best.sourceTier) return hit;
    if (hit.sourceTier === best.sourceTier) {
      if (hit.confidence > best.confidence) return hit;
      if (hit.confidence === best.confidence && hit.notificationNumber && !best.notificationNumber) return hit;
    }
    return best;
  });
}

// ─── Main cluster function ────────────────────────────────────

export function clusterDiscoveries(items: RawDiscovery[]): DiscoveryCluster[] {
  if (items.length === 0) return [];

  const n = items.length;
  const uf = new UnionFind(n);

  // Track the best merge result for each pair that gets merged
  const mergeInfo = new Map<string, MergeResult>();

  // Two-pass: first MERGED (strong identity), then POSSIBLE_MATCH (fuzzy)
  // Items merged by strong identity in pass 1 are already in the same component
  // in pass 2, so fuzzy matches between items in the same component are no-ops.

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const result = checkMergability(items[i], items[j]);
      if (!result.shouldMerge) continue;
      if (result.status !== "MERGED") continue;
      uf.union(i, j);
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      mergeInfo.set(key, result);
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (uf.find(i) === uf.find(j)) continue; // already in same component
      const result = checkMergability(items[i], items[j]);
      if (!result.shouldMerge) continue;
      uf.union(i, j);
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      mergeInfo.set(key, result);
    }
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const group = groups.get(root) ?? [];
    group.push(i);
    groups.set(root, group);
  }

  const clusters: DiscoveryCluster[] = [];

  for (const [, members] of groups) {
    const hits = members.map((i) => items[i]);

    let clusterStatus: ClusterStatus = "MERGED";
    let clusterReason = "single source";
    let titleSimilarityScore: number | undefined;

    if (members.length > 1) {
      // Determine the weakest merge reason across all pair merges in this group
      let hasPossibleMatch = false;
      let hasMerged = false;
      const reasons: string[] = [];

      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const key = `${Math.min(members[i], members[j])}-${Math.max(members[i], members[j])}`;
          const info = mergeInfo.get(key);
          if (info) {
            if (info.status === "MERGED") hasMerged = true;
            if (info.status === "POSSIBLE_MATCH") {
              hasPossibleMatch = true;
              if (info.titleSimilarityScore !== undefined) {
                titleSimilarityScore = Math.max(titleSimilarityScore ?? 0, info.titleSimilarityScore);
              }
            }
            reasons.push(info.reason);
          }
        }
      }

      // If ANY merge was only by fuzzy title, the whole cluster is POSSIBLE_MATCH
      if (hasPossibleMatch && !hasMerged) {
        clusterStatus = "POSSIBLE_MATCH";
        clusterReason = reasons.filter((r) => r.includes("similarity")).join("; ") || "title similarity";
      } else if (hasMerged) {
        clusterStatus = "MERGED";
        clusterReason = reasons.filter((r) => !r.includes("similarity")).join("; ") || "strong identity";
      }
    }

    const primary = selectPrimaryHit(hits);
    const additional = hits.filter((h) => h !== primary);

    clusters.push({
      clusterId: makeClusterId(primary),
      organizationId: primary.organizationId,
      status: clusterStatus,
      mergeReason: clusterReason,
      titleSimilarityScore,
      primaryHit: primary,
      additionalHits: additional,
    });
  }

  return clusters;
}

export { checkMergability };
