// ═══════════════════════════════════════════════════════════
// Phase 5: Intelligence Scheduler Tests
// ═══════════════════════════════════════════════════════════
//
// All tests use fake timers and a mock runFn — no real network
// calls, no real 3-hour waits.
//
// Scenarios:
//   S1  tick() returns SUCCESS record when runFn resolves
//   S2  tick() returns FAILED record when runFn throws — never rethrows
//   S3  SUCCESS record carries all IntelligenceRun stat fields
//   S4  Audit record is appended to auditPath after each tick
//   S5  productionWrites = 0 forwarded into the audit record
//   S6  start() fires first run immediately (no wait for interval)
//   S7  start() registers the configured interval via setIntervalFn
//   S8  stop() calls clearIntervalFn; isRunning becomes false
//   S9  Multiple consecutive failures do not prevent subsequent ticks
//  S10  Audit write failure does not crash the scheduler
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { IntelligenceRun } from "@/intelligence/types";
import type { RunResult } from "@/intelligence/runner";
import {
  IntelligenceScheduler,
  type SchedulerRunRecord,
} from "@/intelligence/scheduler";

// ─── Helpers ─────────────────────────────────────────────────

function makeFakeRun(overrides: Partial<IntelligenceRun> = {}): RunResult {
  const run: IntelligenceRun = {
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 120,
    mode: "DRY_RUN",
    status: "COMPLETED",
    preRunSnapshotRef: "sha256-test-snapshot",
    sourcesConfigured: 13,
    sourcesEnabled: 13,
    sourcesChecked: 10,
    sourcesReachable: 8,
    sourcesFailed: 2,
    opportunitiesChecked: 6,
    staleRecords: 0,
    staleRecordIds: [],
    candidateEventsDetected: 3,
    candidateEventsVerified: 1,
    candidateEventsRejected: 2,
    productionWrites: 0,
    extractionsAttempted: 10,
    extractionsSuccessful: 8,
    contentComparisons: [],
    sourceContentHashes: {},
    rawSignals: 12,
    relevantSignals: 5,
    duplicatesSuppressed: 3,
    unconfirmedSignals: 0,
    opportunityMatches: 1,
    rejectedAmbiguous: 2,
    rejectedSignalExamples: [],
    strongMatches: 1,
    moderateMatches: 0,
    ambiguousMatches: 0,
    officialConfirmations: [],
    confirmedChanges: 1,
    notConfirmed: 0,
    ambiguousConfirmations: 0,
    officiallyUnavailable: 0,
    reviewItemsAdded: 1,
    reviewDuplicatesSuppressed: 0,
    errors: [],
    stalenessReports: [],
    candidateEvents: [],
    ...overrides,
  };
  return { run, logPath: `intelligence-runs/${run.runId}.json` };
}

function tempAuditPath(): string {
  return join(process.cwd(), "intelligence-runs", `scheduler-test-${randomUUID()}.jsonl`);
}

function readAuditLines(path: string): SchedulerRunRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SchedulerRunRecord);
}

// ─── S1: SUCCESS record returned from tick() ─────────────────

suite("Phase 5 › S1: tick() returns SUCCESS record when runFn resolves");
test("Record has outcome SUCCESS and runId from the intelligence run", async () => {
  const fakeResult = makeFakeRun();
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  const scheduler = new IntelligenceScheduler({
    intervalMs: 100,
    runFn: async () => fakeResult,
    auditPath,
  });

  const record = await scheduler.tick();

  assert.equal(record.outcome, "SUCCESS");
  assert.equal(record.runId, fakeResult.run.runId);
  assert.ok(record.schedulerRunId, "schedulerRunId assigned");
  assert.ok(record.completedAt, "completedAt set");
  assert.ok(typeof record.durationMs === "number" && record.durationMs >= 0, "durationMs present");
});

// ─── S2: FAILED record returned when runFn throws ────────────

