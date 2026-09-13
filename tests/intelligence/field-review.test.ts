// ═══════════════════════════════════════════════════════════
// Phase 10E: Field Review & Edit — Tests
// npx tsx --tsconfig tsconfig.json tests/intelligence/field-review.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  E01  machine value → manual edit: machineValue preserved, value updated, manuallyEdited=true
//  E02  original evidence preserved after edit (evidence array unchanged)
//  E03  editor identity and timestamp recorded on edit
//  E04  reset to machine value: value=machineValue, manuallyEdited=false, machineValue still present
//  E05  conflict selection — admin selects official source value
//  E06  conflict alternative value — admin enters custom value
//  E07  vacancy row edit — postName updated, manuallyEdited=true, editedBy set
//  E08  vacancy row addition — new row appended, isAdminAdded=true, derivedTotal updated
//  E09  vacancy row removal — isDeleted=true, derived total excludes the row
//  E10  derived total recalculation after row edit — sum updates correctly
//  E11  Save Draft stamps savedAt without touching canonical data
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import {
  applyFieldEdit,
  resetFieldToMachine,
  applyVacancyRowEdit,
  addVacancyRow,
  removeVacancyRow,
  recalculateDerivedTotal,
  resolveConflict,
  saveDraft,
} from "@/intelligence/draft-editor";
import type {
  FieldValue,
  VacancyData,
  VacancyRow,
  IntelligenceConflict,
  RecruitmentIntelligenceDraft,
} from "@/intelligence/draft-types";

// ─── Test fixtures ─────────────────────────────────────────

function makeFieldValue<T>(value: T): FieldValue<T> {
  return {
    value,
    confidence: 0.92,
    evidence: [
      {
        sourceId: "src-1",
        url: "https://example.com/src-1",
        value,
        extractedText: "extracted context",
        confidence: 0.92,
        authorityRank: 4,
        extractionMethod: "STRUCTURED",
        extractedAt: new Date().toISOString(),
      },
    ],
    manuallyEdited: false,
    conflict: false,
  };
}

function makeVacancyRow(id: string, postName: string, total: number): VacancyRow {
  return {
    id,
    postName,
    total,
    sourceEvidence: [],
    manuallyEdited: false,
  };
}

function makeVacancyData(rows: VacancyRow[]): VacancyData {
  return { rows, derivedTotal: undefined };
}

function makeConflict(): IntelligenceConflict {
  return {
    field: "vacancies.total",
    severity: "WARNING",
    values: [
      { value: 225, sourceId: "src-1", url: "https://official.gov.in/", sourceKind: "OFFICIAL", confidence: 0.9 },
      { value: 237, sourceId: "src-2", url: "https://secondary.com/", sourceKind: "SECONDARY", confidence: 0.7 },
    ],
    resolution: {
      selectedValue: 225,
      selectedSourceId: "src-1",
      reason: "Official source wins by authority rank",
    },
  };
}

function makeMinimalDraft(): RecruitmentIntelligenceDraft {
  const now = new Date().toISOString();
  return {
    id: "test-draft-1",
    createdAt: now,
    updatedAt: now,
    sources: [],
    identity: {
      title: makeFieldValue("Test Recruitment 2026"),
      shortTitle: makeFieldValue("TR 2026"),
      organizationId: makeFieldValue("testorg"),
      organizationName: makeFieldValue("Test Organisation"),
      recruitmentYear: makeFieldValue(2026),
      notificationNumber: makeFieldValue("TR/2026/01"),
      advertisementNumber: makeFieldValue(""),
      recruitmentType: makeFieldValue("new_notice"),
    },
    dates: {},
    vacancies: { rows: [], derivedTotal: undefined },
    posts: [],
    postEligibility: [],
    links: [],
    lifecycle: [],
    conflicts: [],
    missingFields: [],
    overallConfidence: 0.85,
    readiness: { readyForReview: true, blockingIssues: [], warnings: [] },
  };
}

