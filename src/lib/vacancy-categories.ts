// ═══════════════════════════════════════════════════════════
// Category-wise vacancies on the public job page
// ═══════════════════════════════════════════════════════════
//
// A post's breakdown is a flat name → count list (ur, ews, obc, sc, st,
// women, exsm, any other column the notice has under its own name), with
// pwbd as {vi, hi, oc, md} and an optional `other` list. This turns the rows
// into one table: the columns any post has, in a fixed order, and one cell
// per post and column. Rows without a breakdown are left out; when no row
// has one, there is no table and the page looks as before.

import type { VacancyCategoryBreakdown, VacancyRow } from "@/types";

export interface CategoryColumn { key: string; label: string }
export interface CategoryTable {
  columns: CategoryColumn[];
  rows: Array<{ post: string; cells: Array<number | null> }>;
  /** True when a column is a horizontal reservation (women, ex-servicemen, PwBD), usually counted inside the categories. */
  hasHorizontal: boolean;
}

const VERTICAL: CategoryColumn[] = [
  { key: "ur", label: "UR" }, { key: "ews", label: "EWS" }, { key: "obc", label: "OBC" },
  { key: "sc", label: "SC" }, { key: "st", label: "ST" },
];
const HORIZONTAL: CategoryColumn[] = [
  { key: "women", label: "Women" }, { key: "exsm", label: "Ex-Servicemen" }, { key: "pwbd", label: "PwBD" },
];
const HORIZONTAL_KEYS = new Set(HORIZONTAL.map((c) => c.key));
const KNOWN = new Set([...VERTICAL, ...HORIZONTAL].map((c) => c.key));

const count = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

/** Every column of one post's breakdown, as key → count (pwbd summed, `other` flattened). */
function cellsOf(b: VacancyCategoryBreakdown): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    if (k === "pwbd" && v && typeof v === "object") {
      const parts = Object.values(v as Record<string, unknown>).map(count).filter((n): n is number => n !== null);
      if (parts.length > 0) out.set("pwbd", parts.reduce((a, n) => a + n, 0));
    } else if (k === "other" && v && typeof v === "object") {
      for (const [name, n] of Object.entries(v as Record<string, unknown>)) {
        const c = count(n);
        if (c !== null && name.trim()) out.set(name.trim(), c);
      }
    } else {
      const c = count(v);
      if (c !== null) out.set(k, c);
    }
  }
  return out;
}

export function vacancyCategoryTable(rows: VacancyRow[] | undefined): CategoryTable | null {
  const withSplit = (rows ?? [])
    .filter((r) => r && r.breakdown && typeof r.breakdown === "object")
    .map((r) => ({ post: r.post, cells: cellsOf(r.breakdown!) }))
    .filter((r) => r.cells.size > 0);
  if (withSplit.length === 0) return null;

  const present = new Set(withSplit.flatMap((r) => [...r.cells.keys()]));
  // Other columns follow the five usual ones, in the order they are stored
  // (the database keeps an object's keys shortest first, not as typed).
  const others: CategoryColumn[] = [];
  for (const r of withSplit) for (const k of r.cells.keys()) {
    if (!KNOWN.has(k) && !others.some((c) => c.key === k)) others.push({ key: k, label: k });
  }
  const columns = [...VERTICAL.filter((c) => present.has(c.key)), ...others, ...HORIZONTAL.filter((c) => present.has(c.key))];
  return {
    columns,
    rows: withSplit.map((r) => ({ post: r.post, cells: columns.map((c) => r.cells.get(c.key) ?? null) })),
    hasHorizontal: columns.some((c) => HORIZONTAL_KEYS.has(c.key)),
  };
}
