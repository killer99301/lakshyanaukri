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
  basis: "STATED" | "CALCULATED";
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
  | "NOT_REPORTED" | "NO_FIGURE" | "UNDETERMINED_COLUMN" | "STATED_TOTAL_MISMATCH" | "NO_SOURCE";

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

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

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

// ─── Analysis ─────────────────────────────────────────────

export function analyseVacancyTable(table: VacancyTable): VacancyAnalysis {
  const issues: TableIssue[] = [];
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
  const seen = new Map<string, string>();
  for (const r of table.rows) {
    const missing = dims.filter((d) => !(r.at[d.key] ?? "").trim());
    if (missing.length > 0) issues.push({ code: "MISSING_DIMENSION", severity: "ERROR", message: `A row has no ${missing.map((d) => d.label).join(", ")}.`, rowIds: [r.id] });
    const k = atKey(r.at, dims);
    if (seen.has(k)) issues.push({ code: "DUPLICATE_ROW", severity: "ERROR", message: `The same row appears twice: ${dims.map((d) => r.at[d.key]).join(", ")}.`, rowIds: [seen.get(k)!, r.id] });
    else seen.set(k, r.id);
    if (!r.source || (!r.source.line?.trim() && r.source.page == null)) issues.push({ code: "NO_SOURCE", severity: "ERROR", message: `No page or printed line for ${dims.map((d) => r.at[d.key]).join(", ")}.`, rowIds: [r.id] });
    if (r.status === "NOT_REPORTED") { issues.push({ code: "NOT_REPORTED", severity: "WARNING", message: `${dims.map((d) => r.at[d.key]).join(", ")}: not reported in the notice.`, rowIds: [r.id], group: r.at[groupDim] }); continue; }
    if (r.status === "NO_FIGURE") { issues.push({ code: "NO_FIGURE", severity: "WARNING", message: `${dims.map((d) => r.at[d.key]).join(", ")}: printed with no figure.`, rowIds: [r.id], group: r.at[groupDim] }); continue; }
    const bad = [...(r.total !== undefined ? [["total", r.total] as const] : []), ...Object.entries(r.cells)].filter(([, n]) => !isCount(n));
    if (bad.length > 0) { issues.push({ code: "BAD_FIGURE", severity: "ERROR", message: `${dims.map((d) => r.at[d.key]).join(", ")}: ${bad.map(([k]) => k).join(", ")} is not a whole number.`, rowIds: [r.id] }); continue; }
    const hasVertical = vertical.some((key) => isCount(r.cells[key]));
    if (isCount(r.total) && hasVertical && undeterminedInUse.length === 0) {
      const s = sumOf(r.cells, vertical);
      if (s !== r.total) issues.push({ code: "ROW_TOTAL_MISMATCH", severity: "ERROR", message: `${dims.map((d) => r.at[d.key]).join(", ")}: the categories add up to ${s}, the printed total is ${r.total}.`, rowIds: [r.id] });
    }
    const rowTotal = isCount(r.total) ? r.total : hasVertical ? sumOf(r.cells, vertical) : undefined;
    if (rowTotal !== undefined) {
      // A horizontal group (all PwBD parts together) cannot exceed the row.
      const groups = new Map<string, number>();
      for (const c of horizontal) if (isCount(r.cells[c.key])) groups.set(c.partOf ?? c.key, (groups.get(c.partOf ?? c.key) ?? 0) + r.cells[c.key]);
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
      total = { value: stated.total, basis: "STATED", complete: true, method: `printed in the notice${stated.source.page != null ? ` (page ${stated.source.page})` : ""}`, inputs: [], fingerprint: fingerprintOf(stated) };
      if (calculated && calculated.complete && calculated.value !== stated.total) {
        issues.push({ code: "STATED_TOTAL_MISMATCH", severity: "ERROR", group: name,
          message: `${name}: the notice prints ${stated.total}, its rows add up to ${calculated.value}. Decide which is right.` });
      }
    } else if (rows.length === 1 && rows[0].status === "STATED" && isCount(rows[0].total)) {
      // A single printed row is itself the notice's figure.
      total = { value: rows[0].total, basis: "STATED", complete: true, method: `printed in the notice${rows[0].source.page != null ? ` (page ${rows[0].source.page})` : ""}`, inputs: [rows[0].id], fingerprint: fp };
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
    grandTotal = { value, basis: groups.length === 1 && parts[0]!.basis === "STATED" ? "STATED" : "CALCULATED",
      complete: parts.every((p) => p!.complete),
      method: groups.length === 1 ? parts[0]!.method : `sum of ${groups.length} post totals`,
      inputs: groups.flatMap((g) => g.total!.inputs), fingerprint: fingerprintOf(parts.map((p) => p!.fingerprint)) };
  }
  if (statedGrand && isCount(statedGrand.total)) {
    if (grandTotal && grandTotal.complete && grandTotal.value !== statedGrand.total) {
      issues.push({ code: "STATED_TOTAL_MISMATCH", severity: "ERROR",
        message: `The notice prints a grand total of ${statedGrand.total}; the figures add up to ${grandTotal.value}. Decide which is right.` });
    }
    grandTotal = { value: statedGrand.total, basis: "STATED", complete: true, method: `printed in the notice${statedGrand.source.page != null ? ` (page ${statedGrand.source.page})` : ""}`, inputs: [], fingerprint: fingerprintOf(statedGrand) };
  }

  return { categories, groups, grandTotal, issues, fingerprint: fingerprintOf({ table }) };
}

// ─── What the rest of the site reads ──────────────────────

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
      // "General" is the unreserved category: the breakdown's usual key is ur.
      else split[/^(general|gen)$/i.test(c.key) ? "ur" : c.key] = f.value;
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
  opts: { tableChecked: boolean; stored?: Pick<Figure, "value" | "fingerprint"> | null },
): { ready: boolean; reasons: string[] } {
  const a = analyseVacancyTable(table);
  const reasons: string[] = [];
  if (!a.grandTotal) reasons.push("there is no total to check");
  else if (a.grandTotal.basis === "STATED") reasons.push("the total is printed in the notice; check it as usual");
  if (a.grandTotal && !a.grandTotal.complete) reasons.push("the total is incomplete");
  for (const code of ["NO_SOURCE", "NOT_REPORTED", "NO_FIGURE", "DUPLICATE_ROW", "MISSING_DIMENSION", "BAD_FIGURE", "UNDETERMINED_COLUMN", "ROW_TOTAL_MISMATCH", "STATED_TOTAL_MISMATCH", "HORIZONTAL_EXCEEDS_TOTAL"] as IssueCode[]) {
    const n = a.issues.filter((i) => i.code === code).length;
    if (n > 0) reasons.push(`${n} × ${code.toLowerCase().replace(/_/g, " ")}`);
  }
  if (!opts.tableChecked) reasons.push("the table has not been checked against the notice");
  if (opts.stored && a.grandTotal && (opts.stored.value !== a.grandTotal.value || opts.stored.fingerprint !== a.grandTotal.fingerprint)) {
    reasons.push("the stored total no longer matches a recalculation from the rows");
  }
  return { ready: reasons.length === 0, reasons };
}
