// ═══════════════════════════════════════════════════════════
// Posts a corrigendum deletes (B2.6, design P2.3)
// ═══════════════════════════════════════════════════════════
//
// A corrigendum that deletes a post ("सारणी-I में क्रम संख्या-11 पर वर्णित
// पद को विलोपित किया जाता है", "the post of … stands withdrawn") is read by
// code, never by the AI: the sentence that deletes, the job's own post it
// names (by name, or by its serial number and table, traced to the sentence
// that names it), the count the corrigendum prints for it, and its revised
// total ("1230-44 = 1186"). Every one is checked against the job's saved
// vacancy table:
//
//   - the post must be exactly one of the job's posts (in the table named);
//   - the count printed must be the post's count in the table;
//   - a revised total must start from the table's total and subtract exactly
//     the posts removed.
//
// Anything not certain refuses the whole removal, with the reason: nothing is
// removed by a guess. A removal that holds is offered as the job's table
// without those rows — the women's share and every other figure of a removed
// post go with it, never subtracted again — for an admin to tick. The job's
// table before stays in its history and can be restored in one click.

import { analyseVacancyTable, type StatedTotal, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";
import { pageOf } from "@/lib/cms/importer/evidence-text";

/** A sentence that deletes, withdraws or cancels something. */
const DELETES = /\b(?:deleted|withdrawn|cancelled|canceled|dropped|stands?\s+removed)\b|विलोपित|विलोपन|विलुप्त|रद्द|निरस्त|हटाया|हटाए|हटाई/i;
/** A serial number in a list of posts: "क्रम संख्या-11", "S. No. 11", "serial 11". */
const SERIAL = /(?:क्रम\s*(?:संख्या|सं\.?|सं०)|क्र\.?\s*सं\.?|क्र०\s*सं०|s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|serial(?:\s+(?:no\.?|number))?)\s*[-–:.]?\s*(\d{1,3})\b/i;
/** A table of the notice: "सारणी-I", "Table 2", "Annexure-II". */
const TABLE = /(?:सारणी|तालिका|table|annexure)\s*[-–:]?\s*([IVXL]+|\d{1,2})(?![A-Za-z])/i;
/** A count of posts: "44 पद", "44 posts", "44 vacancies". */
const COUNT = /(\d{1,6})\s*(?:पद|posts?\b|vacanc(?:y|ies)\b|रिक्ति)/gi;
/** A revised total worked out in the corrigendum: "1230-44 = 1186". */
const ARITHMETIC = /(\d{2,7})\s*[-–−]\s*(\d{1,6})\s*=\s*(\d{2,7})/;

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[(),./\\\-–—:;"'“”‘’|]+/g, " ").replace(/\s+/g, " ").trim();
const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const tableNo = (s: string) => (/^\d+$/.test(s) ? Number(s) : roman[s.toLowerCase()] ?? null);

export interface RemovedPost {
  post: string;
  /** The job's rows for the post: removed whole, with every figure in them. */
  rows: VacancyTableRow[];
  /** The post's count in the job's table, and as the corrigendum prints it (null when it prints none). */
  count: number;
  printedCount: number | null;
  /** The sentences that delete it and that name it, word for word, with their page. */
  quotes: Array<{ text: string; page: number | null }>;
  serial: string | null;
  table: string | null;
  /** The post's name as the corrigendum was read, when it differs slightly from the job's (a scan read "ईंख" for "ईख"). */
  readAs?: string;
}

export interface RemovalReading {
  /** Deletion sentences found at all. */
  found: number;
  removals: RemovedPost[];
  /** The revised total as the corrigendum works it out, checked against the job's table. */
  total: { before: number; removed: number; after: number; quote: string; page: number | null } | null;
  /** Why nothing is removed, when a deletion was found but could not be matched for certain. */
  refused: Array<{ quote: string; reason: string }>;
  /** Printed totals of the job that covered a removed post: no longer true, kept in the table's history. */
  droppedTotals: StatedTotal[];
  /** The job's table without the removed posts; null when nothing is removed. */
  table: VacancyTable | null;
}

/** The document's sentences: lines joined, cut at "।" and at a full stop that ends one. */
function sentencesOf(text: string): string[] {
  const body = text.replace(/^-- \d+ of \d+ --$/gm, "\n\n");
  return body.split(/\n\s*\n/).flatMap((para) => para.replace(/\s*\n\s*/g, " ")
    .split(/(?<=।)\s*|(?<=[a-z0-9)])\.\s+(?=[A-Z(])/))
    .map((s) => s.trim()).filter((s) => s.length > 3);
}

/** The job's posts this sentence names: by the whole name, else by the name before its first comma, bracket or slash. */
function postsNamed(sentence: string, posts: string[]): { posts: string[]; ambiguous: string | null } {
  const s = ` ${norm(sentence)} `;
  const whole = posts.filter((p) => norm(p).length > 2 && s.includes(` ${norm(p)} `));
  if (whole.length) return { posts: whole, ambiguous: null };
  const cores = new Map<string, string[]>();
  for (const p of posts) {
    const core = norm(p.split(/[,(/]/)[0]);
    if (core.length < 4 || !s.includes(` ${core} `)) continue;
    cores.set(core, [...(cores.get(core) ?? []), p]);
  }
  // A shorter name inside a longer one that also matched ("Officer" in "Sugarcane Officer") is the longer one.
  const keys = [...cores.keys()].filter((k) => ![...cores.keys()].some((o) => o !== k && o.includes(k)));
  const twice = keys.find((k) => cores.get(k)!.length > 1);
  if (twice) return { posts: [], ambiguous: `“${twice}” is the name of ${cores.get(twice)!.length} of the job's posts (${cores.get(twice)!.join("; ")})` };
  return { posts: keys.flatMap((k) => cores.get(k)!), ambiguous: null };
}

/** Edit distance between two short strings. */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Where a sentence names the post with at most two characters read differently: the words as read, or null. */
function nearName(sentence: string, post: string): string | null {
  const core = norm(post.split(/[,(/]/)[0]);
  if (core.length < 6) return null;
  const s = norm(sentence);
  let best: { d: number; at: string } | null = null;
  for (let len = core.length - 2; len <= core.length + 2; len++) {
    for (let i = 0; i + len <= s.length; i++) {
      // Whole words only: the name as read is reported as it stands in the sentence, never cut mid-word.
      if ((i > 0 && s[i - 1] !== " ") || (i + len < s.length && s[i + len] !== " ")) continue;
      const w = s.slice(i, i + len);
      const d = distance(w, core);
      if (!best || d < best.d) best = { d, at: w };
    }
  }
  return best && best.d <= 2 ? best.at.trim() : null;
}

/** The count printed for a post in a sentence: the one count after its name, or the only count in the sentence. */
function countFor(sentence: string, post: string): number | null {
  const all = [...sentence.matchAll(COUNT)].map((m) => ({ n: Number(m[1]), at: m.index! }));
  if (all.length === 1) return all[0].n;
  const core = post.split(/[,(/]/)[0].trim();
  const at = sentence.normalize("NFC").indexOf(core.normalize("NFC"));
  const after = at >= 0 ? all.filter((c) => c.at > at) : [];
  return after.length >= 1 ? after[0].n : null;
}

const rowTotal = (r: VacancyTableRow) => (r.status === "NIL" ? 0 : typeof r.total === "number" ? r.total : null);
/** The serial a row was printed at: the first figure of its printed line, when the line starts with one. */
const printedSerial = (r: VacancyTableRow) => /^\s*\|?\s*0*(\d{1,3})[.)]?\s*(?:\||\s)/.exec(r.source.line)?.[1] ?? null;

export function readRemovals(text: string, existing: VacancyTable | null, opts: { retrievalId: string | null } = { retrievalId: null }): RemovalReading {
  const none: RemovalReading = { found: 0, removals: [], total: null, refused: [], droppedTotals: [], table: null };
  const sentences = sentencesOf(text);
  const deleting = sentences.filter((s) => DELETES.test(s));
  if (deleting.length === 0) return none;
  const out: RemovalReading = { ...none, found: deleting.length };
  const refuse = (quote: string, reason: string) => { out.refused.push({ quote, reason }); };
  if (!existing || existing.rows.length === 0) {
    for (const d of deleting) refuse(d, "the job has no vacancy table to remove a post from; remove it in the job editor if the notice means that");
    return out;
  }
  const posts = [...new Set(existing.rows.map((r) => r.at.post).filter(Boolean))];
  const tableDim = existing.dimensions.find((d) => d.key === "table")?.key ?? null;
  const page = (q: string) => pageOf(text, q);

  const byPost = new Map<string, RemovedPost>();
  for (const d of deleting) {
    const serial = SERIAL.exec(d)?.[1] ?? null;
    const tableRef = TABLE.exec(d)?.[1] ?? null;
    let named = postsNamed(d, posts);
    const quotes = [{ text: d, page: page(d) }];
    let describing = d;
    let nearly: string | null = null;
    // Named only by its place ("the post at serial 11 of Table I"): the sentence that gives that place a name.
    if (named.posts.length === 0 && !named.ambiguous && serial) {
      const same = sentences.filter((s) => s !== d && SERIAL.exec(s)?.[1] === serial && (!tableRef || TABLE.exec(s)?.[1]?.toLowerCase() === tableRef.toLowerCase()));
      const found = same.map((s) => ({ s, n: postsNamed(s, posts) })).filter((x) => x.n.posts.length || x.n.ambiguous);
      const names = [...new Set(found.flatMap((x) => x.n.posts))];
      if (found.some((x) => x.n.ambiguous)) named = { posts: [], ambiguous: found.find((x) => x.n.ambiguous)!.n.ambiguous };
      else if (names.length > 1) named = { posts: [], ambiguous: `serial ${serial}${tableRef ? ` of table ${tableRef}` : ""} is given to more than one post (${names.join("; ")})` };
      else if (names.length === 1) { named = { posts: names, ambiguous: null }; describing = found[0].s; quotes.unshift({ text: found[0].s, page: page(found[0].s) }); }
      // The name read a character or two differently (a scanned page: "ईंख" for "ईख"). Taken only when three things
      // agree: exactly one of the job's posts was printed at that serial (in that table), the sentence names it
      // within two characters, and the count it prints is the post's own (checked below; required here).
      if (named.posts.length === 0 && !named.ambiguous) {
        const atSerial = existing.rows.filter((r) => printedSerial(r) === String(Number(serial))
          && (!tableRef || !tableDim || tableNo((r.at[tableDim] ?? "").replace(/^(?:सारणी|तालिका|table)\s*[-–:]?\s*/i, "").trim()) === tableNo(tableRef)));
        const there = [...new Set(atSerial.map((r) => r.at.post))];
        const hit = there.length === 1 ? [d, ...same].map((s) => ({ s, as: nearName(s, there[0]) })).find((x) => x.as) : undefined;
        if (hit) {
          named = { posts: there, ambiguous: null };
          nearly = hit.as;
          if (hit.s !== d) { describing = hit.s; quotes.unshift({ text: hit.s, page: page(hit.s) }); }
        }
      }
    }
    if (named.ambiguous) { refuse(d, `the post cannot be told for certain: ${named.ambiguous}`); continue; }
    if (named.posts.length === 0) {
      refuse(d, serial ? `serial ${serial}${tableRef ? ` of table ${tableRef}` : ""} names no post of this job` : "it names no post of this job");
      continue;
    }
    for (const post of named.posts) {
      let rows = existing.rows.filter((r) => r.at.post === post);
      // The table it names, when the job's table keeps which table each post is in.
      if (tableRef && tableDim) {
        const want = tableNo(tableRef);
        const inTable = rows.filter((r) => tableNo((r.at[tableDim] ?? "").replace(/^(?:सारणी|तालिका|table)\s*[-–:]?\s*/i, "").trim()) === want);
        if (inTable.length === 0) { refuse(d, `“${post}” is not in table ${tableRef} of the job's vacancy table`); continue; }
        rows = inTable;
      }
      // The serial it was printed at, when its line shows one.
      if (serial) {
        const printed = [...new Set(rows.map(printedSerial).filter((x): x is string => !!x))];
        if (printed.length > 0 && !printed.includes(String(Number(serial)))) { refuse(d, `“${post}” was printed at serial ${printed.join(", ")} in the notice; the corrigendum says serial ${serial}`); continue; }
      }
      const totals = rows.map(rowTotal);
      if (totals.some((t) => t === null)) { refuse(d, `“${post}” has a row with no figure in the job's table; its count cannot be checked`); continue; }
      const count = (totals as number[]).reduce((a, b) => a + b, 0);
      const printedCount = countFor(describing, post);
      if (printedCount !== null && printedCount !== count) { refuse(d, `the corrigendum says “${post}” had ${printedCount} posts; the job's table has ${count}`); continue; }
      if (nearly && printedCount === null) { refuse(d, `the corrigendum's name for the post at serial ${serial} reads “${nearly}”, not quite “${post}”, and it prints no count to confirm it`); continue; }
      const had = byPost.get(post);
      if (had) { for (const q of quotes) if (!had.quotes.some((x) => x.text === q.text)) had.quotes.push(q); continue; }
      byPost.set(post, { post, rows, count, printedCount, quotes: [...quotes], serial, table: tableRef, ...(nearly ? { readAs: nearly } : {}) });
    }
  }
  out.removals = [...byPost.values()];
  if (out.refused.length > 0 || out.removals.length === 0) return { ...out, removals: [] };

  // The revised total, when the corrigendum works it out: it must start from the job's total and take away exactly these posts.
  const removed = out.removals.reduce((a, r) => a + r.count, 0);
  const before = analyseVacancyTable(existing).grandTotal;
  const sum = sentences.map((s) => ({ s, m: ARITHMETIC.exec(s) })).find((x) => x.m);
  if (sum) {
    const [b, r, a] = [Number(sum.m![1]), Number(sum.m![2]), Number(sum.m![3])];
    const quote = sum.m![0];
    if (b - r !== a) refuse(sum.s, `its revised total does not add up: ${b} − ${r} is ${b - r}, not ${a}`);
    else if (r !== removed) refuse(sum.s, `it takes away ${r}; the posts it deletes have ${removed} in the job's table`);
    else if (!before?.complete || before.value !== b) refuse(sum.s, `it starts from ${b}; the job's table ${before?.complete ? `adds up to ${before.value}` : "has no complete total"}`);
    else out.total = { before: b, removed: r, after: a, quote, page: page(sum.s) };
    if (out.refused.length) return { ...out, removals: [], total: null };
  }

  // The job's table without them. Its printed totals that covered a removed post no longer hold: set aside
  // (they stay in the table's history); the revised grand total the corrigendum prints takes the grand total's place.
  const gone = new Set(out.removals.flatMap((r) => r.rows.map((x) => x.id)));
  const covers = (s: StatedTotal) => existing.rows.some((r) => gone.has(r.id) && Object.entries(s.at).every(([k, v]) => (r.at[k] ?? "").trim().toLowerCase() === v.trim().toLowerCase()));
  out.droppedTotals = existing.statedTotals.filter(covers);
  const statedTotals = existing.statedTotals.filter((s) => !covers(s));
  if (out.total) statedTotals.push({ at: {}, total: out.total.after, source: { retrievalId: opts.retrievalId, page: out.total.page, line: out.total.quote } });
  out.table = { ...existing, rows: existing.rows.filter((r) => !gone.has(r.id)), statedTotals };
  return out;
}