// ─── Tests ─────────────────────────────────────────────────

suite("Phase 10E — Field Review & Edit");

test("E01: machine value → manual edit: machineValue preserved, value updated, manuallyEdited=true", () => {
  const fv = makeFieldValue("IBPS PO/MT XV");
  const edited = applyFieldEdit(fv, "IBPS PO/MT Common Recruitment Process XV", "admin");

  assert.strictEqual(edited.value, "IBPS PO/MT Common Recruitment Process XV", "value updated");
  assert.strictEqual(edited.machineValue, "IBPS PO/MT XV", "machineValue is original");
  assert.strictEqual(edited.manuallyEdited, true, "manuallyEdited=true");
  assert.strictEqual(edited.conflict, false, "conflict state unchanged");
  assert.strictEqual(edited.confidence, 0.92, "confidence unchanged");
});

test("E02: original evidence preserved after edit (evidence array unchanged)", () => {
  const fv = makeFieldValue("Original Title");
  const edited = applyFieldEdit(fv, "Corrected Title", "admin");

  assert.strictEqual(edited.evidence.length, 1, "evidence array length preserved");
  assert.strictEqual(edited.evidence[0].sourceId, "src-1", "evidence source preserved");
  assert.deepStrictEqual(edited.evidence[0], fv.evidence[0], "evidence entry unchanged");
});

test("E03: editor identity and timestamp recorded on edit", () => {
  const before = new Date();
  const fv = makeFieldValue("UIIC AO 2026");
  const edited = applyFieldEdit(fv, "UIIC Administrative Officer 2026", "admin@lakshyanaukri.com", "Full title preferred");

  assert.strictEqual(edited.editedBy, "admin@lakshyanaukri.com", "editedBy recorded");
  assert.strictEqual(edited.editReason, "Full title preferred", "editReason recorded");
  assert.ok(edited.editedAt, "editedAt set");
  const editedAt = new Date(edited.editedAt!);
  assert.ok(editedAt >= before, "editedAt is after edit started");
  assert.ok(editedAt <= new Date(), "editedAt is not in future");
});

test("E04: reset to machine value: value=machineValue, manuallyEdited=false, machineValue still present", () => {
  const fv = makeFieldValue("Short Title");
  const edited = applyFieldEdit(fv, "Longer Corrected Title", "admin");
  assert.strictEqual(edited.machineValue, "Short Title");

  const reset = resetFieldToMachine(edited);

  assert.strictEqual(reset.value, "Short Title", "value restored to original");
  assert.strictEqual(reset.manuallyEdited, false, "manuallyEdited cleared");
  assert.strictEqual(reset.editedBy, undefined, "editedBy cleared");
  assert.strictEqual(reset.editedAt, undefined, "editedAt cleared");
  // machineValue must survive the reset for audit trail
  assert.strictEqual(reset.machineValue, "Short Title", "machineValue preserved after reset");
});

test("E05: conflict resolution — admin selects official source value", () => {
  const conflict = makeConflict();
  const resolved = resolveConflict(conflict, 225, "src-1", "admin", "Official corrigendum confirmed 225");

  assert.ok(resolved.adminDecision, "adminDecision set");
  assert.strictEqual(resolved.adminDecision!.selectedValue, 225, "selected official value");
  assert.strictEqual(resolved.adminDecision!.selectedSourceId, "src-1", "official source selected");
  assert.strictEqual(resolved.adminDecision!.reason, "Official corrigendum confirmed 225");
  assert.strictEqual(resolved.adminDecision!.decidedBy, "admin");
  // Original conflict values preserved
  assert.strictEqual(resolved.values.length, 2, "all conflict values preserved");
  assert.strictEqual(resolved.resolution?.selectedValue, 225, "auto-resolution unchanged");
});

