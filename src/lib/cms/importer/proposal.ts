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
  /** Read from a scanned page that the AI wrote out from its image (stage B2.4): its quote is the AI's reading, not printed text. */
  fromImage?: boolean;
  /** What code did to the reading, for the admin to see on the item (B2.6: a stage added from the schedule, a type corrected). */
  notes?: string[];
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

/** Fields whose one value an official corrigendum restates in full, so its replacement starts ticked (B2.6). */
const CORRIGENDUM_REPLACES = /^(?:dates\.|financial\.fee|vacancies\.total$)/;

export interface ItemClaim {
  retrievalId: string;
  quote?: string;
  page?: number | null;
  tableCell?: ExtractedValue["tableCell"];
  fromImage?: boolean;
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
  /** What the whole import lacks: no official notification or apply link, research only. */
  warnings: string[];
}

/** Deadlines that can have passed; a passed one is flagged, never changed. */
const DEADLINES = ["dates.applicationCloseDate", "dates.feePaymentCloseDate", "dates.correctionWindowEnd"];

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
  currentLinks?: Array<{ url: string; type: string; official?: boolean }>;
  /** Today in India, YYYY-MM-DD, for the passed-deadline flag. */
  today?: string;
}): Proposal {
  const items: ProposalItem[] = [];
  const replacedInImport: Proposal["replacedInImport"] = [];
  const byRetrieval = new Map(input.extractions.map((e) => [e.retrieval.id, e.retrieval]));

  // ── Fields ──
  const groups = new Map<string, Map<string, { value: unknown; claims: ItemClaim[]; notes: string[] }>>();
  for (const ex of input.extractions) {
    for (const v of ex.values) {
      if (isEmpty(v.value)) continue;
      // A corrigendum's heading ("Corrigendum 1 to …") is not the job's title, and its own file or reference
      // number ("F. No. HQ-C11018/1/2026-C-1") is not the recruitment's notification number (B2.6, SSC CGL).
      if (ex.retrieval.declaredKind === "OFFICIAL_CORRIGENDUM" && (v.fieldPath === "identity.title" || v.fieldPath === "identity.shortTitle" || v.fieldPath === "identity.notificationNumber")) continue;
      const perField = groups.get(v.fieldPath) ?? new Map();
      const h = shortHash(v.fieldPath, v.value);
      const g = perField.get(h) ?? { value: v.value, claims: [], notes: [] };
      for (const n of v.notes ?? []) if (!g.notes.includes(n)) g.notes.push(n);
      g.claims.push({ retrievalId: ex.retrieval.id, quote: v.quote, page: v.page ?? null, ...(v.tableCell ? { tableCell: v.tableCell } : {}), ...(v.fromImage ? { fromImage: true } : {}) });
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
      if (g.claims.some((c) => c.fromImage)) flags.push("read from a scanned page by AI — check it against the page image");
      flags.push(...g.notes);

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
        // A critical value that only research gives, while the official
        // document in this import is silent on it, waits for the admin's tick.
        // An official corrigendum states the current value: its replacement of
        // a value nobody has verified starts ticked (B2.6: SSC CGL's reopened
        // window). Replacing a verified value still waits for the admin.
        // Only single values: a corrigendum's few sentences or rows do not restate a whole list (BPSC: its notes as "conditions").
        defaultTicked: !conflict && (action === "FILL" || action === "MATCHES" || (action === "REPLACE" && fromCorrigendum.length > 0 && CORRIGENDUM_REPLACES.test(fieldPath)))
          && !(officialInImport && !sources.some(eligibleRetrieval) && fieldDef(fieldPath).tier !== undefined),
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
        // Ticked only for an address on the organisation's trusted list.
        defaultTicked: l.official && blocking.length === 0 && ex.retrieval.declaredKind !== "RESEARCH",
        flags: [...l.flags, ...(ex.retrieval.declaredKind === "RESEARCH" ? ["found in research text"] : [])],
      });
    }
  }

  items.sort((a, b) => a.fieldPath.localeCompare(b.fieldPath) || a.id.localeCompare(b.id));

  // Posts that do not add up to the stated total: one of them is wrong (BPSC: 18 posts making 1205, a total
  // of 1077, the notice's 1230). Both are said and left for the admin, not saved by default.
  const totals = items.filter((i) => i.fieldPath === "vacancies.total" && typeof i.value === "number");
  const fromCorr = (i: ProposalItem) => i.claims.some((c) => byRetrieval.get(c.retrievalId)?.declaredKind === "OFFICIAL_CORRIGENDUM");
  // A corrigendum's posts are only those it adds, changes or deletes (BPSC: the deleted Sugarcane Officer, 44):
  // never the whole list, so never saved by default, and not summed against the total.
  for (const b of items.filter((i) => i.fieldPath === "vacancies.breakdown" && fromCorr(i))) {
    b.defaultTicked = false;
    b.flags.push("a corrigendum lists only the posts it adds, changes or deletes — check in the notice whether each is added, changed or deleted before saving; ticked, it would replace the whole list");
  }
  const splits = items.filter((i) => i.fieldPath === "vacancies.breakdown" && Array.isArray(i.value) && !fromCorr(i));
  for (const b of splits) {
    const sum = (b.value as Array<{ count?: number }>).reduce((n, r) => n + (typeof r.count === "number" ? r.count : 0), 0);
    for (const t of totals.filter((x) => x.value !== sum)) {
      const note = `the posts add up to ${sum}, the total says ${t.value} — check both against the notice`;
      for (const i of [b, t]) { if (!i.flags.includes(note)) i.flags.push(note); i.defaultTicked = false; }
    }
  }

  // A schedule entry whose name no rule recognises is not guessed: the admin chooses its class.
  for (const i of items) {
    if (i.fieldPath !== "examStages" || !Array.isArray(i.value)) continue;
    const unknown = (i.value as Array<{ name: string; kind?: string }>).filter((s) => s.kind === "UNCLASSIFIED").map((s) => `“${s.name}”`);
    if (unknown.length) i.flags.push(`not classified as a selection stage or an announcement: ${unknown.join(", ")} — choose in the exam stages editor`);
  }

  // Ages read post by post: a post the eligibility names but no age was read for is said, not given another post's range.
  // An age row covers an eligibility post when one name's words are all in the other's (plurals evened out):
  // IBPS's "Officer Scale- II (Manager)" row covers "Officer Scale-II General Banking Officer (Manager)". A post
  // named so that code cannot tie it to a row ("Law Officer") is flagged: the admin checks it.
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1).map((w) => w.replace(/s$/, ""));
  const within = (a: string, b: string) => words(a).every((w) => words(b).includes(w));
  const covers = (age: string, post: string) => within(post, age) || within(age, post);
  const posts = items.filter((i) => i.fieldPath === "eligibility" && Array.isArray(i.value)).flatMap((i) => (i.value as Array<{ post: string }>).map((p) => p.post));
  for (const i of items) {
    const ages = (i.value as { postWise?: Array<{ post: string }> } | null)?.postWise;
    if (i.fieldPath !== "age" || !ages?.length) continue;
    const missing = [...new Set(posts)].filter((p) => !ages.some((a) => covers(a.post, p)));
    if (missing.length) i.flags.push(`no age was read for ${missing.map((p) => `“${p}”`).join(", ")} — check the notice; another post's range is not used for it`);
    // Half a date-of-birth window read: said, so the other date is entered from the notice (the age check then uses the printed age).
    const half = (ages as Array<{ post: string; bornFrom?: string; bornTo?: string }>).filter((a) => !!a.bornFrom !== !!a.bornTo);
    if (half.length) i.flags.push(`only one date of birth was read for ${half.map((a) => `“${a.post}” (${a.bornFrom ? "the latest" : "the earliest"} is missing)`).join(", ")} — check the notice`);
  }

  if (input.today) {
    for (const i of items) {
      if (DEADLINES.includes(i.fieldPath) && typeof i.value === "string" && i.value < input.today) i.flags.push(`this date has passed (today is ${input.today})`);
    }
  }
  const warnings: string[] = [];
  const hasOfficial = (type: string) =>
    items.some((i) => i.fieldPath === `links#${type}` && (i.value as { official?: boolean }).official === true)
    || (input.currentLinks ?? []).some((l) => l.type === type && l.official === true);
  if (!hasOfficial("OFFICIAL_NOTIFICATION")) {
    warnings.push("No official notification link was found. Add the recruiting body's own notice (its PDF or page) as a source, or add the link in Links: the job cannot be published until it is checked.");
  }
  if (!hasOfficial("APPLY_ONLINE")) {
    warnings.push("No official apply link was found. A portal's link is never used for it. Add it in Links, or mark it not applicable (walk-in, offline form) when checking.");
  }
  if (input.extractions.length > 0 && input.extractions.every((e) => e.retrieval.declaredKind === "RESEARCH")) {
    warnings.push("Every source here is research. Its values are saved as Pending, but none can be checked until an official document is added.");
  }
  return { items, replacedInImport, warnings };
}
