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

export function classifyField(state: FieldState, firstImportAt: string | null): FieldVerdict {
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
export function publishGate(states: FieldState[], firstImportAt: string | null): GateResult {
  const verdicts = CRITICAL_FIELDS.map((path) => {
    const state = states.find((s) => s.fieldPath === path)
      ?? { fieldPath: path, hasValue: false, value: null, latestRevisionId: null, latestRevisionAt: null, claims: [] };
    return classifyField(state, firstImportAt);
  });
  const blockers = verdicts.filter((v) => {
    const tier = fieldDef(v.fieldPath).tier;
    if (v.cls === "VERIFIED" || v.cls === "NOT_APPLICABLE") return false;
    if (v.cls === "NOT_STATED" && tier === "B") return false;
    return true;
  });
  return { ok: blockers.length === 0, verdicts, blockers };
}