test("E06: conflict resolution — admin enters custom value different from all sources", () => {
  const conflict = makeConflict();
  const resolved = resolveConflict(conflict, 230, "custom", "admin", "Corrigendum issued 230 after both sources");

  assert.ok(resolved.adminDecision, "adminDecision set");
  assert.strictEqual(resolved.adminDecision!.selectedValue, 230, "custom value used");
  assert.strictEqual(resolved.adminDecision!.selectedSourceId, "custom", "custom source id");
  // Original auto-resolution preserved alongside admin decision
  assert.strictEqual(resolved.resolution?.selectedValue, 225, "auto-resolution preserved");
  assert.strictEqual(resolved.values.length, 2, "all conflict values preserved");
});

test("E07: vacancy row edit — postName updated, manuallyEdited=true, editedBy set", () => {
  const row = makeVacancyRow("row-1", "Probationary Officer", 4455);
  const edited = applyVacancyRowEdit(row, { postName: "Probationary Officer (PO)", total: 4455 }, "admin");

  assert.strictEqual(edited.postName, "Probationary Officer (PO)");
  assert.strictEqual(edited.total, 4455);
  assert.strictEqual(edited.manuallyEdited, true);
  assert.strictEqual(edited.editedBy, "admin");
  assert.ok(edited.editedAt, "editedAt set");
  // sourceEvidence unchanged
  assert.deepStrictEqual(edited.sourceEvidence, row.sourceEvidence);
});

test("E08: vacancy row addition — new row appended, isAdminAdded=true, derivedTotal updated", () => {
  const vac = makeVacancyData([makeVacancyRow("row-1", "Generalist Officer", 200)]);
  const updated = addVacancyRow(
    vac,
    { id: "row-2", postName: "Hindi Officer", total: 25 },
    "admin",
  );

  assert.strictEqual(updated.rows.length, 2, "row appended");
  const newRow = updated.rows[1];
  assert.strictEqual(newRow.postName, "Hindi Officer");
  assert.strictEqual(newRow.isAdminAdded, true, "isAdminAdded=true");
  assert.strictEqual(newRow.manuallyEdited, true, "manuallyEdited=true");
  assert.strictEqual(newRow.editedBy, "admin");
  assert.strictEqual(updated.derivedTotal, 225, "derivedTotal recalculated: 200+25=225");
});

test("E09: vacancy row removal — isDeleted=true, derived total excludes the row", () => {
  const row1 = makeVacancyRow("row-1", "Generalist", 200);
  const row2 = makeVacancyRow("row-2", "Hindi", 25);
  const vac = recalculateDerivedTotal(makeVacancyData([row1, row2]));
  assert.strictEqual(vac.derivedTotal, 225, "baseline derivedTotal=225");

  const updated = removeVacancyRow(vac, "row-2");

  const removed = updated.rows.find((r) => r.id === "row-2");
  assert.strictEqual(removed?.isDeleted, true, "isDeleted=true");
  assert.strictEqual(updated.rows.length, 2, "row count unchanged (soft delete)");
  assert.strictEqual(updated.derivedTotal, 200, "derivedTotal excludes deleted row: 200");
});

test("E10: derived total recalculation after row edit — sum updates correctly", () => {
  const row1 = makeVacancyRow("row-1", "Generalist", 200);
  const row2 = makeVacancyRow("row-2", "Hindi", 25);
  let vac = recalculateDerivedTotal(makeVacancyData([row1, row2]));
  assert.strictEqual(vac.derivedTotal, 225, "baseline 200+25=225");

  // Admin changes Hindi from 25 → 30
  const editedRow2 = applyVacancyRowEdit(row2, { total: 30 }, "admin");
  vac = recalculateDerivedTotal({
    ...vac,
    rows: vac.rows.map((r) => (r.id === "row-2" ? editedRow2 : r)),
  });

  assert.strictEqual(vac.derivedTotal, 230, "derivedTotal recalculated: 200+30=230");
  // Original row preserved in array
  const updatedRow = vac.rows.find((r) => r.id === "row-2")!;
  assert.strictEqual(updatedRow.total, 30, "row total updated");
  assert.strictEqual(updatedRow.manuallyEdited, true, "row manuallyEdited=true");
});

