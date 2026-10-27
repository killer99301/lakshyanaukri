// ═══════════════════════════════════════════════════════════
// Scanned pages: written out by the AI from the page image, read by code
// ═══════════════════════════════════════════════════════════
//
// Stage B2.4. A page with no text (a scan, a photograph of a printed page)
// is sent to the model as the page itself, a one-page PDF the model reads
// as an image. The model only writes out what is printed: every line, and
// every table as its column headings and its rows cell by cell, figures
// exactly as printed, "[unclear]" where it cannot read one and "[blank]"
// where the cell is empty. It never adds up, corrects or fills anything.
//
// Code then does the rest, as for a text notice: which columns are the
// rows' names and which are figures, which column is the total, the
// category keys, the checks of printed subtotals, tables that run on to the
// next page and rows repeated at a page break. The B1 builder makes the
// vacancy table, and the vacancy engine (A1) adds up and checks it.
//
// Every row and figure from here is marked as read from an image by the AI
// ("AI_IMAGE"). Its arithmetic agreeing proves nothing about the picture:
// every such figure stays to be checked against the page.

import { callAiJson } from "@/lib/cms/ai-assist";
import type { VacancyDimension } from "@/lib/vacancy-table";
import type { ColumnSpec, FoundTable, Line } from "@/lib/cms/importer/vacancy-tables";

export interface TranscribedTable { title: string; continues: boolean; columns: string[]; rows: string[][] }
export interface TranscribedPage {
  page: number; lines: string[]; tables: TranscribedTable[];
  /** The model says nothing is printed on the page but a page number or a running header. */
  blank?: boolean;
}

/** The model found almost nothing on a page it did not call blank: it may have missed what is printed. */
export function nearlyEmpty(p: TranscribedPage): boolean {
  return !p.blank && p.tables.length === 0 && p.lines.join("").replace(/\s+/g, "").length < 30;
}

const MAX_LINES = 400, MAX_TABLES = 20, MAX_COLUMNS = 60, MAX_ROWS = 300, MAX_CELL = 300;
const TRANSCRIBE_TIMEOUT_MS = 45_000;

// ─── The request ──────────────────────────────────────────

export function buildTranscribePrompt(page: number, pages: number, subject: string): string {
  return `The attached file is page ${page} of ${pages} of a scanned government recruitment notice${subject ? ` ("${subject}")` : ""}. It has no text layer: read the page image.

Write out what is printed on this page, exactly. Return one JSON object:
{
  "lines": [ every line of text on the page that is not inside a table, top to bottom, exactly as printed ],
  "blank": true only when nothing is printed on the page but a page number or a running header,
  "tables": [ {
    "title": the heading printed just above the table (for example "POST CODE: 15 JUNIOR ASSISTANT IN ..."), or "" if there is none,
    "continues": true only when the table has no heading row of its own on this page and continues a table from the previous page,
    "columns": every lowest-level column heading, left to right, including the first column(s) that name the rows. When a heading spans sub-headings (OC over G and W), write each column as the heading and the sub-heading together: "OC G", "OC W". When the heading row is repeated on this page, write it once here. When the table has no heading row on this page (it continues from the previous page), "columns" is [] and every row goes in "rows".
    "rows": every row of the table, top to bottom, as a list with exactly one cell per column, including Total and Grand Total rows
  } ]
}

Rules for every cell:
- Copy each figure exactly as printed, with its leading zeros ("01" stays "01").
- "-" stays "-". "NR" stays "NR". "0" stays "0". "Nil" stays "Nil".
- A cell that is empty on the page is "[blank]".
- A cell you cannot read with certainty is "[unclear]". Never guess a figure, never correct one, never add up, never fill a cell from the others.
- A note printed in a cell stays with its figure, for example "01 (VH)".
- A row printed over two lines is one row, and text that wraps inside one cell ("Jammu And" over "Kashmir") is one cell: every row has exactly as many cells as the table has columns. Do not leave out any row, and do not repeat one.
Do not translate, summarise or explain anything.`;
}

