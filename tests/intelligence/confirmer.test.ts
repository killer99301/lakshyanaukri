// ═══════════════════════════════════════════════════════════
// Phase 3: Official Source Confirmation Tests
// ═══════════════════════════════════════════════════════════
//
// Tests for confirmer.ts — deterministic, no live fetching.
//
// Scenarios:
//   T1  BPSC 72nd postponed — official page confirms
//   T2  BPSC 72nd postponed with new date — date diff extracted
//   T3  Official page mentions BPSC but NOT 72nd — AMBIGUOUS
//   T4  Official page has 72nd but no postponement — NOT_CONFIRMED
//   T5  Official source unavailable — OFFICIAL_UNAVAILABLE
//   T6  RRB CEN 05/2024 postponed — confirmed
//   T7  SSC CGL 2026 vacancy revised — vacancy diff extracted
//   T8  IBPS PO CRP XVI result released — confirmed
//   T9  UPSC CSE 2026 postponed — confirmed
//   T10 Identifier and keyword > 200 chars apart — AMBIGUOUS
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import type { GovernmentRecruitment } from "@/types";
import type { CandidateChangeEvent, CandidateEventType } from "@/intelligence/types";
import { confirmChange, confirmUnavailable } from "@/intelligence/confirmer";

// ─── Mock helpers ─────────────────────────────────────────────

