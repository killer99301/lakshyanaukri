// ═══════════════════════════════════════════════════════════
// Vacancy tables: the notice's own figures, and totals worked out by code
// ═══════════════════════════════════════════════════════════
//
// A recruitment's vacancies as the notice prints them: rows along named
// dimensions (post, bank, state, city, zone, district, department…) with the
// notice's category columns. Nothing in a row is summed or guessed; "NR" stays
// not reported, "0" stays nil, a blank stays blank.
//
// Everything else is calculated here, deterministically, from the stored rows:
// totals per post (the first dimension) and overall, category sums, and the
// checks that say whether a total is complete and can be trusted. Every
// calculated figure says it was calculated, how, from how many rows, and
// carries a fingerprint of its inputs, so it can be recalculated and compared.
//
// Horizontal columns (women, PwBD, ex-servicemen…) are left out of totals
// ONLY when the source establishes that they are counted inside the others:
// the notice says so ("out of which"), its printed row totals show it, or
// the admin decided it. A column is never treated as overlapping because of
// its name. Until it is established, totals that depend on it are incomplete.
//
// Pure: no database, no network, safe in the browser. Approved design:
// docs/smart-recruitment-vision.md, sections 4 and 10.

import type { VacancyRow } from "@/types";

// ─── The stored table ─────────────────────────────────────

export interface VacancyDimension { key: string; label: string }

export type CategoryKind = "VERTICAL" | "HORIZONTAL" | "UNDETERMINED";

export interface VacancyCategory {
  key: string;
  label: string;
  kind: CategoryKind;
  /** For a part of a group printed under one heading: "pwbd" for HI / OC / VI / ID. */
  partOf?: string;
  /** How the kind was established, when it is not a standard vertical reservation. */
  established?: { by: "SOURCE" | "ADMIN"; note: string };
}

export interface SourceRef {
  retrievalId: string | null;
  page: number | null;
  /** The row or line as printed, so the figures can be found again. */
  line: string;
  /**
   * "AI_IMAGE": the line was written out by the AI from a scanned page's
   * image (there was no text to read). Its figures are the AI's reading of
   * a picture: they stay to be checked against the page, whatever the
   * arithmetic says.
   *
   * "PREPARED": the rows were prepared outside the notice (by an AI, a
   * person, or copied from another website) and pasted in. They are research,
   * not the notice: they stay to be checked against it, page by page.
   */
  readBy?: "AI_IMAGE" | "PREPARED";
}

export type RowStatus = "STATED" | "NIL" | "NOT_REPORTED" | "NO_FIGURE";

export interface VacancyTableRow {
  id: string;
  /** Where the row sits: { post, bank, state, … }; every dimension has a value. */
  at: Record<string, string>;
  status: RowStatus;
  /** The row's total, when printed. */
  total?: number;
  /** Category key → figure, when printed. */
  cells: Record<string, number>;
  /** Columns ("total" or a category key) printed with a figure the reader could not make out on a scanned page; never filled in. */
  unclear?: string[];
  /** Dimension key → a spelling the AI suggests for the printed name. Shown, never applied by itself. */
  suggested?: Record<string, string>;
  /** Dimension key → the name as printed, kept once an admin applies a suggested spelling. */
  printedAt?: Record<string, string>;
  source: SourceRef;
}

export interface StatedTotal {
  /** {} for the grand total; { post } for a post's total. */
  at: Record<string, string>;
  total: number;
  cells?: Record<string, number>;
  source: SourceRef;
}

export interface VacancyTable {
  /** Outermost first; the first is what the summary groups by (almost always the post). */
  dimensions: VacancyDimension[];
  categories: VacancyCategory[];
  rows: VacancyTableRow[];
  statedTotals: StatedTotal[];
}

// ─── Calculated results ───────────────────────────────────

export interface Figure {
  value: number;
  /** STATED: printed in a document; ENTERED: typed with no page or document behind it; CALCULATED: worked out here. */
  basis: "STATED" | "ENTERED" | "CALCULATED";
  /** False when a row it depends on is not reported, has no figure, or a column's place is undecided. */
  complete: boolean;
  /** How it was obtained, in words. */
  method: string;
  /** Row ids it was calculated from (empty for a stated figure). */
  inputs: string[];
  /** Fingerprint of the rows and columns it was calculated from. */
  fingerprint: string;
}

export type IssueCode =
  | "DUPLICATE_ROW" | "MISSING_DIMENSION" | "BAD_FIGURE" | "ROW_TOTAL_MISMATCH" | "HORIZONTAL_EXCEEDS_TOTAL"
  | "NOT_REPORTED" | "NO_FIGURE" | "UNDETERMINED_COLUMN" | "STATED_TOTAL_MISMATCH" | "NO_SOURCE" | "FIGURES_NOT_IN_LINE" | "UNCLEAR_FIGURE" | "SUGGESTED_SPELLING"
  | "PARTS_TOTAL_MISMATCH"
  /** C2.1 (PF-1): a row from a PDF has no page; or a row from a web page or text has a page it cannot have. */
  | "PDF_ROW_WITHOUT_PAGE" | "PAGE_ON_PAGELESS_SOURCE";

