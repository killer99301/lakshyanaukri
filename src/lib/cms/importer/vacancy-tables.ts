// ═══════════════════════════════════════════════════════════
// Smart intake: reading a notice's vacancy tables
// ═══════════════════════════════════════════════════════════
//
// Server only (the AI fallback). Finds every vacancy table in a document's
// text, reads every row by code, and builds one vacancy table (src/lib/
// vacancy-table.ts) with each row's page and printed line kept as evidence.
//
// How a table is found: a heading with vacancy words (SC, ST, OBC, EWS,
// General, Total, Vacancies, Posts…) followed by at least three rows that
// end in the same number of figures. A row is a serial number (when the
// table has them) and words, possibly wrapped over several lines, then its
// figures; "NR" is not reported, "-" or a missing figure is no figure.
//
// How columns are understood: the heading words are matched by code, in
// printed order (SC ST OBC (NCL) EWS GENERAL TOTAL … HI OC VI ID ESM DESM).
// Only when that does not give exactly one column per figure is the AI
// asked, and its answer must quote the heading. Columns the heading puts
// under "out of which" are counted within the others; any other column's
// place is left for the printed totals to settle (vacancy-table.ts).
//
// Nothing is guessed: a table whose columns are not understood is reported
// as not read, never filled in. The coverage report says which pages held
// tables, which tables were read, and every line in a table that was not.

import { callAiJson } from "@/lib/cms/ai-assist";
import { initialCategoryKind, type VacancyCategory, type VacancyDimension, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";

// ─── Pages ────────────────────────────────────────────────

export interface Line { page: number | null; text: string }

/** The text's lines with their page, from the PDF reader's "-- 3 of 10 --" markers. */
export function linesWithPages(text: string): Line[] {
  const out: Line[] = [];
  const hasMarkers = /\n-- \d+ of \d+ --/.test(`\n${text}`);
  let page = hasMarkers ? 1 : null;
  for (const raw of text.split(/\r?\n/)) {
    const marker = /^-- (\d+) of \d+ --$/.exec(raw.trim());
    if (marker) { page = Number(marker[1]) + 1; continue; }
    const t = raw.replace(/\s+/g, " ").trim();
    if (t) out.push({ page, text: t });
  }
  return out;
}

// ─── Words of a vacancy table ─────────────────────────────

const FIGURE = /^(?:\d{1,3}(?:,\d{2,3})+|\d+|NR|N\.R\.?|-|–|—)$/i;
const VACANCY_WORDS = /\b(vacanc\w*|posts?|sc|st|obc|ews|ur|gen(?:eral)?|unreserved|total|pwbd|esm|bank|state|city|district|zone|division|department)\b/i;
const NOT_VACANCIES = /\b(questions?|marks|duration|minutes|syllabus|fee|amount|rs\.?|salary|pay\s+level|age)\b/i;
const NOISE = /^(go to index\b.*|p a g e \d+.*|page \d+( of \d+)?|nr\s*=\s*not reported.*|\*.*)$/i;

/** Trailing figure tokens of a line, and the words before them. */
function splitFigures(text: string): { words: string; figures: string[] } {
  const tokens = text.split(" ");
  const figures: string[] = [];
  while (tokens.length > 0 && FIGURE.test(tokens[tokens.length - 1])) figures.unshift(tokens.pop()!);
  return { words: tokens.join(" "), figures };
}

interface ColumnSpec { key: string; label: string; role: "category" | "total"; partOf?: string }

// Column words in a heading, in printed order. Group headings that only sit
// over sub-columns (PwBD over HI/OC/VI/ID) are dropped when their parts follow.
const COLUMN_WORDS: Array<[RegExp, (m: string) => ColumnSpec | "PWBD_GROUP" | "ESM_GROUP"]> = [
  [/\bSC\b/i, () => ({ key: "sc", label: "SC", role: "category" })],
  [/\bST\b/i, () => ({ key: "st", label: "ST", role: "category" })],
  [/\bOBC\b(?:\s*\(\s*NCL\s*\)?)?/i, (m) => ({ key: "obc", label: /NCL/i.test(m) ? "OBC (NCL)" : "OBC", role: "category" })],
  [/\bEWS\b/i, () => ({ key: "ews", label: "EWS", role: "category" })],
  [/\b(?:UR|GEN(?:ERAL)?|UNRESERVED)\b/i, (m) => ({ key: "ur", label: /^ur$/i.test(m.trim()) ? "UR" : m.trim()[0].toUpperCase() + m.trim().slice(1).toLowerCase(), role: "category" })],
  [/\bTOTAL\b|\bNumber\s+of\s+(?:Vacanc\w*|Posts)|\bNo\.?\s+of\s+(?:Posts|Vacanc\w*)/i, () => ({ key: "total", label: "Total", role: "total" })],
  [/\bP[Ww][Bb][Dd]\b/i, () => "PWBD_GROUP"],
  [/\bHI\b/, () => ({ key: "pwbd_hi", label: "PwBD HI", role: "category", partOf: "pwbd" })],
  [/\bOC\b/, () => ({ key: "pwbd_oc", label: "PwBD OC", role: "category", partOf: "pwbd" })],
  [/\bVI\b/, () => ({ key: "pwbd_vi", label: "PwBD VI", role: "category", partOf: "pwbd" })],
  [/\bID\b/, () => ({ key: "pwbd_id", label: "PwBD ID", role: "category", partOf: "pwbd" })],
  [/\bMD\b/, () => ({ key: "pwbd_md", label: "PwBD MD", role: "category", partOf: "pwbd" })],
  [/\bDESM\b/i, () => ({ key: "desm", label: "DESM", role: "category" })],
  [/\bE[Xx]?-?SM\b|\bEx-?Servicemen\b/i, () => "ESM_GROUP"],
  [/\bWomen\b|\bFemale\b/i, () => ({ key: "women", label: "Women", role: "category" })],
];

/** The columns a heading names, in order; null when they cannot be matched to `count` figures. */
export function columnsFromHeading(heading: string, count: number): ColumnSpec[] | null {
  const found: Array<{ at: number; spec: ColumnSpec | "PWBD_GROUP" | "ESM_GROUP" }> = [];
  for (const [re, make] of COLUMN_WORDS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of heading.matchAll(g)) found.push({ at: m.index ?? 0, spec: make(m[0]) });
  }
  found.sort((a, b) => a.at - b.at);
  const hasPwbdParts = found.some((f) => typeof f.spec === "object" && f.spec.partOf === "pwbd");
  const esmCount = found.filter((f) => f.spec === "ESM_GROUP").length;
  const specs: ColumnSpec[] = [];
  let esmSeen = 0;
  for (const f of found) {
    if (f.spec === "PWBD_GROUP") { if (!hasPwbdParts) specs.push({ key: "pwbd", label: "PwBD", role: "category" }); continue; }
    if (f.spec === "ESM_GROUP") {
      esmSeen++;
      // "ESM" printed twice: a group heading, then the column itself.
      if (esmCount > 1 && esmSeen < esmCount) continue;
      specs.push({ key: "esm", label: "ESM", role: "category" });
      continue;
    }
    const spec = f.spec as ColumnSpec;
    if (!specs.some((s) => s.key === spec.key)) specs.push(spec);
  }
  return specs.length === count ? specs : null;
}

