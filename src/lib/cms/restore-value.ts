// ═══════════════════════════════════════════════════════════
// Putting back the value a field had before a change
// ═══════════════════════════════════════════════════════════
//
// Pure. Every save writes a revision with the value before and after. To
// undo a mistaken edit, the "before" value is saved again through the
// ordinary field route, so the restore is itself validated and recorded as a
// new revision. Nothing in the history is ever changed or removed.
//
// A restored value comes back Pending, even if it was Verified before: it is
// being put back by hand, so it is checked again. "Not specified" comes back
// as it was. A field that was empty before the change cannot be "restored";
// the admin clears it by hand.

import type { ProvenanceField } from "@/types/recruitment-record";

export type Restorable =
  | { ok: true; field: ProvenanceField<unknown> }
  | { ok: false; reason: string };

const isProvenance = (v: unknown): v is ProvenanceField<unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "status" in v && "value" in v;

export function restorable(oldValue: unknown): Restorable {
  if (oldValue === null || oldValue === undefined) {
    return { ok: false, reason: "This field was empty before the change. Clear it by hand if it should be empty again." };
  }
  if (isProvenance(oldValue)) {
    if (oldValue.status === "NOT_SPECIFIED" || oldValue.value === null || oldValue.value === undefined) {
      return { ok: true, field: { value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true } };
    }
    return { ok: true, field: { value: oldValue.value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } };
  }
  // Lists kept without a status of their own (links, exam stages, steps to apply, listing details).
  return { ok: true, field: { value: oldValue, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } };
}

/** Whether restoring would change anything: the value before equals the field now. */
export function sameAsNow(oldValue: unknown, current: unknown): boolean {
  const unwrap = (v: unknown) => (isProvenance(v) ? v.value : v);
  return JSON.stringify(unwrap(oldValue) ?? null) === JSON.stringify(unwrap(current) ?? null);
}

/** The field's current content, by the same path its revisions use ("dates.applicationCloseDate", "eligibility", "links"). */
export function currentValue(record: object, fieldPath: string): unknown {
  let at: unknown = record;
  for (const part of fieldPath.split(".")) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}
