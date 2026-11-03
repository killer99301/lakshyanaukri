// ═══════════════════════════════════════════════════════════
// Vacancy tables inside pasted text (I2): a table prepared outside (by an AI,
// a person, a spreadsheet) or copied from a web page, with pipes, tabs or
// commas between its cells, read with the vacancy editor's own paste reader
// ═══════════════════════════════════════════════════════════
//
// Pure. The paste reader (src/lib/vacancy-paste.ts) reads each table and
// suggests what each column is; nothing here reads cells another way. A
// table is offered only when every column it uses was recognised from its
// heading and every line became a row or the printed total: otherwise it is
// said, with its columns as suggested, why, and its lines, for the admin to
// paste into the vacancy editor and choose the columns there. A table of
// fees, dates, marks or pay is not a vacancy table and is left alone.

import { buildRows, readPasted, suggestColumns, type BuiltRows, type ColumnRole } from "@/lib/vacancy-paste";
import type { VacancyTable } from "@/lib/vacancy-table";

export interface PastedTable {
  /** The line above the table, when it says what the table is ("Vacancy table:"). */
  title: string;
  /** The table's lines as pasted. */
  lines: string[];
  /** Each column's heading and what it was taken as: "UR → category UR", "Pay Level → skipped". */
  columns: string[];
  /** The rows and printed totals, when the table can be offered; null when it cannot (`why` says why). */
  table: VacancyTable | null;
  why: string | null;
  notes: string[];
}

// Cells that are not vacancy figures, in a heading or a row name: a fee, a date, marks, time, pay.
// Hindi words whole only: अंक (marks) is inside अंकेक्षण (audit), a post's name.
const NOT_VACANCIES = /\b(?:fees?|amount|charges|rs\.?|₹|dates?|marks|questions|minutes|duration|time|salary|pay|stipend|age|syllabus|subjects?)\b|(?:^|[\s(])(?:शुल्क|तिथि|अंक)(?=$|[\s)])/i;
const RECOGNISED_DIMENSION = /\bpost|designation|cadre|^पद|पद\s*(?:का|के)\s*नाम|संवर्ग|\bbank\b|\bstate|u\.?t\.?\b|\bcity|town|location|centre|center|\bdistrict|\bzone|rrb\b|division|\bdepartment|ministry|office|\bsubject|discipline|trade|^(?:table|सारणी|तालिका)/i;
const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Blocks of two or more consecutive lines with pipes or tabs between cells, or three or more with the same commas. */
function blocks(text: string): Array<{ title: string; lines: string[] }> {
  const all = text.replace(/\r/g, "").split("\n");
  const kind = (l: string) => (/\t/.test(l) ? "tab" : (l.match(/\|/g)?.length ?? 0) >= 2 ? "pipe" : (l.match(/,/g)?.length ?? 0) >= 3 ? `comma${l.match(/,/g)!.length}` : null);
  const out: Array<{ title: string; lines: string[] }> = [];
  for (let i = 0; i < all.length;) {
    const k = kind(all[i]);
    if (!k || SEPARATOR.test(all[i])) { i++; continue; }
    let j = i;
    const lines: string[] = [];
    while (j < all.length && (SEPARATOR.test(all[j]) || kind(all[j]) === k)) { if (!SEPARATOR.test(all[j])) lines.push(all[j]); j++; }
    const enough = k.startsWith("comma") ? lines.length >= 3 && lines.slice(1).every((l) => /\d/.test(l)) : lines.length >= 2;
    if (enough) {
      // The line above is the table's title only when it is a heading: short, with no figures. A line with figures
      // ("Application Fee: General ₹600 …") is a statement of its own, not what the table below is.
      const above = all.slice(Math.max(0, i - 2), i).map((l) => l.trim()).filter(Boolean).pop() ?? "";
      out.push({ title: above.length <= 120 && !/\d/.test(above) ? above.replace(/[:：]\s*$/, "") : "", lines });
    }
    i = j;
  }
  return out;
}

const describe = (h: string, r: ColumnRole) => `${h || "(no heading)"} → ${r.role === "dimension" ? `${r.label}` : r.role === "category" ? `category ${r.label}` : r.role === "total" ? "total" : r.role === "serial" ? "serial number" : "skipped"}`;