// ─── Dimensions in the words before the figures ───────────

const DIMENSION_WORDS: Array<[RegExp, string, string]> = [
  [/\bSTATE\b|\bU\.?T\.?\b/i, "state", "State"], [/\bBANK\b/i, "bank", "Bank"], [/\bCITY\b|\bCENTRE\b|\bLOCATION\b/i, "city", "City"],
  [/\bDISTRICT\b/i, "district", "District"], [/\bZONE\b|\bRRB\b|\bDIVISION\b/i, "zone", "Zone"],
  [/\bDEPARTMENT\b|\bMINISTRY\b|\bOFFICE\b/i, "department", "Department"],
  [/\bNAME OF (?:THE )?POST\b|\bPOST NAME\b|\bPOSTS?\b|\bDESIGNATION\b|\bCADRE\b/i, "post", "Post"],
];

function dimensionsFromHeading(heading: string): VacancyDimension[] {
  const found: Array<{ at: number; d: VacancyDimension }> = [];
  for (const [re, key, label] of DIMENSION_WORDS) {
    const m = re.exec(heading);
    if (m && !found.some((f) => f.d.key === key)) found.push({ at: m.index, d: { key, label } });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.d);
}

/** States and union territories, with spellings notices use. */
const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Chattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu & Kashmir", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Orissa", "Puducherry", "Pondicherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "Uttrakhand", "Uttaranchal", "West Bengal",
].sort((a, b) => b.length - a.length);

