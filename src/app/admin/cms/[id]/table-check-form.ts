// ═══════════════════════════════════════════════════════════
// Admin: the whole-table check's form, as plain rules (Stage C, C3 step 3)
// ═══════════════════════════════════════════════════════════
//
// Pure. What the reviewer has given so far, what is still needed before the
// check can be recorded, and the one decision it becomes. The server decides
// everything again when it is sent (tableCheckScope, C2.1); this only keeps
// the screen from offering a check it would refuse, and builds the request so
// the reviewer never sees JSON. Nothing here verifies anything: every tick is
// the reviewer's own declaration.

export interface NeedsDoc { retrievalId: string; name: string; kind: string; eligible: boolean; pages: number[]; rowCount: number }
export interface NeedsRow { rowId: string; label: string; why: "research" | "prepared"; claimedPage: number | null; fromRetrievalId: string | null }
export interface TableNeeds {
  documents: NeedsDoc[];
  rowsToMap: NeedsRow[];
  pageOnlyPages: number[];
  simple: boolean;
  official: Array<{ retrievalId: string; name: string; kind: string }>;
}
export type SourceDeclaration = { by: "FILE_HASH"; sha256: string } | { by: "OFFICIAL_ADDRESS"; url: string };

export interface TableCheckForm {
  /** Step 1, per official document compared: how the reviewer had the original (screen safeguard). */
  sources: Record<string, SourceDeclaration | null>;
  /** Step 4: pages ticked per PDF, extra pages typed, a page-less document read as a whole. */
  pagesTicked: Record<string, number[]>;
  extraPages: Record<string, string>;
  wholeDoc: Record<string, boolean>;
  /** The official PDF that rows typed from the notice (a page, no document) are on. */
  pageOnlyDoc: string | null;
  /** Each research or prepared row: the official document (and page) it was compared with. */
  maps: Record<string, { retrievalId: string; page: number | null } | undefined>;
  quoteDoc: string;
  quotePage: string;
  quote: string;
  flaggedAck: boolean;
  confirm: boolean;
}

export const emptyForm = (): TableCheckForm => ({ sources: {}, pagesTicked: {}, extraPages: {}, wholeDoc: {}, pageOnlyDoc: null, maps: {}, quoteDoc: "", quotePage: "", quote: "", flaggedAck: false, confirm: false });

const PAGELESS = new Set(["HTML", "TEXT", "IMAGE"]);
export const isPageless = (kind: string | undefined) => !!kind && PAGELESS.has(kind);
const numbers = (s: string) => s.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);

/** The official documents this check compares: those the rows rely on, and any the reviewer chose for rows or the quote. */
export function comparedOfficial(needs: TableNeeds, f: TableCheckForm): Array<{ retrievalId: string; name: string; kind: string }> {
  const ids = new Set<string>(needs.documents.filter((d) => d.eligible).map((d) => d.retrievalId));
  if (f.pageOnlyDoc) ids.add(f.pageOnlyDoc);
  for (const m of Object.values(f.maps)) if (m) ids.add(m.retrievalId);
  if (f.quoteDoc) ids.add(f.quoteDoc);
  return needs.official.filter((o) => ids.has(o.retrievalId));
}

/** The pages that must be ticked for a PDF: those its own rows cite, rows mapped to it, and rows typed from it. */
export function requiredPages(needs: TableNeeds, f: TableCheckForm, id: string): number[] {
  const own = needs.documents.find((d) => d.retrievalId === id)?.pages ?? [];
  const mapped = Object.values(f.maps).flatMap((m) => (m && m.retrievalId === id && m.page != null ? [m.page] : []));
  const typed = f.pageOnlyDoc === id ? needs.pageOnlyPages : [];
  return [...new Set([...own, ...mapped, ...typed])].sort((a, b) => a - b);
}

export const pagesOf = (f: TableCheckForm, id: string) => [...new Set([...(f.pagesTicked[id] ?? []), ...numbers(f.extraPages[id] ?? "")])].sort((a, b) => a - b);

