// ═══════════════════════════════════════════════════════════
// Admin: which actions the check list offers for one field (Stage C, C3 step 2)
// ═══════════════════════════════════════════════════════════
//
// Pure. The server decides everything (classify.ts, decide in service.ts):
// this only chooses which buttons to show, from what the checks route
// returns. For Total Vacancies worked out from the vacancy table it follows
// the route the server reports in `tableTotal`, so the list never offers a
// decision the server refuses (C-D2, C-D3).

/** How a total worked out from the vacancy table can be checked, as the checks route reports it (C3 step 1). */
export interface TableTotalView {
  incomplete: boolean;
  route: "TABLE_CHECK" | "PRINTED_LINE";
  /** The printed total's line and page; for a web page or text (C2.1), no page and the document it is on. */
  evidence: PrintedLine | null;
  why: string[];
  pages: number[];
}

export type PrintedLine = { line: string; page: number } | { line: string; page: null; retrievalId: string };

export interface TableCheckState { checked: boolean; decisionId: string | null; pages: number[]; revisionId: string | null }

export interface CheckRowLike { fieldPath: string; cls: string; tier?: "A" | "B"; value: unknown; decisionId?: string }

export interface RowActions {
  verify: boolean;
  notApplicable: boolean;
  /** The ordinary "not stated" (whole document or pages). */
  notStated: boolean;
  /** "Not stated in full", for an incomplete total worked out from the table: pages read and a reason required. */
  notStatedInFull: boolean;
  withdraw: boolean;
  /** The printed total's own line and page, to name when verifying (never filled in for the person). */
  printedLine: PrintedLine | null;
  /** The whole vacancy table must still be checked against the notice for this total (not yet on this screen). */
  needsTableCheck: boolean;
}

const hasValue = (v: unknown) => v !== null && v !== undefined;

export function rowActions(row: CheckRowLike, tableTotal: TableTotalView | null | undefined): RowActions {
  const withdraw = !!row.decisionId;
  // Total Vacancies worked out from the vacancy table: only what the server's route allows.
  if (row.fieldPath === "vacancies.total" && tableTotal) {
    const printed = tableTotal.route === "PRINTED_LINE" && !tableTotal.incomplete;
    return {
      verify: printed && hasValue(row.value) && row.cls !== "VERIFIED",
      notApplicable: false,
      notStated: false,
      notStatedInFull: tableTotal.incomplete && row.cls !== "NOT_STATED",
      withdraw,
      printedLine: printed ? tableTotal.evidence : null,
      // Said only while the total is still pending: not once the table check has verified it, or "not stated in full" stands.
      needsTableCheck: tableTotal.route === "TABLE_CHECK" && row.cls !== "VERIFIED" && row.cls !== "NOT_STATED",
    };
  }
  // Every other field: exactly as before step 2.
  return {
    verify: hasValue(row.value) && row.cls !== "VERIFIED",
    notApplicable: row.cls !== "NOT_APPLICABLE",
    notStated: row.cls !== "NOT_STATED" && row.tier === "B",
    notStatedInFull: false,
    withdraw,
    printedLine: null,
    needsTableCheck: false,
  };
}
