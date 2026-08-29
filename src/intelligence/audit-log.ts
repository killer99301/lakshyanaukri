// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine Audit Log
// ═══════════════════════════════════════════════════════════
// Writes run records to intelligence-runs/ directory.
//
// The audit log is the engine's paper trail:
//   - Every run is persisted as a dated JSON file
//   - The preRunSnapshotRef anchors the state before any changes
//   - No data written here affects the website or canonical records
//   - Files accumulate; clean up manually or via a retention script
//
// Output path:  intelligence-runs/rie-run-{timestamp}-{id}.json
// ═══════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IntelligenceRun } from "./types";

// ─── Config ──────────────────────────────────────────────────

const RUNS_DIR = "intelligence-runs";

// ─── Helpers ─────────────────────────────────────────────────

function ensureRunsDir(): void {
  if (!existsSync(RUNS_DIR)) {
    mkdirSync(RUNS_DIR, { recursive: true });
  }
}

function runFilename(run: IntelligenceRun): string {
  // rie-run-20260821-143022-{first 8 chars of runId}.json
  const ts = run.startedAt
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .substring(0, 15);
  const shortId = run.runId.substring(0, 8);
  return `rie-run-${ts}-${shortId}.json`;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Write the completed IntelligenceRun to disk.
 * Returns the path of the written file.
 *
 * Called at the end of every run regardless of status.
 * If writing fails, logs the error to stderr but does not throw —
 * a log write failure must never crash the monitor process.
 */
export function writeRunLog(run: IntelligenceRun): string {
  ensureRunsDir();
  const filename = runFilename(run);
  const filepath = join(RUNS_DIR, filename);

  try {
    writeFileSync(filepath, JSON.stringify(run, null, 2), "utf-8");
  } catch (err) {
    process.stderr.write(
      `[audit-log] Failed to write run log to ${filepath}: ${String(err)}\n`
    );
  }

  return filepath;
}

/**
 * Load content hashes from the most recent completed run.
 * Returns empty object if no previous run exists or on read error.
 * Used for cross-run deduplication: skip extraction when source hash is unchanged.
 */
export function loadPreviousRunHashes(): Record<string, string> {
  if (!existsSync(RUNS_DIR)) return {};

  let files: string[];
  try {
    files = readdirSync(RUNS_DIR)
      .filter((f) => f.startsWith("rie-run-") && f.endsWith(".json"))
      .sort()
      .reverse(); // lexicographic sort puts latest filename first
  } catch {
    return {};
  }

  if (files.length === 0) return {};

  try {
    const content = readFileSync(join(RUNS_DIR, files[0]), "utf-8");
    const prev = JSON.parse(content) as { sourceContentHashes?: Record<string, string> };
    return prev.sourceContentHashes ?? {};
  } catch {
    return {};
  }
}

/**
 * Format a run summary line for console output.
 */
export function formatRunSummaryLine(run: IntelligenceRun): string {
  const duration =
    run.durationMs !== undefined
      ? ` (${(run.durationMs / 1000).toFixed(1)}s)`
      : "";

  return (
    `Run ${run.runId} | ${run.status}${duration} | ` +
    `sources: ${run.sourcesChecked}/${run.sourcesEnabled} ok | ` +
    `records: ${run.opportunitiesChecked} | ` +
    `stale: ${run.staleRecords} | ` +
    `events: ${run.candidateEventsDetected} | ` +
    `writes: ${run.productionWrites}`
  );
}
