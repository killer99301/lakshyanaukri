// ═══════════════════════════════════════════════════════════
// Smart intake: reading a notice's vacancy tables
// ═══════════════════════════════════════════════════════════
//
// Server only (the AI fallback). Finds every vacancy table in a document's
// text, reads every row by code, and builds one vacancy table (src/lib/
// vacancy-table.ts) with each row's page and printed line kept as evidence.
//
// How a table is found: a heading with vacancy words (SC, ST, OBC, EWS,
// General, Total, Vacancies, Posts…) followed by rows that end in the same
// number of figures. The heading is the nearest line above that is a vacancy
// heading whose words fit the figures: a fee, age or marks line naming
// categories further up is passed over. Three rows or more make a table; one
// or two only when the heading names a column for every figure, with
// reservation categories and a Total or "vacancies", and nothing of fees,
// ages, marks or dates. A table of any size whose heading or rows speak of
// fees, ages, marks or dates is another kind of table. A row is a serial
// number (when the table has them) and words, possibly wrapped over several
// lines, then its figures; "NR" is not reported, "-" or a missing figure is
// no figure.
//
// How columns are understood: the heading words are matched by code, in
// printed order (SC ST OBC (NCL) EWS GENERAL TOTAL … HI OC VI ID ESM DESM).
// Only when that does not give exactly one column per figure is the AI
// asked, and its answer must quote the heading. Columns the heading puts
// under "out of which" are counted within the others; any other column's
// place is left for the printed totals to settle (vacancy-table.ts).
//
// Nothing is guessed: a table whose columns are not understood is reported
// as not read, never filled in, and so is a short table under a vacancy
// heading that cannot be taken. The coverage report says which pages held
// tables, which tables were read, and every line in a table that was not;
// while anything is not read, no row of the job is offered for removal.

import { callAiJson } from "@/lib/cms/ai-assist";
import { foundTablesFromTranscription, type TranscribedPage } from "@/lib/cms/importer/scan-tables";
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
/** Words of the other tables a notice prints across categories: fees, ages, relaxations, marks, dates. */
const OTHER_TABLE = /\b(?:fees?|amount|rs\.?|salary|pay\s+(?:level|scale|band)|age|ages|years?|relaxation|marks|qualifying|cut[- ]?off|percent(?:age)?|duration|minutes|questions?|dates?)\b|₹|%/i;

/** Trailing figure tokens of a line, and the words before them. */
function splitFigures(text: string): { words: string; figures: string[] } {
  const tokens = text.split(" ");
  const figures: string[] = [];
  while (tokens.length > 0 && FIGURE.test(tokens[tokens.length - 1])) figures.unshift(tokens.pop()!);
  return { words: tokens.join(" "), figures };
}

export interface ColumnSpec {
  key: string; label: string; role: "category" | "total"; partOf?: string;
  /** How the column counts, when the table itself establishes it (a transcribed table whose printed subtotals add it up). */
  kind?: "VERTICAL" | "HORIZONTAL"; established?: { by: "SOURCE"; note: string };
}

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

/**
 * Whether a table's heading names a column of post names ("Name of Post", "Post Name", "Designation", "Cadre",
 * or "Post" as its first column), not only a count of posts ("No. of Posts", "Number of Posts", "Total Posts").
 * The post dimension's label is always "Post", so it is the heading's own words that say which.
 */
export function namesPostColumn(heading: string): boolean {
  if (/\bNAME\s+OF\s+(?:THE\s+)?POSTS?\b|\bPOST\s*NAMES?\b|\bDESIGNATIONS?\b|\bCADRES?\b/i.test(heading)) return true;
  const columns = heading.replace(/^\s*(?:sr\.?|sl\.?|s\.?)\s*no\.?\s*/i, "");
  return /^posts?\b/i.test(columns) && !/^posts?\s*(?:total|count)?\s*$/i.test(columns);
}

/**
 * Why a table with a post column cannot be read row by row, or null when it can (or has no post column). The
 * post is never taken from the title or the job instead: a row whose post cannot be read holds the whole table.
 */
