// ═══════════════════════════════════════════════════════════
// Phase 5: Intelligence Scheduler
// ═══════════════════════════════════════════════════════════
//
// Thin orchestration layer around the existing intelligence engine.
// Runs executeRun() on a fixed interval; records an audit entry for
// every run (success or failure); never writes to canonical data.
//
// INVARIANTS:
//   - productionWrites = 0 always
//   - Approval is never automated — queue.json is the only output
//   - One failed run must not prevent the next scheduled run
//   - Manual `npm run intelligence:check` and the scheduler share
//     the same executeRun() call path — no divergent behavior
//   - Deduplication is handled by the existing queue mechanism;
//     the scheduler does not add its own dedup layer
//
// Design:
//   All external dependencies (timer, run function, clock, audit writer)
//   are injectable so the scheduler can be tested without real timers
//   or real network calls.
// ═══════════════════════════════════════════════════════════

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { RunResult } from "./runner";

// ─── Types ────────────────────────────────────────────────────

export interface SchedulerRunRecord {
  schedulerRunId: string;        // UUID identifying this scheduler tick
  runId: string;                 // the intelligence run ID from executeRun()
  scheduledAt: string;           // ISO — when the tick was triggered
  startedAt: string;             // ISO — when executeRun() was invoked
  completedAt: string;           // ISO — when it returned or threw
  durationMs: number;
  outcome: "SUCCESS" | "FAILED";
  error?: string;

  // Stats forwarded from IntelligenceRun (undefined on FAILED)
  sourcesChecked?: number;
  signalsFound?: number;
  confirmedChanges?: number;
  reviewItemsAdded?: number;
  reviewDuplicatesSuppressed?: number;
  productionWrites?: number;     // should always be 0
}

export interface SchedulerConfig {
  /** How often to run, in milliseconds. Default: 3 hours. */
  intervalMs: number;

  /**
   * The function that executes one intelligence run.
   * In production: () => executeRun()
   * In tests: a controllable fake.
   */
  runFn: () => Promise<RunResult>;

  /**
   * Where to append per-run audit records (newline-delimited JSON).
   * Default: intelligence-runs/scheduler-audit.jsonl
   * Injectable so tests can write to a temp path.
   */
  auditPath?: string;

  /** Injectable timer primitives — default to the real global ones. */
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;

  /** Injectable clock — defaults to () => new Date() */
  nowFn?: () => Date;

  /** Called after every completed run record (success or failure). */
  onRunComplete?: (record: SchedulerRunRecord) => void;

  /** Called when a run throws (in addition to logging to auditPath). */
  onRunError?: (error: unknown) => void;
}

export const DEFAULT_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
export const DEFAULT_AUDIT_PATH = join(
  process.cwd(),
  "intelligence-runs",
  "scheduler-audit.jsonl"
);

// ─── Scheduler ────────────────────────────────────────────────

export class IntelligenceScheduler {
  private readonly config: Required<SchedulerConfig>;
  private handle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private runCount = 0;

  constructor(config: SchedulerConfig) {
    this.config = {
      intervalMs: config.intervalMs,
      runFn: config.runFn,
      auditPath: config.auditPath ?? DEFAULT_AUDIT_PATH,
      setIntervalFn: config.setIntervalFn ?? setInterval,
      clearIntervalFn: config.clearIntervalFn ?? clearInterval,
      nowFn: config.nowFn ?? (() => new Date()),
      onRunComplete: config.onRunComplete ?? (() => undefined),
      onRunError: config.onRunError ?? (() => undefined),
    };
  }

  /**
   * Start the scheduler.
   * Fires the first run immediately, then on the configured interval.
   * Returns `this` for chaining.
   */
  start(): this {
    if (this.stopped) throw new Error("IntelligenceScheduler has been stopped; create a new instance to restart.");
    // Fire immediately, then on interval.
    void this.tick();
    this.handle = this.config.setIntervalFn(() => { void this.tick(); }, this.config.intervalMs);
    return this;
  }

  /**
   * Stop the scheduler. No further ticks will fire.
   * A tick already in progress is allowed to complete.
   */
  stop(): void {
    this.stopped = true;
    if (this.handle !== null) {
      this.config.clearIntervalFn(this.handle);
      this.handle = null;
    }
  }

  get isRunning(): boolean {
    return this.handle !== null && !this.stopped;
  }

  get totalRunCount(): number {
    return this.runCount;
  }

  /**
   * Execute one scheduler tick.
   * Exposed as public so tests can call it directly without needing a real timer.
   * Never throws — all errors are captured into the run record.
   */
  async tick(): Promise<SchedulerRunRecord> {
    const now = this.config.nowFn;
    const schedulerRunId = crypto.randomUUID();
    const scheduledAt = now().toISOString();

    let record: SchedulerRunRecord;

    const startedAt = now().toISOString();
    const t0 = Date.now();

    try {
      const result = await this.config.runFn();
      const completedAt = now().toISOString();
      const durationMs = Date.now() - t0;
      this.runCount++;

      record = {
        schedulerRunId,
        runId: result.run.runId,
        scheduledAt,
        startedAt,
        completedAt,
        durationMs,
        outcome: "SUCCESS",

        sourcesChecked: result.run.sourcesChecked,
        signalsFound: result.run.candidateEventsDetected,
        confirmedChanges: result.run.confirmedChanges,
        reviewItemsAdded: result.run.reviewItemsAdded,
        reviewDuplicatesSuppressed: result.run.reviewDuplicatesSuppressed,
        productionWrites: result.run.productionWrites,
      };
    } catch (err) {
      const completedAt = now().toISOString();
      const durationMs = Date.now() - t0;
      this.runCount++;

      const errorMessage =
        err instanceof Error ? err.message : String(err);

      record = {
        schedulerRunId,
        runId: "FAILED",
        scheduledAt,
        startedAt,
        completedAt,
        durationMs,
        outcome: "FAILED",
        error: errorMessage,
      };

      this.config.onRunError(err);
    }

    this.appendAuditRecord(record);
    this.config.onRunComplete(record);

    return record;
  }

  private appendAuditRecord(record: SchedulerRunRecord): void {
    try {
      const auditDir = dirname(this.config.auditPath);
      if (!existsSync(auditDir)) {
        mkdirSync(auditDir, { recursive: true });
      }
      appendFileSync(this.config.auditPath, JSON.stringify(record) + "\n", "utf-8");
    } catch {
      // Audit write failure must not kill the scheduler.
      // The record is still delivered to onRunComplete.
    }
  }
}
