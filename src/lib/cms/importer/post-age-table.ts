// ═══════════════════════════════════════════════════════════
// Ages printed post by post in the notice's list of posts (B2.6)
// ═══════════════════════════════════════════════════════════
//
// SSC CGL 2026 lists its posts in a table whose last column is each post's
// age ("Name of Post | Ministry/Department | Classification | Age Limit"),
// in groups by pay level. Its text layer runs each row over several lines,
// ending with the age: "…Group “B” 20-30 years". The AI read it as four age
// groups in one run and as one range for every post in the other.
//
// Code reads the table row by row: a row starts at its serial number and ends
// at its age; its lines as printed are its quote. A row that ends without an
// age of its own (a merged cell: SSC's posts 10 and 11 share post 12's cells)
// is reported as not read, never given a neighbour's range.

export interface PostAgeRow { post: string; group: string | null; serial: string; min: number; max: number; quote: string }
export interface PostAgeTable { rows: PostAgeRow[]; unread: Array<{ serial: string; text: string; group: string | null }>; heading: string }

const AGE_AT_END = /(\d{2})\s*[-–]\s*(\d{2})\s*years?\.?\s*$/i;
const SERIAL = /^(\d{1,2})\.?(?:\s+(.*))?$/;
const GROUP = /^\d+\.\d+\s+(\S.*?)\s*:?\s*$/;
const MARKER = /^-- \d+ of \d+ --$/;
const PAGE_HEADER = /^page\s+\d+\s+of\s+\d+$/i;
const CLASSIFICATION = /\s+Group\s+["“”'‘’„‟]*[A-D]\b.*$/;

export function readPostAgeTable(text: string): PostAgeTable | null {
  const lines = text.split("\n");
  // The heading: "Age Limit" with "Post" in it or in the few lines above it (the heading wraps).
  const at = lines.findIndex((l, i) => /\bage\s*limit\b/i.test(l) && lines.slice(Math.max(0, i - 6), i + 1).some((x) => /name\s+of\s+(?:the\s+)?posts?|\bposts?\b/i.test(x)));
  if (at < 0) return null;
  const heading = lines.slice(Math.max(0, at - 6), at + 1).join(" ").replace(/\s+/g, " ").trim();
  const rows: PostAgeRow[] = [];
  const unread: PostAgeTable["unread"] = [];
  // The first group's heading is often printed just above the table's heading ("2.1 Pay Level-8 …").
  let group: string | null = lines.slice(Math.max(0, at - 8), at).map((l) => GROUP.exec(l.trim())?.[1] ?? null).filter(Boolean).pop() ?? null;
  let cur: { serial: string; start: number; words: string[] } | null = null;
  const close = () => {
    if (cur && cur.words.join(" ").trim()) unread.push({ serial: cur.serial, text: cur.words.join(" ").replace(/\s+/g, " ").trim(), group });
    cur = null;
  };
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    // A lone number is a serial when no row is open, else (between rows) a page number; page markers are skipped.
    if (!line || MARKER.test(line) || PAGE_HEADER.test(line)) continue;
    if (/^(?:note\b|n\.b\.)/i.test(line)) break; // the notes under the table end it
    const g = GROUP.exec(line);
    if (g && !AGE_AT_END.test(line)) { close(); group = g[1]; continue; }
    const s = SERIAL.exec(line);
    // "18-30 years" alone on a line is the open row's age, not a new row.
    if (s && !/^\d{2}\s*[-–]\s*\d{2}\s*years?/i.test(line)) {
      close();
      cur = { serial: s[1], start: i, words: s[2] ? [s[2]] : [] };
    } else if (cur) {
      cur.words.push(line);
    } else {
      continue; // the rest of the heading, before the first row
    }
    const age = AGE_AT_END.exec(line);
    if (!age || !cur) continue;
    const row: { serial: string; start: number; words: string[] } = cur;
    const words = row.words.join(" ").replace(AGE_AT_END, "").replace(/\s+/g, " ").trim();
    const post = words.replace(CLASSIFICATION, "").trim().slice(0, 160);
    const [min, max] = [Number(age[1]), Number(age[2])];
    // The quote: the row's lines as printed, from its serial to its age (after a page break inside it, the part on the age's page).
    const span = lines.slice(row.start, i + 1);
    const lastBreak = span.findLastIndex((l) => MARKER.test(l.trim()) || PAGE_HEADER.test(l.trim()));
    const quote = span.slice(lastBreak + 1).join("\n").trim();
    if (post && min >= 14 && max <= 70 && min < max) rows.push({ post, group, serial: row.serial, min, max, quote });
    else unread.push({ serial: row.serial, text: words, group });
    cur = null;
  }
  close();
  return rows.length >= 3 ? { rows, unread, heading } : null;
}