/** "ANDHRA PRADESH ANDHRA PRADESH GRAMEENA BANK" → state + the rest; null when no state starts the words. */
export function splitState(words: string): { state: string; rest: string } | null {
  const lower = words.toLowerCase();
  const s = STATES.find((x) => lower === x.toLowerCase() || lower.startsWith(`${x.toLowerCase()} `));
  return s ? { state: words.slice(0, s.length), rest: words.slice(s.length).trim() } : null;
}

// ─── Finding tables ───────────────────────────────────────

export interface FoundTable {
  title: string;
  heading: string;
  headingPage: number | null;
  pages: number[];
  figureCount: number;
  columns: ColumnSpec[] | null;
  /** Who matched the figures to the heading: code, or the AI when code could not (an interpretation to review). */
  columnsBy?: "CODE" | "AI";
  dimensions: VacancyDimension[];
  /** Rows: the words (wrapped lines joined) and the figures, with the printed lines. */
  rows: Array<{ serial: number | null; words: string; figures: string[]; page: number | null; printed: string }>;
  /** "Total" / "Grand Total" lines. */
  totals: Array<{ label: string; figures: string[]; page: number | null; printed: string }>;
  /** Lines inside the table that could not be read as a row. */
  unread: Line[];
  /** Why the table cannot be used, when it cannot. */
  problem?: string;
}

/** A line of a table's column heading. */
const COLUMN_LINE = /\b(sr\.?|sl\.?|s\.?\s*no\.?|state|bank|city|district|zone|sc|st|obc|ews|general|gen|ur|total|name of (?:the )?post|post name|number of)\b/i;
/** Heading lines that only carry column words (wrapped parts like "(NCL", ")", "PwBD ESM", "HI OC VI ID"). */
const HEADING_ONLY = /^(?:\(?[A-Za-z]{1,6}\)?\*?(?:\s+|$))+$/;
const OUT_OF_WHICH = /\b(?:out\s+of\s+which|of\s+which)\b/i;
const SERIAL_HEADING = /^(?:sr\.?|sl\.?|s\.?\s*no\.?)(?:\s|$)/i;
/** How many different column words a line has (SC, ST, State, Bank, Total, Number of…). */
function columnWordCount(t: string): number {
  const g = new RegExp(COLUMN_LINE.source, "gi");
  return new Set([...t.matchAll(g)].map((m) => m[0].toLowerCase())).size;
}
const isHeadingLine = (t: string) => VACANCY_WORDS.test(t) && splitFigures(t).figures.length === 0;
const looksLikeTitle = (t: string) => !NOISE.test(t) && splitFigures(t).figures.length === 0 && t.length <= 120 && /[A-Za-z]/.test(t);

/**
 * Every vacancy table in the lines. Pure: the columns of a table whose
 * heading code cannot match are left null for the caller to ask about.
 */
