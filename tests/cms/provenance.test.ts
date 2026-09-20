// ═══════════════════════════════════════════════════════════
// Phase C: RecruitmentRecord + ProvenanceField Tests
// ═══════════════════════════════════════════════════════════
//
// Tests all Phase C invariants — pure, no DB required.
//
// Run: npx tsx --tsconfig tsconfig.json tests/cms/provenance.test.ts
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";

import type {
  ProvenanceField,
  RecruitmentRecord,
  RecruitmentIdentity,
  RecruitmentDates,
  VacancyInformation,
  FinancialInformation,
  CmsRecruitmentPost,
  AgeCriteria,
  CmsSelectionInformation,
  FieldRevision,
  RecruitmentLifecycle,
} from "@/types/recruitment-record";

import type { VacancyRow } from "@/types";

import {
  validateProvenanceField,
  makeProvenanceField,
  makeNotSpecified,
  makePendingField,
  makeVerifiedField,
  applyAdminEdit,
  validateRecord,
} from "@/lib/cms/validation";

import {
  buildFieldRevision,
  updateVacancyTotal,
  updateVacancyBreakdown,
  updateEligibility,
  updateAge,
  updateSelection,
  updateDateField,
  approveRecord,
} from "@/lib/cms/record-ops";

// ─── Fixtures ─────────────────────────────────────────────