/** Why a column's suggested role is not certain enough to offer the table without the admin choosing it. */
function uncertain(h: string, r: ColumnRole): string | null {
  if (r.role === "dimension") return RECOGNISED_DIMENSION.test(h) ? null : `“${h || "a column with no heading"}” is not a heading the reader knows (taken as ${r.label})`;
  if (r.role === "category") {
    const known = ["ur", "ews", "obc", "st", "sc"].some((k) => r.key === k || r.key.startsWith(`${k}_`)) || r.key.startsWith("pwbd_") || r.key.startsWith("women") || r.key === "exsm";
    return known ? null : `“${h}” is not a category the reader knows`;
  }
  return null;
}

/**
 * The vacancy tables of a pasted text that the paste reader reads, each with its columns as suggested; rows only
 * when the table can be offered as it is. Prepared rows (an AI's or a person's) are marked so, to be checked.
 */
export function readPastedTables(text: string, opts: { retrievalId: string; prepared: boolean }): PastedTable[] {
  const out: PastedTable[] = [];
  for (const [n, b] of blocks(text).entries()) {
    const grid = readPasted(b.lines.join("\n"));
    if (grid.headerLines === 0) continue; // no heading line: what each column is cannot be known
    const roles = suggestColumns(grid);
    const columns = grid.headers.map((h, i) => describe(h, roles[i]));
    const figures = roles.map((r, i) => ({ r, h: grid.headers[i] })).filter(({ r }) => r.role === "category" || r.role === "total");
    const names = grid.lines.slice(grid.headerLines).map((l) => l.find((c, i) => roles[i]?.role === "dimension" && c.trim()) ?? "");
    // A vacancy table counts people: it has a reservation category or a total, and no fee, date, marks or pay in it.
    const counts = figures.some(({ r }) => r.role === "category" && uncertain("", r) === null) || figures.some(({ r, h }) => r.role === "total" && /total|posts?|vacanc|कुल|पद/i.test(h));
    // Its title, its figure columns and its row names are checked; a skipped column ("Pay Level") does not make it one.
    if (!counts || [b.title, ...figures.map(({ h }) => h), ...names].some((s) => NOT_VACANCIES.test(s))) continue;
    const doubts = grid.headers.map((h, i) => uncertain(h, roles[i])).filter((d): d is string => d !== null);
    // The post is the table's first dimension: a table of banks or states alone does not say which post they are for
    // (the line above may, but that is for the admin to say).
    if (!roles.some((r) => r.role === "dimension" && r.key === "post")) doubts.push(`no column names the post${b.title ? ` (the line above says “${b.title}”)` : ""}`);
    const built: BuiltRows = buildRows(grid, roles, { retrievalId: opts.retrievalId, page: null, prepared: opts.prepared, idPrefix: `p${n + 1}-` });
    const why = doubts.length ? `its columns need choosing: ${doubts.join("; ")}`
      : built.errors.length ? `not every line could be read as a row: ${built.errors.slice(0, 3).join(" ")}`
      : built.rows.length === 0 ? "it has no rows" : null;
    out.push({
      title: b.title, lines: b.lines, columns, why, notes: built.notes,
      table: why ? null : { dimensions: built.dimensions, categories: built.categories, rows: built.rows, statedTotals: built.statedTotals },
    });
  }
  return out;
}

/** Tables of the same split as one table (their rows one after another); null when they are split differently. */
export function joinPastedTables(tables: VacancyTable[]): VacancyTable | null {
  if (tables.length === 0) return null;
  const dims = (t: VacancyTable) => t.dimensions.map((d) => d.key).join("|");
  if (tables.some((t) => dims(t) !== dims(tables[0]))) return null;
  const categories = [...tables[0].categories];
  for (const t of tables.slice(1)) for (const c of t.categories) if (!categories.some((x) => x.key === c.key)) categories.push(c);
  return { dimensions: tables[0].dimensions, categories, rows: tables.flatMap((t) => t.rows), statedTotals: tables.flatMap((t) => t.statedTotals) };
}