/** Checks and trims the model's answer; anything not in the expected shape is left out. */
export function parseTranscription(data: Record<string, unknown>, page: number): TranscribedPage {
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_CELL) : "");
  const lines = (Array.isArray(data.lines) ? data.lines : []).map(str).filter(Boolean).slice(0, MAX_LINES);
  const tables: TranscribedTable[] = [];
  for (const t of (Array.isArray(data.tables) ? data.tables : []).slice(0, MAX_TABLES)) {
    const o = (t ?? {}) as Record<string, unknown>;
    const columns = (Array.isArray(o.columns) ? o.columns : []).map(str).slice(0, MAX_COLUMNS);
    const continues = o.continues === true;
    // A table continuing from the previous page may come without its heading row.
    if ((columns.length < 2 && !(continues && columns.length === 0)) || columns.some((c) => !c)) continue;
    const rows = (Array.isArray(o.rows) ? o.rows : []).slice(0, MAX_ROWS)
      .filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map((c) => (typeof c === "number" ? String(c) : str(c))));
    if (columns.length === 0 && rows.length === 0) continue;
    tables.push({ title: str(o.title).replace(/:$/, ""), continues, columns, rows });
  }
  return { page, lines, tables, ...(data.blank === true ? { blank: true } : {}) };
}

/** One scanned page, written out by the model from its image. Never throws. */
export async function transcribePage(opts: {
  pdfBase64: string; page: number; pages: number; subject: string; apiKey: string | undefined; fetchFn?: typeof fetch;
}): Promise<{ ok: true; page: TranscribedPage } | { ok: false; reason: string }> {
  const answer = await callAiJson({
    prompt: buildTranscribePrompt(opts.page, opts.pages, opts.subject), apiKey: opts.apiKey, fetchFn: opts.fetchFn,
    feature: "import", maxOutputTokens: 16_384, timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    attachment: { mimeType: "application/pdf", data: opts.pdfBase64 },
  });
  if (!answer.ok) return { ok: false, reason: answer.reason };
  return { ok: true, page: parseTranscription(answer.data, opts.page) };
}

/** A transcribed page as text, ending with its page mark, for the whole-text reading and the stored source. */
export function pageText(p: TranscribedPage, pages: number): string {
  const out = [...p.lines];
  for (const t of p.tables) {
    if (t.title) out.push(t.title);
    out.push(t.columns.join(" | "));
    for (const r of t.rows) out.push(r.join(" | "));
  }
  return `${out.join("\n")}\n-- ${p.page} of ${pages} --`;
}

// ─── From transcribed tables to tables the builder takes ──

/** A cell as a figure token the builder understands: a number, "NR", "-" (no figure), "[unclear]"; null when it is not a figure. */
export function figureToken(cell: string): string | null {
  const c = cell.trim();
  if (c === "[unclear]") return "[unclear]";
  if (c === "[blank]" || c === "" || /^[-–—]$/.test(c)) return "-";
  if (/^N\.?R\.?$/i.test(c)) return "NR";
  if (/^nil$/i.test(c)) return "0";
  const m = /^(\d{1,3}(?:,\d{2,3})+|\d+)\s*(?:\([^()]{1,12}\))?$/.exec(c); // "01", "1,234", "01 (VH)"
  return m ? m[1] : null;
}