/** A source document's kind, by its id, for the per-row page rule (C2.1, PF-1). */
export type SourceKinds = Record<string, string>;
/** Documents that have no pages: a web page, pasted text, a single image. */
export const PAGELESS_KINDS = new Set(["HTML", "TEXT", "IMAGE"]);

export interface TableIssue {
  code: IssueCode;
  /** ERROR: a contradiction or a gap that a total depends on; WARNING: worth a look. */
  severity: "ERROR" | "WARNING";
  message: string;
  rowIds?: string[];
  group?: string;
}

export interface GroupSummary {
  /** The first dimension's value, e.g. the post name. */
  name: string;
  rowIds: string[];
  reported: number;
  notReported: number;
  noFigure: number;
  total: Figure | null;
  /** The total the rows add up to, when a stated total is used instead (for comparison). */
  calculatedTotal: number | null;
  /** Category key → sum over rows; absent when not every counted row gives that column. */
  categories: Record<string, Figure>;
}

export interface VacancyAnalysis {
  /** Column kinds after applying what the printed totals show. */
  categories: VacancyCategory[];
  groups: GroupSummary[];
  grandTotal: Figure | null;
  issues: TableIssue[];
  fingerprint: string;
}

// ─── Helpers ──────────────────────────────────────────────

/** The usual vertical reservations, vertical by definition; nothing else is assumed. */
const STANDARD_VERTICAL = new Set(["ur", "general", "gen", "ews", "obc", "sc", "st"]);

/** The kind of a category column before any evidence: vertical only for the standard reservations. */
export function initialCategoryKind(key: string): CategoryKind {
  return STANDARD_VERTICAL.has(key.toLowerCase()) ? "VERTICAL" : "UNDETERMINED";
}

/** The largest figure accepted for one row or column, as for the post-wise breakdown. */
export const MAX_FIGURE = 1_000_000;
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_FIGURE;

/**
 * A row is backed by a document when it names the page it came from or the
 * stored source it was read from. A typed or pasted line alone is not evidence.
 */
export const hasEvidence = (r: Pick<VacancyTableRow, "source">): boolean =>
  !!r.source && (r.source.page != null || !!r.source.retrievalId);

