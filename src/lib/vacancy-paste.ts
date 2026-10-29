// ═══════════════════════════════════════════════════════════
// Pasting a vacancy table: from Excel, Google Sheets, a web page or a PDF
// ═══════════════════════════════════════════════════════════
//
// Three pure steps, so the editor can show each one before anything is kept:
//
//   1. readPasted     the text → a grid of cells (tabs, pipes, commas, wide
//                     gaps, or a PDF line: words, then figures)
//   2. suggestColumns what each column looks like: a dimension (post, bank,
//                     state…), a category (SC, ST, OBC…), the total, or a
//                     serial number to ignore. The admin changes any of it.
//   3. buildRows      the grid + the admin's choices → table rows, with every
//                     problem listed; mergePasted then compares them with the
//                     table already saved, and never replaces a row unasked.
//
// Nothing is guessed: "NR" is not reported, "0" nil, a blank or "-" no
// figure, anything else that is not a whole number is an error. A pasted row
// keeps its own line as printed; it counts as evidence only with a page.
//
// A difficult notice (a scan, a table in Hindi) can always come this way: a
// table prepared outside (by an AI, a person, or copied from another website)
// and pasted in. Such rows are marked "prepared" and stay to be checked
// against the notice; a "Total" line becomes the notice's printed total, to
// be checked against the rows, never a row of its own.

import {
  initialCategoryKind, type CategoryKind, type StatedTotal, type VacancyCategory, type VacancyDimension, type VacancyTable, type VacancyTableRow,
} from "@/lib/vacancy-table";

export type PasteFormat = "tabs" | "pipes" | "commas" | "gaps" | "pdf";

export interface PastedGrid {
  format: PasteFormat;
  /** Every non-empty line, cut into cells. */
  lines: string[][];
  /** The lines as pasted, for the rows' evidence. */
  raw: string[];
  /** How many leading lines are headings (no figures). */
  headerLines: number;
  /** Each column's heading, the heading lines joined. */
  headers: string[];
}

export type ColumnRole =
  | { role: "ignore" }
  | { role: "serial" }
  | { role: "dimension"; key: string; label: string }
  | { role: "category"; key: string; label: string; kind: CategoryKind; partOf?: string; note?: string }
  | { role: "total" };

const FIGURE = /^(?:\d{1,3}(?:,\d{2,3})+|\d+|NR|N\.R\.|-|–|—)$/i;
const isFigureCell = (s: string) => FIGURE.test(s.trim());
const isBlankFigure = (s: string) => /^(?:|-|–|—)$/.test(s.trim());
const isNotReported = (s: string) => /^(?:NR|N\.R\.)$/i.test(s.trim());

// ─── 1. Reading the text ──────────────────────────────────

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** A line from a PDF: an optional serial number, words, then trailing figures. */
function splitPdfLine(line: string): string[] {
  const tokens = line.trim().split(/\s+/);
  const figures: string[] = [];
  while (tokens.length > 0 && isFigureCell(tokens[tokens.length - 1])) figures.unshift(tokens.pop()!);
  const serial = tokens.length > 1 && /^\d{1,4}\.?$/.test(tokens[0]) ? [tokens.shift()!.replace(/\.$/, "")] : [];
  return [...serial, ...(tokens.length ? [tokens.join(" ")] : []), ...figures];
}