const SERIAL = /^(?:s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|serial(?:\s+no\.?)?)$/i;
const POST_COLUMN = /^(?:name of (?:the )?posts?|post name|posts?|designation)$/i;
const DIM_COLUMNS: Array<[RegExp, string]> = [
  [/\bstate\b|\bu\.?t\.?\b/i, "state"], [/\bbank\b/i, "bank"], [/\bcity\b|\bcentre\b|\blocation\b/i, "city"],
  [/\bdistrict\b/i, "district"], [/\bzone\b|\bdivision\b|\brrb\b/i, "zone"], [/\bdepartment\b|\bministry\b|\boffice\b/i, "department"],
];
const GRAND_TOTAL = /^grand\s+total$/i;
const TOTAL = /^(?:total(?:\s+(?:vacanc\w*|posts?|seats))?|no\.?\s*of\s+(?:posts?|vacanc\w*|seats|apprentices?)|number\s+of\s+\w+)$/i;
const SUBTOTAL = /^total\s+(\S.*)$/i;
const STANDARD: Record<string, string> = { sc: "sc", st: "st", obc: "obc", "obc (ncl)": "obc", "obc-ncl": "obc", ews: "ews", ur: "ur", gen: "ur", general: "ur", unreserved: "ur" };
const VACANCY_CONTEXT = /vacanc|\bposts?\b|seats|apprentice|\bsc\b|\bst\b|obc|ews|\bur\b|\boc\b|\bbc\b|total|reserv/i;
const NOT_VACANCY_COLUMN = /\b(questions?|marks|duration|minutes|fee|amount|rs\.?|salary|pay\s+level|age)\b/i;

/** The sub-heading a column belongs to: "TOTAL G" → "g"; with `member`, "BC-A G" → "g". */
function groupOf(label: string, member = false): string | null {
  if (!member) return SUBTOTAL.exec(label)?.[1].trim().toLowerCase() ?? null;
  const words = label.trim().split(/\s+/);
  return words.length >= 2 ? words[words.length - 1].toLowerCase() : null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "column";
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x.replace(/\s+/g, " ").toLowerCase() === b[i].replace(/\s+/g, " ").toLowerCase());

/**
 * The transcribed pages' vacancy tables, for the B1 builder: rows' name
 * columns as dimensions, figure columns as categories and the total, every
 * row with its page and its cells as written out. A table that continues on
 * the next page is joined to it; a row repeated at the top of the next page
 * is counted once, and said. Printed subtotals ("TOTAL G") are checked
 * against their columns; a difference is said, never corrected.
 */
