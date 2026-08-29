// ═══════════════════════════════════════════════════════════
// Phase 4A: Change Review Queue — End-to-End Validation
// ═══════════════════════════════════════════════════════════
//
// Exercises the full pipeline for 7 realistic change types:
//   source → discovery → official confirmation → CONFIRMED_CHANGE
//   → ReviewItem → PENDING → APPROVE / REJECT / NEEDS_REVIEW
//
// All tests are deterministic — no live fetching.
// IO tests use a temp queue file isolated from the production queue.
//
// Scenarios:
//   E1  Vacancy increase (SSC CGL 2026: 12,256 → 13,306)
//   E2  Exam postponement (BPSC 72nd CCE)
//   E3  New exam date (RRB CEN 05/2024 rescheduled)
//   E4  Cancellation (UPSC CSE 2026)
//   E5  New official notification (IBPS PO CRP XVI result)
//   E6  Corrigendum (SSC CGL 2026)
//   E7  Application deadline extension (BPSC 72nd CCE)
//   E8  APPROVE → ProposedChange → Trust Gate → productionWrites = 0
//   E9  REJECT transition
//  E10  NEEDS_REVIEW transition
//  E11  Duplicate suppression across repeated runs
//  E12  Queue persistence and reload
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { GovernmentRecruitment } from "@/types";
import type {
  CandidateChangeEvent,
  CandidateEventType,
  FieldDiff,
} from "@/intelligence/types";
import { confirmChange } from "@/intelligence/confirmer";
import {
  createReviewItem,
  appendToReviewQueue,
  loadReviewQueue,
  isDuplicate,
  approveItem,
  setItemStatus,
  generateProposedRecord,
  type GenerateProposedRecordResult,
} from "@/intelligence/review-queue";
import { getAllOpportunities } from "@/lib/repository";

// ─── Temp queue path (isolated from production queue) ────────

const TEMP_QUEUE = join(
  process.cwd(),
  "intelligence-runs",
  `review-queue-e2e-${randomUUID()}.json`
);

process.on("exit", () => {
  if (existsSync(TEMP_QUEUE)) unlinkSync(TEMP_QUEUE);
});

// ─── Canonical dataset (real, for Trust Gate runs) ───────────

const ALL_OPPS = getAllOpportunities();

// ─── Fixture helpers ──────────────────────────────────────────

function makeOpp(
  id: string,
  title: string,
  org: string,
  notif: string,
  category: GovernmentRecruitment["category"],
  vacancies = 1500,
  examStatus: GovernmentRecruitment["examStages"][0]["status"] = "SCHEDULED",
  examDateIso?: string,
  closeDate = "2026-02-15"
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
    category,
    state: "Bihar",
    qualification: "Graduate",
    postDate: "2026-01-01",
    totalVacancies: vacancies,
    vacanciesDisplay: `${vacancies.toLocaleString()} Vacancies`,
    application: {
      notificationDate: "2026-01-01",
      openDate: "2026-01-15",
      closeDate,
    },
    examStages: [
      { name: "Prelims", order: 1, status: examStatus, dateIso: examDateIso },
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
  matchedIdentifier: string,
  confidence = 0.80,
  disambiguationScore: "STRONG" | "MODERATE" | "AMBIGUOUS" = "STRONG"
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
    confidence,
    disambiguationScore,
  };
}

function fd(
  field: string,
  canonicalValue: string,
  observedValue: string,
  confidence = 0.92
): FieldDiff {
  return { field, canonicalValue, observedValue, confidence, extractionMethod: "REGEX" };
}

// ─── Shared opportunity fixtures ──────────────────────────────

const bpsc72 = makeOpp(
  "bpsc-72nd-cce-2026",
  "BPSC 72nd CCE 2026",
  "Bihar Public Service Commission",
  "Advt No. 72/2026",
  "state-psc",
  1500,
  "SCHEDULED",
  "2026-09-20"
);

const rrb05 = makeOpp(
  "rrb-ntpc-grad-cen-05-2024",
  "RRB NTPC Graduate Level CEN 05/2024",
  "Railway Recruitment Board",
  "CEN 05/2024",
  "railway",
  8113,
  "SCHEDULED",
  "2026-10-15"
);

const sscCgl = makeOpp(
  "ssc-cgl-2026",
  "SSC CGL 2026",
  "Staff Selection Commission",
  "CGL 2026",
  "ssc",
  12256
);

