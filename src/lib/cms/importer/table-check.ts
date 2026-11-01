// ═══════════════════════════════════════════════════════════
// Smart intake: checking a vacancy table against the notice (Stage C, C1)
// ═══════════════════════════════════════════════════════════
//
// One decision covers the whole table (owner's decision C-D1): "checked
// against the notice", naming the pages compared. It is an ordinary field
// decision on "vacancies.table", so it is bound to the table's exact
// revision, refused on a stale one, revoked like any other, and any save of
// the table leaves it behind. This file holds the rules that are the
// table's own; it does not decide whether a total may be published (C2).
//
// C2.1 (owner-approved): pages follow each row's own document (a PDF row
// needs its page; a web page or text has none), and a table drawn from more
// than one document, or holding research or prepared rows, names every
// document and maps each research or prepared row to the eligible official
// document it was compared with. The server judges each document's standing;
// being listed gives none. A mapping records the reviewer's declared
// comparison, not proof that the figures match.
// Pure: no database.

import { PAGELESS_KINDS, type VacancyTable } from "@/lib/vacancy-table";

export const TABLE_PATH = "vacancies.table";

/** The pages the table's rows and printed totals say they come from. */
export function tablePages(table: VacancyTable): number[] {
  const pages = [...table.rows.map((r) => r.source?.page), ...table.statedTotals.map((s) => s.source?.page)]
    .filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p > 0);
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** One of the job's documents, as the server judges it: its kind, and whether it can be official evidence (9.1). */
export interface DocStanding { kind: string; eligible: boolean }
export type DocStandings = Record<string, DocStanding>;

interface DocEntry { retrievalId: string; pages?: number[]; whole_document?: boolean; rowSourceOnly?: boolean }
interface CompareEntry { retrievalId: string; rows: Array<{ rowId: string; page: number | null }> }

export interface TableCheckInput {
  kind: "ADMIN_VERIFIED" | "ADMIN_NOT_APPLICABLE" | "ADMIN_NOT_STATED";
  table: VacancyTable | null | undefined;
  quote: string | null;
  page: number | null;
  reviewScope: { whole_document?: boolean; pages?: unknown; sections?: string[]; documents?: unknown; comparedWith?: unknown } | null;
  /** The job's documents and their standing (C2.1). Absent: no row is judged by its document. */
  docs?: DocStandings;
  /** The document the decision cites (its words), when known. */
  retrievalId?: string | null;
}

export type TableCheckScope =
  | { pages: number[]; sections: string[] }
  | { documents: DocEntry[]; comparedWith?: CompareEntry[]; pages?: number[]; whole_document?: true; sections: string[] };

const pageless = (kind: string | undefined) => !!kind && PAGELESS_KINDS.has(kind);
const isPage = (p: unknown): p is number => Number.isInteger(p) && (p as number) > 0;

/** Where each row's evidence must come from (C2.1, 9.2). */
type RowNeed =
  | { rowId: string; need: "OWN"; retrievalId: string; page: number | null }
  | { rowId: string; need: "MAP"; claimedPage: number | null }
  | { rowId: string; need: "PAGE_ONLY"; page: number }
  | { rowId: string; need: "NONE" };

function rowNeeds(table: VacancyTable, docs: DocStandings): RowNeed[] | { error: string } {
  const out: RowNeed[] = [];
  for (const r of table.rows) {
    const rid = r.source?.retrievalId ?? null;
    if (r.source?.readBy === "PREPARED") { out.push({ rowId: r.id, need: "MAP", claimedPage: r.source.page ?? null }); continue; }
    if (rid) {
      if (!docs[rid]) return { error: `Row ${r.id} cites a document that was not brought in for this job` };
      out.push(docs[rid].eligible ? { rowId: r.id, need: "OWN", retrievalId: rid, page: r.source.page ?? null } : { rowId: r.id, need: "MAP", claimedPage: null });
      continue;
    }
    out.push(r.source?.page != null ? { rowId: r.id, need: "PAGE_ONLY", page: r.source.page } : { rowId: r.id, need: "NONE" });
  }
  return out;
}

