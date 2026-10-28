// ═══════════════════════════════════════════════════════════
// Exam-pattern tables, read by code (after B2.5)
// ═══════════════════════════════════════════════════════════
//
// A notice prints each paper of its exam as a table: a header naming the
// tests or subjects, the number of questions and the marks (and often the
// medium and the duration), a row per test, and a total. Code finds every
// such table first, so the number of papers the notice prints is known
// before anything is read; then reads each table's rows as printed.
//
// Nothing is worked out: totals and durations are the printed ones, and a
// sum that disagrees with its printed total is said, never corrected. A
// table whose rows cannot be read is reported with its page, so the pattern
// is never shown as complete with a paper missing. The AI is used for a
// pattern only where the text has no such table (prose, or a scanned page
// it could not write out as a table).

import type { ExamPatternPaper, ExamPatternSection } from "@/types/recruitment-record";

interface Line { text: string; page: number | null }

export interface PatternTable {
  /** The paper's name from the headings above its table ("Preliminary Examination – Officer Scale-I"); null when none could be told. */
  heading: string | null;
  page: number | null;
  /** Read as printed; null when the rows could not be read. */
  paper: ExamPatternPaper | null;
  /** The first row's printed line, as evidence. */
  quote: string | null;
  why?: string;
  /** Printed totals the rows do not add up to: said, not corrected. */
  problems: string[];
}

export interface PatternCoverage {
  /** Tables the notice prints: one per paper. */
  expected: number;
  read: number;
  tables: Array<{ heading: string | null; page: number | null; read: boolean; why?: string }>;
  problems: string[];
}

const MARK = /^-- (\d+) of \d+ --$/;

function linesWithPages(text: string): Line[] {
  const raw = text.split(/\r?\n/);
  // Each "-- N of M --" mark ends page N.
  const ends: Array<{ at: number; page: number }> = [];
  raw.forEach((l, i) => { const m = MARK.exec(l.trim()); if (m) ends.push({ at: i, page: Number(m[1]) }); });
  let k = 0;
  return raw.flatMap((l, i) => {
    while (k < ends.length && ends[k].at < i) k++;
    const page = ends.length === 0 ? null : k < ends.length ? ends[k].page : ends[ends.length - 1].page + 1;
    const t = l.replace(/\t+/g, "  ").replace(/\s+$/, "");
    return t.trim() && !MARK.test(t.trim()) ? [{ text: t.trim(), page }] : [];
  });
}

// Words a pattern table's header is made of, and nothing else.
const HEADER_WORD = /^(?:sr|s|sl|no|name|of|the|tests?|subjects?|sections?|papers?|parts?|medium|exam|examination|number|qs?|questions?|maximum|maximu|m|max|marks?|duration|time|allotted|allowed|minutes|mins?|in|version|tier|session|sl\.no|s\.no|sr\.no|&|\/|-)$/i;
const isHeaderLine = (t: string) => {
  const words = t.toLowerCase().replace(/[.:()|]/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => HEADER_WORD.test(w));
};
const headerComplete = (h: string) => /\b(?:tests?|subjects?|sections?|papers?|parts?)\b/i.test(h) && /\b(?:questions?|qs)\b/i.test(h) && /\bmarks?\b/i.test(h);