function postColumnProblem(t: { dimensions: VacancyDimension[]; rows: Array<{ words: string; dimCells?: Record<string, string> }> }): string | null {
  const at = t.dimensions.findIndex((d) => d.key === "post");
  if (at < 0) return null;
  const others = t.dimensions.filter((d) => d.key !== "post");
  const rows = t.rows.filter((r) => !r.dimCells); // a transcribed row has its own cells
  if (rows.some((r) => !r.words.trim())) return "a row has no post name in the post column";
  if (others.length === 0) return null;
  if (others.length === 1 && others[0].key === "state") {
    const stuck = rows.find((r) => !splitPostState(r.words, at === 0));
    return stuck ? `the post and the state cannot be told apart in “${stuck.words}”` : null;
  }
  return `each row's post and ${others.map((d) => d.label.toLowerCase()).join(" and ")} run together in one name (“${rows[0]?.words ?? ""}”), and cannot be told apart`;
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

/**
 * A row of a table with a post and a state column, "Clerk Bihar" or "Bihar Clerk": the post and the state, when
 * exactly one state starts or ends the words and a post is left; null when they cannot be told apart.
 */
export function splitPostState(words: string, postFirst: boolean): { post: string; state: string } | null {
  const lower = words.toLowerCase();
  if (postFirst) {
    const s = STATES.find((x) => lower.endsWith(` ${x.toLowerCase()}`));
    const post = s ? words.slice(0, words.length - s.length).trim() : "";
    return s && post ? { post, state: words.slice(words.length - s.length) } : null;
  }
  const s = splitState(words);
  return s && s.rest ? { post: s.rest, state: s.state } : null;
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
  rows: Array<{ serial: number | null; words: string; figures: string[]; page: number | null; printed: string;
    /** A transcribed table's dimension cells by dimension key, as printed (no splitting of words needed). */
    dimCells?: Record<string, string>;
    /** How this row was read, when it differs from its table (a table that runs from a text page onto a scanned one). */
    readBy?: "AI_IMAGE" | "TEXT" }>;
  /** Written out by the AI from scanned page images (stage B2.4), not read from text. */
  readBy?: "AI_IMAGE";
  /** "Total" / "Grand Total" lines. */
  totals: Array<{ label: string; figures: string[]; page: number | null; printed: string; readBy?: "AI_IMAGE" | "TEXT" }>;
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
/** A line saying the table goes on from the page before ("Annexure I (continued)", "Table 2 contd."), with no figures. */
const CONTINUED = /\b(?:continued|contd\.?)(?=\W|$)/i;
const isContinuationLine = (t: string) => CONTINUED.test(t) && splitFigures(t).figures.length === 0 && t.length <= 120;
const sameLine = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
const looksLikeTitle = (t: string) => !NOISE.test(t) && splitFigures(t).figures.length === 0 && t.length <= 120 && /[A-Za-z]/.test(t);

/**
 * Rows of figures at the top of a page, before any other text on it: a table
 * continuing from the page before without its heading. Wrapped names (up to
 * two lines) are joined to the row they belong to, as in a table.
 */
function orphanRun(lines: Line[], data: number[], i: number): { orphan: Orphan; next: number } | null {
  const page = lines[i].page;
  for (let b = i - 1; b >= 0 && lines[b].page === page; b--) if (!NOISE.test(lines[b].text) && data[b] === 0 && !/^\d{1,3}$/.test(lines[b].text)) {
    // Wrapped words of the first row are allowed just above it.
    if (i - b > 2) return null;
  }
  const k = data[i];
  const rows: Orphan["rows"] = [];
  const totals: Orphan["totals"] = [];
  const used: Line[] = [];
  let pending: Line[] = [];
  let start = i;
  while (start - 1 >= 0 && lines[start - 1].page === page && data[start - 1] === 0 && !NOISE.test(lines[start - 1].text) && i - (start - 1) <= 2) start--;
  pending = lines.slice(start, i);
  let j = i;
  while (j < lines.length) {
    const l = lines[j];
    if (data[j] === k) {
      const { words, figures } = splitFigures(l.text);
      const all = [...pending.map((p) => p.text), words].join(" ").trim();
      const printed = [...pending.map((p) => p.text), l.text].join("\n");
      const serialM = /^(\d{1,4})\.?\s+(.*)$/.exec(all);
      if (/^(grand\s+)?total\b/i.test(serialM ? serialM[2] : all)) totals.push({ label: all, figures, page: l.page, printed });
      else rows.push({ serial: serialM ? Number(serialM[1]) : null, words: serialM ? serialM[2] : all, figures, page: pending[0]?.page ?? l.page, printed });
      used.push(...pending, l);
      pending = [];
      j++;
      continue;
    }
    if (NOISE.test(l.text)) { j++; continue; }
    if (data[j] === 0 && !isHeadingLine(l.text) && pending.length < 2 && data.slice(j + 1, j + 3).includes(k)) { pending.push(l); j++; continue; }
    break;
  }
  if (rows.length === 0 && totals.length === 0) return null;
  return { orphan: { page, figureCount: k, rows, totals, lines: used }, next: j };
}

export interface Orphan {
  page: number | null;
  figureCount: number;
  rows: FoundTable["rows"];
  totals: FoundTable["totals"];
  lines: Line[];
}

/** A short table under a vacancy heading that could not be taken: reported as not read, never filled in. */
export interface Suspected {
  title: string;
  heading: string;
  pages: number[];
  rows: number;
  why: string;
  lines: Line[];
}

/**
 * Every vacancy table in the lines. Pure: the columns of a table whose
 * heading code cannot match are left null for the caller to ask about.
 * With `out.orphans`, rows at the top of a page with no heading above them
 * (a table continuing from the page before) are collected there, to be
 * joined to that table or reported; otherwise they are passed over. With
 * `out.suspected`, a short table under a vacancy heading that cannot be taken
 * is collected there, to be reported as not read.
 */
export function findVacancyTables(lines: Line[], out?: { orphans: Orphan[]; suspected?: Suspected[] }): FoundTable[] {
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
    const isCandidate = (l: Line) => columnWordCount(l.text) >= 2 || SERIAL_HEADING.test(l.text);
    let firstColumnLine = headingLines.findIndex(isCandidate);
    if (firstColumnLine < 0) {
      const run = out ? orphanRun(lines, data, i) : null;
      if (run) { out!.orphans.push(run.orphan); i = run.next; continue; }
      i++;
      continue;
    }
    // The heading continues until the first row: a line starting with a serial
    // number. A wrapped heading word ("Vacancies", "(NCL", "HI OC VI ID") stays in it.
    const extend = (from: number) => {
      let last = from;
      for (let j = from + 1; j < headingLines.length; j++) {
        const t = headingLines[j].text;
        if (/^\d{1,4}\.?\s/.test(t)) break;
        if (COLUMN_LINE.test(t) || OUT_OF_WHICH.test(t) || HEADING_ONLY.test(t) || /^\(?vacanc\w*\)?$|^posts?$/i.test(t) || /^[()*.,\s-]+$/.test(t)) last = j;
        else break;
      }
      return last;
    };
    // A vacancy table names categories or vacancies; marks, fees or ages are other tables.
    const isVacancyHeading = (from: number, last: number) => {
      const hd = headingLines.slice(from, last + 1).map((l) => l.text).join(" ");
      const ctx = headingLines.slice(0, last + 1).map((l) => l.text).join(" ");
      return /\b(sc|st|obc|ews|vacanc\w*|posts?)\b/i.test(ctx) && !(NOT_VACANCIES.test(hd) && !/vacanc|\bposts?\b/i.test(hd));
    };
    const fitsFigures = (from: number, last: number) => columnsFromHeading(headingLines.slice(from, last + 1).map((l) => l.text).join(" "), k) !== null;
    let lastColumnLine = extend(firstColumnLine);
    // A line further up that only looks like a heading (a fee, age or marks line naming categories) is not this
    // table's heading: the next candidate below it is tried before the table is given up.
    while (!isVacancyHeading(firstColumnLine, lastColumnLine)) {
      const next = headingLines.findIndex((l, x) => x > lastColumnLine && isCandidate(l));
      if (next < 0) break;
      firstColumnLine = next;
      lastColumnLine = extend(next);
    }
    if (!isVacancyHeading(firstColumnLine, lastColumnLine)) { i++; continue; }
    // A heading whose words cannot be matched to the figures (a sentence naming SC, ST, OBC above the table)
    // gives way to a later candidate whose words can.
    if (!fitsFigures(firstColumnLine, lastColumnLine)) {
      for (let x = lastColumnLine + 1; x < headingLines.length; x++) {
        if (!isCandidate(headingLines[x])) continue;
        const last = extend(x);
        if (isVacancyHeading(x, last) && fitsFigures(x, last)) { firstColumnLine = x; lastColumnLine = last; break; }
      }
    }
    const headingPart = headingLines.slice(firstColumnLine, lastColumnLine + 1);
    const heading = headingPart.map((l) => l.text).join(" ");
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
    let lastPage: number | null = null;
    while (j < lines.length) {
      const l = lines[j];
      if (data[j] === k) {
        lastPage = l.page;
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
      // On a later page, the table's own column heading printed again, and a "(continued)" line, are not a
      // row's wrapped name: passed over, so the next row keeps its own name and printed line.
      if (lastPage != null && l.page != null && l.page > lastPage
          && (isContinuationLine(l.text) || headingPart.some((x) => sameLine(x.text, l.text)))) { j++; continue; }
      gap++;
      if (gap > 4) break;
      pending.push(l);
      j++;
    }
    // Words left over after the last row are not part of the table.
    const columns = columnsFromHeading(heading, k);
    const namesVacancies = /\bvacanc\w*|\bposts?\b/i.test(heading);
    const otherRows = rows.filter((r) => OTHER_TABLE.test(r.words)).length;
    // Fees, ages, relaxations, marks or dates across categories are another kind of table: said by the heading
    // (unless it names vacancies or posts: "Name of Post Pay Level UR SC ST Total"), or by half the rows or more.
    const otherTable = (OTHER_TABLE.test(heading) && !namesVacancies) || (rows.length > 0 && otherRows * 2 >= rows.length);
    // One or two rows make a table only on the heading's own evidence: a column for every figure, matched by
    // code, two reservation categories or more, a Total column or "vacancies"/"posts" in the title or heading,
    // and no word of fees, ages, marks or dates in the title, the heading or the rows ("Fee by category" over
    // "Category SC ST OBC EWS Total" is a fee table).
    const categories = (columns ?? []).filter((c) => ["sc", "st", "obc", "ews", "ur"].includes(c.key)).length;
    const vacancyNamed = /\btotal\b|\bvacanc\w*|\bposts?\b/i.test(`${title} ${heading}`);
    const shortTable = rows.length >= 1 && rows.length < 3 && !!columns && categories >= 2 && vacancyNamed
      && !OTHER_TABLE.test(`${title} ${heading}`) && otherRows === 0;
    if ((rows.length >= 3 && !otherTable) || shortTable) {
      // The post is a dimension of its own only where the heading names a column of post names; a "No. of Posts"
      // column is a count. (Before, the post was always left out, so every post-wise row took the table's title.)
      const dims = dimensionsFromHeading(heading).filter((d) => d.key !== "post" || namesPostColumn(heading));
      tables.push({
        title, heading, headingPage: headingPart[0]?.page ?? null,
        pages: [...new Set([...rows.map((r) => r.page), ...totals.map((t) => t.page)].filter((p): p is number => p != null))],
        figureCount: k, columns, dimensions: dims, rows, totals, unread,
      });
      i = j;
    } else {
      // A short table under a vacancy heading that cannot be taken is said, never passed over in silence: only
      // where its heading names reservation categories and a total or vacancies, and nothing in it, its heading
      // or its title speaks of fees, ages, marks or dates. Those are other tables, and say nothing.
      const categoryWords = new Set([...heading.matchAll(/\b(sc|st|obc|ews|ur|general|unreserved)\b/gi)].map((m) => m[1].toLowerCase())).size;
      if (out?.suspected && rows.length >= 1 && rows.length < 3 && categoryWords >= 2 && vacancyNamed
          && !OTHER_TABLE.test(`${title} ${heading}`) && otherRows === 0) {
        out.suspected.push({
          title, heading,
          pages: [...new Set(rows.map((r) => r.page).filter((p): p is number => p != null))],
          rows: rows.length,
          why: columns
            ? "its heading names fewer than two reservation categories"
            : `its ${k} figures per row could not be matched to the heading's columns by code`,
          lines: rows.map((r) => ({ page: r.page, text: r.printed.replace(/\n/g, " ") })),
        });
      }
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
  tables: Array<{ title: string; pages: number[]; rows: number; read: boolean; why?: string; columnsBy?: "CODE" | "AI"; columns?: string[]; readBy?: "AI_IMAGE" }>;
  unreadLines: Array<{ page: number | null; text: string }>;
  /** What did not fit and was said rather than guessed: rows repeated at a page break, rows continuing no table read, subtotals that disagree. */
  problems?: string[];
}

const titleCase = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s)
  ? s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Ii|Iii|Iv|Vi|Vii)\b/g, (r) => r.toUpperCase()).replace(/\bOf\b/g, "of").replace(/\bAnd\b/g, "and")
  : s);