/**
 * Why this decision on the table must be refused, or the review scope to
 * store with it: the pages compared (one document), or every document with
 * its pages or the whole document, and the official document each research or
 * prepared row was compared with (C2.1).
 */
export function tableCheckScope(input: TableCheckInput): { error: string } | { scope: TableCheckScope } {
  if (input.kind !== "ADMIN_VERIFIED") {
    return { error: "A vacancy table is checked against the notice as a whole. \"Not applicable\" and \"not stated\" are not recorded on the table." };
  }
  if (!input.table || !Array.isArray(input.table.rows) || input.table.rows.length === 0) return { error: "There is no vacancy table to check" };
  const table = input.table;
  const docs = input.docs ?? {};
  const needs = rowNeeds(table, docs);
  if ("error" in needs) return needs;
  const ownDocs = [...new Set(needs.flatMap((n) => (n.need === "OWN" ? [n.retrievalId] : [])))];
  const statedDocs = [...new Set(table.statedTotals.map((s) => s.source?.retrievalId).filter((x): x is string => !!x && !!docs[x]))];
  const researchDocs = [...new Set(table.rows.map((r) => r.source?.retrievalId).filter((x): x is string => !!x && !!docs[x] && !docs[x].eligible))];
  const needsMap = needs.some((n) => n.need === "MAP");
  const anyPageless = [...ownDocs, ...statedDocs].some((d) => pageless(docs[d]?.kind));

  // ── One PDF, nothing to map: the pages compared, as C1 (unchanged) ──
  if (input.reviewScope?.documents === undefined) {
    const single = [...new Set([...ownDocs, ...statedDocs])];
    if (needsMap || anyPageless || single.length > 1 || researchDocs.length > 0) {
      return { error: "This table comes from more than one document, from a web page or text, or holds research or prepared rows: name every document compared, and the official document each research or prepared row was compared with" };
    }
    const raw = input.reviewScope?.pages;
    if (!Array.isArray(raw) || raw.length === 0) return { error: "Name the pages of the notice you compared the table with" };
    if (!raw.every(isPage)) return { error: "Each page compared must be a page number" };
    const pages = [...new Set(raw as number[])].sort((a, b) => a - b);
    const missing = tablePages(table).filter((p) => !pages.includes(p));
    if (missing.length) {
      return { error: `The table comes from page${missing.length === 1 ? "" : "s"} ${missing.join(", ")} too: compare ${missing.length === 1 ? "it" : "them"} as well, or the check does not cover the whole table` };
    }
    if (!input.quote) return { error: "Copy the table's heading, or a line of it, exactly as printed" };
    if (input.page !== null && !pages.includes(input.page)) return { error: "The words cited must be on one of the pages compared" };
    return { scope: { pages, sections: ["the whole vacancy table"] } };
  }

  // ── Every document named (PF-3); each row's evidence (9.2, 12) ──
  if (!Array.isArray(input.reviewScope.documents) || input.reviewScope.documents.length === 0) return { error: "Name the documents compared" };
  const entries = new Map<string, DocEntry>();
  for (const raw of input.reviewScope.documents as unknown[]) {
    const e = raw as DocEntry;
    if (!e || typeof e.retrievalId !== "string") return { error: "Each document compared must be named by its id" };
    const d = docs[e.retrievalId];
    if (!d) return { error: `A document named was not brought in for this job: ${e.retrievalId}` };
    if (entries.has(e.retrievalId)) return { error: "A document is named twice" };
    if (!d.eligible) {
      // Research, unconfirmed or unlisted: it may be named as where rows came from, never as evidence.
      if (e.rowSourceOnly !== true || e.pages !== undefined || e.whole_document !== undefined) {
        return { error: `${e.retrievalId} is not official evidence (research, unconfirmed or unlisted): it can only be named as a source of rows` };
      }
      entries.set(e.retrievalId, { retrievalId: e.retrievalId, rowSourceOnly: true });
      continue;
    }
    if (e.rowSourceOnly) return { error: `${e.retrievalId} is official evidence: name what was compared in it, not as a source of rows only` };
    if (pageless(d.kind)) {
      if (e.whole_document !== true || (e.pages !== undefined && (!Array.isArray(e.pages) || e.pages.length > 0))) {
        return { error: `${e.retrievalId} is a web page or text, which has no pages: compare it as a whole document, with no page numbers` };
      }
      entries.set(e.retrievalId, { retrievalId: e.retrievalId, whole_document: true });
    } else {
      if (e.whole_document) return { error: `${e.retrievalId} is a PDF: name the pages compared` };
      if (!Array.isArray(e.pages) || e.pages.length === 0 || !e.pages.every(isPage)) return { error: `${e.retrievalId} is a PDF: name the pages compared, as page numbers` };
      entries.set(e.retrievalId, { retrievalId: e.retrievalId, pages: [...new Set(e.pages)].sort((a, b) => a - b) });
    }
  }
  // Every document the rows or printed totals come from is named.
  for (const id of [...ownDocs, ...statedDocs, ...researchDocs]) if (!entries.has(id)) return { error: `The table comes from a document not named: ${id}` };
  // Rows from an eligible document: its pages (a PDF) cover theirs; a PDF row needs its page; a page-less one has none.
  const coveredPdfPages = (id: string) => entries.get(id)?.pages ?? [];
  for (const n of needs) {
    if (n.need !== "OWN") continue;
    const kind = docs[n.retrievalId].kind;
    if (pageless(kind)) { if (n.page != null) return { error: `Row ${n.rowId} comes from a web page or text but has page ${n.page}: remove the page` }; continue; }
    if (n.page == null) return { error: `Row ${n.rowId} comes from a PDF but has no page: give its page` };
    if (!coveredPdfPages(n.retrievalId).includes(n.page)) return { error: `The table comes from page ${n.page} of ${n.retrievalId} too: compare it as well, or the check does not cover the whole table` };
  }
  for (const s of table.statedTotals) {
    const id = s.source?.retrievalId;
    if (!id || !docs[id] || !docs[id].eligible || pageless(docs[id].kind) || s.source.page == null) continue;
    if (!coveredPdfPages(id).includes(s.source.page)) return { error: `The printed total is on page ${s.source.page} of ${id}: compare it as well` };
  }
  // Rows with a page but no document (typed from the notice): that page must be among an official PDF's pages compared.
  const allPdfPages = [...entries.values()].flatMap((e) => e.pages ?? []);
  for (const n of needs) if (n.need === "PAGE_ONLY" && !allPdfPages.includes(n.page)) return { error: `Row ${n.rowId} has page ${n.page} but no document: that page of an official PDF must be among those compared` };

  // Research and prepared rows: each mapped once, to an eligible official document, with its page (12).
  const mapNeeds = new Map(needs.flatMap((n) => (n.need === "MAP" ? [[n.rowId, n] as const] : [])));
  const compared: CompareEntry[] = [];
  const seenRows = new Set<string>();
  const rawCompared = input.reviewScope.comparedWith;
  if (rawCompared !== undefined && !Array.isArray(rawCompared)) return { error: "The rows compared must be a list" };
  for (const raw of (rawCompared ?? []) as unknown[]) {
    const c = raw as CompareEntry;
    if (!c || typeof c.retrievalId !== "string" || !Array.isArray(c.rows)) return { error: "Each comparison names an official document and its rows" };
    const d = docs[c.retrievalId];
    if (!d || !entries.has(c.retrievalId)) return { error: `Rows were compared with a document not named: ${c.retrievalId}` };
    if (!d.eligible) return { error: `Rows can be compared only with official evidence; ${c.retrievalId} is research, unconfirmed or unlisted` };
    const rows: CompareEntry["rows"] = [];
    for (const rr of c.rows) {
      const n = rr && typeof rr.rowId === "string" ? mapNeeds.get(rr.rowId) : undefined;
      if (!rr || typeof rr.rowId !== "string" || !table.rows.some((r) => r.id === rr.rowId)) return { error: `A row compared is not in the table: ${rr?.rowId}` };
      if (!n || n.need !== "MAP") return { error: `Row ${rr.rowId} comes from an official document of its own: it is not listed among the rows compared` };
      if (seenRows.has(rr.rowId)) return { error: `Row ${rr.rowId} is listed twice` };
      seenRows.add(rr.rowId);
      if (pageless(d.kind)) {
        if (rr.page != null) return { error: `Row ${rr.rowId}: ${c.retrievalId} is a web page or text, so the row has no page in it` };
      } else {
        if (!isPage(rr.page)) return { error: `Row ${rr.rowId}: give the page of ${c.retrievalId} it was compared with` };
        if (!(entries.get(c.retrievalId)!.pages ?? []).includes(rr.page)) return { error: `Row ${rr.rowId}: page ${rr.page} of ${c.retrievalId} is not among the pages compared` };
        if (n.claimedPage != null && rr.page !== n.claimedPage) return { error: `Prepared row ${rr.rowId} claims page ${n.claimedPage} of the notice; it was compared with page ${rr.page}` };
      }
      rows.push({ rowId: rr.rowId, page: pageless(d.kind) ? null : rr.page });
    }
    if (rows.length) compared.push({ retrievalId: c.retrievalId, rows });
  }
  const unmapped = [...mapNeeds.keys()].filter((id) => !seenRows.has(id));
  if (unmapped.length) return { error: `Research or prepared rows not compared with an official document: ${unmapped.slice(0, 8).join(", ")}${unmapped.length > 8 ? ` and ${unmapped.length - 8} more` : ""}` };

  // At least one official document; the words cited come from one of them, on a page compared.
  const eligibleNamed = [...entries.values()].filter((e) => !e.rowSourceOnly);
  if (eligibleNamed.length === 0) return { error: "No official document is named: a table can be checked only against official evidence" };
  if (!input.quote) return { error: "Copy the table's heading, or a line of it, exactly as printed" };
  if (input.retrievalId) {
    const e = entries.get(input.retrievalId);
    if (!e || e.rowSourceOnly) return { error: "The words cited must come from one of the official documents compared" };
    if (pageless(docs[input.retrievalId].kind)) { if (input.page !== null) return { error: "The words cited come from a web page or text: give no page" }; }
    else if (input.page !== null && !(e.pages ?? []).includes(input.page)) return { error: "The words cited must be on one of the pages compared" };
  }
  const pages = [...new Set(eligibleNamed.flatMap((e) => e.pages ?? []))].sort((a, b) => a - b);
  return { scope: {
    documents: [...entries.values()],
    ...(compared.length ? { comparedWith: compared } : {}),
    ...(pages.length ? { pages } : {}),
    ...(eligibleNamed.some((e) => e.whole_document) ? { whole_document: true as const } : {}),
    sections: ["the whole vacancy table"],
  } };
}