/** What is still needed before the check can be recorded, in plain words; empty when it can be recorded. */
export function stillNeeded(needs: TableNeeds, f: TableCheckForm, flaggedCount: number): string[] {
  const out: string[] = [];
  const official = comparedOfficial(needs, f);
  if (official.length === 0) out.push("an official document to compare the table with");
  for (const o of official) {
    if (!f.sources[o.retrievalId]) out.push(`how you have the original of ${o.name} (step 1)`);
    if (isPageless(o.kind)) { if (!f.wholeDoc[o.retrievalId]) out.push(`that you read the whole of ${o.name}`); continue; }
    const have = pagesOf(f, o.retrievalId);
    const missing = requiredPages(needs, f, o.retrievalId).filter((p) => !have.includes(p));
    if (have.length === 0) out.push(`the pages of ${o.name} you compared`);
    else if (missing.length) out.push(`page${missing.length === 1 ? "" : "s"} ${missing.join(", ")} of ${o.name}`);
  }
  if (needs.pageOnlyPages.length && !f.pageOnlyDoc) out.push(`which official PDF the rows typed from the notice (page${needs.pageOnlyPages.length === 1 ? "" : "s"} ${needs.pageOnlyPages.join(", ")}) are on`);
  const unmapped = needs.rowsToMap.filter((r) => {
    const m = f.maps[r.rowId];
    if (!m) return true;
    const kind = needs.official.find((o) => o.retrievalId === m.retrievalId)?.kind;
    return isPageless(kind) ? m.page != null : !(Number.isInteger(m.page) && (m.page as number) > 0);
  });
  if (unmapped.length) out.push(`${unmapped.length} row${unmapped.length === 1 ? "" : "s"} still to compare with an official document`);
  const wrongClaim = needs.rowsToMap.filter((r) => r.why === "prepared" && r.claimedPage != null && f.maps[r.rowId] && !isPageless(needs.official.find((o) => o.retrievalId === f.maps[r.rowId]!.retrievalId)?.kind) && f.maps[r.rowId]!.page !== r.claimedPage);
  if (wrongClaim.length) out.push(`prepared rows compared with another page than they claim: ${wrongClaim.map((r) => r.label).join("; ")}`);
  if (!f.quoteDoc) out.push("the document the words you cite are from");
  else {
    const kind = needs.official.find((o) => o.retrievalId === f.quoteDoc)?.kind;
    if (!isPageless(kind) && f.quotePage && !pagesOf(f, f.quoteDoc).includes(Number(f.quotePage))) out.push("the page of the words you cite must be one you compared");
  }
  if (!f.quote.trim()) out.push("a line of the table, copied exactly from the notice");
  if (flaggedCount > 0 && !f.flaggedAck) out.push(`that you looked at the ${flaggedCount} marked row${flaggedCount === 1 ? "" : "s"} (step 3)`);
  if (!f.confirm) out.push("your confirmation that the whole table matches the notice");
  return out;
}

/** The one decision the check becomes: the documents, the rows compared, and the reviewer's declarations. */
export function buildDecision(needs: TableNeeds, f: TableCheckForm, flaggedCount: number): { retrievalId: string; page: number | null; quote: string; reviewScope: Record<string, unknown> } {
  const official = comparedOfficial(needs, f);
  const documents: Array<Record<string, unknown>> = official.map((o) => ({
    retrievalId: o.retrievalId,
    ...(isPageless(o.kind) ? { whole_document: true } : { pages: pagesOf(f, o.retrievalId) }),
    ...(f.sources[o.retrievalId] ? { source: f.sources[o.retrievalId] } : {}),
  }));
  for (const d of needs.documents) if (!d.eligible) documents.push({ retrievalId: d.retrievalId, rowSourceOnly: true });
  const byDoc = new Map<string, Array<{ rowId: string; page: number | null }>>();
  for (const r of needs.rowsToMap) {
    const m = f.maps[r.rowId];
    if (!m) continue;
    if (!byDoc.has(m.retrievalId)) byDoc.set(m.retrievalId, []);
    byDoc.get(m.retrievalId)!.push({ rowId: r.rowId, page: m.page });
  }
  const quoteKind = needs.official.find((o) => o.retrievalId === f.quoteDoc)?.kind;
  return {
    retrievalId: f.quoteDoc,
    page: isPageless(quoteKind) || !f.quotePage ? null : Number(f.quotePage),
    quote: f.quote.trim(),
    reviewScope: {
      documents,
      ...(byDoc.size ? { comparedWith: [...byDoc.entries()].map(([retrievalId, rows]) => ({ retrievalId, rows })) } : {}),
      ...(flaggedCount > 0 && f.flaggedAck ? { flaggedRowsAcknowledged: flaggedCount } : {}),
    },
  };
}

/** Bulk assignment saves choosing the same document and page again; it never ticks a confirmation. */
export function assignRows(needs: TableNeeds, f: TableCheckForm, rowIds: string[], retrievalId: string, page: number | null): TableCheckForm {
  const kind = needs.official.find((o) => o.retrievalId === retrievalId)?.kind;
  const maps = { ...f.maps };
  for (const id of rowIds) {
    const r = needs.rowsToMap.find((x) => x.rowId === id);
    if (!r) continue;
    // A prepared row keeps the notice page it claims; the server accepts no other.
    const p = isPageless(kind) ? null : r.why === "prepared" && r.claimedPage != null ? r.claimedPage : page;
    maps[id] = { retrievalId, page: p };
  }
  return { ...f, maps, confirm: false };
}