suite("Phase 5 › S2: tick() returns FAILED record when runFn throws — never rethrows");
test("Error is captured in record.error; tick() does not throw", async () => {
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  const errors: unknown[] = [];
  const scheduler = new IntelligenceScheduler({
    intervalMs: 100,
    runFn: async () => { throw new Error("network timeout"); },
    auditPath,
    onRunError: (err) => errors.push(err),
  });

  // Must not throw
  const record = await scheduler.tick();

  assert.equal(record.outcome, "FAILED");
  assert.equal(record.runId, "FAILED");
  assert.ok(record.error?.includes("network timeout"), "error message captured");
  assert.equal(errors.length, 1, "onRunError called once");
  assert.ok(errors[0] instanceof Error);
});

// ─── S3: SUCCESS record carries all stat fields ───────────────

suite("Phase 5 › S3: SUCCESS record carries all IntelligenceRun stat fields");
test("All relevant stats from IntelligenceRun are forwarded to SchedulerRunRecord", async () => {
  const fakeResult = makeFakeRun({
    sourcesChecked: 9,
    candidateEventsDetected: 7,
    confirmedChanges: 2,
    reviewItemsAdded: 2,
    reviewDuplicatesSuppressed: 1,
    productionWrites: 0,
  });
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  const scheduler = new IntelligenceScheduler({ intervalMs: 100, runFn: async () => fakeResult, auditPath });
  const record = await scheduler.tick();

  assert.equal(record.sourcesChecked, 9);
  assert.equal(record.signalsFound, 7);
  assert.equal(record.confirmedChanges, 2);
  assert.equal(record.reviewItemsAdded, 2);
  assert.equal(record.reviewDuplicatesSuppressed, 1);
  assert.equal(record.productionWrites, 0);
});

// ─── S4: Audit record persisted after each tick ───────────────

suite("Phase 5 › S4: Audit record appended to auditPath after each tick");
test("After two ticks, two lines exist in the audit file", async () => {
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  const scheduler = new IntelligenceScheduler({
    intervalMs: 100,
    runFn: async () => makeFakeRun(),
    auditPath,
  });

  await scheduler.tick();
  await scheduler.tick();

  const lines = readAuditLines(auditPath);
  assert.equal(lines.length, 2, "two audit lines written");
  assert.equal(lines[0].outcome, "SUCCESS");
  assert.equal(lines[1].outcome, "SUCCESS");
  assert.notEqual(lines[0].schedulerRunId, lines[1].schedulerRunId, "each tick has unique schedulerRunId");
});

// ─── S5: productionWrites = 0 in audit record ────────────────

suite("Phase 5 › S5: productionWrites = 0 always forwarded in audit record");
test("productionWrites from IntelligenceRun is 0 and preserved in SchedulerRunRecord", async () => {
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  const scheduler = new IntelligenceScheduler({
    intervalMs: 100,
    runFn: async () => makeFakeRun({ productionWrites: 0 }),
    auditPath,
  });

  const record = await scheduler.tick();

  assert.equal(record.productionWrites, 0, "productionWrites = 0 in scheduler record");
  const lines = readAuditLines(auditPath);
  assert.equal(lines[0].productionWrites, 0, "productionWrites = 0 in persisted audit line");
});

// ─── S6: start() fires first run immediately ─────────────────