// ─── The total worked out from a table (Stage C, C2) ──────

const squash = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/** Whether `n` is printed in the text as a figure of its own ("1,230" is 1230; "130" is not 30). */
export function figureIn(text: string, n: number): boolean {
  return (text.match(/\d[\d,]*/g) ?? []).some((t) => Number(t.replace(/,/g, "")) === n);
}

const sameName = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** A printed total's own evidence: its line and page; for a web page or text (no pages), its line and its document. */
export type PrintedEvidence = { line: string; page: number } | { line: string; page: null; retrievalId: string };

/**
 * The notice's own line for the table's grand total, when it can be established: exactly one printed total
 * covering every row (the grand total, or the one post's total when the table has a single post), equal to
 * the stored total, with its page, its line holding that figure. Otherwise why not. A printed total from a
 * web page or text (C2.1) has no page; its document stands in for it.
 */
export function printedTotalEvidence(table: VacancyTable, value: number, docs?: DocStandings): PrintedEvidence | { missing: string } {
  const grand = table.statedTotals.filter((s) => Object.entries(s.at ?? {}).every(([k, v]) => table.rows.every((r) => sameName(r.at[k] ?? "", v))));
  if (grand.length === 0) return { missing: "the notice's printed grand total is not in the table" };
  if (grand.length > 1) return { missing: "the table holds more than one printed total for the whole table" };
  const g = grand[0];
  if (g.total !== value) return { missing: `the printed grand total (${g.total}) is not the stored total (${value})` };
  const line = (g.source?.line ?? "").trim();
  const rid = g.source?.retrievalId ?? null;
  const pagelessSource = !!rid && pageless(docs?.[rid]?.kind);
  if (g.source?.page == null && !pagelessSource) return { missing: "the printed grand total has no page" };
  if (g.source?.page != null && pagelessSource) return { missing: "the printed grand total comes from a web page or text but has a page" };
  if (!line || !figureIn(line, value)) return { missing: "the printed grand total's line does not hold its figure" };
  return pagelessSource ? { line, page: null, retrievalId: rid! } : { line, page: g.source.page! };
}

