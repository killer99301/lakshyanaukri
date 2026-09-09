#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// Phase 9A: Multi-Source Discovery CLI
// ═══════════════════════════════════════════════════════════
//
// Usage:
//   npx tsx scripts/run-multi-source-discovery.ts [--dry-run] [--source <id>]
//
// Flags:
//   --dry-run     (default) Show what would be discovered. No writes.
//   --source <id> Only run this source (e.g. freejobalert-rss).
//
// SAFETY RULES (enforced in code, not just docs):
//   - Does NOT write to government.ts or any canonical data
//   - Does NOT create GitHub PRs automatically
//   - Does NOT enable any scheduler
//   - Third-party sources are discovery/corroboration only
//   - Official source remains authoritative

import * as path from "node:path";
import * as fs from "node:fs";
import { getAllOpportunities } from "@/lib/repository";
import { runMultiSourceDiscovery } from "../src/intelligence/multi-source/runner";
import { getEnabledSources } from "../src/intelligence/multi-source/source-config";
import type { MultiSourceRunResult, SourceFetchStatus } from "../src/intelligence/multi-source/types";

// ─── Args ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = !args.includes("--live"); // dry-run is the default
const sourceFilter = (() => {
  const idx = args.indexOf("--source");
  return idx >= 0 ? args[idx + 1] : undefined;
})();

// ─── Load existing candidates ─────────────────────────────────

const CANDIDATES_PATH = path.join(process.cwd(), "intelligence-runs", "discovery-candidates.json");

function loadExistingCandidates() {
  if (!fs.existsSync(CANDIDATES_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf-8"));
    return Array.isArray(raw.candidates) ? raw.candidates : [];
  } catch {
    return [];
  }
}

// ─── Formatting ───────────────────────────────────────────────

const STATUS_SYMBOLS: Record<SourceFetchStatus, string> = {
  OK:          "  OK",
  EMPTY:       "  EMPTY",
  UNAVAILABLE: "  UNAVAILABLE",
  BLOCKED:     "  BLOCKED",
  PARSE_ERROR: "  PARSE_ERROR",
};

function printReport(result: MultiSourceRunResult): void {
  const hr = "─".repeat(60);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Phase 9A Multi-Source Discovery`);
  console.log(`Run ID: ${result.runId}`);
  console.log(`Mode:   ${result.isDryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Start:  ${result.startedAt}`);
  console.log(`End:    ${result.completedAt}`);
  console.log(`${"═".repeat(60)}\n`);

  // Source health
  console.log("SOURCE RESULTS");
  console.log(hr);
  for (const sr of result.sourceResults) {
    const sym = STATUS_SYMBOLS[sr.status] ?? `  ${sr.status}`;
    const hits = sr.hitCount > 0 ? `  (${sr.hitCount} hits)` : "";
    const err = sr.error ? `  — ${sr.error.slice(0, 80)}` : "";
    console.log(`${sym.padEnd(16)} ${sr.sourceName}${hits}${err}`);
  }

  if (result.errors.length > 0) {
    console.log("\nERRORS");
    console.log(hr);
    for (const e of result.errors) {
      console.log(`  [${e.sourceId}] ${e.message}`);
    }
  }

  // Cluster summary
  console.log(`\nCLUSTERING`);
  console.log(hr);
  console.log(`  Raw hits:            ${result.rawHitCount}`);
  console.log(`  Clusters:            ${result.clusterCount}`);
  console.log(`    MERGED:            ${result.mergedClusters}  (strong identity — safe to produce candidate)`);
  console.log(`    POSSIBLE_MATCH:    ${result.possibleMatchClusters}  (fuzzy title only — verify manually)`);
  console.log(`    HELD:              ${result.heldClusters}  (no identity basis — not surfaced)`);
  console.log(`  Candidates produced: ${result.candidatesProduced}`);
  console.log(`  Candidates skipped:  ${result.candidatesSkipped}  (already in canonical or in-flight)`);

  // Per-cluster detail
  if (result.clusters.length > 0) {
    console.log(`\nDISCOVERED CLUSTERS`);
    console.log(hr);
    let n = 0;
    for (const cluster of result.clusters) {
      if (cluster.status === "HELD") continue;
      n++;
      const badge = cluster.status === "MERGED" ? "[MERGED]" : "[POSSIBLE_MATCH]";
      const sources = [cluster.primaryHit, ...cluster.additionalHits]
        .map((h) => `${h.sourceName} (tier ${h.sourceTier})`)
        .join(", ");
      console.log(`\n  ${n}. ${badge} ${cluster.organizationId.toUpperCase()}`);
      console.log(`     Title:    ${cluster.primaryHit.title.slice(0, 100)}`);
      console.log(`     Notif#:   ${cluster.primaryHit.notificationNumber ?? "(not extracted)"}`);
      console.log(`     Date:     ${cluster.primaryHit.nearbyDate ?? "(not found)"}`);
      console.log(`     Sources:  ${sources}`);
      console.log(`     Reason:   ${cluster.mergeReason}`);
      if (cluster.status === "POSSIBLE_MATCH") {
        console.log(`     WARNING:  Title similarity only. Do NOT treat as same recruitment without manual verification.`);
      }
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  if (result.isDryRun) {
    console.log(`DRY RUN COMPLETE — no data was written.`);
    console.log(`To see what would be produced, review the clusters above.`);
  }
  console.log(`${"═".repeat(60)}\n`);
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Loading canonical records...");
  const canonicalRecords = getAllOpportunities().filter(
    (o): o is import("../src/types").GovernmentRecruitment => o.type === "government"
  );
  console.log(`  ${canonicalRecords.length} canonical records loaded.`);

  console.log("Loading existing candidates...");
  const existingCandidates = loadExistingCandidates();
  console.log(`  ${existingCandidates.length} existing candidates loaded.`);

  let sources = getEnabledSources();
  if (sourceFilter) {
    sources = sources.filter((s) => s.id === sourceFilter);
    if (sources.length === 0) {
      console.error(`No enabled source with id "${sourceFilter}". Available:`);
      getEnabledSources().forEach((s) => console.error(`  ${s.id}`));
      process.exit(1);
    }
  }

  console.log(`\nRunning discovery across ${sources.length} source(s)...\n`);

  const result = await runMultiSourceDiscovery(
    sources,
    canonicalRecords,
    existingCandidates,
    { isDryRun }
  );

  printReport(result);

  // Write run log (always, even in dry run — for audit trail)
  const runLogPath = path.join(
    process.cwd(),
    "intelligence-runs",
    `multi-source-${result.runId.slice(0, 8)}.json`
  );
  fs.mkdirSync(path.dirname(runLogPath), { recursive: true });
  fs.writeFileSync(runLogPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`Run log written to: ${path.relative(process.cwd(), runLogPath)}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
