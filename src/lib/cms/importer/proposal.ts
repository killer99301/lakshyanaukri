// ═══════════════════════════════════════════════════════════
// Importer: from what each source says to the preview's items
// ═══════════════════════════════════════════════════════════
//
// Pure. Values found in every source of one import are grouped per field.
//   - Different values from sources that are still current → a conflict: one
//     item per value, none ticked.
//   - A corrigendum in the import replaces other sources' value for the fields
//     it states, and only those fields; earlier claims on the job for those
//     fields are proposed as superseded.
//   - Compared with the job: an empty field is filled (ticked), an equal value
//     only gains evidence (ticked), a different value is a replacement (not
//     ticked), and a verified value needs a second, separate confirmation.
// Nothing here decides; the admin ticks.

import { canonicalJson, valueHash } from "@/lib/cms/importer/evidence-text";
import { fieldDef } from "@/lib/cms/importer/fields";
import type { FoundLink } from "@/lib/cms/importer/links";

export type DeclaredKind = "OFFICIAL_NOTIFICATION" | "OFFICIAL_CORRIGENDUM" | "OFFICIAL_PAGE" | "RESEARCH" | "OTHER";
export type Authenticity = "CONFIRMED" | "ATTESTED" | "UNCONFIRMED" | "NOT_APPLICABLE";

export interface RetrievalSummary {
  id: string;
  declaredKind: DeclaredKind;
  authenticity: Authenticity;
  originRole: "AUTHORITY" | "PARTNER" | "UNLISTED" | "NONE";
  originPurposes: string[];
  /** How the preview names it: "lichousing.com (PDF, confirmed)", "Pasted research text". */
  label: string;
  versionLabel?: string;
  documentDate?: string;
}

export interface ExtractedValue {
  fieldPath: string;
  value: unknown;
  quote?: string;
  page?: number | null;
  tableCell?: { page?: number; table?: number; row?: string; column?: string; text: string };
}

export interface SourceExtraction {
  retrieval: RetrievalSummary;
  values: ExtractedValue[];
  links: FoundLink[];
}

/** An EXTRACTED claim already on the job, from an earlier import. */
export interface ExistingClaim {
  id: string;
  fieldPath: string;
  value: unknown;
  superseded: boolean;
}

export interface CurrentField {
  value: unknown;
  /** The field's current revision carries an effective VERIFIED decision. */
  verified: boolean;
}

export type ItemAction = "FILL" | "MATCHES" | "REPLACE" | "REPLACE_VERIFIED";

export interface ItemClaim {
  retrievalId: string;
  quote?: string;
  page?: number | null;
  tableCell?: ExtractedValue["tableCell"];
}

export interface ProposalItem {
  id: string;
  kind: "FIELD" | "LINK";
  fieldPath: string;
  label: string;
  value: unknown;
  claims: ItemClaim[];
  action: ItemAction;
  conflict: boolean;
  /** Existing EXTRACTED claim ids this value replaces (corrigendum). */
  supersedes: string[];
  defaultTicked: boolean;
  flags: string[];
  current?: unknown;
}

