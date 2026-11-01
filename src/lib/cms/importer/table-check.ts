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
// Pure: no database.

import type { VacancyTable } from "@/lib/vacancy-table";

export const TABLE_PATH = "vacancies.table";

/** The pages the table's rows and printed totals say they come from. */
export function tablePages(table: VacancyTable): number[] {
  const pages = [...table.rows.map((r) => r.source?.page), ...table.statedTotals.map((s) => s.source?.page)]
    .filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p > 0);
  return [...new Set(pages)].sort((a, b) => a - b);
}

export interface TableCheckInput {
  kind: "ADMIN_VERIFIED" | "ADMIN_NOT_APPLICABLE" | "ADMIN_NOT_STATED";
  table: VacancyTable | null | undefined;
  quote: string | null;
  page: number | null;
  reviewScope: { whole_document?: boolean; pages?: unknown; sections?: string[] } | null;
}

/**
 * Why this decision on the table must be refused, or the review scope to
 * store with it: the pages compared, sorted, and that it covers the whole table.
 */
export function tableCheckScope(input: TableCheckInput): { error: string } | { scope: { pages: number[]; sections: string[] } } {
  if (input.kind !== "ADMIN_VERIFIED") {
    return { error: "A vacancy table is checked against the notice as a whole. \"Not applicable\" and \"not stated\" are not recorded on the table." };
  }
  if (!input.table || !Array.isArray(input.table.rows) || input.table.rows.length === 0) return { error: "There is no vacancy table to check" };
  const raw = input.reviewScope?.pages;
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Name the pages of the notice you compared the table with" };
  if (!raw.every((p) => Number.isInteger(p) && (p as number) > 0)) return { error: "Each page compared must be a page number" };
  const pages = [...new Set(raw as number[])].sort((a, b) => a - b);
  const missing = tablePages(input.table).filter((p) => !pages.includes(p));
  if (missing.length) {
    return { error: `The table comes from page${missing.length === 1 ? "" : "s"} ${missing.join(", ")} too: compare ${missing.length === 1 ? "it" : "them"} as well, or the check does not cover the whole table` };
  }
  if (!input.quote) return { error: "Copy the table's heading, or a line of it, exactly as printed" };
  if (input.page !== null && !pages.includes(input.page)) return { error: "The words cited must be on one of the pages compared" };
  return { scope: { pages, sections: ["the whole vacancy table"] } };
}

// ─── The total worked out from a table (Stage C, C2) ──────

const squash = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/** Whether `n` is printed in the text as a figure of its own ("1,230" is 1230; "130" is not 30). */
export function figureIn(text: string, n: number): boolean {
  return (text.match(/\d[\d,]*/g) ?? []).some((t) => Number(t.replace(/,/g, "")) === n);
}

const sameName = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The notice's own line for the table's grand total, when it can be established: exactly one printed total
 * covering every row (the grand total, or the one post's total when the table has a single post), equal to
 * the stored total, with its page, its line holding that figure. Otherwise why not.
 */
export function printedTotalEvidence(table: VacancyTable, value: number): { line: string; page: number } | { missing: string } {
  const grand = table.statedTotals.filter((s) => Object.entries(s.at ?? {}).every(([k, v]) => table.rows.every((r) => sameName(r.at[k] ?? "", v))));
  if (grand.length === 0) return { missing: "the notice's printed grand total is not in the table" };
  if (grand.length > 1) return { missing: "the table holds more than one printed total for the whole table" };
  const g = grand[0];
  if (g.total !== value) return { missing: `the printed grand total (${g.total}) is not the stored total (${value})` };
  const line = (g.source?.line ?? "").trim();
  if (g.source?.page == null) return { missing: "the printed grand total has no page" };
  if (!line || !figureIn(line, value)) return { missing: "the printed grand total's line does not hold its figure" };
  return { line, page: g.source.page };
}

/**
 * Whether a quote and page are the printed total's own evidence: the whole printed line (a part of it, such
 * as the bare figure, is not enough), holding the figure, on its page.
 */
export function quoteIsPrintedTotal(ev: { line: string; page: number }, value: number, quote: string | null, page: number | null): boolean {
  if (!quote || page !== ev.page || !figureIn(quote, value)) return false;
  return squash(quote).includes(squash(ev.line));
}

export interface TotalRoute {
  /** The figure is a minimum: rows not reported, or no figure. */
  incomplete: boolean;
  /** How the total can be checked: by the whole-table check only, or by citing its printed line. */
  route: "TABLE_CHECK" | "PRINTED_LINE";
  /** For PRINTED_LINE: the line, page and figure to cite. */
  evidence: { line: string; page: number } | null;
  /** Why the whole-table check is required (owner's decision C-D2, and C2's safeguard). */
  why: string[];
}

/** How the total worked out from this table can be checked. */
export function totalRoute(table: VacancyTable, derived: { basis: string; complete: boolean }, value: number): TotalRoute {
  const why: string[] = [];
  const incomplete = derived.complete === false;
  if (incomplete) why.push("the total is incomplete");
  if (derived.basis !== "STATED") why.push(derived.basis === "CALCULATED" ? "the total is calculated from the rows" : "the total was entered by hand");
  const fromImage = table.rows.filter((r) => r.source?.readBy === "AI_IMAGE").length;
  const prepared = table.rows.filter((r) => r.source?.readBy === "PREPARED").length;
  if (fromImage) why.push(`${fromImage} row${fromImage === 1 ? " was" : "s were"} read by AI from a page image`);
  if (prepared) why.push(`${prepared} row${prepared === 1 ? " was" : "s were"} prepared outside the notice`);
  let evidence: { line: string; page: number } | null = null;
  if (why.length === 0) {
    const ev = printedTotalEvidence(table, value);
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

export function tableTotalView(table: VacancyTable, derived: { basis: string; complete: boolean }, value: number): TableTotalView {
  return { ...totalRoute(table, derived, value), pages: tablePages(table) };
}

/** calculatedTotalReady's reasons that only say the total is a minimum: the ones "not stated in full" may answer. */
export const isIncompletenessReason = (r: string) => r === "the total is incomplete" || /^\d+ × (not reported|no figure)$/.test(r);
