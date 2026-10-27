// ═══════════════════════════════════════════════════════════
// Finding a notice's passages by what they contain
// ═══════════════════════════════════════════════════════════
//
// Notices name the same part in many ways: IBPS calls its exam pattern
// "Online Examination Structure", others "Scheme of Examination", "Plan of
// Examination" or nothing at all above a table. Looking for heading words
// misses the ones nobody listed. Here a passage is recognised by its
// content: an exam pattern by its rows of questions, marks and duration; an
// age limit by ages in years beside age words.
//
// Pure code, no AI. Every passage is a slice of the text as given (so quotes
// taken from it are verbatim, and page markers stay inside it), cut at line
// boundaries.

export interface Passage {
  /** Character offsets in the text. */
  start: number;
  end: number;
  /** How strongly it looks like what was asked for (more lines that fit). */
  score: number;
}

interface Line { text: string; start: number; end: number }

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const t of text.split("\n")) {
    out.push({ text: t, start: at, end: at + t.length });
    at += t.length + 1;
  }
  return out;
}

// ─── Exam pattern ─────────────────────────────────────────

const DURATION = String.raw`\d+(?:\.\d+)?\s*(?:minutes?|mins?\.?|hours?|hrs?\.?)`;
/** A row of a pattern table: figures and a duration ("1 Reasoning * 40 40 25 minutes", "Total 200 200 120 minutes"). */
const PATTERN_ROW_RE = new RegExp(String.raw`(?:\b\d{1,4}\b[^\n]*){2,}${DURATION}|${DURATION}[^\n]*(?:\b\d{1,4}\b[^\n]*){2,}`, "i");
/** Words, then at least two separate figures. */
const FIGURE_ROW_RE = /[A-Za-z]{3,}.*?\b\d{1,4}\b.*?\b\d{1,4}\b/;
const DATE_RE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;
/** A pattern's own title line ("Single level Examination (objective)", "Tier-I", "Paper II"), taken in when it is a little above the table. */
const PATTERN_TITLE_RE = /^\s*(?:[A-Z]\.\s*|\d+\.\s*)?[^.\n]{0,60}\b(?:examination|exam|tier|paper|stage|phase|test)\b[^.\n]{0,40}$/i;
/** Words of a pattern table's heading: three kinds within a few lines make a heading. */
const PATTERN_HEAD_WORDS: RegExp[] = [/\bquestions?\b|\bq(?:s|ns)\.?(?:\s|$)/i, /\bmarks?\b|\bmaximu\s*m\b/i, /\bduration\b|\btime\s+(?:allowed|allotted)\b|\btime\b/i, /\b(?:name\s+of\s+(?:the\s+)?tests?|subjects?|papers?|sections?|tests?)\b/i];

/**
 * Passages that hold an exam pattern table, in document order. A passage
 * needs two rows with figures and a duration, or a heading with one row.
 * A lone line such as "compensatory time of 20 minutes per hour" is not one.
 */
export function findPatternPassages(text: string, opts: { before?: number; after?: number; gap?: number } = {}): Passage[] {
  const lines = linesOf(text);
  const row = lines.map((l) => PATTERN_ROW_RE.test(l.text) && !/\bper\s+hour\b/i.test(l.text));
  // A heading line starts a few lines that name at least three of: questions, marks, duration, tests.
  const head = lines.map((l, i) => PATTERN_HEAD_WORDS.some((re) => re.test(l.text))
    && PATTERN_HEAD_WORDS.filter((re) => re.test(lines.slice(i, i + 8).map((x) => x.text).join(" "))).length >= 3);
  // Under such a heading, a line of words and two or more figures is a row even
  // without a duration ("General English 25 25", "Paper 1 General Studies 25 25").
  for (let i = 0; i < lines.length; i++) {
    if (!row[i] && FIGURE_ROW_RE.test(lines[i].text) && !DATE_RE.test(lines[i].text) && head.slice(Math.max(0, i - 12), i).some(Boolean)) row[i] = true;
  }
  return clusters(lines, (i) => row[i] || head[i], (from, to) => {
    let rows = 0, heads = 0;
    for (let i = from; i <= to; i++) { if (row[i]) rows++; if (head[i]) heads++; }
    return rows >= 2 || (rows >= 1 && heads >= 1) ? rows + (heads > 0 ? 2 : 0) : 0;
  }, { before: opts.before ?? 5, after: opts.after ?? 3, gap: opts.gap ?? 14, title: PATTERN_TITLE_RE });
}