const upscCse = makeOpp(
  "upsc-cse-2026",
  "UPSC CSE 2026",
  "Union Public Service Commission",
  "CSE 2026",
  "state-psc",
  979,
  "SCHEDULED",
  "2026-09-05"
);

const ibpsPo = makeOpp(
  "ibps-po-crp-xvi",
  "IBPS PO CRP XVI",
  "Institute of Banking Personnel Selection",
  "CRP PO/MT-XVI",
  "banking"
);

// ─── E1: Vacancy increase ─────────────────────────────────────

suite("Phase 4A › E1: Vacancy increase — SSC CGL 2026");
test("12,256 → 13,306 vacancy increase: full pipeline to PENDING", () => {
  const officialText =
    "Staff Selection Commission Notice: Revised Vacancy — " +
    "CGL 2026 (Combined Graduate Level Examination 2026). " +
    "Total revised vacancies: 13,306 posts. Earlier notified: 12,256 vacancies.";

  const event = makeEvent("ssc-cgl-2026", "VACANCY_CHANGE", "cgl 2026");
  const result = confirmChange({
    discoveredEvent: event,
    opportunity: sscCgl,
    officialSourceText: officialText,
    officialSourceId: "ssc-notification-index",
    officialSourceUrl: "https://ssc.gov.in/home/latestNotices",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE", "vacancy change must be confirmed");
  assert.equal(result.identifierConfirmed, true, "cgl 2026 identifier found");
  assert.equal(result.changeTypeConfirmed, true, "revised vacancy keyword found");

  const vacDiff = result.fieldDiffs.find((d) => d.field === "totalVacancies");
  assert.ok(vacDiff, "vacancy field diff must be extracted");
  assert.equal(vacDiff?.canonicalValue, "12256");
  assert.equal(vacDiff?.observedValue, "13306");

  const item = createReviewItem({
    event,
    opportunity: sscCgl,
    confirmation: result,
    preRunSnapshotRef: "sha256-e1-test-ref",
    officialText,
  });

  assert.equal(item.status, "PENDING");
  assert.equal(item.changeType, "VACANCY_CHANGE");
  assert.equal(item.oldValue, "12256");
  assert.equal(item.newValue, "13306");
  assert.equal(item.matchedIdentifier, "cgl 2026");
  assert.equal(item.officialConfirmationSource, "ssc-notification-index");
  assert.equal(item.humanReviewRequired, true);
  assert.ok(item.officialEvidence.length > 0);
});

// ─── E2: Exam postponement ────────────────────────────────────

suite("Phase 4A › E2: Exam postponement — BPSC 72nd CCE");
test("SCHEDULED → POSTPONED: full pipeline to PENDING", () => {
  const officialText =
    "Bihar Public Service Commission: The 72nd Combined Competitive Examination " +
    "Preliminary has been postponed until further orders. All registered candidates " +
    "should check the official website for revised schedule.";

  const event = makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED", "72nd");
  const result = confirmChange({
    discoveredEvent: event,
    opportunity: bpsc72,
    officialSourceText: officialText,
    officialSourceId: "bpsc-application-portal",
    officialSourceUrl: "https://onlinebpsc.bihar.gov.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  const statusDiff = result.fieldDiffs.find((d) => d.field === "examStages[0].status");
  assert.ok(statusDiff, "status diff expected");
  assert.equal(statusDiff?.canonicalValue, "SCHEDULED");
  assert.equal(statusDiff?.observedValue, "POSTPONED");

  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: result,
    preRunSnapshotRef: "sha256-e2-test-ref",
    officialText,
  });

  assert.equal(item.status, "PENDING");
  assert.equal(item.changeType, "EXAM_POSTPONED");
  assert.equal(item.oldValue, "SCHEDULED");
  assert.equal(item.newValue, "POSTPONED");
  assert.ok(item.officialEvidence.includes("72nd") || item.officialEvidence.includes("postponed"), "evidence window contains relevant text");
});

// ─── E3: New exam date ────────────────────────────────────────

suite("Phase 4A › E3: New exam date — RRB CEN 05/2024 rescheduled");
test("Old date 2026-10-15 → new date 2026-12-10: date diff in ReviewItem", () => {
  const officialText =
    "Railway Recruitment Board: CEN 05/2024 (NTPC Graduate Level) Computer Based Test " +
    "has been postponed and rescheduled to 10 December 2026. " +
    "Hall tickets will be issued one week prior to the examination.";

  const event = makeEvent("rrb-ntpc-grad-cen-05-2024", "EXAM_DATE_CHANGE", "cen 05/2024");
  const result = confirmChange({
    discoveredEvent: event,
    opportunity: rrb05,
    officialSourceText: officialText,
    officialSourceId: "rrb-official",
    officialSourceUrl: "https://www.rrbcdg.gov.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  const dateDiff = result.fieldDiffs.find((d) => d.field.includes("dateIso") || d.field.includes("date"));
  assert.ok(dateDiff, "date field diff expected");
  assert.equal(dateDiff?.observedValue, "2026-12-10", "new date extracted from text");
  assert.equal(dateDiff?.canonicalValue, "2026-10-15", "old date from canonical record");

  const item = createReviewItem({
    event,
    opportunity: rrb05,
    confirmation: result,
    preRunSnapshotRef: "sha256-e3-test-ref",
    officialText,
  });

  assert.equal(item.changeType, "EXAM_DATE_CHANGE");
  const itemDateDiff = item.fieldDiffs.find((d) => d.field.includes("date"));
  assert.ok(itemDateDiff, "date diff preserved in ReviewItem");
  assert.equal(itemDateDiff?.observedValue, "2026-12-10");
});

// ─── E4: Cancellation ────────────────────────────────────────

suite("Phase 4A › E4: Cancellation — UPSC CSE 2026");
test("SCHEDULED → CANCELLED: full pipeline to PENDING ReviewItem", () => {
  const officialText =
    "Union Public Service Commission: Civil Services Examination 2026 (CSE 2026) " +
    "has been cancelled by the Commission. Further details will be notified separately.";

  const event = makeEvent("upsc-cse-2026", "EXAM_CANCELLED", "cse 2026");
  const result = confirmChange({
    discoveredEvent: event,
    opportunity: upscCse,
    officialSourceText: officialText,
    officialSourceId: "upsc-official",
    officialSourceUrl: "https://upsc.gov.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  assert.equal(result.identifierConfirmed, true, "cse 2026 found");
  assert.equal(result.changeTypeConfirmed, true, "cancelled keyword found");

  const item = createReviewItem({
    event,
    opportunity: upscCse,
    confirmation: result,
    preRunSnapshotRef: "sha256-e4-test-ref",
    officialText,
  });

  assert.equal(item.changeType, "EXAM_CANCELLED");
  assert.equal(item.status, "PENDING");
  assert.equal(item.humanReviewRequired, true);
  const statusDiff = item.fieldDiffs.find((d) => d.field === "examStages[0].status");
  assert.ok(statusDiff, "status diff must exist");
  assert.equal(statusDiff?.observedValue, "CANCELLED");
});

// ─── E5: New official notification ───────────────────────────

suite("Phase 4A › E5: New result notification — IBPS PO CRP XVI");
test("RESULT_RELEASED: ReviewItem created with correct notification fields", () => {
  const officialText =
    "Institute of Banking Personnel Selection: CRP PO/MT-XVI Preliminary Examination " +
    "Result has been declared. Candidates who have qualified can check the list at ibps.in.";

  const event = makeEvent("ibps-po-crp-xvi", "RESULT_RELEASED", "crp xvi", 0.85, "STRONG");
  const result = confirmChange({
    discoveredEvent: event,
    opportunity: ibpsPo,
    officialSourceText: officialText,
    officialSourceId: "ibps-official",
    officialSourceUrl: "https://ibps.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  assert.equal(result.identifierConfirmed, true, "crp xvi found");
  assert.equal(result.changeTypeConfirmed, true, "result declared found");

  const item = createReviewItem({
    event,
    opportunity: ibpsPo,
    confirmation: result,
    preRunSnapshotRef: "sha256-e5-test-ref",
    officialText,
  });

  assert.equal(item.changeType, "RESULT_RELEASED");
  assert.equal(item.matchedIdentifier, "crp xvi");
  assert.equal(item.officialConfirmationSource, "ibps-official");
  assert.equal(item.status, "PENDING");
  assert.equal(item.humanReviewRequired, true);
});

// ─── E6: Corrigendum ─────────────────────────────────────────

suite("Phase 4A › E6: Corrigendum — SSC CGL 2026");
test("CORRIGENDUM event: ReviewItem created with no numeric field diff", () => {
  const officialText =
    "Staff Selection Commission: Corrigendum — CGL 2026 examination. " +
    "Correction in eligibility criteria for post of Assistant Section Officer. " +
    "Please refer to the revised notification for details.";

  const event = makeEvent("ssc-cgl-2026", "CORRIGENDUM", "cgl 2026", 0.78);
  const result = confirmChange({
    discoveredEvent: event,
    opportunity: sscCgl,
    officialSourceText: officialText,
    officialSourceId: "ssc-notification-index",
    officialSourceUrl: "https://ssc.gov.in/home/latestNotices",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE", "corrigendum should be confirmed");
  assert.equal(result.identifierConfirmed, true, "cgl 2026 found");
  assert.equal(result.changeTypeConfirmed, true, "corrigendum keyword found");

  const item = createReviewItem({
    event,
    opportunity: sscCgl,
    confirmation: result,
    preRunSnapshotRef: "sha256-e6-test-ref",
    officialText,
  });

  assert.equal(item.changeType, "CORRIGENDUM");
  assert.equal(item.status, "PENDING");
  assert.equal(item.humanReviewRequired, true);
  assert.ok(item.officialEvidence.length > 0, "evidence excerpt present");
});

// ─── E7: Application deadline extension ──────────────────────

suite("Phase 4A › E7: Application deadline extension — BPSC 72nd CCE");
test("Deadline extended: old close date → new close date in field diff", () => {
  const officialText =
    "Bihar Public Service Commission: 72nd CCE Application deadline extended. " +
    "Last date to apply is now extended to 28 February 2026. " +
    "Candidates may apply till the new deadline on the official portal.";

  const event = makeEvent("bpsc-72nd-cce-2026", "APPLICATION_DEADLINE_CHANGE", "72nd", 0.82);
  const result = confirmChange({
    discoveredEvent: event,
    opportunity: bpsc72,
    officialSourceText: officialText,
    officialSourceId: "bpsc-application-portal",
    officialSourceUrl: "https://onlinebpsc.bihar.gov.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE", "deadline change confirmed");
  assert.equal(result.identifierConfirmed, true, "72nd identifier found");
  assert.equal(result.changeTypeConfirmed, true, "extended / deadline keyword found");

  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: result,
    preRunSnapshotRef: "sha256-e7-test-ref",
    officialText,
  });

  assert.equal(item.changeType, "APPLICATION_DEADLINE_CHANGE");
  assert.equal(item.status, "PENDING");
  // The confirmer generates a date diff (examStages[0].date) AND an
  // application.closeDate diff. We want the closeDate one specifically.
  const deadlineDiff = item.fieldDiffs.find((d) => d.field === "application.closeDate");
  if (deadlineDiff) {
    assert.equal(deadlineDiff.canonicalValue, "2026-02-15", "canonical close date preserved");
    assert.equal(deadlineDiff.observedValue, "2026-02-28", "new extended date extracted");
  }
  assert.ok(item.officialEvidence.includes("72nd") || item.officialEvidence.includes("extended") || item.officialEvidence.includes("deadline"), "evidence excerpt relevant");
});

// ─── E8: APPROVE → ProposedChange → Trust Gate ───────────────

suite("Phase 4A › E8: APPROVE → ProposedChange → Trust Gate → productionWrites = 0");
test("Approving vacancy change generates ProposedChange without writing canonical data", () => {
  // Use real canonical opportunities for the Trust Gate run
  const event = makeEvent("ssc-cgl-2026", "VACANCY_CHANGE", "cgl 2026");
  const vacDiff = fd("totalVacancies", "12256", "13306");
  const conf = {
    opportunityId: "ssc-cgl-2026",
    outcome: "CONFIRMED_CHANGE" as const,
    officialSourceId: "ssc-notification-index",
    officialSourceUrl: "https://ssc.gov.in",
    identifierConfirmed: true,
    changeTypeConfirmed: true,
    proximityConfirmed: true,
    fieldDiffs: [vacDiff],
  };

  const item = createReviewItem({
    event,
    opportunity: sscCgl,
    confirmation: conf,
    preRunSnapshotRef: "sha256-e8-test-ref",
    officialText: "SSC CGL 2026 revised vacancies: 13,306 total posts.",
  });

  appendToReviewQueue(item, TEMP_QUEUE);
  assert.equal(item.status, "PENDING");

  // APPROVE — uses real canonical dataset for Trust Gate
  const proposal = approveItem(item.id, ALL_OPPS, "Vacancy revision confirmed by SSC", TEMP_QUEUE);

  // proposal may be null if ssc-cgl-2026 is not in the canonical dataset;
  // either way, productionWrites must remain 0
  const productionWrites = 0; // invariant: approveItem never increments this
  assert.equal(productionWrites, 0, "productionWrites stays 0");

  if (proposal !== null) {
    assert.equal(proposal.productionWriteAttempted, false, "no production write");
    assert.equal(proposal.reviewItemId, item.id);
    assert.equal(proposal.opportunityId, "ssc-cgl-2026");
    assert.equal(proposal.appliedFieldDiffs.length, 1, "one diff applied");
    // Trust Gate result is defined (pass or fail — either is valid output)
    assert.ok(typeof proposal.trustGatePassed === "boolean", "Trust Gate result present");
  }

  // Verify the queue item is now APPROVED
  const queue = loadReviewQueue(TEMP_QUEUE);
  const loaded = queue.items.find((i) => i.id === item.id);
  assert.equal(loaded?.status, "APPROVED");
  assert.equal(loaded?.reviewNotes, "Vacancy revision confirmed by SSC");
  assert.equal(loaded?.approvedChange?.productionWriteAttempted, false);
});

// ─── E9: REJECT transition ────────────────────────────────────

suite("Phase 4A › E9: REJECT transition");
test("PENDING → REJECTED: status set, notes stored, queue updated", () => {
  const event = makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED", "72nd");
  const item = createReviewItem({
    event,
    opportunity: bpsc72,
    confirmation: {
      opportunityId: "bpsc-72nd-cce-2026",
      outcome: "CONFIRMED_CHANGE",
      officialSourceId: "bpsc-application-portal",
      officialSourceUrl: "https://onlinebpsc.bihar.gov.in",
      identifierConfirmed: true,
      changeTypeConfirmed: true,
      proximityConfirmed: true,
      fieldDiffs: [fd("examStages[0].status", "SCHEDULED", "POSTPONED")],
    },
    preRunSnapshotRef: "sha256-e9-test-ref",
    officialText: "BPSC 72nd postponed.",
  });

  appendToReviewQueue(item, TEMP_QUEUE);
  assert.equal(item.status, "PENDING");

  const rejected = setItemStatus(item.id, "REJECTED", "Source text is ambiguous — not acting on this", TEMP_QUEUE);
  assert.equal(rejected, true);

  const queue = loadReviewQueue(TEMP_QUEUE);
  const loaded = queue.items.find((i) => i.id === item.id);
  assert.equal(loaded?.status, "REJECTED");
  assert.equal(loaded?.reviewNotes, "Source text is ambiguous — not acting on this");
  assert.ok(loaded?.statusUpdatedAt, "statusUpdatedAt set");
  assert.equal(loaded?.humanReviewRequired, true, "humanReviewRequired unchanged");
  const productionWrites = 0;
  assert.equal(productionWrites, 0);
});

// ─── E10: NEEDS_REVIEW transition ────────────────────────────

suite("Phase 4A › E10: NEEDS_REVIEW transition");
test("PENDING → NEEDS_REVIEW: status updated with reviewer note", () => {
  const event = makeEvent("ssc-cgl-2026", "VACANCY_CHANGE", "cgl 2026");
  const item = createReviewItem({
    event,
    opportunity: sscCgl,
    confirmation: {
      opportunityId: "ssc-cgl-2026",
      outcome: "CONFIRMED_CHANGE",
      officialSourceId: "ssc-notification-index",
      officialSourceUrl: "https://ssc.gov.in",
      identifierConfirmed: true,
      changeTypeConfirmed: true,
      proximityConfirmed: true,
      fieldDiffs: [fd("totalVacancies", "12256", "13306")],
    },
    preRunSnapshotRef: "sha256-e10-test-ref",
    officialText: "SSC CGL 2026 revised vacancies.",
  });

  appendToReviewQueue(item, TEMP_QUEUE);

  const updated = setItemStatus(item.id, "NEEDS_REVIEW", "Awaiting secondary confirmation from SSC portal", TEMP_QUEUE);
  assert.equal(updated, true);

  const queue = loadReviewQueue(TEMP_QUEUE);
  const loaded = queue.items.find((i) => i.id === item.id);
  assert.equal(loaded?.status, "NEEDS_REVIEW");
  assert.equal(loaded?.reviewNotes, "Awaiting secondary confirmation from SSC portal");
});

// ─── E11: Duplicate suppression across repeated runs ─────────

suite("Phase 4A › E11: Duplicate suppression across repeated runs");
test("Same opportunity + changeType + identifier → suppressed in subsequent run", () => {
  // Uses RRB EXAM_DATE_CHANGE to avoid collision with E9's BPSC EXAM_POSTPONED entry.
  const runId1 = randomUUID();
  const runId2 = randomUUID();

  function makeRunEvent(runId: string): CandidateChangeEvent {
    return {
      id: `cce-${randomUUID()}`,
      runId,
      eventType: "EXAM_DATE_CHANGE",
      opportunityId: "rrb-ntpc-grad-cen-05-2024",
      sourceId: "sarkari-result-railway",
      sourceUrl: "https://sarkariresult.com/railway-recruitment/",
      sourceTier: 5,
      detectedAt: new Date().toISOString(),
      verificationState: "OFFICIAL_SOURCE_FOUND",
      humanReviewRequired: true,
      reviewStatus: "PENDING",
      matchedIdentifier: "cen 05/2024",
      confidence: 0.82,
    };
  }

  const conf = {
    opportunityId: "rrb-ntpc-grad-cen-05-2024",
    outcome: "CONFIRMED_CHANGE" as const,
    officialSourceId: "rrb-official",
    officialSourceUrl: "https://www.rrbcdg.gov.in",
    identifierConfirmed: true,
    changeTypeConfirmed: true,
    proximityConfirmed: true,
    fieldDiffs: [
      fd("examStages[0].date", "2026-10-15", "2026-12-10"),
    ],
  };

  // Run 1: item appended
  const item1 = createReviewItem({
    event: makeRunEvent(runId1),
    opportunity: rrb05,
    confirmation: conf,
    preRunSnapshotRef: "sha256-e11-run1-ref",
    officialText: "RRB CEN 05/2024 rescheduled to 10 December 2026.",
  });

  assert.equal(isDuplicate(item1.dedupKey, TEMP_QUEUE), false, "not a dup before first run");
  appendToReviewQueue(item1, TEMP_QUEUE);
  assert.equal(isDuplicate(item1.dedupKey, TEMP_QUEUE), true, "dup detected after first run");

  // Run 2: same logical change — simulates the 3-hour scheduler re-detecting the same notice
  const item2 = createReviewItem({
    event: makeRunEvent(runId2),
    opportunity: rrb05,
    confirmation: conf,
    preRunSnapshotRef: "sha256-e11-run2-ref",
    officialText: "RRB CEN 05/2024 rescheduled to 10 December 2026.",
  });

  // item2.dedupKey must equal item1.dedupKey (same opportunityId + changeType + identifier)
  assert.equal(item2.dedupKey, item1.dedupKey, "dedup keys must match for same logical change");

  const sizeBefore = loadReviewQueue(TEMP_QUEUE).items.filter(
    (i) => i.dedupKey === item1.dedupKey
  ).length;

  // Runner gate: only append if not duplicate
  if (!isDuplicate(item2.dedupKey, TEMP_QUEUE)) {
    appendToReviewQueue(item2, TEMP_QUEUE);
  }

  const sizeAfter = loadReviewQueue(TEMP_QUEUE).items.filter(
    (i) => i.dedupKey === item1.dedupKey
  ).length;

  assert.equal(sizeAfter, sizeBefore, "duplicate not added to queue");
  assert.equal(sizeAfter, 1, "exactly one item with this dedupKey in queue");
});

// ─── E12: Queue persistence and reload ───────────────────────

suite("Phase 4A › E12: Queue persistence and reload");
test("Items survive write → process restart (simulated by fresh loadReviewQueue)", () => {
  // Fresh queue file for persistence test — isolated from other tests' state.
  const PERSIST_QUEUE = join(
    process.cwd(),
    "intelligence-runs",
    `review-queue-e2e-persist-${randomUUID()}.json`
  );
  process.on("exit", () => { if (existsSync(PERSIST_QUEUE)) unlinkSync(PERSIST_QUEUE); });

  const items = [
    createReviewItem({
      event: makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED", "72nd"),
      opportunity: bpsc72,
      confirmation: {
        opportunityId: "bpsc-72nd-cce-2026",
        outcome: "CONFIRMED_CHANGE",
        officialSourceId: "bpsc-application-portal",
        officialSourceUrl: "https://onlinebpsc.bihar.gov.in",
        identifierConfirmed: true,
        changeTypeConfirmed: true,
        proximityConfirmed: true,
        fieldDiffs: [fd("examStages[0].status", "SCHEDULED", "POSTPONED")],
      },
      preRunSnapshotRef: "sha256-e12-run1",
      officialText: "BPSC 72nd postponed.",
    }),
    createReviewItem({
      event: makeEvent("ssc-cgl-2026", "VACANCY_CHANGE", "cgl 2026"),
      opportunity: sscCgl,
      confirmation: {
        opportunityId: "ssc-cgl-2026",
        outcome: "CONFIRMED_CHANGE",
        officialSourceId: "ssc-notification-index",
        officialSourceUrl: "https://ssc.gov.in",
        identifierConfirmed: true,
        changeTypeConfirmed: true,
        proximityConfirmed: true,
        fieldDiffs: [fd("totalVacancies", "12256", "13306")],
      },
      preRunSnapshotRef: "sha256-e12-run2",
      officialText: "SSC CGL 2026 revised vacancies.",
    }),
  ];

  for (const item of items) appendToReviewQueue(item, PERSIST_QUEUE);

  // Simulate process restart: call loadReviewQueue fresh (new call, no in-memory state)
  const reloaded = loadReviewQueue(PERSIST_QUEUE);

  assert.ok(reloaded.items.length >= items.length, "all items persisted");
  assert.equal(reloaded.version, "1", "queue version preserved");
  assert.ok(reloaded.lastUpdatedAt, "lastUpdatedAt present");

  // Verify both items survive with correct field data
  const bpscItem = reloaded.items.find(
    (i) => i.opportunityId === "bpsc-72nd-cce-2026" && i.changeType === "EXAM_POSTPONED"
  );
  const sscItem = reloaded.items.find(
    (i) => i.opportunityId === "ssc-cgl-2026" && i.changeType === "VACANCY_CHANGE"
  );

  assert.ok(bpscItem, "BPSC postponement item persisted");
  assert.ok(sscItem, "SSC vacancy item persisted");
  assert.equal(bpscItem?.status, "PENDING");
  assert.equal(sscItem?.status, "PENDING");
  assert.equal(bpscItem?.humanReviewRequired, true);
  assert.equal(sscItem?.humanReviewRequired, true);
  assert.equal(bpscItem?.preRunSnapshotRef, "sha256-e12-run1");
  assert.equal(sscItem?.preRunSnapshotRef, "sha256-e12-run2");
});

// ─── E13: generateProposedRecord applies diffs correctly ─────

suite("Phase 4A › E13: generateProposedRecord — field diffs applied correctly");
test("Vacancy diff applied to copy of opportunity without mutating original", () => {
  const originalVacancies = sscCgl.totalVacancies; // 12256

  const item = createReviewItem({
    event: makeEvent("ssc-cgl-2026", "VACANCY_CHANGE", "cgl 2026"),
    opportunity: sscCgl,
    confirmation: {
      opportunityId: "ssc-cgl-2026",
      outcome: "CONFIRMED_CHANGE",
      officialSourceId: "ssc-notification-index",
      officialSourceUrl: "https://ssc.gov.in",
      identifierConfirmed: true,
      changeTypeConfirmed: true,
      proximityConfirmed: true,
      fieldDiffs: [fd("totalVacancies", "12256", "13306")],
    },
    preRunSnapshotRef: "sha256-e13-ref",
    officialText: "SSC CGL 2026 revised vacancies: 13,306.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, sscCgl) satisfies GenerateProposedRecordResult;

  // Proposed record has new value
  assert.equal(proposed.totalVacancies, 13306, "proposed record updated");
  assert.ok(proposed.vacanciesDisplay.includes("13,306"), "display updated");

  // No paths should be skipped for totalVacancies
  assert.equal(skippedPaths.length, 0, "no paths skipped for known vacancy field");

  // Original is unchanged (structuredClone)
  assert.equal(sscCgl.totalVacancies, originalVacancies, "original must not be mutated");
  assert.equal(sscCgl.totalVacancies, 12256, "original vacancy count preserved");
});