export function readPasted(text: string): PastedGrid {
  const raw = text.replace(/ /g, " ").split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const share = (re: RegExp) => raw.filter((l) => re.test(l)).length / Math.max(1, raw.length);
  let format: PasteFormat;
  let lines: string[][];
  if (share(/\t/) >= 0.5) {
    format = "tabs";
    lines = raw.map((l) => l.split("\t").map((c) => c.trim()));
  } else if (share(/\|/) >= 0.5) {
    format = "pipes";
    lines = raw.map((l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
  } else if (share(/,/) >= 0.8 && new Set(raw.map((l) => splitCsvLine(l).length)).size === 1 && splitCsvLine(raw[0]).length > 1) {
    format = "commas";
    lines = raw.map(splitCsvLine);
  } else if (share(/\S {2,}\S/) >= 0.5 && raw.every((l) => !/^\s*\d+\s+\S+(\s\S+)*\s\d+(\s\d+)+\s*$/.test(l) || /\S {2,}\S/.test(l))) {
    format = "gaps";
    lines = raw.map((l) => l.trim().split(/\s{2,}/));
  } else {
    format = "pdf";
    lines = raw.map(splitPdfLine);
  }
  // Rows with fewer cells are padded on the left of their figures, so the
  // figures line up under the right-hand columns (PDF lines wrap the words).
  // A line of words only (a wrapped name) goes under the other lines' words.
  const width = Math.max(...lines.map((l) => l.length));
  if (format === "pdf" || format === "gaps") {
    const wordsAt = (l: string[]) => l.findIndex((c) => c.trim() && !isFigureCell(c));
    const counts = new Map<number, number>();
    for (const l of lines) if (l.some((c, i) => i > 0 && isFigureCell(c) && !isBlankFigure(c))) counts.set(wordsAt(l), (counts.get(wordsAt(l)) ?? 0) + 1);
    const wordsColumn = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    lines = lines.map((l) => {
      if (l.length === width) return l;
      const firstFigure = l.findIndex((c, i) => i > 0 && isFigureCell(c));
      if (firstFigure < 0) {
        const lead = l.length === 1 && wordsColumn > 0 ? Array(wordsColumn).fill("") : [];
        return [...lead, ...l, ...Array(Math.max(0, width - l.length - lead.length)).fill("")];
      }
      return [...l.slice(0, firstFigure), ...Array(width - l.length).fill(""), ...l.slice(firstFigure)];
    });
  } else {
    lines = lines.map((l) => [...l, ...Array(width - l.length).fill("")]);
  }
  // Headings: leading lines with no figures that have words above a column
  // whose later cells are figures ("Number of Vacancies" over 1, 1, 2…). A
  // row of words with its figure left blank (a city with no figure) is not one.
  const figuresBelow = (from: number, col: number) => lines.slice(from).some((l) => isFigureCell(l[col] ?? "") && !isBlankFigure(l[col] ?? ""));
  let headerLines = 0;
  while (headerLines < Math.min(3, lines.length - 1)) {
    const line = lines[headerLines];
    const hasFigures = line.some((c) => isFigureCell(c) && !isBlankFigure(c));
    if (hasFigures || !line.some((c, col) => c.trim() && figuresBelow(headerLines + 1, col))) break;
    headerLines++;
  }
  const headers = Array.from({ length: width }, (_, i) =>
    lines.slice(0, headerLines).map((l) => l[i] ?? "").filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
  return { format, lines, raw, headerLines, headers };
}

// ─── 2. Suggesting what each column is ────────────────────

const DIMENSIONS: Array<[RegExp, string, string]> = [
  [/\bpost|designation|cadre|^पद|पद\s*(?:का|के)\s*नाम|संवर्ग/i, "post", "Post"], [/^(?:table|सारणी|तालिका)\b|^(?:सारणी|तालिका)$/i, "table", "Table"], [/\bbank\b/i, "bank", "Bank"], [/\bstate|u\.?t\.?\b/i, "state", "State"],
  [/\bcity|town|location|centre|center/i, "city", "City"], [/\bdistrict/i, "district", "District"], [/\bzone|rrb\b|division/i, "zone", "Zone"],
  [/\bdepartment|ministry|office/i, "department", "Department"], [/\bsubject|discipline|trade/i, "subject", "Subject"],
];
// The standard reservations, in English or Hindi ("UR (अनारक्षित)" or "अनारक्षित"). ST before SC: जनजाति contains जाति.
const CATEGORIES: Array<[RegExp, string, string]> = [
  [/^(?:ur|gen|general|unreserved|open)\b|^(?:अनारक्षित|सामान्य)$/i, "ur", "UR"], [/^ews\b|economically weaker|^आर्थिक\s*रूप\s*से\s*कमजोर/i, "ews", "EWS"],
  [/^obc\b|other backward|^अन्य\s*पिछड़ा\s*वर्ग$/i, "obc", "OBC"], [/^st\b|scheduled tribe|^अनुसूचित\s*जन\s*जाति$/i, "st", "ST"], [/^sc\b|scheduled caste|^अनुसूचित\s*जाति$/i, "sc", "SC"],
];
const PWBD_PARTS: Array<[RegExp, string]> = [[/^hi\b|hearing/i, "hi"], [/^oc\b|ortho|locomotor/i, "oc"], [/^oh\b/i, "oh"], [/^vi\b|visual/i, "vi"], [/^dd\b|dwarf/i, "dd"], [/^ld\b/i, "ld"], [/^id\b|intellect/i, "id"], [/^md\b|multiple/i, "md"]];
// Not vacancy figures: the minimum age, the pay. Suggested as skipped.
const NOT_FIGURES = /^(?:min(?:imum)?\.?\s*)?age\b|^pay\b|pay\s*(?:level|scale)|^न्यूनतम\s*(?:उम्र|आयु)|^(?:उम्र|आयु)|^वेतन/i;
// The women's share of a category ("Women UR", "महिला अनारक्षित"); "Women total" is the women's printed total.
const WOMEN_PART = /^(?:women|female|महिला)\s*[-–:]?\s*(.+)$/i;
const keyOf = (label: string) => {
  const k = label.replace(/[^A-Za-z0-9 ()./&+-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  // A key starts with a letter or digit: "अत्यंत पिछड़ा वर्ग (EBC)" gives "EBC", not "(EBC)".
  return /^[A-Za-z0-9]/.test(k) ? k : k.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
};
/** The category a heading names, in either language, with the heading as printed kept as its label when it is not English. */
function standardOf(h: string): [string, string] | null {
  const head = h.normalize("NFC").trim();
  const english = head.replace(/\(.*?\)/g, "").trim();
  const hit = CATEGORIES.find(([re]) => re.test(english) || re.test(head) || re.test(head.replace(/^.*?\(|\).*$/g, "").trim()));
  return hit ? [hit[1], /[^\x00-\x7F]/.test(head) ? head : hit[2]] : null;
}

export function suggestColumns(grid: PastedGrid): ColumnRole[] {
  const body = grid.lines.slice(grid.headerLines);
  const headingText = grid.lines.slice(0, grid.headerLines).flat().join(" ");
  const outOfWhich = /out\s+of\s+which|of\s+which/i.test(headingText);
  let dims = 0;
  // A column is figures when its heading names a category or the total, or
  // when most of its cells are figures; a stray "12a" in it is then reported
  // as an error by buildRows, never read as a name.
  const namesFigures = (h: string) => /\btotal\b|^कुल/i.test(h) || !!standardOf(h) || PWBD_PARTS.some(([re]) => re.test(h)) || WOMEN_PART.test(h);
  const isFigureColumn = (i: number) => {
    const values = body.map((l) => l[i] ?? "").filter((v) => v.trim());
    if (values.length === 0) return false;
    if (namesFigures(grid.headers[i] ?? "")) return true;
    return values.filter(isFigureCell).length / values.length >= 0.8;
  };
  const figureColumns = grid.headers.map((_, i) => {
    const values = body.map((l) => l[i] ?? "").filter((v) => v.trim());
    return isFigureColumn(i) && !(i === 0 && values.every((v, j) => Number(v) === j + 1));
  });
  // One column of figures and no category heading: it is the number of posts.
  const onlyFigureColumn = figureColumns.filter(Boolean).length === 1 ? figureColumns.indexOf(true) : -1;
  const used = new Set<string>();
  const unique = (key: string, i: number) => { let k = key || `col${i + 1}`; for (let n = 2; used.has(k); n++) k = `${key || "col"}_${n}`; used.add(k); return k; };
  return grid.headers.map((h, i) => {
    const values = body.map((l) => l[i] ?? "").filter((v) => v.trim());
    const allFigures = isFigureColumn(i);
    if (NOT_FIGURES.test(h.trim())) return { role: "ignore" };
    if (i === onlyFigureColumn && !standardOf(h)) return { role: "total" };
    if (allFigures && (/^(?:s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|sr|s\.no|#|क्र[०o.]?\s*सं[०o.]?|क्रम\s*संख्या|क्रमांक)$/i.test(h.trim()) || (i === 0 && values.every((v, j) => Number(v) === j + 1)))) return { role: "serial" };
    if (!allFigures) {
      const known = DIMENSIONS.find(([re]) => re.test(h));
      dims++;
      return { role: "dimension", key: known?.[1] ?? (dims === 1 ? "post" : `dim${dims}`), label: known?.[2] ?? (h || (dims === 1 ? "Post" : `Column ${i + 1}`)) };
    }
    // The women's share of each category: a part of the women's group, never added to the total.
    const women = WOMEN_PART.exec(h.normalize("NFC").trim());
    if (women) {
      const of = women[1].trim();
      if (/^(?:total|all|कुल)(?:\s|$)/i.test(of)) return { role: "category", key: unique("women", i), label: h, kind: "UNDETERMINED" };
      const std = standardOf(of);
      return { role: "category", key: unique(`women_${std?.[0] ?? (keyOf(of).toLowerCase().replace(/[^a-z0-9]+/g, "_") || `col${i + 1}`)}`, i), label: h, kind: "UNDETERMINED", partOf: "women" };
    }
    if (/\btotal\b|^कुल(?:\s*पद)?$/i.test(h)) return { role: "total" };
    const standard = standardOf(h);
    if (standard) return { role: "category", key: unique(standard[0], i), label: standard[1], kind: "VERTICAL" };
    const part = PWBD_PARTS.find(([re]) => re.test(h.replace(/pwbd|\(.*?\)/gi, "").trim()) || re.test(h));
    if (part) {
      return { role: "category", key: unique(`pwbd_${part[1]}`, i), label: `PwBD ${part[1].toUpperCase()}`, partOf: "pwbd",
        kind: outOfWhich ? "HORIZONTAL" : "UNDETERMINED", ...(outOfWhich ? { note: "the pasted heading says “out of which”" } : {}) };
    }
    const label = h || `Column ${i + 1}`;
    const key = unique(/^(?:esm|ex-?servicemen|ex-?sm)\b/i.test(label) ? "exsm" : /^women\b|female/i.test(label) ? "women" : keyOf(label).toLowerCase(), i);
    return { role: "category", key, label, kind: initialCategoryKind(key) };
  });
}

// ─── 3. Building rows ─────────────────────────────────────

export interface BuiltRows {
  dimensions: VacancyDimension[];
  categories: VacancyCategory[];
  rows: VacancyTableRow[];
  /** "Total" lines: the notice's printed totals, for the rows they cover (all, or those sharing a dimension's value). */
  statedTotals: StatedTotal[];
  /** Problems that stop a line from becoming a row; the line is left out. */
  errors: string[];
  /** Things done that the admin should see (a wrapped line joined to the one above). */
  notes: string[];
}

export function buildRows(grid: PastedGrid, roles: ColumnRole[], opts: {
  /** Values for dimensions not in the pasted columns, e.g. { post: "Officer Scale I" }. */
  constants?: Array<{ key: string; label: string; value: string }>;
  page?: number | null;
  retrievalId?: string | null;
  /** The rows were prepared outside the notice (an AI, a person, another website): marked so, to be checked. */
  prepared?: boolean;
  idPrefix: string;
}): BuiltRows {
  const errors: string[] = [];
  const notes: string[] = [];
  const constants = (opts.constants ?? []).filter((c) => c.key.trim() && c.value.trim());
  const dimCols = roles.map((r, i) => ({ r, i })).filter((x): x is { r: Extract<ColumnRole, { role: "dimension" }>; i: number } => x.r.role === "dimension");
  const catCols = roles.map((r, i) => ({ r, i })).filter((x): x is { r: Extract<ColumnRole, { role: "category" }>; i: number } => x.r.role === "category");
  const totalCol = roles.findIndex((r) => r.role === "total");
  const dimensions: VacancyDimension[] = [...constants.map((c) => ({ key: c.key, label: c.label })), ...dimCols.map(({ r }) => ({ key: r.key, label: r.label }))];
  const seenDims = new Set<string>();
  for (const d of dimensions) { if (seenDims.has(d.key)) errors.push(`The dimension "${d.label}" is chosen twice.`); seenDims.add(d.key); }
  const categories: VacancyCategory[] = catCols.map(({ r }) => ({
    key: r.key, label: r.label, kind: r.kind, ...(r.partOf ? { partOf: r.partOf } : {}),
    ...(r.kind !== "UNDETERMINED" && initialCategoryKind(r.key) !== r.kind && r.note ? { established: { by: "SOURCE" as const, note: r.note } } : {}),
  }));
  const seenCats = new Set<string>();
  for (const c of categories) { if (seenCats.has(c.key)) errors.push(`The category "${c.label}" is chosen twice.`); seenCats.add(c.key); }
  if (dimensions.length === 0) errors.push("Choose at least one column (or fill in a fixed value) that names the post.");
  if (catCols.length === 0 && totalCol < 0) errors.push("Choose at least one column of figures: a category or the total.");
  if (errors.length > 0) return { dimensions, categories, rows: [], statedTotals: [], errors, notes };
  const statedTotals: StatedTotal[] = [];

  const rows: VacancyTableRow[] = [];
  const figureCols = [...catCols.map(({ i }) => i), ...(totalCol >= 0 ? [totalCol] : [])];
  grid.lines.slice(grid.headerLines).forEach((line, j) => {
    const lineNo = grid.headerLines + j + 1;
    const printed = grid.raw[grid.headerLines + j] ?? line.join(" ");
    const hasFigures = figureCols.some((i) => (line[i] ?? "").trim());
    // A line with words and no figures continues the row above (a PDF wraps long bank names).
    if (!hasFigures && rows.length > 0 && dimCols.some(({ i }) => (line[i] ?? "").trim())) {
      const prev = rows[rows.length - 1];
      for (const { r, i } of dimCols) if ((line[i] ?? "").trim()) prev.at[r.key] = `${prev.at[r.key] ?? ""} ${line[i].trim()}`.trim();
      prev.source = { ...prev.source, line: `${prev.source.line}\n${printed}` };
      notes.push(`Line ${lineNo} has words but no figures: joined to the row above (${dimCols.map(({ r }) => prev.at[r.key]).join(", ")}).`);
      return;
    }
    const at: Record<string, string> = Object.fromEntries(constants.map((c) => [c.key, c.value.trim()]));
    for (const { r, i } of dimCols) at[r.key] = (line[i] ?? "").trim();
    // A "Total" line is the notice's printed total for the rows it covers: the other names on the line say which.
    const totalWord = dimCols.find(({ r }) => TOTAL_LINE.test(at[r.key] ?? ""));
    const missing = dimensions.filter((d) => !at[d.key]);
    if (missing.length > 0 && !totalWord) {
      // Figures under no name: often a second line of figures for the row above (BPSC prints the women's share so).
      const hint = rows.length > 0 && dimCols.every(({ i }) => !(line[i] ?? "").trim()) ? " If these are a second line of figures for the row above (the women's share, say), prepare them as more columns of that row." : "";
      errors.push(`Line ${lineNo}: no ${missing.map((d) => d.label).join(", ")}.${hint}`);
      return;
    }
    const cells: Record<string, number> = {};
    let total: number | undefined;
    let nr = 0, blank = 0, bad = false;
    for (const i of figureCols) {
      const v = (line[i] ?? "").trim();
      if (isNotReported(v)) { nr++; continue; }
      if (isBlankFigure(v)) { blank++; continue; }
      if (!/^\d{1,3}(?:,\d{2,3})+$|^\d+$/.test(v)) { errors.push(`Line ${lineNo}, ${i === totalCol ? "Total" : (roles[i] as { label: string }).label}: "${v}" is not a whole number.`); bad = true; continue; }
      const n = Number(v.replace(/,/g, ""));
      if (i === totalCol) total = n; else cells[(roles[i] as { key: string }).key] = n;
    }
    if (bad) return;
    const source = { retrievalId: opts.retrievalId ?? null, page: opts.page ?? null, line: printed, ...(opts.prepared ? { readBy: "PREPARED" as const } : {}) };
    if (totalWord) {
      const covers = Object.fromEntries(Object.entries(at).filter(([k, v]) => k !== totalWord.r.key && v));
      if (total === undefined) { errors.push(`Line ${lineNo}: a “${at[totalWord.r.key]}” line with no total figure.`); return; }
      if (statedTotals.some((s) => JSON.stringify(s.at) === JSON.stringify(covers))) { errors.push(`Line ${lineNo}: a second “${at[totalWord.r.key]}” line for the same rows.`); return; }
      statedTotals.push({ at: covers, total, ...(Object.keys(cells).length ? { cells } : {}), source });
      notes.push(`Line ${lineNo} is a total line: kept as the notice's printed total${Object.keys(covers).length ? ` for ${Object.values(covers).join(", ")}` : ""} (${total}), to be checked against the rows, not as a row.`);
      return;
    }
    const id = `${opts.idPrefix}${rows.length + 1}`;
    if (nr > 0 && nr + blank === figureCols.length) { rows.push({ id, at, status: "NOT_REPORTED", cells: {}, source }); return; }
    if (blank === figureCols.length) { rows.push({ id, at, status: "NO_FIGURE", cells: {}, source }); return; }
    if (nr > 0) notes.push(`Line ${lineNo}: some figures are "NR"; they are left empty.`);
    const all = [...Object.values(cells), ...(total !== undefined ? [total] : [])];
    rows.push({ id, at, status: all.length > 0 && all.every((n) => n === 0) ? "NIL" : "STATED", ...(total !== undefined ? { total } : {}), cells, source });
  });
  return { dimensions, categories, rows, statedTotals, errors, notes };
}

/** The name on a total line: "Total", "Grand Total", "कुल", "योग". */
const TOTAL_LINE = /^(?:grand\s+)?total\b|^कुल(?:\s*योग)?$|^(?:महा)?योग$/i;

// ─── Comparing with the table already saved ───────────────

export interface MergePlan {
  /** Rows not in the table yet. */
  added: VacancyTableRow[];
  /** Rows already in the table with the same figures. */
  same: VacancyTableRow[];
  /** Rows already in the table with different figures: replaced only when asked. */
  differ: Array<{ before: VacancyTableRow; after: VacancyTableRow }>;
  /** The table after the merge. */
  table: VacancyTable;
  /** Why the pasted rows cannot go into this table as they are. */
  problems: string[];
}

const figuresOf = (r: VacancyTableRow) => JSON.stringify([r.status, r.total ?? null, Object.entries(r.cells).sort()]);

/**
 * The pasted rows against the saved table. New rows are added; rows that
 * match an existing one by every dimension are left alone when the figures
 * are the same, and replaced only with `replaceDiffering`. New categories are
 * added; the dimensions must be the same as the table's.
 */
export function mergePasted(existing: VacancyTable | null, built: BuiltRows, replaceDiffering: boolean): MergePlan {
  const problems: string[] = [];
  const base: VacancyTable = existing ?? { dimensions: built.dimensions, categories: [], rows: [], statedTotals: [] };
  const sameDims = base.dimensions.map((d) => d.key).join("|") === built.dimensions.map((d) => d.key).join("|");
  if (!sameDims) {
    problems.push(`The table is split by ${base.dimensions.map((d) => d.label).join(" › ")}; the pasted rows by ${built.dimensions.map((d) => d.label).join(" › ")}. Choose the same columns (add a fixed value for a missing one).`);
    return { added: [], same: [], differ: [], table: base, problems };
  }
  const categories = [...base.categories];
  // Printed totals: added when new; one already kept with a different figure is replaced only when asked.
  const statedTotals = [...base.statedTotals];
  for (const s of built.statedTotals ?? []) {
    const at = (x: StatedTotal) => JSON.stringify(Object.entries(x.at).sort());
    const had = statedTotals.findIndex((x) => at(x) === at(s));
    if (had < 0) statedTotals.push(s);
    else if (statedTotals[had].total !== s.total || JSON.stringify(statedTotals[had].cells ?? {}) !== JSON.stringify(s.cells ?? {})) {
      if (replaceDiffering) statedTotals[had] = s;
      else problems.push(`The table already keeps a printed total of ${statedTotals[had].total} for ${Object.values(s.at).join(", ") || "the whole table"}; the pasted total line says ${s.total}. Tick “Replace” to use the pasted one.`);
    }
  }
  for (const c of built.categories) {
    const had = categories.find((x) => x.key === c.key);
    if (!had) categories.push(c);
    else if (had.kind !== c.kind && c.kind !== "UNDETERMINED" && had.kind === "UNDETERMINED") Object.assign(had, { kind: c.kind, ...(c.established ? { established: c.established } : {}) });
  }
  const keyOfRow = (r: VacancyTableRow) => base.dimensions.map((d) => (r.at[d.key] ?? "").replace(/\s+/g, " ").trim().toLowerCase()).join(" | ");
  const byKey = new Map(base.rows.map((r) => [keyOfRow(r), r]));
  const usedIds = new Set(base.rows.map((r) => r.id));
  const added: VacancyTableRow[] = [], same: VacancyTableRow[] = [], differ: MergePlan["differ"] = [];
  const rows = [...base.rows];
  for (const r of built.rows) {
    const had = byKey.get(keyOfRow(r));
    if (!had) {
      let id = r.id;
      for (let n = 2; usedIds.has(id); n++) id = `${r.id}-${n}`;
      usedIds.add(id);
      const row = { ...r, id };
      added.push(row);
      rows.push(row);
      byKey.set(keyOfRow(row), row);
    } else if (figuresOf(had) === figuresOf(r)) same.push(had);
    else {
      differ.push({ before: had, after: { ...r, id: had.id } });
      if (replaceDiffering) rows[rows.indexOf(had)] = { ...r, id: had.id };
    }
  }
  return { added, same, differ, problems, table: { ...base, categories, rows, statedTotals } };
}
