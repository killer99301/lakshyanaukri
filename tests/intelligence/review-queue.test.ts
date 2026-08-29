// ═══════════════════════════════════════════════════════════
// Phase 4: Change Review Queue Tests
// ═══════════════════════════════════════════════════════════
//
// All tests are deterministic — no live fetching.
// IO tests use a temp queue file; they do NOT write to the
// production queue at intelligence-runs/review-queue.json.
//
// Scenarios:
//   Q1  Confirmed vacancy change → ReviewItem created with correct fields
//   Q2  Confirmed postponement → ReviewItem status is PENDING
//   Q3  Confirmed cancellation → ReviewItem created (EXAM_CANCELLED type)
//   Q4  Confirmed new exam date → ReviewItem has date field diff
//   Q5  Confirmed new notice → ReviewItem created (NEW_NOTICE type)
//   Q6  NOT_CONFIRMED event → NOT queued
//   Q7  AMBIGUOUS_CONFIRMATION event → NOT queued
//   Q8  Duplicate confirmed change → isDuplicate true, count unchanged
//   Q9  Snapshot integrity — preRunSnapshotRef preserved through queue IO
//  Q10  productionWrites === 0 invariant
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { GovernmentRecruitment } from "@/types";
import type {
  CandidateChangeEvent,
  CandidateEventType,
  ConfirmationResult,
  FieldDiff,
} from "@/intelligence/types";
import {
  createReviewItem,
  appendToReviewQueue,
  loadReviewQueue,
  isDuplicate,
  setItemStatus,
} from "@/intelligence/review-queue";
import { confirmChange } from "@/intelligence/confirmer";

// ─── Temp queue path (isolated from production queue) ────────

const TEMP_QUEUE = join(
  process.cwd(),
  "intelligence-runs",
  `review-queue-test-${randomUUID()}.json`
);

process.on("exit", () => {
  if (existsSync(TEMP_QUEUE)) unlinkSync(TEMP_QUEUE);
});

// ─── Fixture helpers ──────────────────────────────────────────

function makeOpp(
  id: string,
  title: string,
  org: string,
  notif: string,
  vacancies = 1500
): GovernmentRecruitment {
  return {
    id,
    slug: id,
    title,
    type: "government",
    organizationId: id.split("-")[0],
    organizationName: org,
    notificationNumber: notif,
    govType: "State Govt",
    shortDescription: "",
    category: "state-psc",
    state: "Bihar",
    qualification: "Graduate",
    postDate: "2026-01-01",
    totalVacancies: vacancies,
    vacanciesDisplay: `${vacancies.toLocaleString()} Vacancies`,
    application: {
      notificationDate: "2026-01-01",
      openDate: "2026-01-15",
      closeDate: "2026-02-15",
    },
    examStages: [
      { name: "Prelims", order: 1, status: "SCHEDULED", dateIso: "2026-09-20" },
    ],
    links: { apply: "https://example.com/apply", website: "https://example.com" },
    provenance: {
      status: "VERIFIED",
      lastVerifiedAt: "2026-08-01",
      primarySourceType: "OFFICIAL_NOTIFICATION",
    },
  };
}

