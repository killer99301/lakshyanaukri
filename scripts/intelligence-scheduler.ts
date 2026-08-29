#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Scheduler
// node scripts/intelligence-scheduler.ts
// (or: npm run intelligence:scheduler)
// ═══════════════════════════════════════════════════════════
//
// Runs the intelligence engine every 3 hours.
// Fires the first run immediately on startup, then on interval.
//
// Output:
//   Scheduler events to stdout
//   Per-run audit records → intelligence-runs/scheduler-audit.jsonl
//   Per-run intelligence log → intelligence-runs/<runId>.json (via executeRun)
//
// INVARIANT: productionWrites = 0 always.
// ═══════════════════════════════════════════════════════════

import { executeRun } from "@/intelligence/runner";
import {
  IntelligenceScheduler,
  DEFAULT_INTERVAL_MS,
  type SchedulerRunRecord,
} from "@/intelligence/scheduler";

const HOURS = DEFAULT_INTERVAL_MS / (60 * 60 * 1000);

console.log(`\n┌─────────────────────────────────────────────────────┐`);
console.log(`│  Career Campus — Intelligence Scheduler              │`);
console.log(`│  Interval: every ${HOURS} hours                         │`);
console.log(`│  productionWrites: 0 (always)                       │`);
console.log(`│  CTRL+C to stop                                     │`);
console.log(`└─────────────────────────────────────────────────────┘\n`);

const scheduler = new IntelligenceScheduler({
  intervalMs: DEFAULT_INTERVAL_MS,
  runFn: () => executeRun({ mode: "DRY_RUN" }),

  onRunComplete(record: SchedulerRunRecord) {
    if (record.outcome === "SUCCESS") {
      console.log(
        `[${record.completedAt}] ✅ Run ${record.runId.slice(0, 8)}  ` +
        `duration=${record.durationMs}ms  ` +
        `sources=${record.sourcesChecked}  ` +
        `signals=${record.signalsFound}  ` +
        `confirmed=${record.confirmedChanges}  ` +
        `queued=${record.reviewItemsAdded}  ` +
        `deduped=${record.reviewDuplicatesSuppressed}  ` +
        `writes=${record.productionWrites}`
      );
    } else {
      console.error(
        `[${record.completedAt}] ❌ Run FAILED  ` +
        `duration=${record.durationMs}ms  ` +
        `error=${record.error}`
      );
    }
  },

  onRunError(err: unknown) {
    // onRunComplete already logs the error; this is for additional alerting.
    // In production, plug in your alerting/notification system here.
    void err;
  },
});

scheduler.start();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nScheduler stopped.");
  scheduler.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  scheduler.stop();
  process.exit(0);
});