// ─── Age limit ────────────────────────────────────────────

const YEARS = String.raw`\b\d{2}\s*(?:years?|yrs\.?)\b`;
/** An age stated in years beside an age word, or a date of birth range. */
const AGE_LINE_RE = new RegExp(String.raw`\bage\b[^\n]*${YEARS}|${YEARS}[^\n]*\bage\b|\bbetween\s+\d{2}\s*(?:years?|yrs\.?)?\s+and\s+\d{2}\s*(?:years?|yrs\.?)|\b(?:minimum|maximum|upper|lower)\b[^\n]*${YEARS}|\bborn\s+(?:not\s+)?(?:earlier|later|before|after|between|on\s+or)\b|\brelaxation\b[^\n]*${YEARS}|\bage\s*\(\s*as\s+on\b|\bage\s+limit\b`, "i");
const YEARS_RE = new RegExp(YEARS, "i");
/** A form's blank ("Age ____ years") is not an age limit. */
const AGE_BLANK_RE = /_{3,}/;

/** Passages that state an age limit or its relaxations, in document order. */
export function findAgePassages(text: string): Passage[] {
  const lines = linesOf(text);
  // PDF text wraps table cells ("Between 18 years" / "and 28 years"), so each line is read with the next.
  const joined = (i: number) => `${lines[i].text} ${lines[i + 1]?.text ?? ""}`;
  const hit = lines.map((l, i) => AGE_LINE_RE.test(joined(i)) && !AGE_BLANK_RE.test(l.text));
  const years = lines.map((l) => YEARS_RE.test(l.text) && !AGE_BLANK_RE.test(l.text));
  // An age in years counts when an age line is close above it: the rows of an age table.
  const near = (i: number) => hit.slice(Math.max(0, i - 12), i + 1).some(Boolean);
  return clusters(lines, (i) => hit[i] || (years[i] && near(i)), (from, to) => {
    let n = 0, y = 0;
    for (let i = from; i <= to; i++) { if (hit[i]) n++; if (years[i]) y++; }
    return n >= 1 && y >= 1 ? n + y : 0;
  }, { before: 2, after: 3, gap: 10 });
}

// ─── Shared ───────────────────────────────────────────────

/** Groups the signal lines that lie within `gap` lines of each other; keeps the groups `score` approves, with context. */
function clusters(lines: Line[], signal: (i: number) => boolean, score: (from: number, to: number) => number, o: { before: number; after: number; gap: number; title?: RegExp }): Passage[] {
  const out: Passage[] = [];
  let from = -1, to = -1;
  const close = () => {
    if (from < 0) return;
    const s = score(from, to);
    if (s > 0) {
      let first = Math.max(0, from - o.before);
      // The passage's own title, a little further up, is part of it.
      if (o.title) for (let i = first - 1; i >= Math.max(0, from - 15); i--) if (o.title.test(lines[i].text)) { first = i; break; }
      const a = lines[first];
      const b = lines[Math.min(lines.length - 1, to + o.after)];
      out.push({ start: a.start, end: b.end, score: s });
    }
    from = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    if (!signal(i)) continue;
    if (from >= 0 && i - to > o.gap) close();
    if (from < 0) from = i;
    to = i;
  }
  close();
  return out;
}

/**
 * Cuts passages into pieces of at most `max` characters at line ends, so a
 * long pattern (IBPS's runs over four pages) is sent whole, in parts.
 */
export function piecesOf(text: string, passages: Passage[], max: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const p of passages) {
    let at = p.start;
    while (at < p.end) {
      let end = Math.min(p.end, at + max);
      if (end < p.end) {
        const nl = text.lastIndexOf("\n", end);
        if (nl > at + max / 2) end = nl;
      }
      out.push({ start: at, end });
      at = end;
    }
  }
  return out;
}

/** True when two character ranges overlap. */
export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