export function findVacancyTables(lines: Line[]): FoundTable[] {
  const tables: FoundTable[] = [];
  // Data lines: words then figures. Each table is a run of them with the same count.
  const data = lines.map((l) => {
    const { words, figures } = splitFigures(l.text);
    return figures.length > 0 && (words.length > 0 || figures.length > 1) && !NOISE.test(l.text) ? figures.length : 0;
  });
  let i = 0;
  while (i < lines.length) {
    if (data[i] === 0) { i++; continue; }
    const k = data[i];
    // The heading: the lines just above the first row, back to a blank-ish break.
    let h = i - 1;
    const headingLines: Line[] = [];
    while (h >= 0 && headingLines.length < 14 && data[h] === 0) {
      if (!NOISE.test(lines[h].text)) headingLines.unshift(lines[h]);
      h--;
    }
    // The column heading runs from the first line naming a column (Sr. No.,
    // State, SC, Total…) to the last line that belongs to it; the title is the
    // line just above it; lines after the heading are row 1's wrapped words.
    // A heading line names two columns, or starts with a serial-number heading:
    // a title that merely contains a column word ("General Banking Officer") does not count.
    const firstColumnLine = headingLines.findIndex((l) => columnWordCount(l.text) >= 2 || SERIAL_HEADING.test(l.text));
    if (firstColumnLine < 0) { i++; continue; }
    // The heading continues until the first row: a line starting with a serial
    // number. A wrapped heading word ("Vacancies", "(NCL", "HI OC VI ID") stays in it.
    let lastColumnLine = firstColumnLine;
    for (let j = firstColumnLine + 1; j < headingLines.length; j++) {
      const t = headingLines[j].text;
      if (/^\d{1,4}\.?\s/.test(t)) break;
      if (COLUMN_LINE.test(t) || OUT_OF_WHICH.test(t) || HEADING_ONLY.test(t) || /^\(?vacanc\w*\)?$|^posts?$/i.test(t) || /^[()*.,\s-]+$/.test(t)) lastColumnLine = j;
      else break;
    }
    const headingPart = headingLines.slice(firstColumnLine, lastColumnLine + 1);
    const heading = headingPart.map((l) => l.text).join(" ");
    const context = headingLines.slice(0, lastColumnLine + 1).map((l) => l.text).join(" ");
    // A vacancy table names categories or vacancies; marks, fees or ages are other tables.
    if (!/\b(sc|st|obc|ews|vacanc\w*|posts?)\b/i.test(context) || (NOT_VACANCIES.test(heading) && !/vacanc|\bposts?\b/i.test(heading))) { i++; continue; }
    const firstWrap = headingLines.slice(lastColumnLine + 1);
    const titleLines = headingLines.slice(0, firstColumnLine).filter((l) => looksLikeTitle(l.text) && !OUT_OF_WHICH.test(l.text));
    const title = (titleLines[titleLines.length - 1]?.text ?? "").replace(/:$/, "");

    // Read the run: rows with k figures; up to 4 word-only lines between rows
    // are the next row's wrapped words; a new heading ends the table.
    const rows: FoundTable["rows"] = [];
    const totals: FoundTable["totals"] = [];
    const unread: Line[] = [];
    let pending: Line[] = [...firstWrap];
    let j = i;
    let gap = 0;
    while (j < lines.length) {
      const l = lines[j];
      if (data[j] === k) {
        const { words, figures } = splitFigures(l.text);
        const all = [...pending.map((p) => p.text), words].join(" ").trim();
        const printed = [...pending.map((p) => p.text), l.text].join("\n");
        const serialM = /^(\d{1,4})\.?\s+(.*)$/.exec(all);
        if (/^(grand\s+)?total\b/i.test(serialM ? serialM[2] : all)) totals.push({ label: all, figures, page: l.page, printed });
        else rows.push({ serial: serialM ? Number(serialM[1]) : null, words: serialM ? serialM[2] : all, figures, page: pending[0]?.page ?? l.page, printed });
        pending = [];
        gap = 0;
        j++;
        continue;
      }
      if (data[j] > 0 && data[j] !== k) {
        // A line with a different number of figures inside the run.
        if (isHeadingLine(lines[j].text)) break;
        const next = data.slice(j + 1, j + 4).includes(k);
        if (!next) break;
        unread.push(l);
        j++;
        continue;
      }
      // Words only.
      if (isHeadingLine(l.text) && rows.length > 0 && /\b(sc|st|obc|total|bank|state|city)\b/i.test(l.text) && splitFigures(l.text).figures.length === 0
          && lines.slice(j, j + 6).filter((x) => isHeadingLine(x.text)).length >= 2) break; // a new table's heading
      if (NOISE.test(l.text)) { j++; continue; }
      gap++;
      if (gap > 4) break;
      pending.push(l);
      j++;
    }
    // Words left over after the last row are not part of the table.
    if (rows.length >= 3) {
      const columns = columnsFromHeading(heading, k);
      const dims = dimensionsFromHeading(heading).filter((d) => d.key !== "post" || !/^posts?$/i.test(d.label));
      tables.push({
        title, heading, headingPage: headingPart[0]?.page ?? null,
        pages: [...new Set([...rows.map((r) => r.page), ...totals.map((t) => t.page)].filter((p): p is number => p != null))],
        figureCount: k, columns, dimensions: dims, rows, totals, unread,
      });
      i = j;
    } else {
      i++;
    }
  }
  // Tables that continue on the next page without repeating their heading
  // were read as one run already; a table whose heading repeats on the next
  // page with the same title is joined to the one before it.
  const joined: FoundTable[] = [];
  for (const t of tables) {
    const prev = joined[joined.length - 1];
    if (prev && prev.title === t.title && prev.figureCount === t.figureCount && t.title && t.rows[0]?.serial !== 1) {
      prev.rows.push(...t.rows); prev.totals.push(...t.totals); prev.unread.push(...t.unread);
      prev.pages = [...new Set([...prev.pages, ...t.pages])];
    } else joined.push(t);
  }
  return joined;
}