export interface Proposal {
  items: ProposalItem[];
  /** Values a corrigendum in this import replaced, for the preview to show. */
  replacedInImport: Array<{ fieldPath: string; value: unknown; by: string }>;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** The part of a value that identity is judged on (links by address and type). */
export function comparable(fieldPath: string, value: unknown): unknown {
  if (fieldPath.startsWith("links#") && value && typeof value === "object") {
    const l = value as { url?: string; type?: string };
    return { type: l.type, url: l.url };
  }
  return value;
}

const shortHash = (fieldPath: string, value: unknown) => valueHash(comparable(fieldPath, value)).slice(0, 12);

const eligibleRetrieval = (r: RetrievalSummary) =>
  (r.authenticity === "CONFIRMED" || r.authenticity === "ATTESTED") && (r.originRole === "AUTHORITY" || r.originRole === "PARTNER");

export function buildProposal(input: {
  extractions: SourceExtraction[];
  current: (fieldPath: string) => CurrentField | undefined;
  existingClaims?: ExistingClaim[];
  /** Links already on the job, by address. */
  currentLinks?: Array<{ url: string; type: string }>;
}): Proposal {
  const items: ProposalItem[] = [];
  const replacedInImport: Proposal["replacedInImport"] = [];
  const byRetrieval = new Map(input.extractions.map((e) => [e.retrieval.id, e.retrieval]));

  // ── Fields ──
  const groups = new Map<string, Map<string, { value: unknown; claims: ItemClaim[] }>>();
  for (const ex of input.extractions) {
    for (const v of ex.values) {
      if (isEmpty(v.value)) continue;
      const perField = groups.get(v.fieldPath) ?? new Map();
      const h = shortHash(v.fieldPath, v.value);
      const g = perField.get(h) ?? { value: v.value, claims: [] };
      g.claims.push({ retrievalId: ex.retrieval.id, quote: v.quote, page: v.page ?? null, ...(v.tableCell ? { tableCell: v.tableCell } : {}) });
      perField.set(h, g);
      groups.set(v.fieldPath, perField);
    }
  }

  for (const [fieldPath, perField] of groups) {
    let candidates = [...perField.entries()];
    // A corrigendum in this import states the current value of the fields it mentions.
    const fromCorrigendum = candidates.filter(([, g]) => g.claims.some((c) => byRetrieval.get(c.retrievalId)?.declaredKind === "OFFICIAL_CORRIGENDUM"));
    let supersedes: string[] = [];
    if (fromCorrigendum.length > 0) {
      for (const [, g] of candidates.filter((c) => !fromCorrigendum.includes(c))) {
        replacedInImport.push({ fieldPath, value: g.value, by: fromCorrigendum[0][1].claims.map((c) => byRetrieval.get(c.retrievalId)?.label).join(", ") });
      }
      candidates = fromCorrigendum;
      supersedes = (input.existingClaims ?? [])
        .filter((c) => c.fieldPath === fieldPath && !c.superseded && !candidates.some(([h]) => h === shortHash(fieldPath, c.value)))
        .map((c) => c.id);
    }
    const conflict = candidates.length > 1;
    const cur = input.current(fieldPath);
    for (const [h, g] of candidates) {
      const sources = g.claims.map((c) => byRetrieval.get(c.retrievalId)!).filter(Boolean);
      const flags: string[] = [];
      if (sources.every((s) => s.declaredKind === "RESEARCH")) flags.push("from research only — check it against the official notice");
      else if (!sources.some(eligibleRetrieval)) flags.push("no confirmed official document states this");
      const officialInImport = input.extractions.some((e) => e.retrieval.declaredKind !== "RESEARCH" && eligibleRetrieval(e.retrieval));
      if (officialInImport && !sources.some(eligibleRetrieval)) flags.push("the official document in this import does not state this");

      let action: ItemAction;
      if (!cur || isEmpty(cur.value)) action = "FILL";
      else if (canonicalJson(comparable(fieldPath, cur.value)) === canonicalJson(comparable(fieldPath, g.value))) action = "MATCHES";
      else action = cur.verified ? "REPLACE_VERIFIED" : "REPLACE";

      items.push({
        id: `f:${fieldPath}:${h}`,
        kind: "FIELD",
        fieldPath,
        label: fieldDef(fieldPath).label,
        value: g.value,
        claims: g.claims,
        action,
        conflict,
        supersedes: conflict ? [] : supersedes,
        defaultTicked: !conflict && (action === "FILL" || action === "MATCHES"),
        flags,
        ...(cur && !isEmpty(cur.value) ? { current: cur.value } : {}),
      });
    }
  }

  // ── Links, one item per address ──
  const seen = new Set<string>();
  const onJob = new Set((input.currentLinks ?? []).map((l) => l.url));
  for (const ex of input.extractions) {
    for (const l of ex.links) {
      if (seen.has(l.url)) continue;
      seen.add(l.url);
      const fieldPath = `links#${l.type}`;
      const value = { type: l.type, label: l.label, url: l.url, official: l.official };
      const blocking = l.flags.filter((f) => f !== "tracking removed");
      items.push({
        id: `l:${shortHash(fieldPath, value)}`,
        kind: "LINK",
        fieldPath,
        label: fieldDef(fieldPath).label,
        value,
        claims: [{ retrievalId: ex.retrieval.id, quote: l.context }],
        action: onJob.has(l.url) ? "MATCHES" : "FILL",
        conflict: false,
        supersedes: [],
        defaultTicked: blocking.length === 0 && ex.retrieval.declaredKind !== "RESEARCH",
        flags: [...l.flags, ...(ex.retrieval.declaredKind === "RESEARCH" ? ["found in research text"] : [])],
      });
    }
  }

  items.sort((a, b) => a.fieldPath.localeCompare(b.fieldPath) || a.id.localeCompare(b.id));
  return { items, replacedInImport };
}
