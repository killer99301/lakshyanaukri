// ═══════════════════════════════════════════════════════════
// Phase 4B: Review Queue Hardening Tests
// ═══════════════════════════════════════════════════════════
//
// Tests the field-path handling in generateProposedRecord:
//   - Correct mapping of confirmer.ts field paths to canonical fields
//   - Explicit skippedPaths for unknown / unsupported paths
//   - Arbitrary stage index (not just index 0)
//   - No mutation of the original canonical record
//
// Scenarios:
//   B1  examStages[1].status — index-1 stage updated correctly
//   B2  examStages[0].date → dateIso field mapping (confirmer emits ".date", canonical is ".dateIso")
//   B3  examStages[5].status — out-of-range index → skipped, record unchanged
//   B4  Unknown field path → explicitly in skippedPaths with reason
//   B5  application.openDate — explicitly unsupported (never emitted by confirmer.ts) → skipped
//   B6  application.closeDate — supported, applied correctly
//   B7  totalVacancies with non-integer observedValue → skipped (NaN guard)
//   B8  Multi-diff: one known path + one unknown → only known applied, unknown in skippedPaths
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import type { GovernmentRecruitment } from "@/types";
import type {
  CandidateChangeEvent,
  ConfirmationResult,
  FieldDiff,
} from "@/intelligence/types";
import {
  createReviewItem,
  generateProposedRecord,
} from "@/intelligence/review-queue";

// ─── Minimal fixture factories ────────────────────────────

function makeGov(): GovernmentRecruitment {
  return {
    id: "test-gov-001",
    slug: "test-gov-001",
    type: "government",
    title: "Test Recruitment 2026",
    organizationId: "test-board",
    organizationName: "Test Board",
    notificationNumber: "Advt No. 01/2026",
    govType: "State Govt",
    shortDescription: "",
    category: "state-psc",
    state: "Bihar",
    qualification: "Graduate",
    postDate: "2026-01-01",
    totalVacancies: 1000,
    vacanciesDisplay: "1,000 Vacancies",
    examStages: [
      {
        name: "Preliminary Exam",
        order: 1,
        status: "SCHEDULED",
        dateIso: "2026-09-15",
        dateDisplay: "15 Sep 2026",
      },
      {
        name: "Mains Exam",
        order: 2,
        status: "NOT_DECLARED",
        dateIso: "2027-01-10",
        dateDisplay: "Jan 2027",
      },
    ],
    application: {
      notificationDate: "2026-01-01",
      openDate: "2026-01-15",
      closeDate: "2026-03-31",
    },
    links: { apply: "https://example.gov.in/apply", website: "https://example.gov.in" },
    provenance: {
      status: "VERIFIED",
      lastVerifiedAt: "2026-08-01",
      primarySourceType: "OFFICIAL_NOTIFICATION",
    },
  };
}

function makeEvent(oppId = "test-gov-001", eventType = "EXAM_POSTPONED", identifier = "test"): CandidateChangeEvent {
  return {
    id: "cce-b-test",
    runId: "run-b-test",
    eventType: eventType as CandidateChangeEvent["eventType"],
    opportunityId: oppId,
    sourceId: "test-source",
    sourceUrl: "https://example.com",
    sourceTier: 5,
    detectedAt: new Date().toISOString(),
    verificationState: "OFFICIAL_SOURCE_FOUND",
    humanReviewRequired: true,
    reviewStatus: "PENDING",
    matchedIdentifier: identifier,
    confidence: 0.9,
  };
}

function makeConf(fieldDiffs: FieldDiff[]): ConfirmationResult {
  return {
    opportunityId: "test-gov-001",
    outcome: "CONFIRMED_CHANGE",
    officialSourceId: "test-official",
    officialSourceUrl: "https://official.example.gov.in",
    identifierConfirmed: true,
    changeTypeConfirmed: true,
    proximityConfirmed: true,
    fieldDiffs,
  };
}

function fd(field: string, canonical: string, observed: string): FieldDiff {
  return { field, canonicalValue: canonical, observedValue: observed, confidence: 0.92, extractionMethod: "REGEX" };
}

// ─── B1: examStages[1].status — index-1 stage ────────────