/** Stable JSON: object keys sorted, so the same table always gives the same text. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Two FNV-1a 32-bit passes, as 16 hex digits: a fingerprint, not a security hash. Same in the browser and on the server. */
export function fingerprintOf(v: unknown): string {
  const text = canonical(v);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

const atKey = (at: Record<string, string>, dims: VacancyDimension[]) =>
  dims.map((d) => (at[d.key] ?? "").replace(/\s+/g, " ").trim().toLowerCase()).join(" | ");

const sumOf = (cells: Record<string, number>, keys: string[]) => keys.reduce((s, k) => s + (cells[k] ?? 0), 0);

/**
 * Which undetermined columns the printed row totals show to be part of the
 * total: the one subset that makes every row with a total add up. Null when
 * no row has a total and that column, or when no subset (or more than one)
 * fits every row.
 */
function inferFromPrintedTotals(rows: VacancyTableRow[], vertical: string[], undetermined: string[]): Set<string> | null {
  if (undetermined.length === 0 || undetermined.length > 8) return null;
  const evidence = rows.filter((r) => r.status === "STATED" && isCount(r.total) && undetermined.some((k) => isCount(r.cells[k]) && r.cells[k] > 0));
  if (evidence.length === 0) return null;
  const fits: Array<Set<string>> = [];
  for (let mask = 0; mask < 1 << undetermined.length; mask++) {
    const inTotal = undetermined.filter((_, i) => mask & (1 << i));
    if (evidence.every((r) => sumOf(r.cells, [...vertical, ...inTotal]) === r.total)) fits.push(new Set(inTotal));
  }
  return fits.length === 1 ? fits[0] : null;
}

/** A figure taken as given: printed in a document when a page or source backs it, otherwise entered by hand. */
function printedOrEntered(source: SourceRef): Pick<Figure, "basis" | "method"> {
  return source && (source.page != null || !!source.retrievalId)
    ? { basis: "STATED", method: `${source.readBy === "PREPARED" ? "prepared outside from the notice, to be checked" : "printed in the notice"}${source.page != null ? ` (page ${source.page})` : ""}` }
    : { basis: "ENTERED", method: "entered by hand" };
}

// ─── Analysis ─────────────────────────────────────────────

export function analyseVacancyTable(table: VacancyTable, opts: { sourceKinds?: SourceKinds } = {}): VacancyAnalysis {
  const issues: TableIssue[] = [];
  // The page each row (and printed total) must or must not have, by the kind of its own document (C2.1, PF-1).
  // Only rows whose document is known are judged; a row with no document keeps the rules below (NO_SOURCE).
  const kinds = opts.sourceKinds ?? {};
  const pageRule = (src: SourceRef | undefined, where: string, rowIds?: string[]) => {
    const kind = src?.retrievalId ? kinds[src.retrievalId] : undefined;
    if (!kind) return;
    if (kind === "PDF" && src!.page == null) {
      issues.push({ code: "PDF_ROW_WITHOUT_PAGE", severity: "ERROR", message: `${where}: it comes from a PDF but has no page. Give its page.`, ...(rowIds ? { rowIds } : {}) });
    }
    if (PAGELESS_KINDS.has(kind) && src!.page != null) {
      issues.push({ code: "PAGE_ON_PAGELESS_SOURCE", severity: "ERROR", message: `${where}: it comes from a web page or text, which has no pages, yet it has page ${src!.page}. Remove the page.`, ...(rowIds ? { rowIds } : {}) });
    }
  };
  for (const r of table.rows) pageRule(r.source, Object.values(r.at).filter(Boolean).join(", ") || "A row", [r.id]);
  for (const s of table.statedTotals) pageRule(s.source, `The printed total${Object.keys(s.at ?? {}).length ? ` for ${Object.values(s.at).join(", ")}` : ""}`);
  const dims = table.dimensions;
  const groupDim = dims[0]?.key ?? "post";

  // Column kinds: as stored, then what the printed totals establish.
  let categories = table.categories.map((c) => ({ ...c }));
  const verticalKeys = () => categories.filter((c) => c.kind === "VERTICAL").map((c) => c.key);
  const undeterminedKeys = categories.filter((c) => c.kind === "UNDETERMINED").map((c) => c.key);
  const inTotal = inferFromPrintedTotals(table.rows, verticalKeys(), undeterminedKeys);
  if (inTotal) {
    categories = categories.map((c) => c.kind !== "UNDETERMINED" ? c : {
      ...c,
      kind: inTotal.has(c.key) ? "VERTICAL" : "HORIZONTAL",
      established: { by: "SOURCE", note: inTotal.has(c.key) ? "the printed totals include this column" : "the printed totals do not include this column (counted within the others)" },
    });
  }
  const vertical = verticalKeys();
  const horizontal = categories.filter((c) => c.kind === "HORIZONTAL");
  const undetermined = categories.filter((c) => c.kind === "UNDETERMINED");
  const undeterminedInUse = undetermined.filter((c) => table.rows.some((r) => isCount(r.cells[c.key]) && r.cells[c.key] > 0));
  for (const c of undeterminedInUse) {
    issues.push({ code: "UNDETERMINED_COLUMN", severity: "ERROR",
      message: `"${c.label}": the notice does not show whether these seats are part of the total or counted within the other categories. Decide it, or the totals stay incomplete.` });
  }

  // Row checks.
  const partGroups = new Set(categories.filter((c) => c.partOf && categories.some((x) => x.key === c.partOf)).map((c) => c.partOf!));
  const columnName = (key: string) => key === "total" ? "the total" : categories.find((c) => c.key === key)?.label ?? key;
  const seen = new Map<string, string>();
  for (const r of table.rows) {
    const missing = dims.filter((d) => !(r.at[d.key] ?? "").trim());
    if (missing.length > 0) issues.push({ code: "MISSING_DIMENSION", severity: "ERROR", message: `A row has no ${missing.map((d) => d.label).join(", ")}.`, rowIds: [r.id] });
    const k = atKey(r.at, dims);
    if (seen.has(k)) issues.push({ code: "DUPLICATE_ROW", severity: "ERROR", message: `The same row appears twice: ${dims.map((d) => r.at[d.key]).join(", ")}.`, rowIds: [seen.get(k)!, r.id] });
    else seen.set(k, r.id);
    if (!hasEvidence(r)) issues.push({ code: "NO_SOURCE", severity: "WARNING", message: `${dims.map((d) => r.at[d.key]).join(", ")}: entered by hand, with no page of a document behind it.`, rowIds: [r.id] });
    if (r.status === "NOT_REPORTED") { issues.push({ code: "NOT_REPORTED", severity: "WARNING", message: `${dims.map((d) => r.at[d.key]).join(", ")}: not reported in the notice.`, rowIds: [r.id], group: r.at[groupDim] }); continue; }
    // A spelling the AI suggests for a printed name: kept as printed until an admin applies it (B2.6).
    for (const [k, v] of Object.entries(r.suggested ?? {})) {
      issues.push({ code: "SUGGESTED_SPELLING", severity: "WARNING", rowIds: [r.id], group: r.at[groupDim],
        message: `“${r.at[k]}” is kept as printed${r.source.page != null ? ` (page ${r.source.page})` : ""}; the AI suggests “${v}”. Apply it in the editor if the notice means that.` });
    }
    if (r.unclear?.length) {
      issues.push({ code: "UNCLEAR_FIGURE", severity: "ERROR", rowIds: [r.id], group: r.at[groupDim],
        message: `${dims.map((d) => r.at[d.key]).join(", ")}: ${r.unclear.map(columnName).join(", ")} could not be read on the scanned page${r.source.page != null ? ` (page ${r.source.page})` : ""}. Read it on the page and enter it; it is never filled in.` });
    }
    if (r.status === "NO_FIGURE") { issues.push({ code: "NO_FIGURE", severity: "WARNING", message: `${dims.map((d) => r.at[d.key]).join(", ")}: printed with no figure.`, rowIds: [r.id], group: r.at[groupDim] }); continue; }
    const bad = [...(r.total !== undefined ? [["total", r.total] as const] : []), ...Object.entries(r.cells)].filter(([, n]) => !isCount(n));
    if (bad.length > 0) { issues.push({ code: "BAD_FIGURE", severity: "ERROR", message: `${dims.map((d) => r.at[d.key]).join(", ")}: ${bad.map(([k]) => columnName(k)).join(", ")} is not a whole number up to ${MAX_FIGURE.toLocaleString("en-IN")}.`, rowIds: [r.id] }); continue; }
    // A row backed by a page must have its figures in the line it was read
    // from; a figure typed over it afterwards no longer matches the notice.
    if (hasEvidence(r) && r.source.line.trim()) {
      // As numbers: notices print "01" for 1.
      const printed: string[] = (r.source.line.replace(/(\d),(\d)/g, "$1$2").match(/\d+/g) ?? []).map((d) => String(Number(d)));
      const figures = [...(isCount(r.total) ? [r.total] : []), ...Object.values(r.cells).filter(isCount)];
      const missing = figures.filter((n) => !printed.includes(String(n)));
      if (missing.length > 0) {
        issues.push({ code: "FIGURES_NOT_IN_LINE", severity: "WARNING", rowIds: [r.id], group: r.at[groupDim],
          message: `${dims.map((d) => r.at[d.key]).join(", ")}: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""} ${missing.length === 1 ? "is" : "are"} not in the line this row was read from${r.source.page != null ? ` (page ${r.source.page})` : ""}; check it against the notice.` });
      }
    }
    const hasVertical = vertical.some((key) => isCount(r.cells[key]));
    if (isCount(r.total) && hasVertical && undeterminedInUse.length === 0) {
      const s = sumOf(r.cells, vertical);
      if (s !== r.total) issues.push({ code: "ROW_TOTAL_MISMATCH", severity: "ERROR", message: `${dims.map((d) => r.at[d.key]).join(", ")}: the categories add up to ${s}, the printed total is ${r.total}.`, rowIds: [r.id] });
    }
    const rowTotal = isCount(r.total) ? r.total : hasVertical ? sumOf(r.cells, vertical) : undefined;
    if (rowTotal !== undefined) {
      // A horizontal group (all PwBD parts together) cannot exceed the row. A column whose key is a
      // group's name is that group's printed total (BPSC: women's total over the women's share of each
      // category): it is not added to its parts, and its parts must add up to it.
      const groups = new Map<string, number>();
      for (const c of horizontal) if (!partGroups.has(c.key) && isCount(r.cells[c.key])) groups.set(c.partOf ?? c.key, (groups.get(c.partOf ?? c.key) ?? 0) + r.cells[c.key]);
      for (const g of partGroups) {
        const parts = categories.filter((c) => c.partOf === g);
        if (!isCount(r.cells[g]) || parts.some((c) => !isCount(r.cells[c.key]))) continue;
        const s = sumOf(r.cells, parts.map((c) => c.key));
        if (s !== r.cells[g]) issues.push({ code: "PARTS_TOTAL_MISMATCH", severity: "ERROR", rowIds: [r.id], group: r.at[groupDim],
          message: `${dims.map((d) => r.at[d.key]).join(", ")}: ${parts.map((c) => c.label).join(" + ")} add up to ${s}; the printed ${columnName(g)} is ${r.cells[g]}.` });
      }
      for (const [g, n] of groups) {
        if (n > rowTotal) issues.push({ code: "HORIZONTAL_EXCEEDS_TOTAL", severity: "ERROR", message: `${dims.map((d) => r.at[d.key]).join(", ")}: ${g} seats (${n}) exceed the row total (${rowTotal}).`, rowIds: [r.id] });
      }
    }
  }

  // Duplicate rows are counted once in the sums, at their first appearance.
  const dupIds = new Set(issues.filter((i) => i.code === "DUPLICATE_ROW").map((i) => i.rowIds![1]));
  const badIds = new Set(issues.filter((i) => i.code === "BAD_FIGURE").map((i) => i.rowIds![0]));
  const usable = (r: VacancyTableRow) => !dupIds.has(r.id) && !badIds.has(r.id);
  const rowValue = (r: VacancyTableRow): number | null => {
    if (r.status === "NIL") return 0;
    if (r.status !== "STATED") return null;
    if (isCount(r.total)) return r.total;
    // Without a readable total, a row with an unreadable figure cannot be added up.
    if (r.unclear?.length) return null;
    if (undeterminedInUse.length > 0) return null;
    return vertical.some((k) => isCount(r.cells[k])) ? sumOf(r.cells, vertical) : null;
  };

  const groupNames: string[] = [];
  for (const r of table.rows) { const g = r.at[groupDim] ?? ""; if (!groupNames.includes(g)) groupNames.push(g); }
  const statedFor = (at: Record<string, string>) => table.statedTotals.find((s) => canonical(s.at) === canonical(at));
  const columnLabel = (key: string) => categories.find((c) => c.key === key)?.label ?? key;

  const groups: GroupSummary[] = groupNames.map((name) => {
    const rows = table.rows.filter((r) => (r.at[groupDim] ?? "") === name);
    const counted = rows.filter(usable);
    const values = counted.map(rowValue);
    const known = values.filter((v): v is number => v !== null);
    const sum = known.reduce((a, b) => a + b, 0);
    const complete = values.every((v) => v !== null) && rows.length === counted.length;
    const reported = rows.filter((r) => r.status === "STATED" || r.status === "NIL").length;
    const fp = fingerprintOf({ rows: counted, columns: categories });
    const where = rows.map((r) => r.source.page).filter((p): p is number => p != null);
    const pages = where.length ? ` (page${new Set(where).size > 1 ? "s" : ""} ${[...new Set(where)].sort((a, b) => a - b).join(", ")})` : "";
    const calculated: Figure | null = known.length === 0 ? null : {
      value: sum, basis: "CALCULATED", complete,
      method: dims.length > 1 || rows.length > 1
        ? `sum of ${known.length} row${known.length === 1 ? "" : "s"} by ${dims.slice(1).map((d) => d.label.toLowerCase()).join(" and ") || "row"}${pages}`
        : `the row's categories added${pages}`,
      inputs: counted.filter((_, i) => values[i] !== null).map((r) => r.id), fingerprint: fp,
    };
    const stated = statedFor({ [groupDim]: name });
    let total: Figure | null = calculated;
    if (stated && isCount(stated.total)) {
      total = { value: stated.total, ...printedOrEntered(stated.source), complete: true, inputs: [], fingerprint: fingerprintOf(stated) };
      if (calculated && calculated.complete && calculated.value !== stated.total) {
        issues.push({ code: "STATED_TOTAL_MISMATCH", severity: "ERROR", group: name,
          message: `${name}: ${hasEvidence(stated) ? "the notice prints" : "the total entered by hand is"} ${stated.total}, its rows add up to ${calculated.value}. Decide which is right.` });
      }
    } else if (rows.length === 1 && rows[0].status === "STATED" && isCount(rows[0].total)) {
      // A single printed row is itself the notice's figure.
      total = { value: rows[0].total, ...printedOrEntered(rows[0].source), complete: true, inputs: [rows[0].id], fingerprint: fp };
    }

    // Category sums: only when every counted, reported row gives that column.
    const cats: Record<string, Figure> = {};
    const reportedRows = counted.filter((r) => r.status === "STATED");
    for (const c of categories) {
      const givers = reportedRows.filter((r) => isCount(r.cells[c.key]));
      if (givers.length === 0) continue;
      const allGive = givers.length === reportedRows.length;
      cats[c.key] = {
        value: givers.reduce((s, r) => s + r.cells[c.key], 0), basis: reportedRows.length === 1 ? "STATED" : "CALCULATED",
        complete: allGive && complete && c.kind !== "UNDETERMINED",
        method: reportedRows.length === 1 ? `printed in the notice` : `sum of ${givers.length} row${givers.length === 1 ? "" : "s"} (${columnLabel(c.key)})`,
        inputs: givers.map((r) => r.id), fingerprint: fp,
      };
    }
    return {
      name, rowIds: rows.map((r) => r.id), reported,
      notReported: rows.filter((r) => r.status === "NOT_REPORTED").length,
      noFigure: rows.filter((r) => r.status === "NO_FIGURE").length,
      total, calculatedTotal: calculated?.value ?? null, categories: cats,
    };
  });

  // Grand total: the notice's, or the posts' totals added.
  let grandTotal: Figure | null = null;
  const statedGrand = statedFor({});
  const parts = groups.map((g) => g.total);
  if (parts.length > 0 && parts.every((p) => p !== null)) {
    const value = parts.reduce((s, p) => s + p!.value, 0);
    grandTotal = { value, basis: groups.length === 1 ? parts[0]!.basis : "CALCULATED",
      complete: parts.every((p) => p!.complete),
      method: groups.length === 1 ? parts[0]!.method : `sum of ${groups.length} post totals`,
      inputs: groups.flatMap((g) => g.total!.inputs), fingerprint: fingerprintOf(parts.map((p) => p!.fingerprint)) };
  }
  if (statedGrand && isCount(statedGrand.total)) {
    if (grandTotal && grandTotal.complete && grandTotal.value !== statedGrand.total) {
      issues.push({ code: "STATED_TOTAL_MISMATCH", severity: "ERROR",
        message: `${hasEvidence(statedGrand) ? "The notice prints a grand total of" : "The grand total entered by hand is"} ${statedGrand.total}; the figures add up to ${grandTotal.value}. Decide which is right.` });
    }
    grandTotal = { value: statedGrand.total, ...printedOrEntered(statedGrand.source), complete: true, inputs: [], fingerprint: fingerprintOf(statedGrand) };
  }

  // Printed totals against the rows they cover, column by column: the grand total, a post's, or a
  // subtotal of the rows sharing a value (BPSC: सारणी I's Total line). A column is compared only when
  // every row it covers gives that column; a difference is said, never corrected.
  for (const s of table.statedTotals) {
    const covered = table.rows.filter((r) => Object.entries(s.at).every(([k, v]) => (r.at[k] ?? "").replace(/\s+/g, " ").trim().toLowerCase() === v.replace(/\s+/g, " ").trim().toLowerCase()));
    const counted = covered.filter(usable);
    if (counted.length === 0 || counted.length !== covered.length || counted.some((r) => r.status !== "STATED" && r.status !== "NIL")) continue;
    const where = Object.values(s.at).join(", ") || "The table";
    const checks: Array<[string, number, number | null]> = [];
    const isFirstDimOnly = Object.keys(s.at).length === 1 && Object.keys(s.at)[0] === groupDim;
    if (Object.keys(s.at).length > 0 && !isFirstDimOnly && isCount(s.total)) {
      const totals = counted.map((r) => (r.status === "NIL" ? 0 : rowValue(r)));
      checks.push(["the total", s.total, totals.every((v) => v !== null) ? (totals as number[]).reduce((a, b) => a + b, 0) : null]);
    }
    for (const [k, n] of Object.entries(s.cells ?? {})) {
      if (!isCount(n)) continue;
      const vals = counted.map((r) => (r.status === "NIL" ? 0 : r.cells[k]));
      checks.push([columnName(k), n, vals.every(isCount) ? vals.reduce((a, b) => a + b, 0) : null]);
    }
    for (const [name, printed, sum] of checks) {
      if (sum === null || sum === printed) continue;
      issues.push({ code: "STATED_TOTAL_MISMATCH", severity: "ERROR", ...(isFirstDimOnly ? { group: s.at[groupDim] } : {}),
        message: `${where}: ${hasEvidence(s) ? "the notice prints" : "the figure entered by hand is"} ${printed} for ${name}${s.source.page != null ? ` (page ${s.source.page})` : ""}; its ${counted.length} rows add up to ${sum}. Decide which is right.` });
    }
  }

  return { categories, groups, grandTotal, issues, fingerprint: fingerprintOf({ table }) };
}

// ─── What the rest of the site reads ──────────────────────

/** Keys the existing breakdown and public table already know by name. */
const STANDARD_KEYS = new Set(["ur", "ews", "obc", "sc", "st", "women", "exsm"]);

export interface DerivedVacancies {
  /** For vacancies.total: the grand total, with how it was obtained. */
  total: Figure | null;
  /** For vacancies.breakdown: one row per post (first dimension). */
  breakdown: Array<VacancyRow & { basis: Figure["basis"]; complete: boolean; method: string }>;
}

/**
 * The summary the existing pages, cards, sorting, Telegram and publish checks
 * read: one row per post with its total and category split, and the overall
 * total. Incomplete figures are kept, marked complete: false, so a page can
 * say "at least". Category sums are included only when complete.
 */
export function deriveVacancies(table: VacancyTable): DerivedVacancies {
  const a = analyseVacancyTable(table);
  const breakdown = a.groups.filter((g) => g.total).map((g) => {
    const split: Record<string, unknown> = {};
    const pwbd: Record<string, number> = {};
    for (const c of a.categories) {
      const f = g.categories[c.key];
      if (!f || !f.complete) continue;
      if (c.partOf === "pwbd") pwbd[c.key.replace(/^pwbd[_-]?/i, "")] = f.value;
      // The breakdown's usual keys stay (General is unreserved: ur); any other
      // column is listed under the notice's own name, which pages show as is.
      else split[/^(general|gen)$/i.test(c.key) ? "ur" : STANDARD_KEYS.has(c.key) ? c.key : c.label] = f.value;
    }
    if (Object.keys(pwbd).length > 0) split.pwbd = pwbd;
    const row: VacancyRow & { basis: Figure["basis"]; complete: boolean; method: string } = {
      post: g.name, count: g.total!.value, basis: g.total!.basis, complete: g.total!.complete, method: g.total!.method,
    };
    if (Object.keys(split).length > 0) row.breakdown = split as VacancyRow["breakdown"];
    return row;
  });
  return { total: a.grandTotal, breakdown };
}

// ─── Shape (what the server accepts) ──────────────────────

const ROW_STATUSES: RowStatus[] = ["STATED", "NIL", "NOT_REPORTED", "NO_FIGURE"];
const KINDS: CategoryKind[] = ["VERTICAL", "HORIZONTAL", "UNDETERMINED"];
const KEY = /^[A-Za-z0-9][A-Za-z0-9 _()./&+-]{0,59}$/;
export const MAX_TABLE_ROWS = 2000;

/**
 * Problems with the table's structure, in words; empty when it can be saved.
 * The figures themselves are judged by analyseVacancyTable, not here: a table
 * with gaps or conflicts can be saved, it just says so.
 */
export function vacancyTableShapeErrors(t: unknown): string[] {
  const errors: string[] = [];
  const v = t as Partial<VacancyTable> | null;
  if (!v || typeof v !== "object") return ["the vacancy table is missing"];
  if (!Array.isArray(v.dimensions) || v.dimensions.length === 0) errors.push("the table needs at least one dimension (for example Post)");
  if (!Array.isArray(v.categories)) errors.push("categories must be a list");
  if (!Array.isArray(v.rows)) errors.push("rows must be a list");
  if (!Array.isArray(v.statedTotals)) errors.push("statedTotals must be a list");
  if (errors.length > 0) return errors;
  const dims = v.dimensions!, cats = v.categories!, rows = v.rows!;
  const dimKeys = new Set<string>();
  for (const d of dims) {
    if (!d || typeof d.key !== "string" || !KEY.test(d.key) || typeof d.label !== "string" || !d.label.trim()) errors.push(`dimension ${JSON.stringify(d?.key)} needs a key and a label`);
    else if (dimKeys.has(d.key)) errors.push(`dimension "${d.key}" appears twice`);
    else dimKeys.add(d.key);
  }
  const catKeys = new Set<string>();
  for (const c of cats) {
    if (!c || typeof c.key !== "string" || !KEY.test(c.key) || typeof c.label !== "string" || !c.label.trim()) { errors.push(`category ${JSON.stringify(c?.key)} needs a key and a label`); continue; }
    if (catKeys.has(c.key)) errors.push(`category "${c.label}" appears twice`);
    catKeys.add(c.key);
    if (!KINDS.includes(c.kind)) errors.push(`category "${c.label}" has an unknown kind`);
    // Only the standard reservations are vertical without a reason; anything
    // else placed inside or outside the total says how that was established.
    if (c.kind !== "UNDETERMINED" && initialCategoryKind(c.key) !== c.kind && !(c.established && c.established.note?.trim())) {
      errors.push(`category "${c.label}": say how it is known whether these seats are part of the total`);
    }
  }
  if (rows.length > MAX_TABLE_ROWS) errors.push(`at most ${MAX_TABLE_ROWS} rows`);
  const ids = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r.id !== "string" || !r.id) { errors.push("a row has no id"); continue; }
    if (ids.has(r.id)) errors.push(`row id "${r.id}" appears twice`);
    ids.add(r.id);
    if (!ROW_STATUSES.includes(r.status)) errors.push(`row "${r.id}" has an unknown status`);
    if (!r.at || typeof r.at !== "object" || Object.keys(r.at).some((k) => !dimKeys.has(k))) errors.push(`row "${r.id}" names a dimension the table does not have`);
    if (!r.cells || typeof r.cells !== "object" || Object.keys(r.cells).some((k) => !catKeys.has(k))) errors.push(`row "${r.id}" has a figure for a category the table does not have`);
    if (!r.source || typeof r.source !== "object" || typeof r.source.line !== "string") errors.push(`row "${r.id}" has no source`);
    else if (r.source.readBy !== undefined && r.source.readBy !== "AI_IMAGE" && r.source.readBy !== "PREPARED") errors.push(`row "${r.id}" says it was read in an unknown way`);
    if (r.unclear !== undefined && (!Array.isArray(r.unclear) || r.unclear.some((k) => k !== "total" && !catKeys.has(k)))) errors.push(`row "${r.id}" marks an unknown column as unreadable`);
    for (const [name, map] of [["suggested", r.suggested], ["printedAt", r.printedAt]] as const) {
      if (map !== undefined && (!map || typeof map !== "object" || Object.entries(map).some(([k, v]) => !dimKeys.has(k) || typeof v !== "string" || !v.trim() || v.length > 300))) {
        errors.push(`row "${r.id}" has a ${name === "suggested" ? "suggested spelling" : "printed name"} for a dimension the table does not have`);
      }
    }
  }
  return errors.slice(0, 20);
}