// ─── The AI, only for a heading code could not match ──────

/** Asks the model which column each figure is; its labels must be in the heading. */
export async function columnsByAi(t: FoundTable, opts: { apiKey: string | undefined; fetchFn?: typeof fetch }): Promise<ColumnSpec[] | null> {
  const sample = t.rows.slice(0, 3).map((r) => r.printed.replace(/\n/g, " ")).join("\n");
  const prompt = `This is the heading of a vacancy table from an Indian government recruitment notice, and three of its rows. Each row ends with ${t.figureCount} figures.

HEADING:
${t.heading}

ROWS:
${sample}

Return JSON: { "columns": [ { "label": the column's name copied exactly from the heading, "kind": one of "SC","ST","OBC","EWS","UR","TOTAL","PWBD_HI","PWBD_OC","PWBD_VI","PWBD_ID","PWBD_MD","ESM","DESM","WOMEN","OTHER" } ] } with exactly ${t.figureCount} entries, one per figure, left to right. "UR" is General / Unreserved. If you cannot tell, return { "columns": [] }.`;
  const answer = await callAiJson({ prompt, apiKey: opts.apiKey, fetchFn: opts.fetchFn, feature: "import", maxOutputTokens: 1024 });
  if (!answer.ok) return null;
  const cols = Array.isArray(answer.data.columns) ? (answer.data.columns as Array<{ label?: unknown; kind?: unknown }>) : [];
  if (cols.length !== t.figureCount) return null;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const heading = norm(t.heading);
  const specs: ColumnSpec[] = [];
  for (const c of cols) {
    const label = typeof c.label === "string" ? c.label.trim() : "";
    const kind = typeof c.kind === "string" ? c.kind : "";
    if (!label || !heading.includes(norm(label))) return null; // not quoted from the heading
    const map: Record<string, ColumnSpec> = {
      SC: { key: "sc", label, role: "category" }, ST: { key: "st", label, role: "category" }, OBC: { key: "obc", label, role: "category" },
      EWS: { key: "ews", label, role: "category" }, UR: { key: "ur", label, role: "category" }, TOTAL: { key: "total", label: "Total", role: "total" },
      PWBD_HI: { key: "pwbd_hi", label, role: "category", partOf: "pwbd" }, PWBD_OC: { key: "pwbd_oc", label, role: "category", partOf: "pwbd" },
      PWBD_VI: { key: "pwbd_vi", label, role: "category", partOf: "pwbd" }, PWBD_ID: { key: "pwbd_id", label, role: "category", partOf: "pwbd" },
      PWBD_MD: { key: "pwbd_md", label, role: "category", partOf: "pwbd" }, ESM: { key: "esm", label, role: "category" },
      DESM: { key: "desm", label, role: "category" }, WOMEN: { key: "women", label, role: "category" },
    };
    const spec = map[kind] ?? { key: label.toLowerCase().replace(/[^a-z0-9 ()./&+-]/g, "").slice(0, 60) || `col${specs.length + 1}`, label, role: "category" as const };
    if (specs.some((s) => s.key === spec.key)) return null;
    specs.push(spec);
  }
  return specs;
}

// ─── Building one vacancy table ───────────────────────────

export interface CoverageReport {
  pages: number | null;
  tables: Array<{ title: string; pages: number[]; rows: number; read: boolean; why?: string; columnsBy?: "CODE" | "AI"; columns?: string[] }>;
  unreadLines: Array<{ page: number | null; text: string }>;
}

const titleCase = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s)
  ? s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Ii|Iii|Iv|Vi|Vii)\b/g, (r) => r.toUpperCase()).replace(/\bOf\b/g, "of").replace(/\bAnd\b/g, "and")
  : s);

/**
 * One vacancy table from the tables found. Rows keep their page and printed
 * lines; `post` names a table's post when its rows do not (the table's
 * title, or `fallbackPost` for a heading like "Table E"). A dimension the
 * notice gives in one table and not in another (a bank's state) is filled
 * from the tables that do give it, never invented.
 */
