// ═══════════════════════════════════════════════════════════
// Held vacancy figures (I5): what an import read but did not offer as the
// job's table, as tables to open in the vacancy editor's paste box
// ═══════════════════════════════════════════════════════════
//
// Pure and client-safe. From a source's vacancy-table note (its preview's
// `vacancyTables`): rows held because the document's table is split
// differently from the job's (H1 the AI's split, H2 a table), and tables not
// read (H3 a pasted table whose columns need choosing, H4 posts run together
// with banks or places, H5 other tables code could not read). Each becomes
// the text the paste box reads, with its original lines, never retyped and
// never guessed: rows held from a different split are written out under
// their own column headings, and every line keeps the original it came from.
// An import made before I5 kept no heading or per-table lines: its lines are
// given as they are, and that is said.
//
// Whether a held table has been added is worked out from the job's saved
// rows each time, never stored: a row counts only when a saved row has the
// same document, the same line and figures that are all in that line.

import type { VacancyDimension, VacancyTableRow } from "@/lib/vacancy-table";

/** The parts of a source's stored vacancy-table note this reads (older imports have fewer). */
export interface HeldNote {
  from?: string | null;
  coverage?: {
    tables: Array<{ title: string; pages: number[]; read: boolean; why?: string; columns?: string[]; heading?: string; lines?: Array<{ page: number | null; text: string }> }>;
    unreadLines: Array<{ page: number | null; text: string }>;
  };
  diff?: {
    held?: number;
    heldRows?: Array<{ at: Record<string, string>; status: string; total: number | null; page: number | null; line?: string; cells?: Record<string, number> }>;
    heldDimensions?: VacancyDimension[];
  };
  problems?: string[];
}

export interface HeldSource { id: string; label: string; declaredKind: string; prepared?: boolean }

/** A line of a held table as the paste box gets it, and what it stands for. */
export interface HeldLine {
  /** The line in the paste box's text. */
  text: string;
  /** The document's own line (a quote); differs from `text` when the row was written out from held figures. */
  original: string;
  page: number | null;
  /** A row of figures (not the heading, not a "Total" line). */
  row: boolean;
}

export interface HeldTable {
  key: string;
  sourceId: string;
  sourceLabel: string;
  research: boolean;
  prepared: boolean;
  title: string;
  /** Why it was held, as the import said it. */
  why: string;
  /** H1/H2: rows of a different split; H3: a pasted table; H4/H5: a table code could not read; LEGACY: lines kept before I5. */
  kind: "SPLIT" | "PASTED" | "NOT_READ" | "LEGACY";
  /** The text the paste box opens with. */
  text: string;
  lines: HeldLine[];
  /** The columns as the import took or suggested them, when it said. */
  columns?: string[];
  /** What is missing from what was kept (a heading, the table's own lines), said, never filled in. */
  incomplete?: string;
}

const numbers = (s: string) => [...s.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter((n) => Number.isFinite(n));
const TOTAL_LINE = /^\s*\|?\s*(?:\d+[.)]?\s+)?(?:grand\s+)?total\b|^\s*\|?\s*(?:कुल|योग)\b/i;
const asLine = (text: string, page: number | null, original = text): HeldLine =>
  ({ text, original, page, row: numbers(text).length > 0 && !TOTAL_LINE.test(text) });

