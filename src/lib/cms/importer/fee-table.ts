// ═══════════════════════════════════════════════════════════
// Category-wise fees, read by code (CMS 2.0 U2)
// ═══════════════════════════════════════════════════════════
//
// Pure. "Application Fee: General/EWS/OBC Rs. 750, SC/ST/PwBD Nil" and rows
// under a fee heading ("Women: Exempted") become one row per group of
// categories as written, post by post where the text says so. Nothing is
// worked out: a category the text does not name has no row, and a clause
// whose amount cannot be read is said, not guessed.
//
// The two older fee fields (General/OBC, SC/ST/PwBD) are derived from the
// table only where the table states them plainly and the same for every post.

import type { FeeGroup, FeeRow } from "@/types/recruitment-record";

export interface ReadFeeRow extends FeeRow { line: number; quote: string }
export interface FeeReading { rows: ReadFeeRow[]; consumed: number[]; problems: Array<{ line: number; message: string }> }

const MONEY = /(?:₹|rs\.?|inr|rupees)\s*([\d,]+)(?:\.\d+)?(?:\s*\/-)?|\b([\d,]{2,})\s*(?:\/-|rupees\b)/i;
const EXEMPT = /\b(?:exempt(?:ed)?(?:\s+from\s+(?:the\s+)?(?:application\s+)?fees?)?|no\s+(?:application\s+)?fees?|not\s+required\s+to\s+pay|free(?:\s+of\s+cost)?|nil)\b/i;
const GROUPS: Array<[FeeGroup, RegExp]> = [
  ["general", /\b(?:general|gen|ur|unreserved)\b/i],
  ["obc", /\bobc\b/i],
  ["ews", /\bews\b/i],
  ["sc", /\bsc\b/i],
  ["st", /\bst\b/i],
  ["pwbd", /\b(?:pwbd|pwd|ph|divyang\w*|persons?\s+with\s+(?:benchmark\s+)?disabilit\w*)\b/i],
  ["women", /\b(?:women|female|woman)\b/i],
  ["esm", /\b(?:ex-?servicemen|esm)\b/i],
  ["transgender", /\btransgender\b/i],
  ["all", /\ball\s+(?:the\s+)?(?:candidates|categories|applicants)\b|\bfor\s+all\b/i],
];
const FEE_LABEL = /^\s*(?:[-*•]\s*)?(?:application|exam(?:ination)?|registration)?\s*fees?(?:\s+details)?(?:\s+exemption)?\s*(?:\(([^)]{2,120})\))?\s*[:：]\s*(.*)$/i;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function amountOf(s: string): { amount: number; exempt?: boolean } | null {
  const m = MONEY.exec(s);
  if (m) {
    const n = Number((m[1] ?? m[2]).replace(/,/g, ""));
    if (Number.isInteger(n) && n >= 0 && n <= 100_000) return n === 0 ? { amount: 0, exempt: true } : { amount: n };
  }
  return EXEMPT.test(s) ? { amount: 0, exempt: true } : null;
}

function groupsOf(s: string): FeeGroup[] {
  return GROUPS.filter(([, re]) => re.test(s)).map(([g]) => g);
}