export function buildVacancyTable(found: FoundTable[], opts: { retrievalId: string | null; fallbackPost: string }): { table: VacancyTable | null; coverage: Omit<CoverageReport, "pages"> } {
  const coverage: Omit<CoverageReport, "pages"> = { tables: [], unreadLines: [] };
  const usable = found.filter((t) => t.columns);
  for (const t of found) {
    coverage.tables.push({ title: t.title || "(untitled table)", pages: t.pages, rows: t.rows.length, read: !!t.columns,
      ...(t.columns ? { columnsBy: t.columnsBy ?? "CODE", columns: t.columns.map((c) => c.label) } : { why: `its ${t.figureCount} columns of figures could not be matched to the heading` }) });
    coverage.unreadLines.push(...t.unread.map((l) => ({ page: l.page, text: l.text })));
  }
  if (usable.length === 0) return { table: null, coverage };

  // Dimensions: the post, then every other dimension any table has, in order.
  const extra: VacancyDimension[] = [];
  for (const t of usable) for (const d of t.dimensions) if (d.key !== "post" && !extra.some((x) => x.key === d.key)) extra.push(d);
  const rowsHavePost = usable.some((t) => t.dimensions.some((d) => d.key === "post"));
  const dimensions: VacancyDimension[] = [{ key: "post", label: "Post" }, ...extra];

  // Categories, in order of first appearance; how each counts.
  const categories: VacancyCategory[] = [];
  for (const t of usable) {
    const outOfWhich = /\b(?:out\s+of\s+which|of\s+which|included)\b/i.test(t.heading);
    for (const c of t.columns!) {
      if (c.role !== "category" || categories.some((x) => x.key === c.key)) continue;
      const overlapping = outOfWhich && (c.partOf === "pwbd" || c.key === "pwbd" || c.key === "esm" || c.key === "desm");
      categories.push({
        key: c.key, label: c.label, kind: overlapping ? "HORIZONTAL" : initialCategoryKind(c.key),
        ...(c.partOf ? { partOf: c.partOf } : {}),
        ...(overlapping ? { established: { by: "SOURCE" as const, note: `the table heading says “out of which”${t.headingPage != null ? ` (page ${t.headingPage})` : ""}` } } : {}),
      });
    }
  }

  // A bank's (or city's) state from the tables that print both.
  const stateOf = new Map<string, string>();
  const rows: VacancyTableRow[] = [];
  const statedTotals: VacancyTable["statedTotals"] = [];
  const parsed = usable.map((t, ti) => {
    const post = titleCase(t.title && !/^(table|annexure)\b/i.test(t.title) && !/vacanc/i.test(t.title) ? t.title : opts.fallbackPost);
    const own = t.dimensions.filter((d) => d.key !== "post");
    return { t, ti, post, own };
  });
  for (const { t, own } of parsed) {
    if (own[0]?.key === "state" && own.length > 1) {
      for (const r of t.rows) { const s = splitState(r.words); if (s?.rest) stateOf.set(s.rest.toLowerCase(), s.state); }
    }
  }
  for (const { t, ti, post, own } of parsed) {
    t.rows.forEach((r, ri) => {
      const at: Record<string, string> = { post };
      const postDim = t.dimensions.find((d) => d.key === "post");
      let words = r.words;
      if (postDim && !own.length) { at.post = titleCase(words); words = ""; }
      if (own[0]?.key === "state" && own.length > 1) {
        const s = splitState(words);
        if (s) { at.state = s.state; at[own[1].key] = s.rest; } else at[own[1].key] = words;
      } else if (own.length === 1 && own[0].key !== "state") {
        at[own[0].key] = words;
        if (extra.some((d) => d.key === "state")) at.state = stateOf.get(words.toLowerCase()) ?? "";
      } else if (own.length === 1) at.state = words;
      else if (own.length > 1) { const last = own[own.length - 1].key; at[last] = words; }
      for (const d of extra) if (!(d.key in at)) at[d.key] = "";
      const cells: Record<string, number> = {};
      let total: number | undefined;
      let nr = 0, blank = 0;
      t.columns!.forEach((c, ci) => {
        const v = r.figures[ci] ?? "";
        if (/^N\.?R\.?$/i.test(v)) { nr++; return; }
        if (/^(?:|-|–|—)$/.test(v)) { blank++; return; }
        const n = Number(v.replace(/,/g, ""));
        if (c.role === "total") total = n; else cells[c.key] = n;
      });
      const source = { retrievalId: opts.retrievalId, page: r.page, line: r.printed };
      const id = `t${ti + 1}r${ri + 1}`;
      if (nr > 0 && nr + blank === t.columns!.length) rows.push({ id, at, status: "NOT_REPORTED", cells: {}, source });
      else if (blank === t.columns!.length) rows.push({ id, at, status: "NO_FIGURE", cells: {}, source });
      else {
        const all = [...Object.values(cells), ...(total !== undefined ? [total] : [])];
        rows.push({ id, at, status: all.every((n) => n === 0) ? "NIL" : "STATED", ...(total !== undefined ? { total } : {}), cells, source });
      }
    });
    for (const tot of t.totals) {
      const ci = t.columns!.findIndex((c) => c.role === "total");
      const v = ci >= 0 ? tot.figures[ci] : tot.figures.length === 1 ? tot.figures[0] : undefined;
      if (!v || !/^\d[\d,]*$/.test(v)) continue;
      const grand = /^grand/i.test(tot.label) && usable.length === 1;
      const cells: Record<string, number> = {};
      t.columns!.forEach((c, i) => { if (c.role === "category" && /^\d[\d,]*$/.test(tot.figures[i] ?? "")) cells[c.key] = Number(tot.figures[i].replace(/,/g, "")); });
      statedTotals.push({ at: grand ? {} : { post }, total: Number(v.replace(/,/g, "")), ...(Object.keys(cells).length ? { cells } : {}),
        source: { retrievalId: opts.retrievalId, page: tot.page, line: tot.printed } });
    }
  }
  void rowsHavePost;
  return { table: { dimensions, categories, rows, statedTotals }, coverage };
}