/** Every held table of one source's note, in the order the import read them. */
export function heldTablesOf(note: HeldNote | null | undefined, source: HeldSource, keyPrefix = ""): HeldTable[] {
  if (!note) return [];
  const base = { sourceId: source.id, sourceLabel: source.label, research: source.declaredKind === "RESEARCH", prepared: source.prepared === true };
  const out: HeldTable[] = [];
  // H1/H2: rows held because the document's table is split differently from the job's. Written out under their own
  // headings (the split's dimensions, the categories as labelled, the total); each line keeps the row's own quote.
  const held = note.diff?.heldRows ?? [];
  if (held.length) {
    const dims = note.diff?.heldDimensions ?? [...new Set(held.flatMap((r) => Object.keys(r.at)))].map((k) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1) }));
    const cats = [...new Set(held.flatMap((r) => Object.keys(r.cells ?? {})))];
    const heading = [...dims.map((d) => d.label), ...cats, "Total"].join("\t");
    const rows = held.map((r) => [...dims.map((d) => r.at[d.key] ?? ""), ...cats.map((c) => (r.cells?.[c] ?? "").toString()), r.total ?? ""].join("\t"));
    out.push({ ...base, key: `${keyPrefix}${source.id}:split`, kind: "SPLIT", title: note.from === "split" ? "Figures from the AI's reading of the categories" : "Rows of a table split differently",
      why: note.problems?.find((p) => /^The job's table is split by/.test(p)) ?? "the document's table is split differently from the job's",
      text: [heading, ...rows].join("\n"),
      lines: [asLine(heading, null), ...rows.map((t, i) => ({ text: t, original: held[i].line ?? t, page: held[i].page, row: true }))],
      columns: [...dims.map((d) => d.label), ...cats, "Total"],
      ...(note.from === "split" ? { incomplete: "these figures were written in sentences, not a table: each row's quote is the sentence it came from" } : {}) });
  }
  // H3, H4, H5: tables not read, each with its own heading and lines (imports made since I5).
  const notRead = (note.coverage?.tables ?? []).filter((t) => !t.read);
  const kept = new Set<string>();
  notRead.forEach((t, n) => {
    if (!t.lines?.length) return;
    for (const l of t.lines) kept.add(`${l.page}|${l.text}`);
    const pasted = t.pages.length === 0 && t.columns?.some((c) => c.includes(" → "));
    out.push({ ...base, key: `${keyPrefix}${source.id}:table${n + 1}`, kind: pasted ? "PASTED" : "NOT_READ", title: t.title, why: t.why ?? "not read",
      text: t.lines.map((l) => l.text).join("\n"), lines: t.lines.map((l) => asLine(l.text, l.page)), ...(t.columns?.length ? { columns: t.columns } : {}),
      ...(!t.heading ? { incomplete: "the table's column heading was not kept: type it on the first line before choosing the columns" } : {}) });
  });
  // An import made before I5: tables not read kept no lines of their own, only the source's lines not read, together.
  const legacy = notRead.filter((t) => !t.lines?.length);
  const loose = (note.coverage?.unreadLines ?? []).filter((l) => !kept.has(`${l.page}|${l.text}`));
  if (legacy.length && loose.length) {
    out.push({ ...base, key: `${keyPrefix}${source.id}:legacy`, kind: "LEGACY", title: legacy.map((t) => t.title).join("; "),
      why: legacy.map((t) => t.why ?? "not read").join("; "), text: loose.map((l) => l.text).join("\n"), lines: loose.map((l) => asLine(l.text, l.page)),
      incomplete: `this import was made before held tables kept their own heading and lines: ${legacy.length > 1 ? `the lines of ${legacy.length} tables are together here, and ` : ""}the column heading was not kept — type it on the first line, and keep only one table's lines, before choosing the columns` });
  }
  return out;
}

// ─── From the paste box back to the held lines ─────────────

const CORRECTED = "(corrected in the editor) ";
const norm = (s: string) => s.replace(/^\(corrected in the editor\)\s*/, "").replace(/[|\t]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A row built in the paste box from a held table, with its source as the document it came from: a line the admin
 * left as it was keeps the document's own line and page; a line the admin changed is marked as corrected, never
 * passed off as the document's words. Research stays research: the document, not the paste, says which it is.
 */
export function sourceForHeldRow(printed: string, held: Pick<HeldTable, "sourceId" | "prepared" | "lines">): VacancyTableRow["source"] {
  const same = held.lines.find((l) => l.row && l.text.trim() === printed.trim());
  return {
    retrievalId: held.sourceId,
    page: same?.page ?? null,
    line: same ? same.original : `${CORRECTED}${printed}`,
    ...(held.prepared ? { readBy: "PREPARED" as const } : {}),
  };
}

// ─── Whether a held table has been added ───────────────────

export type HeldStatus = "NOT_ADDED" | "PARTIAL" | "ADDED" | "UNCERTAIN";

/**
 * Whether the job's saved rows hold a held table's rows: a held row counts once, and only for a saved row from the
 * same document whose line is that row's own (its quote or its written-out line, corrected or not) and whose figures
 * are all in that line. No rows to tell by: uncertain.
 */
export function heldStatus(held: Pick<HeldTable, "sourceId" | "lines">, saved: VacancyTableRow[]): { status: HeldStatus; added: number; of: number } {
  const rows = held.lines.filter((l) => l.row);
  if (rows.length === 0) return { status: "UNCERTAIN", added: 0, of: 0 };
  const used = new Set<string>();
  let added = 0;
  for (const l of rows) {
    const inLine = numbers(`${l.original} ${l.text}`);
    const hit = saved.find((r) => !used.has(r.id) && r.source?.retrievalId === held.sourceId
      && [norm(l.original), norm(l.text)].includes(norm(r.source.line ?? ""))
      && (() => { const fig = [...Object.values(r.cells ?? {}), ...(r.total !== undefined ? [r.total] : [])]; return fig.length > 0 && fig.every((n) => inLine.includes(n)); })());
    if (hit) { used.add(hit.id); added++; }
  }
  return { status: added === 0 ? "NOT_ADDED" : added === rows.length ? "ADDED" : "PARTIAL", added, of: rows.length };
}
