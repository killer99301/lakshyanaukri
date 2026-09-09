// Tests for Phase 9A safe clustering logic.
// Key invariant: fuzzy title similarity alone NEVER produces MERGED status.

import { clusterDiscoveries, checkMergability } from "../../../src/intelligence/multi-source/clusterer";
import type { RawDiscovery } from "../../../src/intelligence/multi-source/types";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

function hit(overrides: Partial<RawDiscovery> = {}): RawDiscovery {
  return {
    sourceId: "test-source",
    sourceName: "Test Source",
    sourceTier: 5,
    sourceUrl: "https://example.com",
    organizationId: "ssc",
    organizationName: "Staff Selection Commission",
    title: "SSC CGL 2026 Notification",
    href: "https://ssc.gov.in/sscnotice",
    notificationNumber: "CGL/2026",
    normalizedNotifNumber: "CGL2026",
    titleSimilarityKey: "ssccgl2026notification",
    sourceUrlFingerprint: "ssc.gov.in/sscnotice",
    confidence: 0.6,
    discoveredAt: "2026-09-08T10:00:00.000Z",
    rawExcerpt: "SSC CGL 2026",
    ...overrides,
  };
}

// ─── checkMergability ─────────────────────────────────────────

console.log("\n=== checkMergability ===");

assert(
  "exact notif number → MERGED",
  checkMergability(
    hit({ normalizedNotifNumber: "CGL2026" }),
    hit({ normalizedNotifNumber: "CGL2026", sourceId: "other" })
  ).status === "MERGED"
);

assert(
  "different orgs → no merge",
  !checkMergability(
    hit({ organizationId: "ssc" }),
    hit({ organizationId: "ibps" })
  ).shouldMerge
);

assert(
  "fuzzy title >= 0.75 → POSSIBLE_MATCH, not MERGED",
  (() => {
    // "ibpsponotification2026" vs "ibpsponotifications2026" → bigram sim ~0.955 (>= 0.75)
    // Different notif numbers AND different URL fingerprints → only title similarity fires
    const r = checkMergability(
      hit({
        normalizedNotifNumber: "IBPSPO2026A",
        sourceUrlFingerprint: "ibps.in/notice-a",
        titleSimilarityKey: "ibpsponotification2026",
        organizationId: "ibps",
      }),
      hit({
        normalizedNotifNumber: "IBPSPO2026B",
        sourceUrlFingerprint: "ibps.in/notice-b",
        titleSimilarityKey: "ibpsponotifications2026",
        organizationId: "ibps",
      })
    );
    return r.shouldMerge && r.status === "POSSIBLE_MATCH";
  })()
);

assert(
  "title similarity alone never produces MERGED",
  (() => {
    // Same title key, different notif numbers, different URL fingerprints
    const r = checkMergability(
      hit({
        normalizedNotifNumber: "ADVT12026",
        sourceUrlFingerprint: "ssc.gov.in/notice-1",
        titleSimilarityKey: "ssccgl2026notification",
      }),
      hit({
        normalizedNotifNumber: "ADVT22026",
        sourceUrlFingerprint: "ssc.gov.in/notice-2",
        titleSimilarityKey: "ssccgl2026notification",
      })
    );
    return r.status !== "MERGED";
  })()
);

assert(
  "exact URL fingerprint → MERGED",
  (() => {
    const r = checkMergability(
      hit({ normalizedNotifNumber: "X1AAAA", sourceUrlFingerprint: "ssc.gov.in/cgl-2026.pdf" }),
      hit({ normalizedNotifNumber: "X2AAAA", sourceUrlFingerprint: "ssc.gov.in/cgl-2026.pdf" })
    );
    return r.status === "MERGED";
  })()
);

assert(
  "short normalizedNotifNumber (< 4 chars) not treated as strong identity",
  (() => {
    // "CGL" is 3 chars — below the 4-char threshold; must also have different URL fingerprints
    const r = checkMergability(
      hit({ normalizedNotifNumber: "CGL", sourceUrlFingerprint: "ssc.gov.in/page-1" }),
      hit({ normalizedNotifNumber: "CGL", sourceId: "other", sourceUrlFingerprint: "ssc.gov.in/page-2" })
    );
    return r.status !== "MERGED";
  })()
);

// ─── clusterDiscoveries ───────────────────────────────────────

console.log("\n=== clusterDiscoveries ===");

assert("empty input → empty output", clusterDiscoveries([]).length === 0);

assert(
  "single item → one MERGED cluster",
  (() => {
    const clusters = clusterDiscoveries([hit()]);
    return clusters.length === 1 && clusters[0].status === "MERGED";
  })()
);

assert(
  "two items with same notif# → one MERGED cluster",
  (() => {
    const a = hit({ sourceId: "s1", normalizedNotifNumber: "CGL2026" });
    const b = hit({ sourceId: "s2", normalizedNotifNumber: "CGL2026" });
    const clusters = clusterDiscoveries([a, b]);
    return clusters.length === 1 && clusters[0].status === "MERGED";
  })()
);

assert(
  "two items with different notif# but similar title → POSSIBLE_MATCH",
  (() => {
    const a = hit({
      sourceId: "s1",
      normalizedNotifNumber: "SSCNOTIF12026",
      sourceUrlFingerprint: "ssc.gov.in/notif-1",
      titleSimilarityKey: "ssccgl2026notification",
    });
    const b = hit({
      sourceId: "s2",
      normalizedNotifNumber: "SSCNOTIF22026",
      sourceUrlFingerprint: "ssc.gov.in/notif-2",
      titleSimilarityKey: "ssccgl2026notifications",
    });
    const clusters = clusterDiscoveries([a, b]);
    return clusters.length === 1 && clusters[0].status === "POSSIBLE_MATCH";
  })()
);

assert(
  "two items from different orgs → two separate clusters",
  (() => {
    const a = hit({ organizationId: "ssc", normalizedNotifNumber: "CGL2026" });
    const b = hit({ organizationId: "ibps", normalizedNotifNumber: "CGL2026" });
    const clusters = clusterDiscoveries([a, b]);
    return clusters.length === 2;
  })()
);

assert(
  "three items: two MERGED via notif#, third unrelated → two clusters",
  (() => {
    const a = hit({ sourceId: "s1", normalizedNotifNumber: "CGL2026", sourceUrlFingerprint: "ssc.gov.in/cgl-1" });
    const b = hit({ sourceId: "s2", normalizedNotifNumber: "CGL2026", sourceUrlFingerprint: "ssc.gov.in/cgl-2" });
    const c = hit({
      sourceId: "s3",
      normalizedNotifNumber: "CHSL2026",
      sourceUrlFingerprint: "ssc.gov.in/chsl-1",
      titleSimilarityKey: "sscchsl2026",
    });
    const clusters = clusterDiscoveries([a, b, c]);
    return clusters.length === 2;
  })()
);

assert(
  "primary hit is the highest-tier source",
  (() => {
    const tier5 = hit({ sourceId: "aggregator", sourceTier: 5, normalizedNotifNumber: "CGL2026" });
    const tier3 = hit({ sourceId: "official", sourceTier: 3, normalizedNotifNumber: "CGL2026" });
    const clusters = clusterDiscoveries([tier5, tier3]);
    return clusters[0].primaryHit.sourceId === "official";
  })()
);

// ─── Summary ─────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
