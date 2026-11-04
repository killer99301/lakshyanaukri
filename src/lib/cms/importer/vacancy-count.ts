// ═══════════════════════════════════════════════════════════
// Importer: do these words state this figure as the number of vacancies?
// ═══════════════════════════════════════════════════════════
//
// Pure and client-safe. One rule for two uses: the line a code-read total is
// quoted from (F2), and the quote an admin cites to verify a total that is not
// worked out from the vacancy table (F5). The figure must be the count itself,
// not merely a number near a vacancy word:
//   "Total Vacancies: 70", "70 Posts", "Number of posts - 1,205", "Grand Total 232",
//   a total row ("Total 5 3 8 3 11 30": its last figure) — state their figure;
//   "Recruitment of Clerks 2099", "Recruitment 2099 — 70 vacancies" (for 2099),
//   "Last date 30.06.2099", "Advt. No. 05/2099", "Rs. 600" — do not.
// A figure that could be a year (1900–2199) is stated only by a label with a
// colon, dash or "=" before it and no other figure after it ("Total Vacancies: 2030").

const WORD = String.raw`(?:vacanc(?:y|ies)|posts?|seats?|openings?)(?![a-z])`;
const HINDI = String.raw`(?:रिक्तियों|रिक्तियां|रिक्तियाँ|रिक्ति|पदों|पद)`;

interface Figure { value: number; start: number; end: number }

/** The figures in a line that stand on their own: not part of a date, reference, range or amount. */
function figures(line: string): Figure[] {
  const out: Figure[] = [];
  const re = /\d[\d,]*/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const raw = m[0].replace(/,+$/, "");
    const start = m.index, end = m.index + raw.length;
    const before = line.slice(0, start), after = line.slice(end);
    if (/\d[\/.]$/.test(before) || /\d\s*[-–]\s*$/.test(before)) continue;      // 30.06.2099, 05/2099, 44-53
    if (/^[\/.]\d/.test(after) || /^\s*[-–]\s*\d/.test(after)) continue;         // 2099/05, 44-53
    if (/(?:\b(?:rs|inr)\.?|₹)\s{0,2}$/i.test(before)) continue;                  // Rs. 600, ₹600
    if (/^\s*\/-/.test(after)) continue;                                           // 600/-
    out.push({ value: parseInt(raw.replace(/,/g, ""), 10), start, end });
  }
  return out;
}

const yearLike = (n: number) => n >= 1900 && n <= 2199;

/** Whether this one line states `n` as the number of vacancies, posts or seats. */
function lineStates(line: string, n: number): boolean {
  const figs = figures(line);
  const total = /^\s*(?:grand\s+)?total\s*[:\-–]?\s*[\d,\s\-–]+$/i.test(line);
  for (const [i, f] of figs.entries()) {
    if (f.value !== n) continue;
    const before = line.slice(0, f.start);
    const after = line.slice(f.end);
    // A total row: its last figure.
    if (total && i === figs.length - 1) return true;
    // "Total Vacancies: 70", "Posts - 70", "vacancies are 70": the word, then only words or signs, then the figure.
    const labelled = new RegExp(String.raw`(?:${WORD}|${HINDI})([^\d]{0,25})$`, "i").exec(before);
    if (labelled) {
      if (!yearLike(n)) return true;
      if (/[:=\-–]/.test(labelled[1]) && !/^\s*[:\-–]?\s*\d/.test(after)) return true;
      continue;
    }
    // "70 Posts", "70 (Seventy) vacancies", "70 पद": the figure, then the word.
    if (!yearLike(n) && new RegExp(String.raw`^[ \t]*(?:\([^)\d\n]{1,30}\)[ \t]*)?(?:${WORD}|${HINDI})`, "i").test(after)) return true;
  }
  return false;
}

/** Whether the words (one line or several) state `n` as the number of vacancies, posts or seats. */
export function statesVacancyCount(text: string, n: number): boolean {
  return text.split(/\r?\n/).some((line) => lineStates(line, n));
}

/** The source's own line that states `n` as the count, word for word (a long line: the part around the figure). */
export function vacancyCountLine(plain: string, n: number): string | null {
  for (const raw of plain.split(/\r?\n/)) {
    const line = raw.trim();
    if (!lineStates(line, n)) continue;
    if (line.length <= 300) return line;
    const at = figures(line).find((f) => f.value === n && lineStates(line.slice(Math.max(0, f.start - 120), f.end + 120), n));
    if (at) return line.slice(Math.max(0, at.start - 120), at.end + 120).trim();
  }
  return null;
}