/**
 * Whether a quote and page are the printed total's own evidence: the whole printed line (a part of it, such
 * as the bare figure, is not enough), holding the figure, on its page. For a web page or text: no page, and
 * the words cited from that same document.
 */
export function quoteIsPrintedTotal(ev: PrintedEvidence, value: number, quote: string | null, page: number | null, retrievalId?: string | null): boolean {
  if (!quote || page !== ev.page || !figureIn(quote, value)) return false;
  if (ev.page === null && retrievalId !== ev.retrievalId) return false;
  return squash(quote).includes(squash(ev.line));
}

export interface TotalRoute {
  /** The figure is a minimum: rows not reported, or no figure. */
  incomplete: boolean;
  /** How the total can be checked: by the whole-table check only, or by citing its printed line. */
  route: "TABLE_CHECK" | "PRINTED_LINE";
  /** For PRINTED_LINE: the line, page (or, for a web page or text, its document) and figure to cite. */
  evidence: PrintedEvidence | null;
  /** Why the whole-table check is required (owner's decision C-D2, and C2's safeguard). */
  why: string[];
}

/** How the total worked out from this table can be checked. */
export function totalRoute(table: VacancyTable, derived: { basis: string; complete: boolean }, value: number, docs?: DocStandings): TotalRoute {
  const why: string[] = [];
  const incomplete = derived.complete === false;
  if (incomplete) why.push("the total is incomplete");
  if (derived.basis !== "STATED") why.push(derived.basis === "CALCULATED" ? "the total is calculated from the rows" : "the total was entered by hand");
  const fromImage = table.rows.filter((r) => r.source?.readBy === "AI_IMAGE").length;
  const prepared = table.rows.filter((r) => r.source?.readBy === "PREPARED").length;
  if (fromImage) why.push(`${fromImage} row${fromImage === 1 ? " was" : "s were"} read by AI from a page image`);
  if (prepared) why.push(`${prepared} row${prepared === 1 ? " was" : "s were"} prepared outside the notice`);
  // Rows from research or unconfirmed documents need the whole-table check, with their comparison named (C2.1).
  const research = docs ? table.rows.filter((r) => r.source?.readBy !== "PREPARED" && !!r.source?.retrievalId && docs[r.source.retrievalId] && !docs[r.source.retrievalId].eligible).length : 0;
  if (research) why.push(`${research} row${research === 1 ? " comes" : "s come"} from research or an unconfirmed source`);
  let evidence: PrintedEvidence | null = null;
  if (why.length === 0) {
    const ev = printedTotalEvidence(table, value, docs);
    if ("missing" in ev) why.push(ev.missing);
    else evidence = ev;
  }
  return { incomplete, route: why.length ? "TABLE_CHECK" : "PRINTED_LINE", evidence, why };
}

/**
 * What the check list shows about a total worked out from the table (Stage C, C3 step 1): the route the
 * server allows, the printed line to cite when there is one, why the whole-table check is needed, and the
 * pages the table comes from. Read only: it is worked out by totalRoute and tablePages, and decides nothing.
 */
export interface TableTotalView extends TotalRoute {
  pages: number[];
}

export function tableTotalView(table: VacancyTable, derived: { basis: string; complete: boolean }, value: number, docs?: DocStandings): TableTotalView {
  return { ...totalRoute(table, derived, value, docs), pages: tablePages(table) };
}

/** calculatedTotalReady's reasons that only say the total is a minimum: the ones "not stated in full" may answer. */
export const isIncompletenessReason = (r: string) => r === "the total is incomplete" || /^\d+ × (not reported|no figure)$/.test(r);
