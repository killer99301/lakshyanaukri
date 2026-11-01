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
