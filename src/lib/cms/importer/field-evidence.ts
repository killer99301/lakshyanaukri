// ═══════════════════════════════════════════════════════════
// Importer: what each source said about a field, for the check list (G2)
// ═══════════════════════════════════════════════════════════
//
// Pure. From a field's stored claims (recruitment_field_claims, written when
// an import was saved) and the job's documents: each source's value, document,
// quote, page or place in a web text, and standing; the values that disagree;
// and, when one stored passage could support a decision, the evidence to put
// in the check form so the person does not retype it.
//
// It decides nothing. The decision is still the person's, sent with the same
// request as before, and the server checks it exactly as before (decide in
// service.ts): a confirmed or attested document from the recruiting body or a
// listed partner, the words found in that document, a page for a PDF, the
// field's revision, the whole-table check. Research is never offered as
// evidence here. A prefilled quote is the stored one, never made up; when
// none is stored, lines of the official document holding the value are
// offered as suggestions, copied as they are, for the person to choose.

import { valueHash } from "@/lib/cms/importer/evidence-text";
import { comparable } from "@/lib/cms/importer/proposal";
import { authorityCovers, type OriginRole } from "@/lib/cms/importer/trusted-domains";
import type { FieldState } from "@/lib/cms/importer/classify";
import type { Purpose } from "@/lib/cms/importer/fields";

export interface EvidenceDoc {
  id: string; declaredKind: string; authenticity: string; originRole: OriginRole; originPurposes: string[];
  originHost: string | null; contentKind: string; name: string;
}

export type Standing = "OFFICIAL" | "RESEARCH" | "UNCONFIRMED" | "NOT_TRUSTED_FOR_THIS";

export interface EvidenceItem {
  claimId: string;
  value: unknown;
  /** The value the field holds now. */
  matchesCurrent: boolean;
  retrievalId: string | null;
  document: string;
  contentKind: string | null;
  page: number | null;
  quote: string | null;
  /** Where the words are: "page 4", or "web text" for a page or text with no pages. */
  location: string;
  standing: Standing;
  standingWords: string;
  /** Whether the stored words are found in the document's text as it is kept. Null when there are no words. */
  quoteFound: boolean | null;
  /** Whether this stored passage can be offered in the check form (it still goes to the server's own checks). */
  usable: boolean;
  /** Why not, when it cannot. */
  notUsable?: string;
}

export interface FieldEvidence {
  items: EvidenceItem[];
  /** Values the sources give that differ from each other (CONFLICTING), each with its sources. */
  conflicts: Array<{ value: unknown; documents: string[] }>;
  /** The evidence to put in the form, from the first usable passage that states the current value. */
  prefill: { retrievalId: string; page: number | null; quote: string; claimId: string } | null;
  /**
   * When no stored passage can be used (code readers keep no words for a date or a fee): the lines of the official
   * documents that contain the value as written, found by searching them. Offered for the person to pick, never put
   * in the form by itself, and labelled as found, not stored. At most three; none when the value is not a date, a
   * number or a short text.
   */
  suggestions: Array<{ retrievalId: string; document: string; page: number | null; quote: string; location: string }>;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** How a value can be written in a notice: a date in its usual forms, a number with or without Indian commas, a short text as is. */
export function writtenForms(value: unknown): RegExp[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    const dd = String(Number(d)), mm = String(Number(m)), mon = MONTHS[Number(m) - 1];
    const day = `0?${dd}`, month = `0?${mm}`;
    return [
      new RegExp(String.raw`(?<!\d)${day}\s*[./-]\s*${month}\s*[./-]\s*${y}(?!\d)`),
      new RegExp(String.raw`(?<!\d)${day}(?:st|nd|rd|th)?\s+(?:${mon}|${mon.slice(0, 3)})\.?,?\s+${y}(?!\d)`, "i"),
      new RegExp(String.raw`(?:${mon}|${mon.slice(0, 3)})\.?\s+${day}(?:st|nd|rd|th)?,?\s+${y}(?!\d)`, "i"),
    ];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const plain = String(value);
    const indian = value.toLocaleString("en-IN"), western = value.toLocaleString("en-US");
    return [new RegExp(String.raw`(?<![\d,.])(?:${[...new Set([plain, indian, western])].map(esc).join("|")})(?![\d,]|\.\d)`)];
  }
  if (typeof value === "string" && value.trim().length >= 3 && value.length <= 120) return [new RegExp(esc(value.trim()), "i")];
  return [];
}

/** The lines of a document's text holding the value as written, each with its page (by the reader's page markers). */
function linesHolding(text: string, forms: RegExp[]): Array<{ line: string; page: number | null }> {
  const out: Array<{ line: string; page: number | null }> = [];
  let page = 1;
  const marked = /^-- \d+ of \d+ --$/m.test(text);
  for (const raw of text.split(/\r?\n/)) {
    const m = /^-- (\d+) of \d+ --$/.exec(raw.trim());
    if (m) { page = Number(m[1]) + 1; continue; }
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length > 0 && line.length <= 400 && forms.some((f) => f.test(line))) out.push({ line, page: marked ? page : null });
  }
  return out;
}