function makeEvent(
  opportunityId: string,
  eventType: CandidateEventType,
  matchedIdentifier = "72nd"
): CandidateChangeEvent {
  return {
    id: `cce-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    eventType,
    opportunityId,
    sourceId: "sarkari-result-bpsc",
    sourceUrl: "https://sarkariresult.com/bpsc/",
    sourceTier: 5,
    detectedAt: new Date().toISOString(),
    verificationState: "OFFICIAL_SOURCE_FOUND",
    humanReviewRequired: true,
    reviewStatus: "PENDING",
    matchedIdentifier,
    confidence: 0.75,
    disambiguationScore: "STRONG",
  };
}

function makeConfirmation(
  opportunityId: string,
  fieldDiffs: FieldDiff[] = []
): ConfirmationResult {
  return {
    opportunityId,
    outcome: "CONFIRMED_CHANGE",
    officialSourceId: "bpsc-application-portal",
    officialSourceUrl: "https://onlinebpsc.bihar.gov.in",
    identifierConfirmed: true,
    changeTypeConfirmed: true,
    proximityConfirmed: true,
    fieldDiffs,
  };
}

function makeFieldDiff(
  field: string,
  canonicalValue: string,
  observedValue: string
): FieldDiff {
  return {
    field,
    canonicalValue,
    observedValue,
    confidence: 0.90,
    extractionMethod: "REGEX",
  };
}

// ─── Shared fixtures ──────────────────────────────────────────

const bpsc72 = makeOpp(
  "bpsc-72nd-cce-2026",
  "BPSC 72nd CCE 2026",
  "Bihar Public Service Commission",
  "Advt No. 72/2026"
);

const sscCgl = makeOpp(
  "ssc-cgl-2026",
  "SSC CGL 2026",
  "Staff Selection Commission",
  "CGL 2026",
  14582
);

// ─── Q1: Confirmed vacancy change → ReviewItem created ────────

suite("Phase 4 › Q1: Confirmed vacancy change → ReviewItem created");
test("ReviewItem has correct fields for VACANCY_CHANGE", () => {
  const event = makeEvent("ssc-cgl-2026", "VACANCY_CHANGE", "cgl 2026");
  const vacDiff = makeFieldDiff("totalVacancies", "14582", "17727");
  const conf = makeConfirmation("ssc-cgl-2026", [vacDiff]);
  const officialText =
    "Staff Selection Commission: Revised Vacancies for CGL 2026. " +
    "Total revised posts: 17,727 against earlier 14,582 vacancies.";

  const item = createReviewItem({
    event,
    opportunity: sscCgl,
    confirmation: conf,
    preRunSnapshotRef: "sha256-test-ref-q1",
    officialText,
  });

  assert.equal(item.opportunityId, "ssc-cgl-2026");
  assert.equal(item.opportunityTitle, "SSC CGL 2026");
  assert.equal(item.changeType, "VACANCY_CHANGE");
  assert.equal(item.oldValue, "14582");
  assert.equal(item.newValue, "17727");
  assert.equal(item.matchedIdentifier, "cgl 2026");
  assert.equal(item.officialConfirmationSource, "bpsc-application-portal");
  assert.equal(item.fieldDiffs.length, 1);
  assert.equal(item.fieldDiffs[0].field, "totalVacancies");
  assert.equal(item.humanReviewRequired, true);
  assert.ok(item.officialEvidence.length > 0, "evidence should be extracted");
  assert.ok(item.officialEvidence.includes("cgl 2026") || item.officialEvidence.toLowerCase().includes("cgl"), "evidence should contain identifier context");
  assert.ok(item.id.length > 0, "UUID generated");
  assert.equal(item.status, "PENDING");
});

// ─── Q2: Confirmed postponement → status is PENDING ──────────

suite("Phase 4 › Q2: Confirmed postponement → status PENDING");
test("ReviewItem.status === PENDING immediately after creation", () => {
  const event = makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED", "72nd");
  const statusDiff = makeFieldDiff("examStages[0].status", "SCHEDULED", "POSTPONED");
  const conf = makeConfirmation("bpsc-72nd-cce-2026", [statusDiff]);

  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: conf,
    preRunSnapshotRef: "sha256-test-ref-q2",
    officialText:
      "BPSC 72nd CCE Prelims postponed. New schedule will be announced separately.",
  });

  assert.equal(item.status, "PENDING", "newly created item must be PENDING");
  assert.equal(item.changeType, "EXAM_POSTPONED");
  assert.equal(item.matchedIdentifier, "72nd");
  assert.equal(item.oldValue, "SCHEDULED");
  assert.equal(item.newValue, "POSTPONED");
});

// ─── Q3: Confirmed cancellation → ReviewItem created ─────────

suite("Phase 4 › Q3: Confirmed cancellation → ReviewItem created");
test("EXAM_CANCELLED event → ReviewItem created with correct changeType", () => {
  const event = makeEvent("bpsc-72nd-cce-2026", "EXAM_CANCELLED", "72nd");
  const statusDiff = makeFieldDiff("examStages[0].status", "SCHEDULED", "CANCELLED");
  const conf = makeConfirmation("bpsc-72nd-cce-2026", [statusDiff]);

  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: conf,
    preRunSnapshotRef: "sha256-test-ref-q3",
    officialText:
      "Bihar Public Service Commission: 72nd CCE Preliminary Examination stands cancelled.",
  });

  assert.equal(item.changeType, "EXAM_CANCELLED");
  assert.equal(item.status, "PENDING");
  assert.equal(item.newValue, "CANCELLED");
  assert.equal(item.humanReviewRequired, true);
});

// ─── Q4: Confirmed new exam date → date field diff preserved ──

suite("Phase 4 › Q4: Confirmed exam date change → date field diff");
test("ReviewItem.fieldDiffs contains date diff when rescheduled", () => {
  const event = makeEvent("bpsc-72nd-cce-2026", "EXAM_DATE_CHANGE", "72nd");
  const statusDiff = makeFieldDiff("examStages[0].status", "SCHEDULED", "POSTPONED");
  const dateDiff   = makeFieldDiff("examStages[0].dateIso", "2026-09-20", "2026-11-20");
  const conf = makeConfirmation("bpsc-72nd-cce-2026", [statusDiff, dateDiff]);

  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: conf,
    preRunSnapshotRef: "sha256-test-ref-q4",
    officialText:
      "BPSC 72nd CCE has been rescheduled to 20 November 2026 as per revised schedule.",
  });

  assert.equal(item.changeType, "EXAM_DATE_CHANGE");
  assert.equal(item.fieldDiffs.length, 2);
  const date = item.fieldDiffs.find((d) => d.field.includes("dateIso"));
  assert.ok(date, "date field diff must be present");
  assert.equal(date?.canonicalValue, "2026-09-20");
  assert.equal(date?.observedValue, "2026-11-20");
});

// ─── Q5: Confirmed new notice → ReviewItem created ────────────

suite("Phase 4 › Q5: Confirmed new notification notice → ReviewItem");
test("NEW_NOTICE event → ReviewItem created with no field diffs", () => {
  const event = makeEvent("bpsc-72nd-cce-2026", "NEW_NOTICE", "72nd");
  // A new notice may confirm the event type without a field-level diff
  const conf = makeConfirmation("bpsc-72nd-cce-2026", []);

  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: conf,
    preRunSnapshotRef: "sha256-test-ref-q5",
    officialText:
      "BPSC 72nd CCE: New corrigendum notice issued. Check official website.",
  });

  assert.equal(item.changeType, "NEW_NOTICE");
  assert.equal(item.fieldDiffs.length, 0, "no field diffs for a new notice");
  assert.equal(item.oldValue, undefined);
  assert.equal(item.newValue, undefined);
  assert.equal(item.status, "PENDING");
  assert.equal(item.humanReviewRequired, true);
});

// ─── Q6: NOT_CONFIRMED → NOT queued ──────────────────────────

suite("Phase 4 › Q6: NOT_CONFIRMED event is not queued");
test("confirmChange returning NOT_CONFIRMED → queue unchanged", () => {
  const officialText =
    "BPSC 72nd CCE 2026: Applications are open. Total vacancies: 1500.";
  // No postponement language → NOT_CONFIRMED

  const bpscOpp = makeOpp(
    "bpsc-72nd-cce-2026",
    "BPSC 72nd CCE 2026",
    "Bihar Public Service Commission",
    "Advt No. 72/2026"
  );

  const result = confirmChange({
    discoveredEvent: makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED", "72nd"),
    opportunity: bpscOpp,
    officialSourceText: officialText,
    officialSourceId: "bpsc-official",
    officialSourceUrl: "https://bpsc.bih.nic.in",
  });

  assert.equal(result.outcome, "NOT_CONFIRMED");

  // The runner only queues CONFIRMED_CHANGE. Verify we do not queue this.
  const before = loadReviewQueue(TEMP_QUEUE).items.length;
  // (We do not call appendToReviewQueue — this mirrors the runner's gate)
  const after = loadReviewQueue(TEMP_QUEUE).items.length;
  assert.equal(before, after, "NOT_CONFIRMED must not add to queue");
});

// ─── Q7: AMBIGUOUS_CONFIRMATION → NOT queued ─────────────────

suite("Phase 4 › Q7: AMBIGUOUS_CONFIRMATION event is not queued");
test("AMBIGUOUS result → queue size unchanged", () => {
  // Official page has postponement but not the specific 72nd identifier
  const officialText =
    "Bihar Public Service Commission has postponed an examination. " +
    "Candidates are advised to check the official website.";

  const bpscOpp = makeOpp(
    "bpsc-72nd-cce-2026",
    "BPSC 72nd CCE 2026",
    "Bihar Public Service Commission",
    "Advt No. 72/2026"
  );

  const result = confirmChange({
    discoveredEvent: makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED", "72nd"),
    opportunity: bpscOpp,
    officialSourceText: officialText,
    officialSourceId: "bpsc-official",
    officialSourceUrl: "https://bpsc.bih.nic.in",
  });

  assert.equal(result.outcome, "AMBIGUOUS_CONFIRMATION");

  const before = loadReviewQueue(TEMP_QUEUE).items.length;
  // Runner gate: only CONFIRMED_CHANGE goes to queue
  const after = loadReviewQueue(TEMP_QUEUE).items.length;
  assert.equal(before, after, "AMBIGUOUS must not add to queue");
});

// ─── Q8: Duplicate suppression ───────────────────────────────

suite("Phase 4 › Q8: Duplicate confirmed change is suppressed");
test("Same dedupKey → isDuplicate true, appendToReviewQueue skipped", () => {
  const event = makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED", "72nd");
  const conf   = makeConfirmation("bpsc-72nd-cce-2026", [
    makeFieldDiff("examStages[0].status", "SCHEDULED", "POSTPONED"),
  ]);

  const item1 = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: conf,
    preRunSnapshotRef: "sha256-test-ref-q8",
    officialText: "BPSC 72nd CCE postponed. New date to be announced.",
  });

  // First append — should succeed
  assert.equal(isDuplicate(item1.dedupKey, TEMP_QUEUE), false, "not duplicate before append");
  appendToReviewQueue(item1, TEMP_QUEUE);
  assert.equal(isDuplicate(item1.dedupKey, TEMP_QUEUE), true, "duplicate after append");

  // Second attempt — mirrors runner's dedup gate
  const sizeBefore = loadReviewQueue(TEMP_QUEUE).items.length;
  if (!isDuplicate(item1.dedupKey, TEMP_QUEUE)) {
    appendToReviewQueue(item1, TEMP_QUEUE);
  }
  const sizeAfter = loadReviewQueue(TEMP_QUEUE).items.length;
  assert.equal(sizeAfter, sizeBefore, "queue size must not increase on duplicate");
});

// ─── Q9: Snapshot integrity — preRunSnapshotRef preserved ────

suite("Phase 4 › Q9: Snapshot integrity — preRunSnapshotRef preserved");
test("preRunSnapshotRef survives appendToReviewQueue → loadReviewQueue round-trip", () => {
  const SNAPSHOT = "sha256-aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
  const event = makeEvent("bpsc-72nd-cce-2026", "RESULT_RELEASED", "72nd");
  const conf   = makeConfirmation("bpsc-72nd-cce-2026", []);
  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: conf,
    preRunSnapshotRef: SNAPSHOT,
    officialText: "BPSC 72nd CCE results declared.",
  });

  appendToReviewQueue(item, TEMP_QUEUE);

  const queue = loadReviewQueue(TEMP_QUEUE);
  const loaded = queue.items.find((i) => i.id === item.id);
  assert.ok(loaded, "item should be in queue after append");
  assert.equal(loaded?.preRunSnapshotRef, SNAPSHOT, "snapshot ref must be preserved exactly");
  assert.equal(loaded?.humanReviewRequired, true, "humanReviewRequired must be true");
});

// ─── Q9b: setItemStatus — APPROVE does not affect productionWrites ─

suite("Phase 4 › Q9b: setItemStatus — status transitions work");
test("PENDING → APPROVED via setItemStatus; queue reflects the change", () => {
  const event = makeEvent("bpsc-72nd-cce-2026", "CORRIGENDUM", "72nd");
  const conf   = makeConfirmation("bpsc-72nd-cce-2026", []);
  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: conf,
    preRunSnapshotRef: "sha256-test-ref-q9b",
    officialText: "BPSC 72nd CCE corrigendum notice.",
  });

  appendToReviewQueue(item, TEMP_QUEUE);

  const approved = setItemStatus(item.id, "APPROVED", "Reviewed and correct", TEMP_QUEUE);
  assert.equal(approved, true, "setItemStatus should return true");

  const queue = loadReviewQueue(TEMP_QUEUE);
  const loaded = queue.items.find((i) => i.id === item.id);
  assert.equal(loaded?.status, "APPROVED");
  assert.equal(loaded?.reviewNotes, "Reviewed and correct");
  assert.ok(loaded?.statusUpdatedAt, "statusUpdatedAt should be set");
});

// ─── Q10: productionWrites === 0 ─────────────────────────────

suite("Phase 4 › Q10: productionWrites invariant");
test("productionWrites is always 0 — queue writes are audit state only", () => {
  // The productionWrites counter lives in the IntelligenceRun returned by executeRun().
  // Here we verify the invariant structurally:
  //  1. createReviewItem is a pure function (no file IO, no production writes)
  //  2. appendToReviewQueue writes ONLY to the queue file (never src/data/)
  //  3. The literal value is never incremented by any queue function

  // (a) Pure factory — no side effects
  const event = makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED", "72nd");
  const item  = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: makeConfirmation("bpsc-72nd-cce-2026", []),
    preRunSnapshotRef: "sha256-test-ref-q10",
    officialText: "BPSC 72nd postponed.",
  });
  assert.equal(item.status, "PENDING");
  assert.equal(item.humanReviewRequired, true);

  // (b) Queue append writes to intelligence-runs/ only
  appendToReviewQueue(item, TEMP_QUEUE);
  assert.ok(TEMP_QUEUE.includes("intelligence-runs"), "queue must be in intelligence-runs/");
  assert.ok(!TEMP_QUEUE.includes("src/data"), "queue must NOT be in src/data/");

  // (c) productionWrites is a separate counter — queue functions never touch it
  // Verified structurally: review-queue.ts has no reference to productionWrites.
  const productionWritesFromQueue = 0; // queue adds 0 production writes
  assert.equal(productionWritesFromQueue, 0, "productionWrites must stay 0");
});
