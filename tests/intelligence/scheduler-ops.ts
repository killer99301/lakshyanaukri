// Phase 5 Operational Validation — scheduler audit writing + restart behavior
// Mock runFn (same RunResult interface) so this completes in seconds.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { IntelligenceRun } from "@/intelligence/types";
import type { RunResult } from "@/intelligence/runner";
import {
  IntelligenceScheduler,
  type SchedulerRunRecord,
} from "@/intelligence/scheduler";

const AUDIT_PATH = join(
  process.cwd(),
  "intelligence-runs",
  `ops-test-${randomUUID()}.jsonl`
);
process.on("exit", () => { if (existsSync(AUDIT_PATH)) unlinkSync(AUDIT_PATH); });

function mockRun(overrides: Partial<IntelligenceRun> = {}): RunResult {
  const run: IntelligenceRun = {
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 180,
    mode: "DRY_RUN",
    status: "COMPLETED",
    preRunSnapshotRef: "sha256:a688aa69d42eed56c02e2238c26f9c94792346f1429d7f1c2c6a162fa8994862",
    sourcesConfigured: 13,
    sourcesEnabled: 13,
    sourcesChecked: 10,
    sourcesReachable: 7,
    sourcesFailed: 3,
    opportunitiesChecked: 6,
    staleRecords: 2,
    staleRecordIds: ["ibps-po-crp-xvi-2026", "upsc-cse-2026"],
    candidateEventsDetected: 0,
    candidateEventsVerified: 0,
    candidateEventsRejected: 0,
    productionWrites: 0,
    extractionsAttempted: 1,
    extractionsSuccessful: 1,
    contentComparisons: [],
    sourceContentHashes: {},
    rawSignals: 0,
    relevantSignals: 0,
    duplicatesSuppressed: 9,
    unconfirmedSignals: 0,
    opportunityMatches: 0,
    rejectedAmbiguous: 0,
    rejectedSignalExamples: [],
    strongMatches: 0,
    moderateMatches: 0,
    ambiguousMatches: 0,
    officialConfirmations: [],
    confirmedChanges: 0,
    notConfirmed: 0,
    ambiguousConfirmations: 0,
    officiallyUnavailable: 0,
    reviewItemsAdded: 0,
    reviewDuplicatesSuppressed: 0,
    errors: [],
    stalenessReports: [],
    candidateEvents: [],
    ...overrides,
  };
  return { run, logPath: `intelligence-runs/ops-test-${run.runId}.json` };
}

function readAudit(path: string): SchedulerRunRecord[] {
  return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
}

function check(label: string, condition: boolean): void {
  console.log(`  ${condition ? "✅" : "❌"}  ${label}`);
  if (!condition) process.exitCode = 1;
}

async function main() {
  console.log("\n── Phase 5 Operational Validation ────────────────────────────\n");

  // ── STEP 1: Instance #1, two ticks ───────────────────────────
  console.log("STEP 1: Scheduler instance #1 — two ticks\n");

  const s1 = new IntelligenceScheduler({
    intervalMs: 999_999,
    auditPath: AUDIT_PATH,
    runFn: async () => mockRun(),
    onRunComplete: (r) =>
      console.log(`  [tick] outcome=${r.outcome}  sched=${r.schedulerRunId.slice(0,8)}  run=${r.runId.slice(0,8)}  writes=${r.productionWrites}`),
  });

  const r1a = await s1.tick();
  const r1b = await s1.tick();

  console.log("");
  check("schedulerRunId unique across ticks", r1a.schedulerRunId !== r1b.schedulerRunId);
  check("runId unique across ticks", r1a.runId !== r1b.runId);
  const allFour = new Set([r1a.schedulerRunId, r1b.schedulerRunId, r1a.runId, r1b.runId]).size === 4;
  check("All 4 IDs (schedulerRunId×2, runId×2) are distinct", allFour);

  // ── STEP 2: Audit file has 2 lines ───────────────────────────
  console.log("\nSTEP 2: Audit file after 2 ticks\n");
  const audit2 = readAudit(AUDIT_PATH);
  check("Audit file exists", existsSync(AUDIT_PATH));
  check("Audit has 2 lines", audit2.length === 2);
  check("Line 1: outcome SUCCESS", audit2[0].outcome === "SUCCESS");
  check("Line 2: outcome SUCCESS", audit2[1].outcome === "SUCCESS");
  check("Line 1: productionWrites = 0", audit2[0].productionWrites === 0);
  check("Line 2: productionWrites = 0", audit2[1].productionWrites === 0);

  // ── STEP 3: Stop instance #1 ─────────────────────────────────
  console.log("\nSTEP 3: stop() instance #1\n");
  s1.stop();
  check("isRunning = false after stop()", !s1.isRunning);
  check("totalRunCount = 2", s1.totalRunCount === 2);

  // ── STEP 4: Restart — instance #2 ────────────────────────────
  console.log("\nSTEP 4: Scheduler instance #2 (simulates process restart)\n");

  const s2 = new IntelligenceScheduler({
    intervalMs: 999_999,
    auditPath: AUDIT_PATH,
    runFn: async () => mockRun({ reviewDuplicatesSuppressed: 9 }),
    onRunComplete: (r) =>
      console.log(`  [tick] outcome=${r.outcome}  sched=${r.schedulerRunId.slice(0,8)}  run=${r.runId.slice(0,8)}  deduped=${r.reviewDuplicatesSuppressed}`),
  });

  await s2.tick();

  // ── STEP 5: Audit has 3 lines post-restart ───────────────────
  console.log("\nSTEP 5: Audit file after restart tick\n");
  const audit3 = readAudit(AUDIT_PATH);
  check("Audit has 3 lines (2 from #1 + 1 from #2)", audit3.length === 3);
  check("Instance #2 tick: outcome SUCCESS", audit3[2].outcome === "SUCCESS");
  check("Instance #2 tick: productionWrites = 0", audit3[2].productionWrites === 0);
  check("Instance #2 tick: reviewDuplicatesSuppressed = 9", audit3[2].reviewDuplicatesSuppressed === 9);
  check("restart ≠ reset: audit accumulates across instances", audit3[0].schedulerRunId !== audit3[2].schedulerRunId);

  // ── STEP 6: src/data/ not modified ───────────────────────────
  console.log("\nSTEP 6: src/data/ not modified during operational test\n");
  const srcFiles = ["src/data/government.ts", "src/data/homepage.ts", "src/data/private.ts"];
  for (const f of srcFiles) {
    const ageMs = Date.now() - statSync(f).mtimeMs;
    check(`${f} not modified (last write ${Math.round(ageMs/1000)}s ago)`, ageMs > 30_000);
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log("\n── Operational validation complete ───────────────────────────");
  if (process.exitCode !== 1) {
    console.log("✅ All checks passed");
  } else {
    console.error("❌ Some checks failed");
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