/**
 * A table made from a record's existing total and one-row-per-post
 * breakdown, so a job entered the old way can be moved to the table without
 * retyping. Nothing is invented: rows keep their figures and are marked as
 * entered by hand; a total with no rows becomes the table's printed total.
 */
export function tableFromLegacy(total: number | null | undefined, rows: VacancyRow[] | null | undefined): VacancyTable {
  const categories: VacancyCategory[] = [];
  const addCat = (key: string, label: string, partOf?: string) => {
    if (categories.some((c) => c.key === key)) return;
    categories.push({ key, label, kind: initialCategoryKind(key), ...(partOf ? { partOf } : {}) });
  };
  const LABELS: Record<string, string> = { ur: "UR", ews: "EWS", obc: "OBC", sc: "SC", st: "ST", women: "Women", exsm: "Ex-Servicemen" };
  const tableRows: VacancyTableRow[] = (rows ?? []).map((r, i) => {
    const cells: Record<string, number> = {};
    for (const [k, v] of Object.entries((r.breakdown ?? {}) as Record<string, unknown>)) {
      if (k === "pwbd" && v && typeof v === "object") {
        for (const [part, n] of Object.entries(v as Record<string, unknown>)) if (isCount(n)) { addCat(`pwbd_${part}`, `PwBD ${part.toUpperCase()}`, "pwbd"); cells[`pwbd_${part}`] = n; }
      } else if (k === "other" && v && typeof v === "object") {
        for (const [name, n] of Object.entries(v as Record<string, unknown>)) if (isCount(n) && KEY.test(name)) { addCat(name, name); cells[name] = n; }
      } else if (isCount(v) && KEY.test(k)) { addCat(k, LABELS[k] ?? k); cells[k] = v; }
    }
    return {
      id: `r${i + 1}`, at: { post: r.post }, status: r.count === 0 ? "NIL" : "STATED", total: r.count, cells,
      source: { retrievalId: null, page: null, line: "from the earlier post-wise breakdown" },
    };
  });
  // The earlier total is kept when there are no rows, or when the rows do not
  // add up to it: then it is a conflict to decide, never silently dropped.
  const rowSum = tableRows.reduce((s, r) => s + (r.total ?? 0), 0);
  const statedTotals: StatedTotal[] = isCount(total) && (tableRows.length === 0 || rowSum !== total)
    ? [{ at: {}, total, source: { retrievalId: null, page: null, line: "from the earlier Total Vacancies" } }] : [];
  return { dimensions: [{ key: "post", label: "Post" }], categories, rows: tableRows, statedTotals };
}