const PAGELESS = new Set(["HTML", "TEXT", "IMAGE"]);
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function standingOf(doc: EvidenceDoc | undefined, purpose: Purpose): { standing: Standing; words: string } {
  if (!doc) return { standing: "UNCONFIRMED", words: "the document is no longer with this job" };
  if (doc.declaredKind === "RESEARCH") return { standing: "RESEARCH", words: "research (a portal, article or other non-official text): never evidence for a check" };
  if (doc.authenticity !== "CONFIRMED" && doc.authenticity !== "ATTESTED") {
    return { standing: "UNCONFIRMED", words: "said to be official, but not confirmed (fetched from a listed site) or attested (you downloaded it yourself)" };
  }
  if (!authorityCovers(doc.originRole, doc.originPurposes, purpose)) {
    return { standing: "NOT_TRUSTED_FOR_THIS", words: doc.originRole === "PARTNER"
      ? `${doc.originHost ?? "this site"} is a listed partner, not trusted for ${purpose.replace(/_/g, " ")} details`
      : `${doc.originHost ?? "this site"} is not listed as the recruiting body's own site` };
  }
  return { standing: "OFFICIAL", words: `official document (${doc.authenticity === "CONFIRMED" ? "confirmed: fetched from the body's listed site" : "attested by you"})` };
}

/**
 * The evidence view of one field. `texts` holds each document's kept text (by retrieval id), to say whether a stored
 * quote is still found in it; a document without its text is not prefilled.
 */
export function fieldEvidence(state: FieldState, purpose: Purpose, docs: EvidenceDoc[], texts: Map<string, string>): FieldEvidence {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const current = state.hasValue ? valueHash(comparable(state.fieldPath, state.value)) : null;
  const extracted = state.claims.filter((c) => c.kind === "EXTRACTED" && !c.superseded);
  const items: EvidenceItem[] = extracted.map((c) => {
    const doc = c.retrievalId ? byId.get(c.retrievalId) : undefined;
    const { standing, words } = standingOf(doc, purpose);
    const pageless = !!doc && PAGELESS.has(doc.contentKind);
    const text = c.retrievalId ? texts.get(c.retrievalId) : undefined;
    const quoteFound = c.quote ? (text === undefined ? null : squash(text).includes(squash(c.quote))) : null;
    const matchesCurrent = current !== null && valueHash(comparable(state.fieldPath, c.value)) === current;
    let notUsable: string | undefined;
    if (standing !== "OFFICIAL") notUsable = words;
    else if (!matchesCurrent) notUsable = "it states another value than the field holds now";
    else if (!c.quote) notUsable = "no words were kept with it: copy them from the document";
    else if (quoteFound !== true) notUsable = "its words are not found exactly in the document: copy them from it";
    else if (!pageless && doc?.contentKind === "PDF" && !c.page) notUsable = "no page was kept with it: give the page";
    return {
      claimId: c.id, value: c.value, matchesCurrent, retrievalId: c.retrievalId ?? null,
      document: doc?.name ?? "a document no longer with this job", contentKind: doc?.contentKind ?? null,
      page: pageless ? null : c.page ?? null, quote: c.quote ?? null,
      location: pageless ? "web text (no pages)" : c.page ? `page ${c.page}` : "page not kept",
      standing, standingWords: words, quoteFound, usable: !notUsable, ...(notUsable ? { notUsable } : {}),
    };
  });
  // Values that disagree: every distinct value the sources give, when there is more than one.
  const groups = new Map<string, { value: unknown; documents: string[] }>();
  for (const i of items) {
    const h = valueHash(comparable(state.fieldPath, i.value));
    const g = groups.get(h) ?? { value: i.value, documents: [] };
    g.documents.push(i.document);
    groups.set(h, g);
  }
  const conflicts = groups.size > 1 ? [...groups.values()] : [];
  const best = items.find((i) => i.usable);
  // Found, not stored: only when nothing stored can be used, only in documents that could support the check.
  const suggestions: FieldEvidence["suggestions"] = [];
  const forms = !best && state.hasValue ? writtenForms(state.value) : [];
  if (forms.length > 0) {
    for (const doc of docs) {
      if (standingOf(doc, purpose).standing !== "OFFICIAL") continue;
      const text = texts.get(doc.id);
      if (!text) continue;
      const pageless = PAGELESS.has(doc.contentKind);
      for (const l of linesHolding(text, forms)) {
        if (suggestions.length >= 3) break;
        const page = pageless ? null : l.page;
        suggestions.push({ retrievalId: doc.id, document: doc.name, page, quote: l.line, location: pageless ? "web text (no pages)" : page ? `page ${page}` : "page not known" });
      }
    }
  }
  return {
    items, conflicts,
    prefill: best && best.retrievalId && best.quote ? { retrievalId: best.retrievalId, page: best.page, quote: best.quote, claimId: best.claimId } : null,
    suggestions,
  };
}