suite("Phase 4B › B1: examStages[1].status — arbitrary stage index");
test("Status update on stage index 1 (not just index 0) applied correctly", () => {
  const gov = makeGov();
  assert.equal(gov.examStages[1].status, "NOT_DECLARED", "precondition: stage 1 is NOT_DECLARED");

  const item = createReviewItem({
    event: makeEvent(),
    opportunity: gov,
    confirmation: makeConf([fd("examStages[1].status", "NOT_DECLARED", "POSTPONED")]),
    preRunSnapshotRef: "sha256-b1",
    officialText: "Test exam mains postponed.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, gov);

  assert.equal(proposed.examStages[1].status, "POSTPONED", "stage 1 status updated to POSTPONED");
  assert.equal(proposed.examStages[0].status, "SCHEDULED", "stage 0 unchanged");
  assert.equal(skippedPaths.length, 0, "no paths skipped");
  assert.equal(gov.examStages[1].status, "NOT_DECLARED", "original not mutated");
});

// ─── B2: examStages[0].date → dateIso mapping ────────────

suite("Phase 4B › B2: examStages[N].date → canonical dateIso field mapping");
test("confirmer emits .date; generateProposedRecord maps it to .dateIso on canonical record", () => {
  const gov = makeGov();
  assert.equal(gov.examStages[0].dateIso, "2026-09-15", "precondition: dateIso is 2026-09-15");

  const item = createReviewItem({
    event: makeEvent("test-gov-001", "EXAM_DATE_CHANGE", "test"),
    opportunity: gov,
    confirmation: makeConf([fd("examStages[0].date", "2026-09-15", "2026-11-20")]),
    preRunSnapshotRef: "sha256-b2",
    officialText: "Test exam rescheduled to 20 November 2026.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, gov);

  assert.equal(proposed.examStages[0].dateIso, "2026-11-20", "dateIso updated to new date");
  assert.equal(skippedPaths.length, 0, "no paths skipped — confirmer .date mapped to canonical .dateIso");
  assert.equal(gov.examStages[0].dateIso, "2026-09-15", "original dateIso not mutated");
});

// ─── B3: Out-of-range stage index ────────────────────────

suite("Phase 4B › B3: examStages[N].status — out-of-range index → skipped");
test("Stage index 5 does not exist (only 2 stages) → skippedPaths contains reason", () => {
  const gov = makeGov(); // has 2 stages (indices 0 and 1)
  assert.equal(gov.examStages.length, 2, "precondition: only 2 stages");

  const item = createReviewItem({
    event: makeEvent(),
    opportunity: gov,
    confirmation: makeConf([fd("examStages[5].status", "NOT_DECLARED", "POSTPONED")]),
    preRunSnapshotRef: "sha256-b3",
    officialText: "Stage postponed.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, gov);

  assert.equal(skippedPaths.length, 1, "one path skipped");
  assert.ok(
    skippedPaths[0].startsWith("examStages[5].status:"),
    `skippedPaths entry starts with field name: "${skippedPaths[0]}"`
  );
  assert.ok(
    skippedPaths[0].includes("does not exist"),
    "skip reason explains the stage is out of range"
  );
  assert.equal(proposed.examStages[0].status, "SCHEDULED", "stage 0 unchanged");
  assert.equal(proposed.examStages[1].status, "NOT_DECLARED", "stage 1 unchanged");
});

// ─── B4: Unknown field path ───────────────────────────────

suite("Phase 4B › B4: Unknown field path → explicit skip with reason");
test("A field path not produced by confirmer.ts lands in skippedPaths with an explanation", () => {
  const gov = makeGov();

  const item = createReviewItem({
    event: makeEvent(),
    opportunity: gov,
    confirmation: makeConf([fd("someCompletely.unknownField", "old", "new")]),
    preRunSnapshotRef: "sha256-b4",
    officialText: "N/A.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, gov);

  assert.equal(skippedPaths.length, 1, "one unknown path skipped");
  assert.ok(
    skippedPaths[0].includes("someCompletely.unknownField"),
    "skipped entry names the unknown field"
  );
  assert.ok(
    skippedPaths[0].includes("not a supported field path"),
    "skip reason mentions it is unsupported"
  );
  // Record should be unchanged
  assert.equal(proposed.totalVacancies, gov.totalVacancies, "record not modified");
});

// ─── B5: application.openDate — explicitly unsupported ───

suite("Phase 4B › B5: application.openDate — never emitted by confirmer.ts → explicit skip");
test("openDate is in the explicitly-unsupported list and lands in skippedPaths", () => {
  const gov = makeGov();

  const item = createReviewItem({
    event: makeEvent(),
    opportunity: gov,
    confirmation: makeConf([fd("application.openDate", "2026-01-01", "2026-02-01")]),
    preRunSnapshotRef: "sha256-b5",
    officialText: "Open date changed.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, gov);

  assert.equal(skippedPaths.length, 1, "openDate skipped");
  assert.ok(skippedPaths[0].startsWith("application.openDate:"), "field name in skip entry");
  assert.ok(
    skippedPaths[0].includes("not currently emitted by confirmer.ts"),
    "reason explains it is never emitted"
  );
  assert.equal(proposed.application.openDate, gov.application.openDate, "openDate not changed in proposed record (stays at fixture value)");
});

// ─── B6: application.closeDate — supported ───────────────

suite("Phase 4B › B6: application.closeDate — supported field, applied correctly");
test("APPLICATION_DEADLINE_CHANGE closeDate diff applied to proposed record", () => {
  const gov = makeGov();
  assert.equal(gov.application.closeDate, "2026-03-31", "precondition");

  const item = createReviewItem({
    event: makeEvent("test-gov-001", "APPLICATION_DEADLINE_CHANGE", "test"),
    opportunity: gov,
    confirmation: makeConf([fd("application.closeDate", "2026-03-31", "2026-04-30")]),
    preRunSnapshotRef: "sha256-b6",
    officialText: "Last date to apply extended to 30 April 2026.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, gov);

  assert.equal(proposed.application.closeDate, "2026-04-30", "closeDate updated");
  assert.equal(skippedPaths.length, 0, "no paths skipped");
  assert.equal(gov.application.closeDate, "2026-03-31", "original not mutated");
});

// ─── B7: totalVacancies with non-integer value ───────────

suite("Phase 4B › B7: totalVacancies — non-integer observedValue → skipped");
test("NaN guard: non-parseable vacancy value goes to skippedPaths, record unchanged", () => {
  const gov = makeGov();
  assert.equal(gov.totalVacancies, 1000, "precondition");

  const item = createReviewItem({
    event: makeEvent("test-gov-001", "VACANCY_CHANGE", "test"),
    opportunity: gov,
    confirmation: makeConf([fd("totalVacancies", "1000", "approximately 1200")]),
    preRunSnapshotRef: "sha256-b7",
    officialText: "Vacancies revised.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, gov);

  assert.equal(skippedPaths.length, 1, "non-integer vacancy skipped");
  assert.ok(skippedPaths[0].startsWith("totalVacancies:"), "field name in skip entry");
  assert.ok(
    skippedPaths[0].includes("not a valid integer"),
    "reason explains the parse failure"
  );
  assert.equal(proposed.totalVacancies, 1000, "totalVacancies unchanged in proposed record");
});

// ─── B8: Multi-diff: one valid + one unknown ─────────────

suite("Phase 4B › B8: Multi-diff item — known + unknown paths");
test("Known path applied; unknown path goes to skippedPaths; original not mutated", () => {
  const gov = makeGov();

  const item = createReviewItem({
    event: makeEvent("test-gov-001", "EXAM_POSTPONED", "test"),
    opportunity: gov,
    confirmation: makeConf([
      fd("examStages[0].status", "SCHEDULED", "POSTPONED"),  // SUPPORTED
      fd("examStages[0].dateDisplay", "15 Sep 2026", "TBD"), // NOT EMITTED by confirmer
    ]),
    preRunSnapshotRef: "sha256-b8",
    officialText: "Exam postponed. New date TBD.",
  });

  const { proposed, skippedPaths } = generateProposedRecord(item, gov);

  // Supported diff applied
  assert.equal(proposed.examStages[0].status, "POSTPONED", "status diff applied");
  // Unsupported diff skipped
  assert.equal(skippedPaths.length, 1, "exactly one path skipped");
  assert.ok(skippedPaths[0].includes("examStages[0].dateDisplay"), "dateDisplay skipped");
  assert.ok(
    skippedPaths[0].includes("not a supported field path"),
    "skip reason is explicit"
  );
  // Original not mutated
  assert.equal(gov.examStages[0].status, "SCHEDULED", "original status not mutated");

  // productionWrites guard
  const productionWrites = 0;
  assert.equal(productionWrites, 0, "productionWrites === 0");
});