export function foundTablesFromTranscription(pages: TranscribedPage[]): { found: FoundTable[]; problems: string[]; unread: Line[] } {
  const problems: string[] = [];
  const unread: Line[] = [];
  type Open = { t: TranscribedTable; page: number; rows: Array<{ cells: string[]; page: number }>; pages: number[] };
  const runs: Open[] = [];
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    for (const t of p.tables) {
      const prev = runs[runs.length - 1];
      // A page that continues a table often prints no heading row: its first
      // "columns" are then a row (its last cell is a figure), or none at all.
      const headingIsRow = t.columns.length > 0 && /^\d/.test(figureToken(t.columns[t.columns.length - 1]) ?? "");
      const width = t.columns.length || t.rows[0]?.length || 0;
      const continues = prev && prev.pages.includes(p.page - 1) && width === prev.t.columns.length
        && (same(prev.t.columns, t.columns) || headingIsRow || t.columns.length === 0
          || ((t.continues || !t.title) && t.columns.length === prev.t.columns.length))
        && (t.continues || !t.title || t.title.toLowerCase() === prev.t.title.toLowerCase());
      if (continues) {
        let rows = headingIsRow ? [t.columns, ...t.rows] : t.rows;
        const last = prev.rows[prev.rows.length - 1];
        if (last && rows[0] && same(last.cells, rows[0])) {
          problems.push(`page ${p.page}: the row "${rows[0].join(" | ").slice(0, 80)}" is repeated from the foot of page ${last.page}; counted once`);
          rows = rows.slice(1);
        }
        prev.rows.push(...rows.map((cells) => ({ cells, page: p.page })));
        if (!prev.pages.includes(p.page)) prev.pages.push(p.page);
      } else {
        runs.push({ t, page: p.page, rows: t.rows.map((cells) => ({ cells, page: p.page })), pages: [p.page] });
      }
    }
  }

  const found: FoundTable[] = [];
  for (const run of runs) {
    const { columns, title } = run.t;
    const good = run.rows.filter((r) => {
      if (r.cells.length === columns.length) return true;
      unread.push({ page: r.page, text: r.cells.join(" | ") });
      problems.push(`page ${r.page}: a row of “${title || "a table"}” has ${r.cells.length} cells for ${columns.length} columns; not read`);
      return false;
    });
    if (good.length === 0) continue;
    // The columns naming the rows come first; the figures follow. The first
    // column whose every cell is a figure (or "-", blank, NR, unclear) starts
    // the figures, so a column printed all "-" is still a figure column.
    const serial = columns.map((c) => SERIAL.test(c));
    const allFigures = (ci: number) => good.every((r) => figureToken(r.cells[ci]) !== null);
    const firstFigure = columns.findIndex((c, ci) => !serial[ci] && !/code\b/i.test(c) && !POST_COLUMN.test(c) && allFigures(ci));
    if (firstFigure <= 0) continue;
    const dimCols = columns.map((_, ci) => ci).filter((ci) => ci < firstFigure && !serial[ci]);
    const figureCols = columns.map((_, ci) => ci).filter((ci) => ci >= firstFigure && !serial[ci]);
    if (dimCols.length === 0 || !good.some((r) => figureCols.some((ci) => /\d/.test(r.cells[ci])))) continue;
    // Text where a figure belongs is never read as one: it is unreadable, and said.
    for (const r of good) for (const ci of figureCols) {
      if (figureToken(r.cells[ci]) === null) {
        problems.push(`page ${r.page}, ${title || "a table"}: “${r.cells[ci]}” under ${columns[ci]} is not a figure; treated as unreadable`);
        r.cells[ci] = "[unclear]";
      }
    }
    if (!VACANCY_CONTEXT.test(`${title} ${columns.join(" ")}`) || figureCols.some((ci) => NOT_VACANCY_COLUMN.test(columns[ci]))) continue;

    // The total column: "Grand Total", else the one total column, else the only figure column.
    const grand = figureCols.filter((ci) => GRAND_TOTAL.test(columns[ci]));
    const totals = figureCols.filter((ci) => TOTAL.test(columns[ci]));
    const totalCol = grand[0] ?? (totals.length === 1 ? totals[0] : figureCols.length === 1 ? figureCols[0] : null);
    const subtotalCols = figureCols.filter((ci) => ci !== totalCol && SUBTOTAL.test(columns[ci]) && !TOTAL.test(columns[ci]));
    const otherTotals = figureCols.filter((ci) => ci !== totalCol && TOTAL.test(columns[ci]));
    if (otherTotals.length > 0) {
      problems.push(`“${title || "a table"}” prints more than one total column (${otherTotals.map((ci) => columns[ci]).join(", ")}); only ${totalCol === null ? "none" : `“${columns[totalCol]}”`} is used as the total`);
    }
    const categoryCols = figureCols.filter((ci) => ci !== totalCol && !subtotalCols.includes(ci) && !otherTotals.includes(ci));
    const keys = new Set<string>();
    const specs: Array<{ ci: number; spec: ColumnSpec }> = [];
    for (const ci of [...categoryCols, ...(totalCol !== null ? [totalCol] : [])].sort((a, b) => a - b)) {
      if (ci === totalCol) { specs.push({ ci, spec: { key: "total", label: "Total", role: "total" } }); continue; }
      let key = STANDARD[columns[ci].toLowerCase()] ?? slug(columns[ci]);
      if (key === "total") key = "total_column";
      for (let n = 2; keys.has(key); n++) key = `${slug(columns[ci])}_${n}`;
      keys.add(key);
      specs.push({ ci, spec: { key, label: columns[ci], role: "category" } });
    }

    const dimensions: VacancyDimension[] = [];
    const dimKeyOf = new Map<number, string>();
    for (const ci of dimCols) {
      const h = columns[ci];
      let key = POST_COLUMN.test(h) ? "post" : DIM_COLUMNS.find(([re]) => re.test(h))?.[1] ?? slug(h);
      for (let n = 2; dimensions.some((d) => d.key === key); n++) key = `${slug(h)}_${n}`;
      dimensions.push({ key, label: h });
      dimKeyOf.set(ci, key);
    }

    const rows: FoundTable["rows"] = [];
    const totalsRows: FoundTable["totals"] = [];
    // Every category column must belong to exactly one printed subtotal for the subtotals to say anything.
    let holds = subtotalCols.length > 0 && categoryCols.every((ci) => subtotalCols.filter((sc) => groupOf(columns[sc]) === groupOf(columns[ci], true)).length === 1);
    for (const r of good) {
      const printed = r.cells.join(" | ");
      const figures = specs.map(({ ci }) => figureToken(r.cells[ci]) ?? "-");
      const name = dimCols.map((ci) => r.cells[ci]).join(" ").trim();
      if (/^(?:grand\s+)?total\b/i.test(name)) { totalsRows.push({ label: name, figures, page: r.page, printed }); continue; }
      const dimCells: Record<string, string> = {};
      for (const ci of dimCols) dimCells[dimKeyOf.get(ci)!] = r.cells[ci];
      const serialCell = serial.findIndex(Boolean);
      rows.push({ serial: serialCell >= 0 && /^\d+$/.test(r.cells[serialCell]) ? Number(r.cells[serialCell]) : null, words: name, figures, page: r.page, printed, dimCells });
      // Printed subtotals ("TOTAL G") against the columns they add up, and the
      // subtotals against the total. "-" in a printed figure column is none (0).
      const asCount = (ci: number) => { const v = figureToken(r.cells[ci]); return v === "-" ? 0 : v && /^\d+$/.test(v) ? Number(v) : null; };
      const subs: number[] = [];
      for (const sc of subtotalCols) {
        const part = groupOf(columns[sc])!;
        const members = categoryCols.filter((ci) => groupOf(columns[ci], true) === part);
        const printedSub = asCount(sc);
        const values = members.map(asCount);
        if (printedSub === null || values.some((v) => v === null)) { holds = false; continue; } // unreadable or NR: nothing can be established
        subs.push(printedSub);
        const sum = (values as number[]).reduce((n, v) => n + v, 0);
        if (sum !== printedSub) {
          holds = false;
          problems.push(`page ${r.page}, ${title || "a table"}, ${name}: the ${part.toUpperCase()} columns add up to ${sum}; the printed ${columns[sc]} is ${printedSub}. Check the figures against the page.`);
        }
      }
      if (totalCol !== null && subs.length === subtotalCols.length && subtotalCols.length > 0) {
        const total = asCount(totalCol);
        const sum = subs.reduce((n, v) => n + v, 0);
        if (total === null) holds = false;
        else if (sum !== total) {
          holds = false;
          problems.push(`page ${r.page}, ${title || "a table"}, ${name}: ${subtotalCols.map((ci) => columns[ci]).join(" + ")} make ${sum}; the printed ${columns[totalCol]} is ${total}. Check the figures against the page.`);
        }
      }
    }
    if (rows.length === 0) continue;
    // When every row's printed subtotals add up its columns, and the subtotals
    // add up to its total, the table itself shows these columns are part of
    // the total: established by the source, not assumed from their names.
    if (holds) {
      for (const s of specs) {
        if (s.spec.role !== "category") continue;
        s.spec.kind = "VERTICAL";
        s.spec.established = { by: "SOURCE", note: `the printed ${subtotalCols.map((ci) => columns[ci]).join(" and ")} columns add up these columns, and add up to ${totalCol !== null ? columns[totalCol] : "the total"}, in every row (page ${run.pages.join(", ")})` };
      }
    }
    found.push({
      title, heading: columns.join(" | "), headingPage: run.page, pages: run.pages,
      figureCount: specs.length, columns: specs.map((s) => s.spec), columnsBy: "CODE",
      dimensions, rows, totals: totalsRows, unread: [], readBy: "AI_IMAGE",
    });
  }
  return { found, problems, unread };
}