function makeTitleField(value: string): ProvenanceField<string> {
  return {
    value,
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
}

function makeMinimalIdentity(): RecruitmentIdentity {
  return {
    organizationId: "bpsc",
    organizationName: "Bihar Public Service Commission",
    recruitmentYear: 2026,
    title: makeTitleField("BPSC 72nd CCE"),
  };
}

function makeMinimalDates(): RecruitmentDates {
  return {};
}

function makeMinimalVacancies(): VacancyInformation {
  return {};
}

function makeMinimalFinancial(): FinancialInformation {
  return {};
}

function makeMinimalLifecycle(): RecruitmentLifecycle {
  return { status: "DRAFT", conflicts: [], events: [] };
}

function makeMinimalProvenance(): RecruitmentRecord["provenance"] {
  return {
    status: "NOT_VERIFIED",
    lastVerifiedAt: "2026-01-01",
    primarySourceType: "NOT_VERIFIED",
  };
}

let recordCounter = 0;
function makeMinimalRecord(overrides?: Partial<RecruitmentRecord>): RecruitmentRecord {
  recordCounter++;
  return {
    id:             `rec-${recordCounter.toString().padStart(4, "0")}`,
    slug:           `bpsc-72nd-cce-${recordCounter}`,
    draftState:     "DRAFT",
    recordRevision: "00000000",
    identity:       makeMinimalIdentity(),
    dates:          makeMinimalDates(),
    vacancies:      makeMinimalVacancies(),
    financial:      makeMinimalFinancial(),
    lifecycle:      makeMinimalLifecycle(),
    provenance:     makeMinimalProvenance(),
    links:          [],
    documents:      [],
    updates:        [],
    createdAt:      "2026-09-01T00:00:00Z",
    updatedAt:      "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const ADMIN_ID = "admin-uuid-001";
const EVIDENCE_ID = "evid-abc-001";

// ═══════════════════════════════════════════════════════════
// PC01–PC03: Valid ProvenanceField states
// ═══════════════════════════════════════════════════════════

suite("PC01–PC03: Valid ProvenanceField states");

test("PC01: VERIFIED field with non-null value and evidenceIds is valid", () => {
  const field: ProvenanceField<string> = {
    value: "BPSC 72nd CCE",
    status: "VERIFIED",
    evidenceIds: [EVIDENCE_ID],
    conflict: false,
    manuallyEdited: false,
  };
  const errors = validateProvenanceField(field, "identity.title");
  assert.equal(errors.length, 0, `Expected no errors, got: ${JSON.stringify(errors)}`);
});

test("PC02: PENDING field with non-null value is valid", () => {
  const field: ProvenanceField<string> = {
    value: "BPSC 72nd CCE",
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
  const errors = validateProvenanceField(field, "identity.title");
  assert.equal(errors.length, 0);
});

test("PC03: NOT_SPECIFIED field with null value is valid", () => {
  const field: ProvenanceField<string | null> = {
    value: null,
    status: "NOT_SPECIFIED",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
  const errors = validateProvenanceField(field, "dates.examDate");
  assert.equal(errors.length, 0);
});

// ═══════════════════════════════════════════════════════════
// PC04–PC05: NOT_SPECIFIED invariant violations (I1)
// ═══════════════════════════════════════════════════════════

suite("PC04–PC05: NOT_SPECIFIED invariant violations");

test("PC04: null value + non-NOT_SPECIFIED status violates I1", () => {
  const field: ProvenanceField<string | null> = {
    value: null,
    status: "PENDING",        // I1b violation: value is null but status is not NOT_SPECIFIED
    evidenceIds: [],
    conflict: false,
    manuallyEdited: false,
  };
  const errors = validateProvenanceField(field, "dates.examDate");
  assert.ok(errors.length > 0, "Expected at least one error");
  assert.ok(
    errors.some((e) => e.invariant === "I1"),
    `Expected I1 error, got: ${JSON.stringify(errors)}`,
  );
});

test("PC05: NOT_SPECIFIED status + non-null value violates I1", () => {
  const field: ProvenanceField<string> = {
    value: "2026-11-15",     // I1a violation: status is NOT_SPECIFIED but value is not null
    status: "NOT_SPECIFIED",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
  const errors = validateProvenanceField(field, "dates.examDate");
  assert.ok(errors.length > 0, "Expected at least one error");
  assert.ok(
    errors.some((e) => e.invariant === "I1"),
    `Expected I1 error, got: ${JSON.stringify(errors)}`,
  );
});

// ═══════════════════════════════════════════════════════════
// PC06: CONFLICTED invariant violation (I3)
// ═══════════════════════════════════════════════════════════

suite("PC06: CONFLICTED invariant");

test("PC06a: CONFLICTED status without conflict=true violates I3", () => {
  const field: ProvenanceField<number> = {
    value: 500,
    status: "CONFLICTED",
    evidenceIds: [EVIDENCE_ID],
    conflict: false,          // I3a violation
    manuallyEdited: false,
  };
  const errors = validateProvenanceField(field, "financial.feeGeneral");
  assert.ok(errors.length > 0, "Expected at least one error");
  assert.ok(
    errors.some((e) => e.invariant === "I3"),
    `Expected I3 error, got: ${JSON.stringify(errors)}`,
  );
});

test("PC06b: conflict=true without CONFLICTED status violates I3", () => {
  const field: ProvenanceField<number> = {
    value: 500,
    status: "VERIFIED",
    evidenceIds: [EVIDENCE_ID],
    conflict: true,           // I3b violation
    manuallyEdited: false,
  };
  const errors = validateProvenanceField(field, "financial.feeGeneral");
  assert.ok(errors.length > 0, "Expected at least one error");
  assert.ok(
    errors.some((e) => e.invariant === "I3"),
    `Expected I3 error, got: ${JSON.stringify(errors)}`,
  );
});

test("PC06c: valid CONFLICTED field (status=CONFLICTED, conflict=true) has no errors", () => {
  const field: ProvenanceField<number> = {
    value: 500,
    status: "CONFLICTED",
    evidenceIds: [EVIDENCE_ID],
    conflict: true,
    machineValue: 600,
    manuallyEdited: false,
  };
  const errors = validateProvenanceField(field, "financial.feeGeneral");
  assert.equal(errors.length, 0);
});

// ═══════════════════════════════════════════════════════════
// PC07: machineValue preservation rules
// ═══════════════════════════════════════════════════════════

suite("PC07: machineValue preservation");

test("PC07a: first admin edit of machine-extracted field preserves machineValue", () => {
  const original: ProvenanceField<string> = {
    value: "2026-11-15",
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: false,  // not yet edited by admin
  };

  const edited = applyAdminEdit(original, "2026-12-01");

  assert.equal(edited.machineValue, "2026-11-15", "machineValue must equal the original machine value");
  assert.equal(edited.value, "2026-12-01");
  assert.equal(edited.manuallyEdited, true);
  assert.equal(edited.status, "PENDING");
});

test("PC07b: machineValue is never overwritten on subsequent edits", () => {
  const step1: ProvenanceField<string> = {
    value: "2026-12-01",
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    machineValue: "2026-11-15",
    manuallyEdited: true,
  };

  const step2 = applyAdminEdit(step1, "2026-12-10");

  assert.equal(
    step2.machineValue,
    "2026-11-15",
    "machineValue must not change on re-edit",
  );
  assert.equal(step2.value, "2026-12-10");
});

test("PC07c: admin-created field (no prior machine value) has no machineValue", () => {
  const manual: ProvenanceField<string> = {
    value: "",
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,    // admin-created from scratch
  };

  const edited = applyAdminEdit(manual, "2026-12-15");

  assert.equal(
    edited.machineValue,
    undefined,
    "machineValue should be absent when there was no prior machine extraction",
  );
});

test("PC07d: setting NOT_SPECIFIED preserves existing machineValue", () => {
  const field: ProvenanceField<string | null> = {
    value: "2026-11-15",
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: false,
  };

  const notSpecified = applyAdminEdit(field, null);
  assert.equal(notSpecified.status, "NOT_SPECIFIED");
  assert.equal(notSpecified.value, null);
  // machineValue captured from original
  assert.equal(notSpecified.machineValue, "2026-11-15");
});

// ═══════════════════════════════════════════════════════════
// PC08–PC09: FieldRevision field paths
// ═══════════════════════════════════════════════════════════

suite("PC08–PC09: FieldRevision field paths");

test("PC08a: block-level field paths use block name without subfield", () => {
  const paths = ["eligibility", "age", "selection", "vacancies.breakdown"];
  for (const path of paths) {
    const rev = buildFieldRevision("rec-001", path, null, "new-value", ADMIN_ID);
    assert.equal(rev.fieldPath, path, `Expected fieldPath="${path}"`);
  }
});

test("PC08b: namespace field paths use block.fieldName notation", () => {
  const paths = [
    "dates.applicationCloseDate",
    "dates.examDate",
    "identity.title",
    "financial.feeGeneral",
    "financial.feeSCST",
    "vacancies.total",
  ];
  for (const path of paths) {
    const rev = buildFieldRevision("rec-001", path, null, "new-value", ADMIN_ID);
    assert.ok(
      rev.fieldPath.includes("."),
      `Expected "${path}" to contain a dot separator`,
    );
  }
});

test("PC09: buildFieldRevision captures old and new values", () => {
  const oldVal = { value: "2026-11-01", status: "PENDING" };
  const newVal = { value: "2026-12-01", status: "VERIFIED" };

  const rev = buildFieldRevision("rec-001", "dates.examDate", oldVal, newVal, ADMIN_ID, "Rescheduled");

  assert.deepEqual(rev.oldValue, oldVal);
  assert.deepEqual(rev.newValue, newVal);
  assert.equal(rev.reason, "Rescheduled");
  assert.equal(rev.revisedBy, ADMIN_ID);
  assert.ok(rev.id.length > 0, "Revision must have an ID");
  assert.ok(rev.revisedAt.length > 0, "Revision must have a timestamp");
});

// ═══════════════════════════════════════════════════════════
// PC10: FieldRevision append-only semantics
// ═══════════════════════════════════════════════════════════

suite("PC10: FieldRevision append-only behavior");

test("PC10: each field update produces a new revision (never mutates in place)", () => {
  const record = makeMinimalRecord();
  const adminId = ADMIN_ID;

  const newDate: ProvenanceField<string | null> = {
    value: "2026-12-01",
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };

  const result1 = updateDateField(record, "examDate", newDate, adminId, "Initial set");
  const result2 = updateDateField(
    result1.record,
    "examDate",
    { ...newDate, value: "2026-12-15" },
    adminId,
    "Rescheduled",
  );

  // Two distinct revision objects
  assert.notEqual(result1.revision.id, result2.revision.id);
  assert.equal(result1.revision.fieldPath, "dates.examDate");
  assert.equal(result2.revision.fieldPath, "dates.examDate");

  // oldValue of revision 2 = newValue of revision 1
  const r1New = (result1.revision.newValue as { value: string }).value;
  const r2Old = (result2.revision.oldValue as ProvenanceField<string | null>).value;
  assert.equal(r2Old, r1New, "revision 2 oldValue must equal revision 1 newValue");
});

// ═══════════════════════════════════════════════════════════
// PC11: Vacancy total and breakdown independence
// ═══════════════════════════════════════════════════════════

suite("PC11: Vacancy total vs breakdown independence");

test("PC11a: vacancy total can be revised independently of breakdown", () => {
  const record = makeMinimalRecord();

  const totalField: ProvenanceField<number | null> = {
    value: 1000,
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };

  const result = updateVacancyTotal(record, totalField, ADMIN_ID, "Initial total from page");

  assert.equal(result.revision.fieldPath, "vacancies.total");
  assert.equal((result.record.vacancies.total as ProvenanceField<number | null>).value, 1000);
  // breakdown untouched
  assert.equal(result.record.vacancies.breakdown, undefined);
});

test("PC11b: vacancy breakdown can be revised independently of total", () => {
  const rows: VacancyRow[] = [
    { post: "Administrative Officer", count: 200 },
    { post: "Assistant Manager", count: 100 },
  ];

  const breakdownField: ProvenanceField<VacancyRow[]> = {
    value: rows,
    status: "VERIFIED",
    evidenceIds: [EVIDENCE_ID],
    conflict: false,
    manuallyEdited: false,
  };

  const record = makeMinimalRecord();
  const result = updateVacancyBreakdown(record, breakdownField, ADMIN_ID);

  assert.equal(result.revision.fieldPath, "vacancies.breakdown");
  assert.equal((result.record.vacancies.breakdown as ProvenanceField<VacancyRow[]>).value?.length, 2);
  // total untouched
  assert.equal(result.record.vacancies.total, undefined);
});

test("PC11c: total and breakdown can coexist independently", () => {
  const record = makeMinimalRecord();

  const totalField: ProvenanceField<number | null> = {
    value: 300,
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
  const { record: withTotal } = updateVacancyTotal(record, totalField, ADMIN_ID);

  const breakdownField: ProvenanceField<VacancyRow[]> = {
    value: [
      { post: "Administrative Officer", count: 200 },
      { post: "Assistant Manager", count: 100 },
    ],
    status: "VERIFIED",
    evidenceIds: [EVIDENCE_ID],
    conflict: false,
    manuallyEdited: false,
  };
  const { record: withBoth } = updateVacancyBreakdown(withTotal, breakdownField, ADMIN_ID);

  assert.equal((withBoth.vacancies.total as ProvenanceField<number | null>).value, 300);
  assert.equal((withBoth.vacancies.breakdown as ProvenanceField<VacancyRow[]>).value?.length, 2);
});

// ═══════════════════════════════════════════════════════════
// PC12–PC14: Block-level ProvenanceField revision paths
// ═══════════════════════════════════════════════════════════

suite("PC12–PC14: Block revision fieldPaths");

test("PC12: eligibility revision uses fieldPath 'eligibility' (full block)", () => {
  const posts: CmsRecruitmentPost[] = [
    { post: "General Manager", qualification: ["Graduate"] },
    { post: "Senior Officer", qualification: ["Post Graduate"] },
  ];

  const eligField: ProvenanceField<CmsRecruitmentPost[]> = {
    value: posts,
    status: "VERIFIED",
    evidenceIds: [EVIDENCE_ID],
    conflict: false,
    manuallyEdited: false,
  };

  const record = makeMinimalRecord();
  const result = updateEligibility(record, eligField, ADMIN_ID);

  assert.equal(result.revision.fieldPath, "eligibility");
  assert.equal(
    (result.record.eligibility as ProvenanceField<CmsRecruitmentPost[]>).value?.length,
    2,
  );
});

test("PC12b: eligibility revision when one post changes — stores full old/new array", () => {
  const originalPosts: CmsRecruitmentPost[] = [
    { post: "General Manager", qualification: ["Graduate"] },
  ];
  const originalField: ProvenanceField<CmsRecruitmentPost[]> = {
    value: originalPosts,
    status: "VERIFIED",
    evidenceIds: [EVIDENCE_ID],
    conflict: false,
    manuallyEdited: false,
  };

  const record = makeMinimalRecord({ eligibility: originalField });

  // Only 'General Manager' changes its qualification
  const updatedPosts: CmsRecruitmentPost[] = [
    { post: "General Manager", qualification: ["Graduate", "Post Graduate"] },
  ];
  const updatedField: ProvenanceField<CmsRecruitmentPost[]> = {
    value: updatedPosts,
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };

  const result = updateEligibility(record, updatedField, ADMIN_ID, "Corrigendum update");

  assert.equal(result.revision.fieldPath, "eligibility", "fieldPath must be the block name");

  const oldVal = result.revision.oldValue as ProvenanceField<CmsRecruitmentPost[]>;
  const newVal = result.revision.newValue as ProvenanceField<CmsRecruitmentPost[]>;

  assert.equal(oldVal.value?.[0].post, "General Manager");
  assert.equal(oldVal.value?.[0].qualification?.length, 1);
  assert.equal(newVal.value?.[0].qualification?.length, 2);
});

test("PC13: age revision uses fieldPath 'age'", () => {
  const ageCriteria: AgeCriteria = {
    min: 21,
    max: 37,
    asOf: "2026-01-01",
    relaxations: [
      { category: "SC/ST", years: 5 },
      { category: "OBC (NCL)", years: 3 },
    ],
  };

  const ageField: ProvenanceField<AgeCriteria> = {
    value: ageCriteria,
    status: "VERIFIED",
    evidenceIds: [EVIDENCE_ID],
    conflict: false,
    manuallyEdited: false,
  };

  const record = makeMinimalRecord();
  const result = updateAge(record, ageField, ADMIN_ID);

  assert.equal(result.revision.fieldPath, "age");
  assert.equal((result.record.age as ProvenanceField<AgeCriteria>).value?.max, 37);
  assert.equal((result.record.age as ProvenanceField<AgeCriteria>).value?.relaxations.length, 2);
});

test("PC14: selection revision uses fieldPath 'selection'", () => {
  const selection: CmsSelectionInformation = {
    stages: [
      { name: "Preliminary Exam", order: 1, type: "WRITTEN" },
      { name: "Mains", order: 2, type: "WRITTEN" },
      { name: "Interview", order: 3, type: "INTERVIEW", qualifying: false },
    ],
    examPattern: "Objective + Descriptive",
    negativeMarking: "1/3 for wrong answer",
  };

  const selField: ProvenanceField<CmsSelectionInformation> = {
    value: selection,
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };

  const record = makeMinimalRecord();
  const result = updateSelection(record, selField, ADMIN_ID);

  assert.equal(result.revision.fieldPath, "selection");
  const val = (result.record.selection as ProvenanceField<CmsSelectionInformation>).value;
  assert.equal(val?.stages?.length, 3);
  assert.equal(val?.negativeMarking, "1/3 for wrong answer");
});

test("PC14b: vacancies.breakdown revision uses fieldPath 'vacancies.breakdown'", () => {
  const rows: VacancyRow[] = [{ post: "AO", count: 100 }];
  const breakdownField: ProvenanceField<VacancyRow[]> = {
    value: rows,
    status: "VERIFIED",
    evidenceIds: [EVIDENCE_ID],
    conflict: false,
    manuallyEdited: false,
  };

  const record = makeMinimalRecord();
  const result = updateVacancyBreakdown(record, breakdownField, ADMIN_ID);

  assert.equal(result.revision.fieldPath, "vacancies.breakdown");
});

// ═══════════════════════════════════════════════════════════
// PC15: makeProvenanceField helpers
// ═══════════════════════════════════════════════════════════

suite("PC15: makeProvenanceField helpers");

test("PC15a: makeNotSpecified produces a valid NOT_SPECIFIED field", () => {
  const f = makeNotSpecified<string>();
  const errors = validateProvenanceField(f, "test.field");
  assert.equal(errors.length, 0);
  assert.equal(f.status, "NOT_SPECIFIED");
  assert.equal(f.value, null);
  assert.equal(f.conflict, false);
});

test("PC15b: makePendingField produces a valid PENDING field", () => {
  const f = makePendingField("BPSC 72nd CCE");
  const errors = validateProvenanceField(f, "test.field");
  assert.equal(errors.length, 0);
  assert.equal(f.status, "PENDING");
  assert.equal(f.value, "BPSC 72nd CCE");
});

test("PC15c: makeVerifiedField produces a valid VERIFIED field", () => {
  const f = makeVerifiedField(1000, [EVIDENCE_ID]);
  const errors = validateProvenanceField(f, "test.field");
  assert.equal(errors.length, 0);
  assert.equal(f.status, "VERIFIED");
  assert.equal(f.value, 1000);
  assert.equal(f.evidenceIds[0], EVIDENCE_ID);
});

test("PC15d: makePendingField throws when given null", () => {
  assert.throws(() => makePendingField(null as unknown as string), /non-null/);
});

test("PC15e: makeVerifiedField throws without evidenceIds", () => {
  assert.throws(() => makeVerifiedField("value", []), /evidenceId/);
});

test("PC15f: makeProvenanceField throws on invariant violations", () => {
  // null + non-NOT_SPECIFIED violates I1 — error mentions NOT_SPECIFIED
  assert.throws(
    () =>
      makeProvenanceField({ value: null, status: "PENDING" }),
    /NOT_SPECIFIED/i,
  );
  // non-null + NOT_SPECIFIED also violates I1
  assert.throws(
    () =>
      makeProvenanceField({ value: "test", status: "NOT_SPECIFIED" }),
    /NOT_SPECIFIED/i,
  );
});

// ═══════════════════════════════════════════════════════════
// PC16: applyAdminEdit VERIFIED with evidenceIds
// ═══════════════════════════════════════════════════════════

suite("PC16: applyAdminEdit produces correct status");

test("PC16a: applyAdminEdit with evidenceIds → VERIFIED status", () => {
  const field = makePendingField("old title");
  const updated = applyAdminEdit(field, "new title", [EVIDENCE_ID]);
  assert.equal(updated.status, "VERIFIED");
  assert.equal(updated.value, "new title");
  assert.equal(updated.evidenceIds[0], EVIDENCE_ID);
});

test("PC16b: applyAdminEdit without evidenceIds → PENDING status", () => {
  const field = makePendingField("old title");
  const updated = applyAdminEdit(field, "new title");
  assert.equal(updated.status, "PENDING");
  assert.equal(updated.value, "new title");
});

test("PC16c: applyAdminEdit with null → NOT_SPECIFIED", () => {
  const field = makePendingField("2026-12-01");
  const updated = applyAdminEdit(field, null);
  assert.equal(updated.status, "NOT_SPECIFIED");
  assert.equal(updated.value, null);
  const errors = validateProvenanceField(updated, "test.field");
  assert.equal(errors.length, 0, "NOT_SPECIFIED after edit must be valid");
});

// ═══════════════════════════════════════════════════════════
// PC17: validateRecord — full record validation
// ═══════════════════════════════════════════════════════════

suite("PC17: Full record validation");

test("PC17a: minimal valid record passes validateRecord", () => {
  const record = makeMinimalRecord();
  const result = validateRecord(record);
  assert.ok(result.valid, `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.errors.length, 0);
});

test("PC17b: record with invalid ProvenanceField fails validateRecord", () => {
  const record = makeMinimalRecord({
    dates: {
      examDate: {
        value: null,
        status: "PENDING",  // I1 violation
        evidenceIds: [],
        conflict: false,
        manuallyEdited: false,
      },
    },
  });
  const result = validateRecord(record);
  assert.ok(!result.valid, "Expected invalid");
  assert.ok(
    result.errors.some((e) => e.fieldPath === "dates.examDate"),
    `Expected error on dates.examDate, got: ${JSON.stringify(result.errors)}`,
  );
});

test("PC17c: record with NOT_SPECIFIED title fails validateRecord (title is always required)", () => {
  const record = makeMinimalRecord({
    identity: {
      ...makeMinimalIdentity(),
      title: {
        value: null,
        status: "NOT_SPECIFIED",
        evidenceIds: [],
        conflict: false,
        manuallyEdited: true,
      },
    },
  });
  const result = validateRecord(record);
  assert.ok(!result.valid, "Expected invalid — title cannot be NOT_SPECIFIED");
  assert.ok(
    result.errors.some((e) => e.fieldPath === "identity.title"),
    `Expected error on identity.title, got: ${JSON.stringify(result.errors)}`,
  );
});

test("PC17d: record missing organizationId fails validateRecord", () => {
  const record = makeMinimalRecord({
    identity: {
      ...makeMinimalIdentity(),
      organizationId: "",
    },
  });
  const result = validateRecord(record);
  assert.ok(!result.valid, "Expected invalid — organizationId required");
  assert.ok(
    result.errors.some((e) => e.fieldPath === "identity.organizationId"),
    `Expected error on identity.organizationId`,
  );
});

// ═══════════════════════════════════════════════════════════
// PC18: approveRecord state machine
// ═══════════════════════════════════════════════════════════

suite("PC18: approveRecord transitions");

test("PC18a: valid DRAFT record can be approved", () => {
  const record = makeMinimalRecord();
  const result = approveRecord(record, ADMIN_ID);
  assert.equal(result.record.draftState, "APPROVED");
  assert.equal(result.auditEvent.eventType, "RECORD_APPROVED");
});

test("PC18b: approveRecord does not mutate the original record", () => {
  const record = makeMinimalRecord();
  approveRecord(record, ADMIN_ID);
  assert.equal(record.draftState, "DRAFT", "Original record must remain DRAFT");
});

test("PC18c: approving a non-DRAFT record throws", () => {
  const record = makeMinimalRecord({ draftState: "PUBLISHED" });
  assert.throws(
    () => approveRecord(record, ADMIN_ID),
    /Cannot approve/,
  );
});

test("PC18d: record with active conflicts cannot be approved", () => {
  const record = makeMinimalRecord({
    lifecycle: {
      status: "DRAFT",
      conflicts: [
        {
          fieldPath: "vacancies.total",
          machineValue: 1000,
          adminValue: 1200,
          evidenceIds: [EVIDENCE_ID],
          detectedAt: "2026-09-01T00:00:00Z",
          // resolvedAt absent → unresolved
        },
      ],
      events: [],
    },
  });
  assert.throws(
    () => approveRecord(record, ADMIN_ID),
    /conflict/i,
  );
});

// ═══════════════════════════════════════════════════════════
// PC19: Immutability — record-ops never mutates in place
// ═══════════════════════════════════════════════════════════

suite("PC19: Record immutability");

test("PC19a: updateDateField returns a new record, original is unchanged", () => {
  const record = makeMinimalRecord();
  const dateField: ProvenanceField<string | null> = {
    value: "2026-12-01",
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
  const { record: updated } = updateDateField(record, "examDate", dateField, ADMIN_ID);

  assert.notEqual(record, updated, "Should be a new object");
  assert.equal(record.dates.examDate, undefined, "Original must be unchanged");
  assert.ok(updated.dates.examDate !== undefined, "Updated record has the date");
});

test("PC19b: updateAge returns a new record, original age unchanged", () => {
  const record = makeMinimalRecord();
  const ageField: ProvenanceField<AgeCriteria> = {
    value: { min: 18, max: 35, relaxations: [] },
    status: "PENDING",
    evidenceIds: [],
    conflict: false,
    manuallyEdited: true,
  };
  const { record: updated } = updateAge(record, ageField, ADMIN_ID);

  assert.equal(record.age, undefined, "Original age must be unchanged");
  assert.ok(updated.age !== undefined, "Updated record has age");
});