// ─── Tier B: may a calculated total count as checked? ─────

/**
 * Approved rule (vision doc, decision 3): a calculated total counts as checked
 * only when every row has its evidence, nothing is missing, not reported,
 * duplicated or undecided, no conflict is open, the table itself has been
 * checked by a person at this version, and recalculating gives the stored
 * figure. A stated total follows the usual per-field checks instead.
 */
export function calculatedTotalReady(
  table: VacancyTable,
  opts: { tableChecked: boolean; stored?: Pick<Figure, "value" | "fingerprint"> | null; sourceKinds?: SourceKinds },
): { ready: boolean; reasons: string[] } {
  const a = analyseVacancyTable(table, { sourceKinds: opts.sourceKinds });
  const reasons: string[] = [];
  if (!a.grandTotal) reasons.push("there is no total to check");
  else if (a.grandTotal.basis === "STATED") reasons.push("the total is printed in the notice; check it as usual");
  else if (a.grandTotal.basis === "ENTERED") reasons.push("the total was entered by hand, with no page of a document behind it");
  if (a.grandTotal && !a.grandTotal.complete) reasons.push("the total is incomplete");
  for (const code of ["NO_SOURCE", "PDF_ROW_WITHOUT_PAGE", "PAGE_ON_PAGELESS_SOURCE", "FIGURES_NOT_IN_LINE", "NOT_REPORTED", "NO_FIGURE", "UNCLEAR_FIGURE", "DUPLICATE_ROW", "MISSING_DIMENSION", "BAD_FIGURE", "UNDETERMINED_COLUMN", "ROW_TOTAL_MISMATCH", "STATED_TOTAL_MISMATCH", "HORIZONTAL_EXCEEDS_TOTAL", "PARTS_TOTAL_MISMATCH"] as IssueCode[]) {
    const n = a.issues.filter((i) => i.code === code).length;
    if (n > 0) reasons.push(`${n} × ${code.toLowerCase().replace(/_/g, " ")}`);
  }
  // Figures the AI read from a picture: their arithmetic agreeing proves nothing about the page.
  const fromImage = table.rows.filter((r) => r.source?.readBy === "AI_IMAGE").length;
  if (fromImage > 0 && !opts.tableChecked) reasons.push(`${fromImage} row${fromImage === 1 ? " was" : "s were"} read from scanned page images by AI; check them against the pages`);
  // Rows prepared outside (an AI, a person, another website) are research until checked against the notice.
  const prepared = table.rows.filter((r) => r.source?.readBy === "PREPARED").length;
  if (prepared > 0 && !opts.tableChecked) reasons.push(`${prepared} row${prepared === 1 ? " was" : "s were"} prepared outside the notice (by an AI, a person or another website); check them against the notice's pages`);
  if (!opts.tableChecked) reasons.push("the table has not been checked against the notice");
  if (opts.stored && a.grandTotal && (opts.stored.value !== a.grandTotal.value || opts.stored.fingerprint !== a.grandTotal.fingerprint)) {
    reasons.push("the stored total no longer matches a recalculation from the rows");
  }
  return { ready: reasons.length === 0, reasons };
}
