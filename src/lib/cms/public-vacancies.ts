// ═══════════════════════════════════════════════════════════
// Public vacancy data (Nov 2026)
// ═══════════════════════════════════════════════════════════
//
// What a public page may send to browsers about a job's vacancies, copied
// field by field (an allowlist, like toPublicUpdates for announcements). The
// stored record keeps everything: each row's source (the line as pasted or
// printed, the document's retrieval id, its page, how it was read), suggested
// spellings, printed names and how a column's place was established. None of
// that is shown to visitors, and the home page and /jobs send every job to the
// browser, so it is left out here, at the one place public job data is built
// (snapshotToGovernmentRecruitment).
//
// The public vacancy summary still needs to know one thing about a source:
// whether a document backs the row or total, because that decides "printed"
// against "entered by hand" and therefore the totals shown. That is kept as a
// fixed marker (PUBLIC_DOCUMENT) in place of the real retrieval id; the page,
// the line and how it was read are dropped. Figures are kept only when they are
// numbers, which is all the summary ever reads.

import type { VacancyRow, VacancyCategoryBreakdown } from "@/types";
import type { VacancyTable, VacancyTableRow, StatedTotal, SourceRef, VacancyCategory, VacancyDimension, RowStatus, CategoryKind } from "@/lib/vacancy-table";

/** Stands in for a real retrieval id on public pages: "a document backs this figure", nothing more. */
export const PUBLIC_DOCUMENT = "document";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const ROW_STATUSES = new Set<RowStatus>(["STATED", "NIL", "NOT_REPORTED", "NO_FIGURE"]);
const KINDS = new Set<CategoryKind>(["VERTICAL", "HORIZONTAL", "UNDETERMINED"]);

function strings(m: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) if (isStr(v)) out[k] = v;
  return out;
}

function numbers(m: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) if (isNum(v)) out[k] = v;
  return out;
}

/** Only whether a document backs the figure: no line, page, retrieval id or reading method. */
function publicSource(s: SourceRef | undefined | null): SourceRef {
  const backed = !!s && (s.page != null || !!s.retrievalId);
  return { retrievalId: backed ? PUBLIC_DOCUMENT : null, page: null, line: "" };
}

function publicRow(r: VacancyTableRow): VacancyTableRow {
  const unclear = Array.isArray(r.unclear) ? r.unclear.filter(isStr) : [];
  return {
    id: String(r.id),
    at: strings(r.at),
    status: ROW_STATUSES.has(r.status) ? r.status : "NO_FIGURE",
    ...(isNum(r.total) ? { total: r.total } : {}),
    cells: numbers(r.cells),
    ...(unclear.length ? { unclear } : {}),
    source: publicSource(r.source),
  };
}

function publicStatedTotal(s: StatedTotal): StatedTotal {
  return {
    at: strings(s.at),
    total: isNum(s.total) ? s.total : 0,
    ...(s.cells ? { cells: numbers(s.cells) } : {}),
    source: publicSource(s.source),
  };
}

function publicCategory(c: VacancyCategory): VacancyCategory {
  return {
    key: String(c.key),
    label: String(c.label),
    kind: KINDS.has(c.kind) ? c.kind : "UNDETERMINED",
    ...(isStr(c.partOf) && c.partOf ? { partOf: c.partOf } : {}),
  };
}

/** The vacancy table as public pages may carry it. */
export function toPublicVacancyTable(table: VacancyTable): VacancyTable {
  return {
    dimensions: (table.dimensions ?? []).map((d: VacancyDimension) => ({ key: String(d.key), label: String(d.label) })),
    categories: (table.categories ?? []).map(publicCategory),
    rows: (table.rows ?? []).map(publicRow),
    statedTotals: (table.statedTotals ?? []).filter((s) => isNum(s?.total)).map(publicStatedTotal),
  };
}

function publicBreakdown(b: VacancyCategoryBreakdown): VacancyCategoryBreakdown {
  // Every numeric column as stored (the category table reads any numeric key), plus the PwBD parts and "other" columns.
  const out: Record<string, unknown> = numbers(b);
  const raw = b as Record<string, unknown>;
  if (raw.pwbd && typeof raw.pwbd === "object") out.pwbd = numbers(raw.pwbd);
  if (raw.other && typeof raw.other === "object") out.other = numbers(raw.other);
  return out as VacancyCategoryBreakdown;
}

/** The post-wise vacancy rows as public pages may carry them. */
export function toPublicVacancyBreakdown(rows: readonly VacancyRow[]): VacancyRow[] {
  return rows.filter((r) => r && typeof r === "object").map((r) => ({
    post: String(r.post ?? ""),
    count: isNum(r.count) ? r.count : 0,
    ...(isStr(r.payScale) ? { payScale: r.payScale } : {}),
    ...(isStr(r.eligibility) ? { eligibility: r.eligibility } : {}),
    ...(r.breakdown && typeof r.breakdown === "object" ? { breakdown: publicBreakdown(r.breakdown) } : {}),
  }));
}