/**
 * One vacancy table from the tables found. Rows keep their page and printed
 * lines; `post` names a table's post when its rows do not (the table's
 * title, or `fallbackPost` for a heading like "Table E"). A dimension the
 * notice gives in one table and not in another (a bank's state) is filled
 * from the tables that do give it, never invented. A table whose heading
 * names a post column takes each row's post from the row; where that cannot
 * be read safely the table is not read (and said), never given the title.
 */
export function buildVacancyTable(found: FoundTable[], opts: { retrievalId: string | null; fallbackPost: string; /** Page → spellings the model suggested for printed names on scanned pages (B2.6). */ spelling?: Map<number, Array<{ printed: string; suggested: string }>> }): { table: VacancyTable | null; coverage: Omit<CoverageReport, "pages"> } {
  const coverage: Omit<CoverageReport, "pages"> = { tables: [], unreadLines: [] };
  const held = new Map(found.map((t) => [t, t.columns ? postColumnProblem(t) : null]));
  const usable = found.filter((t) => t.columns && !held.get(t));
  for (const t of found) {
    const why = held.get(t);
    coverage.tables.push({ title: t.title || "(untitled table)", pages: t.pages, rows: t.rows.length, read: !!t.columns && !why, ...(t.readBy ? { readBy: t.readBy } : {}),
      ...(t.columns ? { columnsBy: t.columnsBy ?? "CODE", columns: t.columns.map((c) => c.label) } : {}),
      ...(why ? { why } : t.columns ? {} : { why: `its ${t.figureCount} columns of figures could not be matched to the heading` }) });
    coverage.unreadLines.push(...t.unread.map((l) => ({ page: l.page, text: l.text })));
    // A held table's rows are lines not read: they hold removals, and the admin sees them.
    if (why) coverage.unreadLines.push(...t.rows.map((r) => ({ page: r.page, text: r.printed })));
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
      if (c.role !== "category") continue;
      const had = categories.find((x) => x.key === c.key);
      // The same column of another table in this notice, where that table establishes how it counts.
      if (had && had.kind === "UNDETERMINED" && c.kind && c.established) { had.kind = c.kind; had.established = c.established; continue; }
      if (had) continue;
      const overlapping = outOfWhich && (c.partOf === "pwbd" || c.key === "pwbd" || c.key === "esm" || c.key === "desm");
      categories.push({
        key: c.key, label: c.label, kind: c.kind ?? (overlapping ? "HORIZONTAL" : initialCategoryKind(c.key)),
        ...(c.partOf ? { partOf: c.partOf } : {}),
        ...(c.established ? { established: c.established }
          : overlapping ? { established: { by: "SOURCE" as const, note: `the table heading says “out of which”${t.headingPage != null ? ` (page ${t.headingPage})` : ""}` } } : {}),
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
      const suggested: Record<string, string> = {};
      const postDim = t.dimensions.find((d) => d.key === "post");
      let words = r.words;
      // A post and a state in the row ("Clerk Bihar"): told apart before this table was taken (postColumnProblem).
      const postAndState = !r.dimCells && postDim && own.length === 1 && own[0].key === "state" ? splitPostState(words, t.dimensions[0].key === "post") : null;
      if (r.dimCells) {
        // A transcribed row's cells are its dimensions, each as printed: no words to split.
        for (const [k, v] of Object.entries(r.dimCells)) at[k] = k === "post" ? titleCase(v) : v;
        // A spelling the model suggested for a printed name on this page: kept beside it, not used (B2.6).
        for (const [k, v] of Object.entries(r.dimCells)) {
          const fix = (opts.spelling?.get(r.page ?? -1) ?? []).find((c) => c.printed === v);
          if (fix) suggested[k] = k === "post" ? titleCase(fix.suggested) : fix.suggested;
        }
      } else if (postDim && !own.length) { at.post = titleCase(words); words = ""; }
      else if (postAndState) { at.post = titleCase(postAndState.post); at.state = postAndState.state; words = ""; }
      if (r.dimCells || postAndState) {
        // placed above
      } else if (own[0]?.key === "state" && own.length > 1) {
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
      const unclear: string[] = [];
      t.columns!.forEach((c, ci) => {
        const v = r.figures[ci] ?? "";
        // Printed, but not made out on the scanned page: never filled in.
        if (v === "[unclear]") { unclear.push(c.role === "total" ? "total" : c.key); return; }
        if (/^N\.?R\.?$/i.test(v)) { nr++; return; }
        if (/^(?:|-|–|—)$/.test(v)) { blank++; return; }
        const n = Number(v.replace(/,/g, ""));
        if (c.role === "total") total = n; else cells[c.key] = n;
      });
      const rb = r.readBy ?? t.readBy;
      const source = { retrievalId: opts.retrievalId, page: r.page, line: r.printed, ...(rb === "AI_IMAGE" ? { readBy: rb } : {}) };
      const id = `t${ti + 1}r${ri + 1}`;
      const marks = { ...(unclear.length ? { unclear } : {}), ...(Object.keys(suggested).length ? { suggested } : {}) };
      if (nr > 0 && nr + blank === t.columns!.length) rows.push({ id, at, status: "NOT_REPORTED", cells: {}, ...(Object.keys(suggested).length ? { suggested } : {}), source });
      else if (blank + unclear.length === t.columns!.length) rows.push({ id, at, status: "NO_FIGURE", cells: {}, ...marks, source });
      else {
        const all = [...Object.values(cells), ...(total !== undefined ? [total] : [])];
        // A row with an unreadable figure is never called nil, even if what was read is all zero.
        rows.push({ id, at, status: all.every((n) => n === 0) && !unclear.length ? "NIL" : "STATED", ...(total !== undefined ? { total } : {}), cells, ...marks, source });
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
        source: { retrievalId: opts.retrievalId, page: tot.page, line: tot.printed, ...((tot.readBy ?? t.readBy) === "AI_IMAGE" ? { readBy: "AI_IMAGE" as const } : {}) } });
    }
  }
  void rowsHavePost;
  return { table: { dimensions, categories, rows, statedTotals }, coverage };
}

/** Everything above for one document's text: tables found, columns understood (AI only if needed), one table. */
export async function readVacancyTables(text: string, opts: {
  retrievalId: string | null; fallbackPost: string; apiKey: string | undefined; fetchFn?: typeof fetch;
  /** Scanned pages: their text is the AI's write-up, so they are not read here; their tables come in `extraFound`. */
  skipPages?: number[];
  /** Tables transcribed from scanned page images (stage B2.4), already split into columns. */
  extraFound?: FoundTable[];
  /** Scanned pages as the AI wrote them out (stage B2.4): their tables are read here, and joined to text tables they continue (B2.5). */
  scanPages?: TranscribedPage[];
}): Promise<{ table: VacancyTable | null; coverage: CoverageReport }> {
  const all = linesWithPages(text);
  const skip = new Set([...(opts.skipPages ?? []), ...(opts.scanPages ?? []).map((p) => p.page)]);
  const lines = skip.size ? all.filter((l) => l.page === null || !skip.has(l.page)) : all;
  const orphans: Orphan[] = [];
  const suspected: Suspected[] = [];
  const problems: string[] = [];
  const unread: Line[] = [];
  const textTables = findVacancyTables(lines, { orphans, suspected });
  // A scanned page that continues a table from a text page joins that table (B2.5).
  let scanFound: FoundTable[] = [];
  if (opts.scanPages?.length) {
    const scan = foundTablesFromTranscription(opts.scanPages, {
      continueFrom: (page, width) => textTables.find((t) => lastPageOf(t) === page - 1 && t.columns && ownDims(t).length + t.figureCount === width) ?? null,
    });
    scanFound = scan.found;
    problems.push(...scan.problems);
    unread.push(...scan.unread);
  }
  // In page order, so a table that runs on from a text page onto a scanned one stays in order.
  const found = [...textTables, ...scanFound, ...(opts.extraFound ?? [])].sort((a, b) => (a.pages[0] ?? 0) - (b.pages[0] ?? 0));
  // Rows at the top of a text page with no heading: the table that ended on the page before, text or scanned (B2.5).
  for (const o of orphans) {
    const target = o.page == null ? null : found.find((t) => lastPageOf(t) === o.page! - 1 && t.figureCount === o.figureCount);
    if (!target) {
      // Said only where a table could have been continued: a table ended on the page before, or that page was
      // scanned (its table may have been missed). Elsewhere (an index, a numbered list) it is no table: passed over, as before.
      const before = o.page == null ? false : found.some((t) => lastPageOf(t) === o.page! - 1) || (opts.scanPages ?? []).some((p) => p.page === o.page! - 1);
      if (!before) continue;
      unread.push(...o.lines);
      const last = Math.max(...o.lines.map((l) => l.page ?? 0));
      problems.push(`page ${o.page ?? "?"}${last > (o.page ?? 0) ? `–${last}` : ""}: ${o.rows.length + o.totals.length} row(s) at the top of the page continue no table that was read; not read`);
      continue;
    }
    joinRows(target, o.rows.map((r) => ({ ...r, readBy: "TEXT" as const })), o.totals.map((t) => ({ ...t, readBy: "TEXT" as const })), o.page!, problems);
  }
  for (const t of found) {
    if (!t.columns) {
      t.columns = await columnsByAi(t, opts);
      if (t.columns) t.columnsBy = "AI";
    }
  }
  const pages = all.reduce((m, l) => Math.max(m, l.page ?? 0), 0) || null;
  const { table, coverage } = buildVacancyTable(found, { ...opts, spelling: new Map((opts.scanPages ?? []).map((p) => [p.page, p.corrections ?? []])) });
  // A short table under a vacancy heading that could not be taken: a table not read, with its lines. The
  // reading is then incomplete, so no row of the job is offered for removal on its account.
  for (const s of suspected) {
    coverage.tables.push({ title: s.title || "(untitled table)", pages: s.pages, rows: s.rows, read: false, why: s.why });
    unread.push(...s.lines);
  }
  coverage.unreadLines.push(...unread.map((l) => ({ page: l.page, text: l.text })));
  return { table, coverage: { pages, ...coverage, ...(problems.length ? { problems } : {}) } };
}

/** The last page a table has a row on. */
export const lastPageOf = (t: FoundTable) => Math.max(...t.rows.map((r) => r.page ?? 0), ...t.totals.map((r) => r.page ?? 0), ...t.pages);
/** A table's dimensions other than the post (named in its title). */
export const ownDims = (t: FoundTable) => t.dimensions.filter((d) => d.key !== "post" || !t.title);

/**
 * Rows that continue a table on the next page, added to it. A first row that
 * repeats the table's last row (printed again at the page break) counts once,
 * and is said.
 */
export function joinRows(target: FoundTable, rows: FoundTable["rows"], totals: FoundTable["totals"], page: number, problems: string[]): void {
  const key = (r: { words: string; figures: string[] }) => `${r.words.replace(/\s+/g, " ").trim().toLowerCase()}|${r.figures.join(" ")}`;
  const last = target.rows[target.rows.length - 1];
  let add = rows;
  if (last && add[0] && key(last) === key(add[0])) {
    problems.push(`page ${page}: the row "${add[0].words.slice(0, 60)}" is repeated from the foot of page ${last.page}; counted once`);
    add = add.slice(1);
  }
  target.rows.push(...add);
  target.totals.push(...totals);
  if (!target.pages.includes(page)) target.pages.push(page);
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
    // A quote over several lines ("Post Name …\nTotal Vacancies 105") is found by its first line: the text's lines are single.
    const head = norm(quoted.line.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "").slice(0, 40);
    const start = Math.max(0, lines.findIndex((l) => head && norm(l).includes(head)));
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
  /** The document's rows not brought in because its table is split differently (post-wise against
   * bank-wise): the job's rows stay as they are, and these are kept here to be checked by hand. */
  held: VacancyTableRow[];
}

const rowKey = (r: VacancyTableRow, dims: VacancyDimension[]) => dims.map((d) => (r.at[d.key] ?? "").replace(/\s+/g, " ").trim().toUpperCase()).join(" | ");
const figures = (r: VacancyTableRow) => JSON.stringify([r.status, r.total ?? null, Object.entries(r.cells).sort()]);

/**
 * The job's table with the new document's rows brought in, matched by every
 * dimension (post, state, bank…), never by page. A notice replaces the posts
 * whose tables it gives; a corrigendum (`updateOnly`) changes or adds the
 * rows it prints and removes nothing. Posts the document does not give are
 * kept as they are. A table split differently from the job's (post-wise
 * against bank-wise) changes nothing: no row can be matched, so the job's rows
 * are kept and the document's are held, to be checked by hand. Nothing here
 * decides what is saved: the result is offered.
 */
export function mergeTables(existing: VacancyTable | null, incoming: VacancyTable, updateOnly: boolean): { table: VacancyTable; diff: TableDiff; problems: string[] } {
  if (!existing) return { table: incoming, diff: { added: incoming.rows, changed: [], removed: [], same: 0, untouchedPosts: [], held: [] }, problems: [] };
  const problems: string[] = [];
  const sameDims = existing.dimensions.map((d) => d.key).join("|") === incoming.dimensions.map((d) => d.key).join("|");
  if (!sameDims) {
    const one = incoming.rows.length === 1;
    problems.push(`The job's table is split by ${existing.dimensions.map((d) => d.label).join(" › ")}; this document by ${incoming.dimensions.map((d) => d.label).join(" › ")}. The job's rows are kept as they are; this document's ${one ? "row is" : `${incoming.rows.length} rows are`} not brought in — check ${one ? "it" : "them"} by hand in the vacancy editor.`);
    return { table: existing, diff: { added: [], changed: [], removed: [], same: 0, untouchedPosts: [], held: incoming.rows }, problems };
  }
  const dims = incoming.dimensions;
  const incomingPosts = new Set(incoming.rows.map((r) => r.at.post));
  const keep = existing.rows.filter((r) => !incomingPosts.has(r.at.post));
  const byKey = new Map(existing.rows.filter((r) => incomingPosts.has(r.at.post)).map((r) => [rowKey(r, dims), r]));
  const used = new Set(existing.rows.map((r) => r.id));
  const diff: TableDiff = { added: [], changed: [], removed: [], same: 0, untouchedPosts: [...new Set(keep.map((r) => r.at.post))], held: [] };
  const merged: VacancyTableRow[] = [];
  const matched = new Set<string>();
  for (const r of incoming.rows) {
    const had = byKey.get(rowKey(r, dims));
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
    if (updateOnly) merged.push(r); // a corrigendum, or a table not read in full, removes nothing
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
  return { table: { dimensions: existing.dimensions, categories, rows, statedTotals }, diff, problems };
}