function makeGovOpp(
  id: string,
  title: string,
  organizationName: string,
  notificationNumber: string,
  examStatus: GovernmentRecruitment["examStages"][0]["status"],
  examDateIso?: string,
  totalVacancies = 1500,
  closeDate = "2026-02-15"
): GovernmentRecruitment {
  return {
    id,
    slug: id,
    title,
    type: "government",
    organizationId: id.split("-")[0],
    organizationName,
    notificationNumber,
    govType: "State Govt",
    shortDescription: "",
    category: "state-psc",
    state: "Bihar",
    qualification: "Graduate",
    postDate: "2026-01-01",
    totalVacancies,
    vacanciesDisplay: `${totalVacancies.toLocaleString()} Vacancies`,
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
  eventType: CandidateEventType
): CandidateChangeEvent {
  return {
    id: "cce-test-1",
    runId: "run-test-1",
    eventType,
    opportunityId,
    sourceId: "test-secondary-source",
    sourceUrl: "https://secondary.example.com",
    sourceTier: 5,
    detectedAt: new Date().toISOString(),
    verificationState: "DISCOVERED",
    humanReviewRequired: true,
    reviewStatus: "PENDING",
  };
}

// ─── Fixtures ─────────────────────────────────────────────────

const bpsc72 = makeGovOpp(
  "bpsc-72nd-cce-2026",
  "BPSC 72nd CCE 2026",
  "Bihar Public Service Commission",
  "Advt No. 72/2026",
  "SCHEDULED",
  "2026-09-20"
);

const rrb05 = makeGovOpp(
  "rrb-ntpc-grad-cen-05-2024",
  "RRB NTPC Graduate Level CEN 05/2024",
  "Railway Recruitment Board",
  "CEN 05/2024",
  "SCHEDULED",
  "2026-10-15"
);

const sscCgl = makeGovOpp(
  "ssc-cgl-2026",
  "SSC CGL 2026",
  "Staff Selection Commission",
  "CGL 2026",
  "SCHEDULED",
  undefined,
  14582  // current vacancy count
);

const ibpsPo = makeGovOpp(
  "ibps-po-crp-xvi",
  "IBPS PO CRP XVI",
  "Institute of Banking Personnel Selection",
  "CRP PO/MT-XVI",
  "CONDUCTED",
  undefined
);

const upscCse = makeGovOpp(
  "upsc-cse-2026",
  "UPSC CSE 2026",
  "Union Public Service Commission",
  "CSE 2026",
  "SCHEDULED",
  "2026-09-05"
);

// ─── T1: BPSC 72nd postponed — official page confirms ────────

suite("Phase 3 › T1: BPSC 72nd postponement confirmed");
test("CONFIRMED_CHANGE: identifier + postponement within 200 chars", () => {
  const officialText =
    "Bihar Public Service Commission Notice: The BPSC 72nd Combined Competitive Examination " +
    "Prelims has been postponed. The examination stands postponed until further orders are issued.";

  const result = confirmChange({
    discoveredEvent: makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED"),
    opportunity: bpsc72,
    officialSourceText: officialText,
    officialSourceId: "bpsc-official",
    officialSourceUrl: "https://bpsc.bih.nic.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  assert.equal(result.identifierConfirmed, true, "identifier 72nd should be found");
  assert.equal(result.changeTypeConfirmed, true, "postponed should be found");
  assert.equal(result.proximityConfirmed, true, "72nd and postponed within 200 chars");
  assert.ok(result.fieldDiffs.length >= 1, "at least one field diff expected");
  const statusDiff = result.fieldDiffs.find((d) => d.field === "examStages[0].status");
  assert.ok(statusDiff, "status diff should exist");
  assert.equal(statusDiff?.canonicalValue, "SCHEDULED");
  assert.equal(statusDiff?.observedValue, "POSTPONED");
});

// ─── T2: BPSC 72nd postponed with new date ───────────────────

suite("Phase 3 › T2: BPSC 72nd postponed — new date extracted");
test("CONFIRMED_CHANGE: date diff extracted from official text", () => {
  const officialText =
    "BPSC 72nd CCE Preliminary Examination has been postponed and is now rescheduled " +
    "to 20 November 2026 as per the Commission's revised schedule.";

  const result = confirmChange({
    discoveredEvent: makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED"),
    opportunity: bpsc72,
    officialSourceText: officialText,
    officialSourceId: "bpsc-official",
    officialSourceUrl: "https://bpsc.bih.nic.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  const statusDiff = result.fieldDiffs.find((d) => d.field === "examStages[0].status");
  assert.ok(statusDiff, "status diff expected");
  assert.equal(statusDiff?.observedValue, "POSTPONED");
  const dateDiff = result.fieldDiffs.find((d) => d.field.includes(".date"));
  assert.ok(dateDiff, "date diff expected");
  assert.equal(dateDiff?.canonicalValue, "2026-09-20", "canonical date preserved");
  assert.equal(dateDiff?.observedValue, "2026-11-20", "ISO date extracted from text");
});

// ─── T3: Official page mentions BPSC but NOT 72nd ────────────

suite("Phase 3 › T3: Identifier absent from official page");
test("AMBIGUOUS_CONFIRMATION: change keyword found but cannot attribute to 72nd", () => {
  const officialText =
    "Bihar Public Service Commission has postponed an important examination. " +
    "All candidates are advised to visit the official website for further updates.";
  // "72nd", "72/2026" are NOT in this text.

  const result = confirmChange({
    discoveredEvent: makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED"),
    opportunity: bpsc72,
    officialSourceText: officialText,
    officialSourceId: "bpsc-official",
    officialSourceUrl: "https://bpsc.bih.nic.in",
  });

  assert.equal(result.identifierConfirmed, false, "72nd not in text");
  assert.equal(result.changeTypeConfirmed, true, "postponed found");
  assert.equal(result.outcome, "AMBIGUOUS_CONFIRMATION");
  assert.equal(result.fieldDiffs.length, 0, "no field diffs without identifier");
});

// ─── T4: Official page has 72nd but no postponement ──────────

suite("Phase 3 › T4: Identifier present but change keyword absent");
test("NOT_CONFIRMED: 72nd on official page but no postponement language", () => {
  const officialText =
    "BPSC 72nd Combined Competitive Examination 2026: Applications are now open. " +
    "Total vacancies: 1500 posts. Last date to apply: 15 February 2026.";
  // No "postponed", "deferred", etc.

  const result = confirmChange({
    discoveredEvent: makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED"),
    opportunity: bpsc72,
    officialSourceText: officialText,
    officialSourceId: "bpsc-official",
    officialSourceUrl: "https://bpsc.bih.nic.in",
  });

  assert.equal(result.identifierConfirmed, true, "72nd found");
  assert.equal(result.changeTypeConfirmed, false, "no postponement language");
  assert.equal(result.outcome, "NOT_CONFIRMED");
});

// ─── T5: Official source unavailable ─────────────────────────

suite("Phase 3 › T5: Official source unavailable");
test("OFFICIAL_UNAVAILABLE returned by confirmUnavailable()", () => {
  const event = makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED");
  const result = confirmUnavailable(event, bpsc72, "bpsc-official", "https://bpsc.bih.nic.in");

  assert.equal(result.outcome, "OFFICIAL_UNAVAILABLE");
  assert.equal(result.identifierConfirmed, false);
  assert.equal(result.changeTypeConfirmed, false);
  assert.equal(result.proximityConfirmed, false);
  assert.equal(result.fieldDiffs.length, 0);
  assert.equal(result.opportunityId, "bpsc-72nd-cce-2026");
});

// ─── T6: RRB CEN 05/2024 postponed confirmed ─────────────────

suite("Phase 3 › T6: RRB CEN 05/2024 postponement confirmed");
test("CONFIRMED_CHANGE: cen 05/2024 identifier + postponed keyword", () => {
  const officialText =
    "Railway Recruitment Board: Computer Based Test (CBT-1) for CEN 05/2024 " +
    "(NTPC Graduate Level Posts) has been postponed. New schedule will be announced separately.";

  const result = confirmChange({
    discoveredEvent: makeEvent("rrb-ntpc-grad-cen-05-2024", "EXAM_POSTPONED"),
    opportunity: rrb05,
    officialSourceText: officialText,
    officialSourceId: "rrb-official",
    officialSourceUrl: "https://www.rrbcdg.gov.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  assert.equal(result.identifierConfirmed, true, "cen 05/2024 found");
  assert.equal(result.changeTypeConfirmed, true, "postponed found");
  assert.equal(result.proximityConfirmed, true, "within 200 chars");
  const statusDiff = result.fieldDiffs.find((d) => d.field === "examStages[0].status");
  assert.ok(statusDiff, "status diff expected");
  assert.equal(statusDiff?.observedValue, "POSTPONED");
});

// ─── T7: SSC CGL 2026 vacancy revision confirmed ─────────────

suite("Phase 3 › T7: SSC CGL 2026 vacancy revision");
test("CONFIRMED_CHANGE: cgl 2026 + vacancy revised + count diff extracted", () => {
  const officialText =
    "Staff Selection Commission: Revised Vacancies for CGL 2026 (Combined Graduate Level Examination). " +
    "Total revised posts: 17,727 against earlier notified 14,582 vacancies.";

  const result = confirmChange({
    discoveredEvent: makeEvent("ssc-cgl-2026", "VACANCY_CHANGE"),
    opportunity: sscCgl,
    officialSourceText: officialText,
    officialSourceId: "ssc-official",
    officialSourceUrl: "https://ssc.gov.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  assert.equal(result.identifierConfirmed, true, "cgl 2026 identifier found");
  assert.equal(result.changeTypeConfirmed, true, "revised vacancy found");
  const vacDiff = result.fieldDiffs.find((d) => d.field === "totalVacancies");
  assert.ok(vacDiff, "vacancy diff expected");
  assert.equal(vacDiff?.canonicalValue, "14582");
  assert.equal(vacDiff?.observedValue, "17727");
});

// ─── T8: IBPS PO CRP XVI result released confirmed ───────────

suite("Phase 3 › T8: IBPS PO CRP XVI result confirmed");
test("CONFIRMED_CHANGE: crp xvi + result declared keyword", () => {
  const officialText =
    "Institute of Banking Personnel Selection: CRP PO/MT-XVI Preliminary Examination " +
    "Result has been declared. Candidates can check their result at ibps.in.";

  const result = confirmChange({
    discoveredEvent: makeEvent("ibps-po-crp-xvi", "RESULT_RELEASED"),
    opportunity: ibpsPo,
    officialSourceText: officialText,
    officialSourceId: "ibps-official",
    officialSourceUrl: "https://ibps.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  assert.equal(result.identifierConfirmed, true, "crp xvi identifier found");
  assert.equal(result.changeTypeConfirmed, true, "result declared found");
  assert.equal(result.proximityConfirmed, true);
});

// ─── T9: UPSC CSE 2026 postponement confirmed ────────────────

suite("Phase 3 › T9: UPSC CSE 2026 mains postponed confirmed");
test("CONFIRMED_CHANGE: cse 2026 + postponed keyword within proximity", () => {
  const officialText =
    "Union Public Service Commission: Civil Services Examination 2026 (CSE 2026) " +
    "Mains Examination stands postponed until further notice. Candidates are advised " +
    "to keep checking the official UPSC website for the revised schedule.";

  const result = confirmChange({
    discoveredEvent: makeEvent("upsc-cse-2026", "EXAM_POSTPONED"),
    opportunity: upscCse,
    officialSourceText: officialText,
    officialSourceId: "upsc-official",
    officialSourceUrl: "https://upsc.gov.in",
  });

  assert.equal(result.outcome, "CONFIRMED_CHANGE");
  assert.equal(result.identifierConfirmed, true, "cse 2026 found");
  assert.equal(result.changeTypeConfirmed, true, "postponed found");
  const statusDiff = result.fieldDiffs.find((d) => d.field === "examStages[0].status");
  assert.ok(statusDiff, "status diff expected");
  assert.equal(statusDiff?.observedValue, "POSTPONED");
});

// ─── T10: Identifier and keyword > 200 chars apart ───────────

suite("Phase 3 › T10: Proximity failure — > 200 chars apart");
test("AMBIGUOUS_CONFIRMATION: both signals present but too far apart", () => {
  // Identifier at start (position 0), keyword at position > 200
  const filler = "A".repeat(220);
  const officialText =
    `BPSC 72nd CCE notification. ${filler} The above examination stands postponed.`;
  // "72nd" is at ~5 chars, "postponed" is at ~252 chars — > 200 apart.

  const result = confirmChange({
    discoveredEvent: makeEvent("bpsc-72nd-cce-2026", "EXAM_POSTPONED"),
    opportunity: bpsc72,
    officialSourceText: officialText,
    officialSourceId: "bpsc-official",
    officialSourceUrl: "https://bpsc.bih.nic.in",
  });

  assert.equal(result.identifierConfirmed, true, "72nd found");
  assert.equal(result.changeTypeConfirmed, true, "postponed found");
  assert.equal(result.proximityConfirmed, false, "should be false — > 200 chars apart");
  assert.equal(result.outcome, "AMBIGUOUS_CONFIRMATION");
});
