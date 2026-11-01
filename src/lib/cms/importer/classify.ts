// ═══════════════════════════════════════════════════════════
// Importer: each field's class, and the publish gate for imported jobs
// ═══════════════════════════════════════════════════════════
//
// Pure. A decision counts only while the revision it names is still the
// field's latest one: any later save — even back to an identical value —
// leaves the field undecided (design §5). Among decisions on the latest
// revision, the unrevoked one with the highest seq is in force.

import { valueHash } from "@/lib/cms/importer/evidence-text";
import { authorityCovers, type OriginRole } from "@/lib/cms/importer/trusted-domains";
import { CRITICAL_FIELDS, fieldDef } from "@/lib/cms/importer/fields";
import { comparable } from "@/lib/cms/importer/proposal";
import { calculatedTotalReady, type VacancyTable } from "@/lib/vacancy-table";
import { isIncompletenessReason, quoteIsPrintedTotal, totalRoute } from "@/lib/cms/importer/table-check";

export type FieldClass =
  | "VERIFIED" | "NOT_APPLICABLE" | "NOT_STATED"
  | "SUPPORTED" | "RESEARCH_ONLY" | "UNSUPPORTED" | "CONFLICTING" | "LEGACY" | "MISSING";

export interface ClaimView {
  id: string;
  seq: number;
  kind: "EXTRACTED" | "ADMIN_VERIFIED" | "ADMIN_NOT_APPLICABLE" | "ADMIN_NOT_STATED" | "ADMIN_REVOKED";
  value: unknown;
  fieldRevisionId?: string | null;
  revokesClaimId?: string | null;
  publicNote?: string | null;
  quote?: string | null;
  page?: number | null;
  superseded?: boolean;
  retrieval?: { authenticity: string; originRole: OriginRole; originPurposes: string[]; declaredKind: string } | null;
}

export interface FieldState {
  fieldPath: string;
  hasValue: boolean;
  value: unknown;
  /** Id of the field's latest field_revisions row, or null when it was never saved. */
  latestRevisionId: string | null;
  /** When that revision was written (ISO), or null. */
  latestRevisionAt: string | null;
  claims: ClaimView[];
}

export interface FieldVerdict {
  fieldPath: string;
  label: string;
  cls: FieldClass;
  decisionId?: string;
  publicNote?: string;
  reason: string;
}

export function effectiveDecision(state: FieldState): ClaimView | undefined {
  const revoked = new Set(state.claims.filter((c) => c.kind === "ADMIN_REVOKED").map((c) => c.revokesClaimId));
  return state.claims
    .filter((c) => (c.kind === "ADMIN_VERIFIED" || c.kind === "ADMIN_NOT_APPLICABLE" || c.kind === "ADMIN_NOT_STATED")
      && !revoked.has(c.id) && state.latestRevisionId !== null && c.fieldRevisionId === state.latestRevisionId)
    .sort((a, b) => b.seq - a.seq)[0];
}

/**
 * What Total Vacancies needs when it is worked out from the job's vacancy table (Stage C, C2): the table,
 * how the total was worked out, whether the whole-table check stands at the table's latest revision, and
 * whether the table has conflicting sources open.
 */
export interface TableTotalContext {
  table: VacancyTable;
  derived: { basis: string; complete: boolean; fingerprint: string };
  tableChecked: boolean;
  tableConflict: boolean;
}

export function classifyField(state: FieldState, firstImportAt: string | null, tableTotal?: TableTotalContext | null): FieldVerdict {
  if (state.fieldPath === "vacancies.total" && tableTotal && state.hasValue && typeof state.value === "number") return classifyTableTotal(state, firstImportAt, tableTotal);
  const { fieldPath } = state;
  const def = fieldDef(fieldPath);
  const verdict = (cls: FieldClass, reason: string, extra: Partial<FieldVerdict> = {}): FieldVerdict => ({ fieldPath, label: def.label, cls, reason, ...extra });

  const decision = effectiveDecision(state);
  if (decision?.kind === "ADMIN_VERIFIED") return verdict("VERIFIED", "checked against the official document", { decisionId: decision.id });
  if (decision?.kind === "ADMIN_NOT_APPLICABLE") return verdict("NOT_APPLICABLE", "recorded as not applicable", { decisionId: decision.id, publicNote: decision.publicNote ?? decision.quote ?? undefined });
  if (decision?.kind === "ADMIN_NOT_STATED") return verdict("NOT_STATED", "recorded as not stated in the notice", { decisionId: decision.id, publicNote: decision.publicNote ?? undefined });

  if (!state.hasValue) return verdict("MISSING", "no value and no decision");

  const extracted = state.claims.filter((c) => c.kind === "EXTRACTED" && !c.superseded);
  const hashes = new Set(extracted.map((c) => valueHash(comparable(fieldPath, c.value))));
  if (hashes.size > 1) return verdict("CONFLICTING", "the sources disagree");

  const current = valueHash(comparable(fieldPath, state.value));
  const matching = extracted.filter((c) => valueHash(comparable(fieldPath, c.value)) === current);
  if (matching.length === 0) {
    const legacy = extracted.length === 0 && firstImportAt !== null
      && (state.latestRevisionAt === null || state.latestRevisionAt < firstImportAt);
    return legacy
      ? verdict("LEGACY", "entered before this job was first imported; check it against a source")
      : verdict("UNSUPPORTED", extracted.length > 0 ? "differs from what the sources say" : "no source states this value");
  }
  const eligible = matching.some((c) => c.retrieval && (c.retrieval.authenticity === "CONFIRMED" || c.retrieval.authenticity === "ATTESTED")
    && authorityCovers(c.retrieval.originRole, c.retrieval.originPurposes, def.purpose));
  if (eligible) return verdict("SUPPORTED", "an official document states it; not yet checked by a person");
  if (matching.every((c) => c.retrieval?.declaredKind === "RESEARCH")) return verdict("RESEARCH_ONLY", "only research text states it");
  return verdict("UNSUPPORTED", "only an unconfirmed or unlisted source states it");
}