test("E11: Save Draft stamps savedAt without modifying canonical data fields", () => {
  const draft = makeMinimalDraft();
  assert.strictEqual(draft.savedAt, undefined, "savedAt initially absent");

  const saved = saveDraft(draft);

  assert.ok(saved.savedAt, "savedAt set");
  assert.ok(new Date(saved.savedAt!) <= new Date(), "savedAt is not in future");
  // Canonical identity fields untouched
  assert.strictEqual(saved.identity.title.value, draft.identity.title.value, "title unchanged");
  assert.strictEqual(saved.identity.organizationId.value, draft.identity.organizationId.value, "orgId unchanged");
  // Original draft not mutated
  assert.strictEqual(draft.savedAt, undefined, "original draft.savedAt still undefined");
  // readiness unchanged — save does not approve
  assert.deepStrictEqual(saved.readiness, draft.readiness, "readiness unchanged");
});

test("E12: manual entry into originally missing field — machineValue stays undefined, reset clears to undefined", () => {
  // Engine produced no value for this field
  const fv: FieldValue<string> = {
    value: undefined,
    confidence: 0,
    evidence: [],
    manuallyEdited: false,
    conflict: false,
  };
  assert.strictEqual(fv.value, undefined, "no machine extraction");

  // Admin enters a value manually
  const edited = applyFieldEdit(fv, "CRP/2026/01", "admin", "Admin entered manually");

  // machineValue must NOT capture the admin-entered value
  assert.strictEqual(edited.machineValue, undefined, "machineValue stays undefined — nothing was machine-extracted");
  assert.strictEqual(edited.value, "CRP/2026/01", "value is admin-entered");
  assert.strictEqual(edited.manuallyEdited, true, "manuallyEdited=true");
  assert.strictEqual(edited.editedBy, "admin");

  // Reset must clear back to undefined, NOT "restore" the admin-entered value
  const reset = resetFieldToMachine(edited);
  assert.strictEqual(reset.value, undefined, "reset clears value to undefined (no machine value to restore)");
  assert.strictEqual(reset.manuallyEdited, false, "manuallyEdited cleared");
  assert.strictEqual(reset.machineValue, undefined, "machineValue still undefined after reset");
  // editedBy/editedAt cleared
  assert.strictEqual(reset.editedBy, undefined, "editedBy cleared");
  assert.strictEqual(reset.editedAt, undefined, "editedAt cleared");
});

test("E13: 3-row vacancy — soft-delete one row — derived total excludes deleted row", () => {
  const row1 = makeVacancyRow("row-1", "Generalist", 200);
  const row2 = makeVacancyRow("row-2", "Hindi", 25);
  const row3 = makeVacancyRow("row-3", "Agriculture", 10);
  let vac = recalculateDerivedTotal(makeVacancyData([row1, row2, row3]));
  assert.strictEqual(vac.derivedTotal, 235, "baseline 200+25+10=235");

  // Soft-delete Agriculture (10)
  vac = removeVacancyRow(vac, "row-3");

  const deletedRow = vac.rows.find((r) => r.id === "row-3");
  assert.strictEqual(deletedRow?.isDeleted, true, "Agriculture row isDeleted=true");
  assert.strictEqual(vac.rows.length, 3, "all 3 rows preserved in array (soft delete, not physical)");
  assert.strictEqual(vac.derivedTotal, 225, "derived total: 200+25=225 (Agriculture excluded)");

  const activeRows = vac.rows.filter((r) => !r.isDeleted);
  assert.strictEqual(activeRows.length, 2, "only 2 active rows");
  assert.ok(activeRows.every((r) => r.id !== "row-3"), "deleted row not in active set");
});