/** Everything above for one document's text: tables found, columns understood (AI only if needed), one table. */
export async function readVacancyTables(text: string, opts: { retrievalId: string | null; fallbackPost: string; apiKey: string | undefined; fetchFn?: typeof fetch }): Promise<{ table: VacancyTable | null; coverage: CoverageReport }> {
  const lines = linesWithPages(text);
  const found = findVacancyTables(lines);
  for (const t of found) {
    if (!t.columns) {
      t.columns = await columnsByAi(t, opts);
      if (t.columns) t.columnsBy = "AI";
    }
  }
  const pages = lines.reduce((m, l) => Math.max(m, l.page ?? 0), 0) || null;
  const { table, coverage } = buildVacancyTable(found, opts);
  return { table, coverage: { pages, ...coverage } };
}

// ─── A table from a reading's quoted category split (no table printed) ──

/**
 * An article or a short notice gives one post's category split as lines
 * ("Unreserved (UR) 41 …"), not as a table code can read. The whole-text
 * reading then quotes each figure; that split becomes a one-dimension table
 * with the quote as each row's evidence. Only when some row has a split.
 */
export function tableFromSplit(rows: Array<{ post: string; count: number; breakdown?: Record<string, unknown> }>, total: number | null,
  quoted: { retrievalId: string | null; page: number | null; line: string }, text?: string): VacancyTable | null {
  if (!rows.some((r) => r.breakdown && Object.keys(r.breakdown).length > 0)) return null;
  // The evidence: the document's own lines from the quote on, up to where every
  // figure of the split has appeared; the quote alone when that block is not found.
  const blockFor = (figs: number[]): string => {
    if (!text) return quoted.line;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
    const start = Math.max(0, lines.findIndex((l) => quoted.line && norm(l).includes(norm(quoted.line).slice(0, 40))));
    const need = new Set(figs.map(String));
    for (let end = start; end < Math.min(lines.length, start + 40); end++) {
      for (const n of lines[end].replace(/(\d),(\d)/g, "$1$2").match(/\d+/g) ?? []) need.delete(n);
      if (need.size === 0) return lines.slice(start, end + 1).join("\n");
    }
    return quoted.line;
  };
  const source = quoted;
  const LABELS: Record<string, string> = { ur: "UR", ews: "EWS", obc: "OBC", sc: "SC", st: "ST", women: "Women", exsm: "Ex-Servicemen" };
  const categories: VacancyCategory[] = [];
  const tableRows: VacancyTableRow[] = rows.map((r, i) => {
    const cells: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.breakdown ?? {})) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) continue;
      if (!categories.some((c) => c.key === k)) categories.push({ key: k, label: LABELS[k] ?? k, kind: initialCategoryKind(k) });
      cells[k] = v;
    }
    const line = blockFor([r.count, ...Object.values(cells)]);
    return { id: `s${i + 1}`, at: { post: r.post }, status: r.count === 0 ? "NIL" : "STATED", total: r.count, cells, source: { ...source, line } };
  });
  const sum = tableRows.reduce((s, r) => s + (r.total ?? 0), 0);
  return {
    dimensions: [{ key: "post", label: "Post" }], categories, rows: tableRows,
    statedTotals: total !== null && total !== sum ? [{ at: {}, total, source }] : [],
  };
}