export interface GateResult {
  ok: boolean;
  verdicts: FieldVerdict[];
  blockers: FieldVerdict[];
}

/** The publish gate for an imported job: Tier A needs VERIFIED or NOT_APPLICABLE; Tier B also accepts NOT_STATED. */
export function publishGate(states: FieldState[], firstImportAt: string | null, tableTotal?: TableTotalContext | null): GateResult {
  const verdicts = CRITICAL_FIELDS.map((path) => {
    const state = states.find((s) => s.fieldPath === path)
      ?? { fieldPath: path, hasValue: false, value: null, latestRevisionId: null, latestRevisionAt: null, claims: [] };
    return classifyField(state, firstImportAt, tableTotal);
  });
  const blockers = verdicts.filter((v) => {
    const tier = fieldDef(v.fieldPath).tier;
    if (v.cls === "VERIFIED" || v.cls === "NOT_APPLICABLE") return false;
    if (v.cls === "NOT_STATED" && tier === "B") return false;
    return true;
  });
  return { ok: blockers.length === 0, verdicts, blockers };
}

/**
 * Total Vacancies worked out from the vacancy table (Stage C, C2). It is VERIFIED only when:
 *  - the table needs no decision (the approved rule, calculatedTotalReady: every row with its evidence,
 *    coverage complete, no undecided column, the stored total equal to a recalculation from the rows),
 *    and no conflict is open on the table; and
 *  - it is checked by its own route: the whole-table check, at the table's latest revision, when the
 *    total is calculated, entered, incomplete, rests on AI-read or prepared rows, or has no printed line
 *    the system can establish (owner's decision C-D2); otherwise a decision citing the printed total's
 *    own line, figure and page. A quote of anything else does not verify it.
 * An incomplete total is never VERIFIED (decision C-D3). "Not stated in full" makes it NOT_STATED only
 * when every reason left is about the missing figures; it never clears another blocker.
 */
function classifyTableTotal(state: FieldState, firstImportAt: string | null, ctx: TableTotalContext): FieldVerdict {
  const def = fieldDef(state.fieldPath);
  const value = state.value as number;
  const verdict = (cls: FieldClass, reason: string, extra: Partial<FieldVerdict> = {}): FieldVerdict => ({ fieldPath: state.fieldPath, label: def.label, cls, reason, ...extra });
  const route = totalRoute(ctx.table, ctx.derived, value);
  const rule = calculatedTotalReady(ctx.table, { tableChecked: ctx.tableChecked, stored: { value, fingerprint: ctx.derived.fingerprint } });
  // The reasons that stand in the way, whatever route the total takes. "Check it as usual" is the
  // printed-line route itself; the table check is asked for below only where that route requires it.
  const reasons = rule.reasons.filter((r) => r !== "the total is printed in the notice; check it as usual"
    && (route.route === "TABLE_CHECK" || r !== "the table has not been checked against the notice"));
  if (ctx.tableConflict) reasons.unshift("the vacancy table has conflicting sources open");
  const pending = (why: string[]): FieldVerdict => {
    const base = classifyField({ ...state, claims: state.claims.filter((c) => c.kind === "EXTRACTED") }, firstImportAt);
    const cls: FieldClass = ctx.tableConflict ? "CONFLICTING" : base.cls === "VERIFIED" || base.cls === "NOT_APPLICABLE" || base.cls === "NOT_STATED" ? "UNSUPPORTED" : base.cls;
    return verdict(cls, `not yet checked: ${why.join("; ")}`);
  };
  const decision = effectiveDecision(state);

  if (route.incomplete) {
    const others = reasons.filter((r) => !isIncompletenessReason(r));
    if (decision?.kind === "ADMIN_NOT_STATED") {
      return others.length === 0
        ? verdict("NOT_STATED", "recorded as not stated in full: the page shows it as a minimum", { decisionId: decision.id, publicNote: decision.publicNote ?? undefined })
        : pending([`"not stated in full" is recorded, but it answers only the missing figures; also ${others.join("; ")}`]);
    }
    return pending([...reasons, "an incomplete total is never verified; when the notice gives no more, record it as not stated in full"]);
  }
  if (reasons.length > 0) return pending(reasons);
  if (route.route === "TABLE_CHECK") {
    return ctx.tableChecked
      ? verdict("VERIFIED", "the whole vacancy table was checked against the notice")
      : pending([...route.why, "check the whole table against the notice"]);
  }
  // A printed total read by code from text: its own line, figure and page, or the whole-table check.
  if (ctx.tableChecked) return verdict("VERIFIED", "the whole vacancy table was checked against the notice");
  if (decision?.kind === "ADMIN_VERIFIED" && route.evidence && quoteIsPrintedTotal(route.evidence, value, decision.quote ?? null, decision.page ?? null)) {
    return verdict("VERIFIED", "checked against the notice's printed total", { decisionId: decision.id });
  }
  return pending([`cite the notice's printed total, “${route.evidence!.line}” (page ${route.evidence!.page}), or check the whole table`]);
}