/** One line's clauses: "General/EWS/OBC Rs. 750, SC/ST Nil" → two. A clause with no amount joins the next ("General, OBC and EWS: Rs 850"). */
function clausesOf(body: string): Array<{ text: string; amount: { amount: number; exempt?: boolean } | null }> {
  const parts = body.split(/[;,]\s*(?=[A-Za-z(])|\s+\band\b\s+(?=(?:sc|st|women|female|pwbd|pwd|ews|obc|esm|ex-?servicemen)\b)/i).map(clean).filter(Boolean);
  const out: Array<{ text: string; amount: { amount: number; exempt?: boolean } | null }> = [];
  let carry = "";
  for (const p of parts) {
    const a = amountOf(p);
    if (!a) { carry = carry ? `${carry}, ${p}` : p; continue; }
    out.push({ text: carry ? `${carry}, ${p}` : p, amount: a });
    carry = "";
  }
  if (carry) out.push({ text: carry, amount: null });
  return out;
}

/** The categories as written: the clause without its amount ("General/EWS/OBC Rs. 750" → "General/EWS/OBC"). */
const categoryText = (clause: string) => clean(clause.replace(MONEY, "").replace(/\b(?:exempt(?:ed)?(?:\s+from\s+(?:the\s+)?(?:application\s+)?fees?)?|nil)\b/gi, "")
  .replace(/\b(?:candidates?|applicants?|category|categories|fee|fees|is|are|for)\b/gi, "").replace(/[:\-–—=]+\s*$/, "").replace(/^[:\-–—]+/, "")) || clean(clause);

// U5 correction: an exception only when the notice states one. "except", "excluding", "other than", "apart from".
const EXCEPT = /\b(?:except|excluding|other\s+than|apart\s+from)\b/i;
// "… except categories below / the following / listed / mentioned": the exceptions are the rows given separately.
const LISTED = /\b(?:below|following|mentioned|listed|given|separately|stated)\b/i;
// A fee for whoever is left, said as such: "Other candidates", "Others", "Remaining categories".
const RESIDUAL = /\b(?:all\s+)?other\s+(?:candidates|categories|applicants)\b|\bothers\b|\bremaining\s+(?:candidates|categories|applicants)\b/i;
const groupsWithoutAll = (s: string) => groupsOf(s).filter((g) => g !== "all");

/** Fee rows from the lines of a fee section (each line with its number in the text). */
export function readFeeLines(lines: Array<{ line: number; text: string }>): FeeReading {
  const out: FeeReading = { rows: [], consumed: [], problems: [] };
  for (const { line, text } of lines) {
    const raw = clean(text);
    if (!raw) continue;
    const parts = raw.split("|").map(clean);
    const postPart = parts.slice(1).map((p) => /^post\s*:\s*(.+)$/i.exec(p)).find(Boolean);
    const head = parts[0];
    const label = FEE_LABEL.exec(head);
    let body = label ? clean(label[2]) : head;
    const post = label?.[1] ? clean(label[1]) : postPart ? clean(postPart[1]) : undefined;
    if (label && !body) { out.consumed.push(line); continue; } // the heading
    // A row under the heading: "General/EWS/OBC: Rs. 750".
    if (!label) {
      const row = /^([^:]{2,120}):\s*(.+)$/.exec(head);
      if (!row || groupsOf(row[1]).length === 0) continue;
      body = `${row[1]} ${row[2]}`;
    }
    const clauses = clausesOf(body);
    let read = 0;
    let lastAll: ReadFeeRow | null = null;
    for (const c of clauses) {
      if (!c.amount) { out.problems.push({ line, message: `no amount could be read for “${c.text}”` }); continue; }
      const ex = EXCEPT.exec(c.text);
      let groups: FeeGroup[];
      let category: string;
      let residual: Pick<FeeRow, "residual" | "exceptGroups"> = {};
      if (ex && ex.index < 3 && lastAll) {
        // "All candidates Rs. 500, except SC/ST/Female Rs. 250": the clause names the stated exceptions of the row before.
        const rest = c.text.slice(ex.index + ex[0].length);
        groups = groupsWithoutAll(rest);
        category = categoryText(rest);
        lastAll.residual = true;
        lastAll.exceptGroups = [...new Set([...(lastAll.exceptGroups ?? []), ...groups])];
      } else if (ex && ex.index >= 3) {
        // "All candidates (except categories below) Rs. 500" / "All candidates except SC/ST Rs. 500": the categories after
        // "except" are NOT covered by this fee.
        const before = c.text.slice(0, ex.index);
        const after = c.text.slice(ex.index + ex[0].length);
        const named = groupsWithoutAll(before);
        groups = named.length && !groupsOf(before).includes("all") ? named : ["all"];
        const excepted = groupsWithoutAll(after);
        residual = { residual: true, ...(excepted.length && !LISTED.test(after) ? { exceptGroups: excepted } : {}) };
        const exceptWords = clean(after.replace(MONEY, "").replace(/[()]/g, " ")).replace(/[:\-–—=]+$/, "").trim();
        category = `${groups[0] === "all" ? "All candidates" : categoryText(before)} (except ${exceptWords})`.slice(0, 120);
      } else if (RESIDUAL.test(c.text) && groupsWithoutAll(c.text).length === 0) {
        groups = ["all"];
        residual = { residual: true };
        category = categoryText(c.text);
      } else {
        groups = groupsOf(c.text);
        category = groups.length === 1 && groups[0] === "all" ? "All candidates" : categoryText(c.text);
      }
      const row: ReadFeeRow = { line, quote: raw, category, groups: groups.length ? groups : ["other"], amount: c.amount.amount,
        ...(c.amount.exempt ? { exempt: true } : {}), ...(post ? { post } : {}), ...residual,
        ...(groups.length ? {} : { note: "the categories are kept as written; they are not ones the CMS knows" }) };
      out.rows.push(row);
      if (row.groups.includes("all")) lastAll = row;
      read++;
    }
    if (read > 0) out.consumed.push(line);
  }
  // Two rows for the same categories and post that disagree: neither stands.
  const key = (r: FeeRow) => `${[...r.groups].sort().join("+")}|${(r.post ?? "").toLowerCase()}`;
  const byKey = new Map<string, ReadFeeRow[]>();
  for (const r of out.rows) byKey.set(key(r), [...(byKey.get(key(r)) ?? []), r]);
  out.rows = [];
  for (const g of byKey.values()) {
    if (g.every((r) => r.amount === g[0].amount)) out.rows.push(g[0]);
    else out.problems.push({ line: g[1].line, message: `two different fees for “${g[0].category}”${g[0].post ? ` (${g[0].post})` : ""}: ${g.map((r) => `₹${r.amount}`).join(" and ")} — neither is offered` });
  }
  return out;
}

export const feeKey = (r: Pick<FeeRow, "groups" | "post">) => `${[...r.groups].sort().join("+")}|${(r.post ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;

/**
 * The two older fee fields from a table, only where the table says them plainly: General/OBC is the fee of the
 * row naming General (or all candidates); SC/ST/PwBD is the fee of the rows naming SC and ST, when they agree.
 * A table that differs by post gives neither.
 */
export function legacyFees(rows: FeeRow[]): { feeGeneral?: number; feeSCST?: number; why?: string } {
  if (rows.some((r) => r.post)) return { why: "the fees differ by post, so the two summary fees are left for you to set" };
  // The rows that give group g a fee. A plain "all candidates" row counts as before (beside a specific row it
  // leaves the summary fee unset: no precedence is invented). A stated default for the remaining categories
  // (`residual`) counts only where g has no row of its own and is not one of its stated exceptions.
  const rowsFor = (g: FeeGroup) => {
    const own = rows.filter((r) => r.groups.includes(g));
    const plainAll = rows.filter((r) => r.groups.includes("all") && !r.residual);
    // With no row of its own, g falls under the stated default unless the notice names g as excepted.
    const residual = own.length ? [] : rows.filter((r) => r.residual && r.groups.includes("all") && !(r.exceptGroups ?? []).includes(g));
    return [...own, ...plainAll, ...residual];
  };
  const general = rowsFor("general");
  const sc = rowsFor("sc");
  const st = rowsFor("st");
  const out: { feeGeneral?: number; feeSCST?: number } = {};
  if (general.length === 1) out.feeGeneral = general[0].amount;
  if (sc.length === 1 && st.length === 1 && sc[0].amount === st[0].amount) out.feeSCST = sc[0].amount;
  return out;
}

// ─── Overlapping rows (U5) ────────────────────────────────

const rowWords = (r: Pick<FeeRow, "category" | "post" | "amount" | "exempt">) =>
  `${r.category}${r.post ? ` (${r.post})` : " (all posts)"}: ${r.exempt || r.amount === 0 ? "no fee" : `₹${r.amount}`}`;

/**
 * Rows that give the same candidates two different fees: they share a category (or one is for all candidates),
 * apply to the same post (or one applies to every post), and their amounts differ (an exemption counts as no fee).
 * "Women: exempt" beside "General ₹750" is NOT an overlap: that is how notices write exemptions. Nothing is
 * decided here: each overlap is said, so the page, the review and the publication review can flag it.
 *
 * U5 correction (14 Nov 2026): the ONE exception is an exception the notice states. A row the notice gives as the
 * fee for the remaining categories (`residual`: "All candidates (except categories below)", "All candidates except
 * SC/ST", "Others") does not clash with a row for the SAME post whose categories are its stated exceptions (all of
 * them named in `exceptGroups`, or, when it says "except the categories listed", any row given separately).
 * Everything else is unchanged: a plain "all candidates" fee beside another fee, a fee for all posts beside a
 * post's own fee, or two fees for the same post and category, is still flagged. No precedence is invented.
 */
export function feeOverlaps(rows: ReadonlyArray<Pick<FeeRow, "category" | "groups" | "amount" | "exempt" | "post" | "residual" | "exceptGroups">>): string[] {
  const fee = (r: Pick<FeeRow, "amount" | "exempt">) => (r.exempt ? 0 : r.amount);
  const postOf = (r: Pick<FeeRow, "post">) => (r.post ?? "").trim().toLowerCase();
  type Row = (typeof rows)[number];
  const statedException = (general: Row, specific: Row) =>
    general.residual === true && specific.residual !== true && postOf(general) === postOf(specific)
    && !specific.groups.includes("all")
    && (general.exceptGroups === undefined || specific.groups.every((g) => (general.exceptGroups as string[]).includes(g)));
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const groups = a.groups.includes("all") || b.groups.includes("all") || a.groups.some((g) => (b.groups as string[]).includes(g));
      const posts = !a.post || !b.post || postOf(a) === postOf(b);
      if (!(groups && posts && fee(a) !== fee(b))) continue;
      if (statedException(a, b) || statedException(b, a)) continue;
      out.push(`${rowWords(a)} and ${rowWords(b)}`);
    }
  }
  return out;
}