// ─── Into the table a job already has ─────────────────────

export interface TableDiff {
  added: VacancyTableRow[];
  changed: Array<{ before: VacancyTableRow; after: VacancyTableRow }>;
  /** Rows of a post the new document's table gives in full that it no longer lists. */
  removed: VacancyTableRow[];
  same: number;
  /** Posts in the job's table the new document does not give, left as they are. */
  untouchedPosts: string[];
}

const rowKey = (r: VacancyTableRow, dims: VacancyDimension[]) => dims.map((d) => (r.at[d.key] ?? "").replace(/\s+/g, " ").trim().toUpperCase()).join(" | ");
const figures = (r: VacancyTableRow) => JSON.stringify([r.status, r.total ?? null, Object.entries(r.cells).sort()]);

/**
 * The job's table with the new document's rows brought in, matched by every
 * dimension (post, state, bank…), never by page. A notice replaces the posts
 * whose tables it gives; a corrigendum (`updateOnly`) changes or adds the
 * rows it prints and removes nothing. Posts the document does not give are
 * kept as they are. Nothing here decides what is saved: the result is offered.
 */
export function mergeTables(existing: VacancyTable | null, incoming: VacancyTable, updateOnly: boolean): { table: VacancyTable; diff: TableDiff; problems: string[] } {
  if (!existing) return { table: incoming, diff: { added: incoming.rows, changed: [], removed: [], same: 0, untouchedPosts: [] }, problems: [] };
  const problems: string[] = [];
  const sameDims = existing.dimensions.map((d) => d.key).join("|") === incoming.dimensions.map((d) => d.key).join("|");
  const dims = sameDims ? incoming.dimensions : incoming.dimensions;
  if (!sameDims) problems.push(`The job's table is split by ${existing.dimensions.map((d) => d.label).join(" › ")}; this document by ${incoming.dimensions.map((d) => d.label).join(" › ")}. Its posts are replaced as a whole.`);
  const incomingPosts = new Set(incoming.rows.map((r) => r.at.post));
  const keep = existing.rows.filter((r) => !incomingPosts.has(r.at.post));
  const byKey = new Map(existing.rows.filter((r) => incomingPosts.has(r.at.post)).map((r) => [rowKey(r, dims), r]));
  const used = new Set(existing.rows.map((r) => r.id));
  const diff: TableDiff = { added: [], changed: [], removed: [], same: 0, untouchedPosts: [...new Set(keep.map((r) => r.at.post))] };
  const merged: VacancyTableRow[] = [];
  const matched = new Set<string>();
  for (const r of incoming.rows) {
    const had = sameDims ? byKey.get(rowKey(r, dims)) : undefined;
    if (had) {
      matched.add(had.id);
      if (figures(had) === figures(r)) { diff.same++; merged.push({ ...r, id: had.id }); }
      else { const after = { ...r, id: had.id }; diff.changed.push({ before: had, after }); merged.push(after); }
    } else {
      let id = r.id;
      for (let n = 2; used.has(id); n++) id = `${r.id}-${n}`;
      used.add(id);
      const row = { ...r, id };
      diff.added.push(row);
      merged.push(row);
    }
  }
  for (const r of existing.rows.filter((x) => incomingPosts.has(x.at.post) && !matched.has(x.id))) {
    if (updateOnly) merged.push(r); // a corrigendum removes nothing
    else diff.removed.push(r);
  }
  const categories = [...existing.categories];
  for (const c of incoming.categories) if (!categories.some((x) => x.key === c.key)) categories.push(c);
  const statedTotals = [
    ...existing.statedTotals.filter((s) => !incoming.statedTotals.some((n) => JSON.stringify(n.at) === JSON.stringify(s.at))),
    ...incoming.statedTotals,
  ];
  // Posts stay in the job's order; a post new to the job follows, in the document's order.
  const postOrder = [...new Set([...existing.rows, ...incoming.rows].map((r) => r.at.post))];
  const rows = [...keep, ...merged].map((r, i) => ({ r, i })).sort((a, b) => postOrder.indexOf(a.r.at.post) - postOrder.indexOf(b.r.at.post) || a.i - b.i).map((x) => x.r);
  return { table: { dimensions: sameDims ? existing.dimensions : incoming.dimensions, categories, rows, statedTotals }, diff, problems };
}