const MEDIUM = /\s+(?:\*|(?:hindi|english|bilingual)(?:\s*\/\s*(?:hindi|english))*)$/i;
/** The figures at the end of a row: questions, marks, and maybe a duration. */
// The figures may be followed by the time column's own words ("25 50 1 hour (with sectional"): SSC CGL Tier-I.
const TAIL = /\s(\d{1,3})\s+(\d{1,3}(?:\.\d+)?)(?:\s+(\d{1,3})\s*(?:minutes?|mins?)\b)?(?:\s+\d{1,2}\s*(?:hours?|hrs?)\b.*|\s+\(.*)?\s*$/i;
/** A line of the time or remarks column wrapped under a row ("timer of 15 minutes for", "(with sectional", "scribe as per Para-7.1"). */
const REMARK = /^[(a-z]|\b(?:timer|scribe|minutes|hours?|sectional)\b/;
const TOTAL = /^total\b/i;
const minutesIn = (s: string): number | undefined => {
  const m = /(\d{1,3})\s*(minutes?|mins?)\b/i.exec(s);
  if (m) return Number(m[1]);
  const h = /(\d)\s*(?:hours?|hrs?)\b/i.exec(s);
  return h ? Number(h[1]) * 60 : undefined;
};

// A heading that names a stage of the exam, and a short title line (a post's name).
const STAGE = /\b(?:preliminary|prelims?|main|mains|single\s+level|tier|phase|stage|paper|exam|examination|test|cbt|pattern)\b/i;
// A sentence ("The written examination structure is as follows:") is not a title.
// A clause number in front ("13.8 Scheme of Tier-I Examination:") does not stop a line being a heading.
const isTitle = (raw: string) => isTitleText(raw.replace(/^\d+(?:\.\d+)*\s+/, ""));
const isTitleText = (t: string) => t.length <= 70 && !/[.;]$/.test(t) && !/\b(?:is|are|will|shall|as follows|should|must)\b/i.test(t)
  && !/\d{2,}\s+\d{2,}/.test(t) && /^[A-Z(“"]/.test(t) && !TOTAL.test(t) && !isHeaderLine(t);
const clean = (t: string) => t.replace(/[*:]+\s*$/g, "").replace(/\s*\*+\s*/g, " ").replace(/\s+/g, " ").trim();

/** Every pattern table in the text, in order, read as printed where its rows can be read. */
export function findPatternTables(text: string): PatternTable[] {
  const lines = linesWithPages(text);
  const out: PatternTable[] = [];
  let stage: string | null = null;
  let titles: Array<{ text: string; at: number; listed?: boolean }> = []; // short titles seen since the last table, not yet given to one
  let i = 0;
  while (i < lines.length) {
    // A header: consecutive lines of header words, together naming the tests, the questions and the marks.
    let j = i;
    let header = "";
    while (j < lines.length && j - i < 10 && isHeaderLine(lines[j].text)) header += ` ${lines[j++].text}`;
    if (j === i || !headerComplete(header)) {
      const t = lines[i].text;
      if (isTitle(t)) {
        if (STAGE.test(t) && t.length <= 70) { stage = clean(t); titles = []; }
        else titles.push({ text: clean(t), at: i });
      } else if (t.length > 70) {
        // A sentence between headings and their tables does not end the list of titles waiting for a table.
      }
      i++;
      continue;
    }
    const page = lines[i].page;
    const hasMedium = /\bmedium\b/i.test(header);
    // Questions before marks, unless the header prints marks first.
    const marksFirst = header.search(/\bmarks?\b/i) < header.search(/\b(?:questions?|qs)\b/i);
    const [qi, mi] = marksFirst ? [2, 1] : [1, 2];
    const partColumn = /\b(?:part|section|tier)\b/i.test(header);
    // The title just above the header is this table's; otherwise the first one waiting (titles listed before their tables).
    const before = lines[i - 1]?.text;
    let title: string | null = null;
    // Titles printed far above the table (more than 30 lines) belong to something else, unless they are
    // the rest of a list whose first title a table has already taken (IBPS: three posts, then three tables).
    titles = titles.filter((x) => x.listed || x.at >= i - 30);
    if (before && titles.length && clean(before) === titles[titles.length - 1].text) title = titles.pop()!.text;
    else if (titles.length) { title = titles.shift()!.text; titles = titles.map((x) => ({ ...x, listed: true })); }
    const heading = [stage, title].filter(Boolean).join(" – ") || null;

    // Rows until the total.
    const sections: Array<ExamPatternSection & { serial: string | null; minutes?: number }> = [];
    let buffer: Line[] = [];
    let total: { q?: number; m?: number; minutes?: number; line: string } | null = null;
    let k = j;
    let firstRow: string | null = null;
    for (; k < lines.length; k++) {
      const t = lines[k].text;
      if (TOTAL.test(t)) {
        const nums = (t.replace(/(\d+)\s*(?:minutes?|mins?|hours?|hrs?)/gi, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
        total = { q: nums[qi - 1], m: nums[mi - 1], minutes: minutesIn(t), line: t };
        k++;
        break;
      }
      if (hasMedium && buffer.length === 0 && MEDIUM.test(` ${t}`) && !/\d/.test(t)) continue; // a medium printed on its own line
      // Right after a row, the time column's wrapped words are passed over, not taken as the next row's name.
      if (buffer.length === 0 && sections.length > 0 && REMARK.test(t) && !TAIL.test(` ${t}`)) continue;
      buffer.push(lines[k]);
      const joined = buffer.map((b) => b.text).join(" ");
      const tail = TAIL.exec(` ${joined}`);
      if (!tail) {
        if (buffer.length >= 4) break; // not a table row: the table ended without a total
        continue;
      }
      let name = joined.slice(0, joined.length - tail[0].length + 1).trim();
      // "1", "4 a", or, under a Part or Section column, a part letter ("A General Awareness").
      // Under a Tier column the first row also carries the tier's numeral ("I A. General Intelligence…"): dropped.
      if (partColumn) name = name.replace(/^[IVX]{1,4}\s+(?=[A-H][.)]\s)/, "");
      const serialM = /^(\d{1,2}\s*[a-z]?)\s*[•.)]?\s+/i.exec(name) ?? (partColumn ? /^([A-H])[.)]?\s+(?=[A-Z])/.exec(name) : null);
      const serial = serialM ? serialM[1].replace(/\s+/g, "") : null;
      if (serialM) name = name.slice(serialM[0].length);
      name = name.replace(/\s{2,}/g, " – ").replace(/\s+/g, " ").trim();
      if (!name) { buffer = []; continue; }
      sections.push({ subject: name, questions: Number(tail[qi]), marks: Number(tail[mi]), serial, ...(tail[3] ? { minutes: Number(tail[3]) } : {}) });
      firstRow ??= buffer.map((b) => b.text).join("\n");
      buffer = [];
    }
    // A duration printed after the total ("Total duration of examination will be 60 minutes", "Duration – 2 Hours").
    let minutes = total?.minutes;
    for (let d = k; minutes === undefined && d < Math.min(lines.length, k + 2); d++) {
      if (/\bduration\b|\btime\b/i.test(lines[d].text)) minutes = minutesIn(lines[d].text);
    }

    // The medium is a column of its own only where most rows end with one ("Reasoning *", "English Language English").
    // Where the notice prints it once beside the table, "General English" is a subject's name, kept whole.
    if (hasMedium && sections.filter((s) => MEDIUM.test(` ${s.subject}`)).length * 2 > sections.length) {
      for (const sec of sections) sec.subject = sec.subject.replace(MEDIUM, "").trim() || sec.subject;
    }

    const problems: string[] = [];
    if (sections.length === 0) {
      out.push({ heading, page, paper: null, quote: null, why: "its rows could not be read", problems });
    } else {
      // "4 a" and "4 b" are a choice of one: counted once against the printed total.
      const counted = sections.filter((s, n) => !(s.serial && /[b-z]$/i.test(s.serial) && sections[n - 1]?.serial?.replace(/[a-z]$/i, "") === s.serial.replace(/[a-z]$/i, "")));
      const sumQ = counted.reduce((n, s) => n + (s.questions ?? 0), 0);
      const sumM = counted.reduce((n, s) => n + (s.marks ?? 0), 0);
      const name = heading ?? `Paper ${out.length + 1}`;
      if (total?.q !== undefined && total.q !== sumQ) problems.push(`${name}: the questions add up to ${sumQ}, the printed total is ${total.q}`);
      if (total?.m !== undefined && total.m !== sumM) problems.push(`${name}: the marks add up to ${sumM}, the printed total is ${total.m}`);
      if (!total) problems.push(`${name}: no printed total under the table`);
      const paper: ExamPatternPaper = {
        name,
        sections: sections.map((s) => ({ subject: s.subject, questions: s.questions, marks: s.marks })),
        ...(total?.q !== undefined ? { totalQuestions: total.q } : {}),
        ...(total?.m !== undefined ? { totalMarks: total.m } : {}),
        ...(minutes !== undefined ? { durationMinutes: minutes } : {}),
        ...(sections.some((s, n) => s.serial && /[a-z]$/i.test(s.serial) && n > 0 && sections[n - 1].serial?.replace(/[a-z]$/i, "") === s.serial.replace(/[a-z]$/i, ""))
          ? { note: "Some tests are a choice of one (printed with the same number, a and b)" } : {}),
      };
      out.push({ heading, page, paper, quote: firstRow, problems });
    }
    i = Math.max(k, j);
  }
  return out;
}

/** The pattern read by code: the papers read, and what the notice prints that was not read. */
export function readPatternTables(text: string): { papers: ExamPatternPaper[]; quote: string | null; coverage: PatternCoverage } {
  const tables = findPatternTables(text);
  const papers = tables.flatMap((t) => (t.paper ? [t.paper] : []));
  return {
    papers,
    quote: tables.find((t) => t.quote)?.quote ?? null,
    coverage: {
      expected: tables.length,
      read: papers.length,
      tables: tables.map((t) => ({ heading: t.heading, page: t.page, read: !!t.paper, ...(t.why ? { why: t.why } : {}) })),
      problems: tables.flatMap((t) => t.problems),
    },
  };
}

// ─── Papers counted from the notice's own words ─────────────
//
// Where a notice prints no pattern table (UPSC CSE: "The Examination shall
// comprise of two compulsory Papers", "The Written Examination will consist
// of 9 papers"), its sentences still say how many papers there are. The AI
// reads such a pattern; code counts the papers the notice states, so a reading
// with papers missing is said to be incomplete (B2.6).

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const STATED = /\b(?:consists?\s+of|comprises?(?:\s+of)?)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:compulsory\s+|objective\s+type\s+|conventional\s+(?:essay\s+)?type\s+|written\s+)?(?:question\s+)?papers?\b/i;

const STAGE_WORD = /\b(preliminary|prelims?|main|mains|tier[\s-]*(?:[ivx]+|\d+)|phase[\s-]*(?:[ivx]+|\d+)|stage[\s-]*(?:[ivx]+|\d+))\b/i;

/**
 * Each examination's stated number of papers, once per stage, with its page,
 * in the notice's order. Only a sentence about an examination counts ("The
 * Written Examination will consist of 9 papers", not "The syllabus consists
 * of two papers"); its stage comes from the sentence or the heading above, so
 * the same stage restated (UPSC states Preliminary's two papers twice) counts once.
 */
export function statedPaperCounts(text: string): Array<{ count: number; quote: string; page: number | null; stage: string | null }> {
  const lines = linesWithPages(text);
  const out: Array<{ count: number; quote: string; page: number | null; stage: string | null }> = [];
  for (let i = 0; i < lines.length; i++) {
    // A sentence may wrap: the line and the next are read together.
    const joined = `${lines[i].text} ${lines[i + 1]?.text ?? ""}`;
    const m = STATED.exec(joined);
    if (!m || m.index >= lines[i].text.length) continue;
    // What consists of the papers: the words just before, back to the sentence's start.
    const before = `${lines[i - 1]?.text ?? ""} ${joined.slice(0, m.index)}`;
    const subject = before.split(/[.;:](?=\s|$)/).pop() ?? "";
    if (!/\bexamination\b|\bexam\b|\btest\b/i.test(subject)) continue;
    let stage = STAGE_WORD.exec(subject)?.[1] ?? null;
    for (let b = i - 1; !stage && b >= Math.max(0, i - 6); b--) if (isTitle(lines[b].text) && STAGE_WORD.test(lines[b].text)) stage = STAGE_WORD.exec(lines[b].text)![1];
    const count = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
    const key = (stage ?? "").toLowerCase().replace(/^prelims?$/, "preliminary").replace(/^mains$/, "main");
    if (out.some((o) => (o.stage ?? "").toLowerCase().replace(/^prelims?$/, "preliminary").replace(/^mains$/, "main") === key && o.count === count)) continue;
    out.push({ count, quote: m[0], page: lines[i].page, stage });
  }
  return out;
}

/**
 * The papers the notice states, against the AI's papers: statements are
 * covered in order while the AI gave enough papers; the rest are not read.
 * Null when the notice states no number of papers.
 */
export function statedCoverage(text: string, aiPapers: number): PatternCoverage | null {
  const stated = statedPaperCounts(text);
  if (stated.length === 0) return null;
  let left = aiPapers;
  const tables = stated.map((s) => {
    const read = left >= s.count;
    left = Math.max(0, left - s.count);
    return { heading: `${s.stage ? `${s.stage[0].toUpperCase()}${s.stage.slice(1).toLowerCase()}: ` : ""}${s.count} paper${s.count === 1 ? "" : "s"} (“${s.quote}”)`, page: s.page, read, ...(read ? {} : { why: "the AI's reading has fewer papers than the notice states" }) };
  });
  const expected = stated.reduce((n, s) => n + s.count, 0);
  return { expected, read: Math.min(aiPapers, expected), tables, problems: [] };
}