suite("Phase 5 › S6: start() fires first run immediately without waiting for interval");
test("runFn is called once immediately after start(), before any interval fires", async () => {
  let callCount = 0;
  let intervalCallback: (() => void) | null = null;
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  const scheduler = new IntelligenceScheduler({
    intervalMs: 999_999,
    runFn: async () => { callCount++; return makeFakeRun(); },
    auditPath,
    setIntervalFn: (fn, _ms) => {
      intervalCallback = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: () => undefined,
  });

  scheduler.start();

  // Allow the microtask queue to flush so the immediate tick completes
  await new Promise<void>((resolve) => setTimeout(resolve, 10));

  assert.equal(callCount, 1, "runFn called once immediately after start()");
  assert.ok(intervalCallback !== null, "interval registered");

  scheduler.stop();
});

// ─── S7: start() sets the configured interval ────────────────

suite("Phase 5 › S7: start() registers interval with the configured intervalMs");
test("setIntervalFn called with the correct interval value", () => {
  let capturedMs: number | null = null;
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  const scheduler = new IntelligenceScheduler({
    intervalMs: 10_800_000,  // 3 hours
    runFn: async () => makeFakeRun(),
    auditPath,
    setIntervalFn: (fn, ms) => {
      capturedMs = ms;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: () => undefined,
  });

  scheduler.start();

  assert.equal(capturedMs, 10_800_000, "interval registered as 3 hours in ms");

  scheduler.stop();
});

// ─── S8: stop() cancels the interval ─────────────────────────

suite("Phase 5 › S8: stop() calls clearIntervalFn and isRunning becomes false");
test("Scheduler stops cleanly; clearIntervalFn receives the handle from setIntervalFn", () => {
  const FAKE_HANDLE = 42 as unknown as ReturnType<typeof setInterval>;
  let clearedHandle: ReturnType<typeof setInterval> | null = null;
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  const scheduler = new IntelligenceScheduler({
    intervalMs: 999_999,
    runFn: async () => makeFakeRun(),
    auditPath,
    setIntervalFn: (_fn, _ms) => FAKE_HANDLE,
    clearIntervalFn: (handle) => { clearedHandle = handle; },
  });

  scheduler.start();
  assert.equal(scheduler.isRunning, true, "isRunning true after start()");

  scheduler.stop();
  assert.equal(scheduler.isRunning, false, "isRunning false after stop()");
  assert.equal(clearedHandle, FAKE_HANDLE, "clearIntervalFn received the correct handle");
});

// ─── S9: Multiple failures don't stop the scheduler ──────────

suite("Phase 5 › S9: Multiple consecutive failures do not prevent subsequent ticks");
test("Three ticks: two failures followed by success — scheduler stays alive, all recorded", async () => {
  const auditPath = tempAuditPath();
  process.on("exit", () => { if (existsSync(auditPath)) unlinkSync(auditPath); });

  let callN = 0;
  const scheduler = new IntelligenceScheduler({
    intervalMs: 100,
    runFn: async () => {
      callN++;
      if (callN <= 2) throw new Error(`failure ${callN}`);
      return makeFakeRun();
    },
    auditPath,
  });

  const r1 = await scheduler.tick();
  const r2 = await scheduler.tick();
  const r3 = await scheduler.tick();

  assert.equal(r1.outcome, "FAILED");
  assert.equal(r2.outcome, "FAILED");
  assert.equal(r3.outcome, "SUCCESS", "scheduler recovered after two failures");
  assert.equal(scheduler.totalRunCount, 3, "all three ticks counted");

  const lines = readAuditLines(auditPath);
  assert.equal(lines.length, 3, "all three ticks written to audit");
  assert.equal(lines[2].outcome, "SUCCESS");
});

// ─── S10: Audit write failure doesn't crash the scheduler ────

suite("Phase 5 › S10: Audit write failure does not crash the scheduler");
test("tick() returns a valid record even when the audit path is unwritable", async () => {
  // Use an invalid path that will fail to write
  const invalidAuditPath = join("Z:\\nonexistent\\path\\scheduler.jsonl");

  const scheduler = new IntelligenceScheduler({
    intervalMs: 100,
    runFn: async () => makeFakeRun(),
    auditPath: invalidAuditPath,
  });

  // Must not throw despite audit write failing
  const record = await scheduler.tick();

  assert.equal(record.outcome, "SUCCESS", "SUCCESS record returned despite audit write failure");
  assert.equal(record.productionWrites, 0);
});
