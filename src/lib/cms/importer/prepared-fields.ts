// ═══════════════════════════════════════════════════════════
// Labelled lines read by code (I1): "Application fee: General ₹600, SC/ST ₹100",
// "Age limit: 18–35 years", "Pay scale: …", "Selection process: …"
// ═══════════════════════════════════════════════════════════
//
// For pasted text: a notice copied as text, or information prepared outside
// (by an AI or a person). Pure and conservative: only a line that starts with
// its label is read, every value is quoted from its own line, and nothing is
// filled in. What a line says but the job's fields cannot hold faithfully (a
// fee for women, a PwBD fee apart from SC/ST, ages by category, an
// eligibility line naming no post) is said for the editor, never widened or
// dropped. Two lines that disagree give nothing, and both are said.
//
// G3: a pasted article's table rows ("Label<TAB>value", "| Label | value |"),
// labels with their value on the next line, and fee tables are read as
// labelled lines too (pasted-article.ts), each quoted with the text's own
// words; and its notice number, vacancies, dates, selection section, steps to
// apply and conditions are read there.

import type { AgeCriteria, CmsRecruitmentPost, CmsSelectionInformation, SelectionStageType } from "@/types/recruitment-record";
import { parseDatesInText } from "@/lib/cms/ai-assist";
import { labelledFromPairs, pairsOf, readArticle } from "@/lib/cms/importer/pasted-article";

export interface LabelledValue { fieldPath: string; value: unknown; quote: string; doubt?: string; notes?: string[] }
export interface LabelledReading { values: LabelledValue[]; refused: Array<{ fieldPath: string; reason: string }> }

/** "Label: value", "Label - value" or "Label – value" at the start of a line (after a bullet or a number). */
const labelled = (label: string) => new RegExp(`^\\s*(?:[-*•]\\s*|\\d{1,2}[.)]\\s*)?(?:${label})\\b[^:\\n]{0,40}?(?:\\s*[:：]\\s*|\\s+[-–—]\\s+)(.*)$`, "i");
const FEE_LINE = labelled("(?:application|exam(?:ination)?|registration)\\s+fees?|fees?(?:\\s+details)?");
const PAY_LINE = labelled("pay\\s*scale|pay\\s*level|pay\\s*band|pay|salary|(?:total\\s+)?ctc|cost\\s+to\\s+company|emoluments|remuneration|stipend");
const AGE_LINE = labelled("age\\s*limits?|age|(?:maximum|minimum|upper|lower)\\s+age(?:\\s+limits?)?");
const RELAXATION_LINE = labelled("age\\s+relaxations?");
const ELIGIBILITY_LINE = labelled("eligibility(?:\\s+criteria)?|(?:minimum|educational|essential|academic)\\s+qualifications?|qualifications?");
const EXPERIENCE_LINE = labelled("(?:work\\s+|minimum\\s+|required\\s+)?experience");
const POST_LINE = labelled("name\\s+of\\s+(?:the\\s+)?posts?|post\\s+names?|posts?");
const SELECTION_LINE = labelled("selection\\s+process|selection\\s+procedure|mode\\s+of\\s+selection|selection");
const HOW_LINE = labelled("how\\s+to\\s+apply|application\\s+procedure|procedure\\s+to\\s+apply|steps\\s+to\\s+apply");

const MONEY = /(?:₹|rs\.?|inr|rupees)\s*([\d,]+)(?:\.\d+)?(?:\s*\/-)?|\b([\d,]{2,})\s*(?:\/-|rupees\b)/i;
const EXEMPT = /\b(?:exempt(?:ed)?(?:\s+from)?|no\s+(?:application\s+)?fee|not\s+required\s+to\s+pay|free\s+of\s+cost|nil)\b/i;
const GROUPS = {
  general: /\b(?:general|gen|ur|unreserved)\b/i,
  obc: /\bobc\b/i,
  ews: /\bews\b/i,
  sc: /\bsc\b/i,
  st: /\bst\b/i,
  pwbd: /\b(?:pwbd|pwd|ph|divyang\w*|persons?\s+with\s+(?:benchmark\s+)?disabilit\w*)\b/i,
  other: /\b(?:women|female|ex-?servicemen|esm|transgender|minorit\w*|bpl|agniveers?)\b/i,
  all: /\ball\s+(?:the\s+)?(?:candidates|categories|applicants)\b|\bfor\s+all\b/i,
} as const;
type Group = keyof typeof GROUPS;

const amountOf = (s: string): number | null => {
  const m = MONEY.exec(s);
  const n = m ? Number((m[1] ?? m[2]).replace(/,/g, "")) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : null;
};
const cleanLine = (l: string) => l.replace(/\s+/g, " ").trim();

interface FeeClause { groups: Group[]; fee: number | null; text: string; line: string }

/** A fee statement cut into clauses, each with the groups it names and its fee (0 when it says they are exempt). */
function feeClauses(statement: string, line: string): FeeClause[] {
  const says = (s: string) => EXEMPT.test(s) || amountOf(s) !== null;
  const texts: string[] = [];
  // A bracket that states a fee of its own is a statement of its own: "General Rs 600 (SC/ST exempted)" is two,
  // not one exemption for all three. Any other bracket is part of the words: "Persons with Disability (PwBD) Rs 200".
  const unbracketed = statement.replace(/\(([^()]*)\)/g, (_, inner: string) => (says(inner) ? `; ${inner};` : ` ${inner} `));
  // A full stop ends a statement, but not the one in "Rs. 600" or "No. 5".
  for (const piece of unbracketed.split(/;|(?<!\b(?:rs|no))\.\s+|\band\b(?=\s*(?:₹|rs\.?|inr)\s*\d)|\bwhile\b|\bwhereas\b/i)) {
    // A comma ends a clause only once it states a fee: "Women, SC, ST, PwBD and ESM are exempted" is one clause;
    // "Rs 500 for General, OBC and EWS" too (the groups after the comma go with the fee before it).
    let open = "";
    const from = texts.length;
    for (const part of piece.split(",")) {
      open = open ? `${open},${part}` : part;
      if (says(open)) { texts.push(open); open = ""; }
    }
    if (open.trim()) { if (texts.length > from) texts[texts.length - 1] += `,${open}`; else texts.push(open); }
  }
  return texts
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({
      groups: (Object.keys(GROUPS) as Group[]).filter((g) => GROUPS[g].test(text)),
      fee: EXEMPT.test(text) ? 0 : amountOf(text),
      text, line,
    }));
}

function readFees(lines: string[], out: LabelledReading): void {
  const clauses: FeeClause[] = [];
  const namesGroup = (l: string) => (Object.keys(GROUPS) as Group[]).some((g) => GROUPS[g].test(l));
  const namesGroupAndFee = (l: string) => namesGroup(l) && (EXEMPT.test(l) || amountOf(l) !== null);
  // Another field's label ends the fee block; "- General/OBC: Rs 600" (a group before the colon) does not.
  const nextLabel = (l: string) => { const m = /^[^:]{1,40}:/.exec(l); return !!m && !namesGroup(m[0]); };
  let block = false; // just under a fee label: "SC/ST candidates Rs.200/-" on the next line is part of it
  for (const raw of lines) {
    const line = cleanLine(raw);
    const m = FEE_LINE.exec(raw);
    if (m) {
      if (m[1].trim()) clauses.push(...feeClauses(m[1], line));
      block = true;
    } else if (block && line && line.length <= 240 && namesGroupAndFee(line) && !nextLabel(line)) {
      clauses.push(...feeClauses(line, line));
    } else {
      block = false;
      // An exemption written as a sentence of its own: "SC/ST candidates are exempted from payment of fee."
      if (/\bfees?\b/i.test(line) && EXEMPT.test(line) && line.length <= 240) clauses.push(...feeClauses(line, line));
    }
  }
  if (clauses.length === 0) return;
  const priced = clauses.filter((c) => c.fee !== null);
  for (const c of priced.filter((x) => x.groups.length === 0)) {
    out.refused.push({ fieldPath: "financial.feeGeneral", reason: `“${c.text}” gives a fee (₹${c.fee}) but names no category: not given to any group — enter it in the editor if the notice means one` });
  }
  for (const c of priced.filter((x) => x.groups.includes("other"))) {
    out.refused.push({ fieldPath: "financial.feeSCST", reason: `“${c.text}”: a fee for a group the job's fee fields do not hold (women, ex-servicemen and the like) — kept here, enter it in the editor's notes if it matters` });
  }
  // A clause naming other groups as well ("Women, SC, ST and PwBD candidates are exempted") still states the fee for
  // the groups it names; the others are said above.
  const forGroup = (g: Group) => priced.filter((c) => c.groups.includes(g));
  const all = priced.filter((c) => c.groups.length === 1 && c.groups[0] === "all");
  const pick = (field: string, label: string, named: Group[], also: Group[], doubtIfMissing: Group[]) => {
    const own = named.flatMap(forGroup);
    const stated = own.length ? own : all;
    if (stated.length === 0) return;
    const fees = [...new Set(stated.map((c) => c.fee!))];
    if (fees.length > 1) {
      out.refused.push({ fieldPath: field, reason: `the text gives ${label} more than one fee (${stated.map((c) => `“${c.text}”`).join("; ")}): the field holds one — enter it in the editor` });
      return;
    }
    // A group the field also covers, priced differently: the one field cannot say both.
    const differ = also.flatMap(forGroup).filter((c) => !stated.includes(c) && c.fee !== fees[0]);
    if (differ.length) {
      out.refused.push({ fieldPath: field, reason: `${label}: “${stated[0].text}” and “${differ[0].text}” differ, and the field holds one fee for them all — enter it in the editor` });
      return;
    }
    // A group the field is for that the text does not price: the fee is not widened to it, the item waits for the admin.
    const missing = own.length ? doubtIfMissing.filter((g) => forGroup(g).length === 0) : [];
    const quote = stated[0].line;
    out.values.push({ fieldPath: field, value: fees[0], quote,
      ...(missing.length ? { doubt: `the text gives this fee for ${[...named, ...also].filter((g) => stated.some((c) => c.groups.includes(g))).map((g) => g.toUpperCase()).join("/")}; ${missing.map((g) => g === "pwbd" ? "PwBD" : g.toUpperCase()).join(" and ")} ${missing.length === 1 ? "is" : "are"} not stated, and the field is for ${label} — check before ticking` } : {}),
      ...(/\bgst\b|\btax/i.test(quote) ? { notes: ["the fee is as written, before the tax the line mentions"] } : {}) });
  };
  pick("financial.feeGeneral", "General / OBC", ["general"], ["obc", "ews"], ["obc"]);
  pick("financial.feeSCST", "SC / ST / PwBD", ["sc", "st"], ["pwbd"], ["pwbd"]);
}

/** The one value two or more lines give for a field, or null (and both are said) when they disagree. */
function single<T>(field: string, label: string, found: Array<{ value: T; quote: string }>, out: LabelledReading): { value: T; quote: string } | null {
  if (found.length === 0) return null;
  const distinct = [...new Map(found.map((f) => [JSON.stringify(f.value), f])).values()];
  if (distinct.length > 1) {
    out.refused.push({ fieldPath: field, reason: `the text gives two different ${label}: ${distinct.slice(0, 3).map((d) => `“${d.quote}”`).join("; ")} — not offered; enter the right one in the editor` });
    return null;
  }
  return found[0];
}

function readAge(lines: string[], out: LabelledReading): void {
  const found: Array<{ value: AgeCriteria; quote: string; notes: string[] }> = [];
  for (const raw of lines) {
    const m = AGE_LINE.exec(raw);
    if (!m) continue;
    const line = cleanLine(raw);
    const range = /\b(\d{2})\s*(?:-|–|—|to)\s*(\d{2})\s*(?:years?|yrs?)\b/i.exec(line);
    if (RELAXATION_LINE.test(raw)) continue;
    let min = range ? Number(range[1]) : Number(/\b(?:minimum|min\.?|at\s+least)\s*[:\-]?\s*(?:age\s*[:\-]?\s*)?(?:of\s*)?(\d{2})\b/i.exec(line)?.[1] ?? NaN);
    let max = range ? Number(range[2]) : Number(/\b(?:maximum|max\.?|not\s+more\s+than|upper\s+age(?:\s+limit)?(?:\s+of)?|up\s*to|below)\s*[:\-]?\s*(\d{2})\b/i.exec(line)?.[1] ?? NaN);
    // "Maximum Age: 30 years": the label says which bound its one figure is (G3).
    const bound = /^\s*(?:[-*•]\s*)?(maximum|upper|minimum|lower)\s+age/i.exec(raw)?.[1]?.toLowerCase();
    const only = /\b(\d{2})\s*(?:years?|yrs?)\b/i.exec(m[1]);
    if (bound && !range && only && Number.isNaN(bound === "maximum" || bound === "upper" ? max : min)) {
      if (bound === "maximum" || bound === "upper") max = Number(only[1]); else min = Number(only[1]);
    }
    const ok = (n: number) => Number.isInteger(n) && n >= 14 && n <= 70;
    if (!ok(min) && !ok(max)) continue;
    if (ok(min) && ok(max) && min > max) { out.refused.push({ fieldPath: "age", reason: `“${line}”: the minimum age is above the maximum — not offered` }); continue; }
    const value: AgeCriteria = { relaxations: [] };
    if (ok(min)) value.min = min;
    if (ok(max)) value.max = max;
    const dates = parseDatesInText(line);
    if (dates.length === 1 && /\bas\s+(?:on|of)\b/i.test(line)) value.asOf = dates[0];
    const notes: string[] = [];
    if (/relax/i.test(line)) notes.push("the line mentions relaxation; no relaxation is read from it — enter the years by category from the notice");
    if (!value.asOf) notes.push("the line gives no date the age is counted on");
    found.push({ value, quote: line, notes });
  }
  const one = single("age", "age limits", found, out);
  if (!one) {
    for (const raw of lines) if (RELAXATION_LINE.test(raw)) out.refused.push({ fieldPath: "age", reason: `“${cleanLine(raw)}”: an age relaxation, but no age limit was read to put it with — enter it in the editor` });
    return;
  }
  const value: AgeCriteria = { ...one.value, relaxations: [...(one.value.relaxations ?? [])] };
  const notes = [...(found.find((f) => f.quote === one.quote)?.notes ?? [])];
  const evidence: NonNullable<AgeCriteria["evidence"]> = [];
  // Relaxations written "Age Relaxation: 5 years for SC/ST" (G3); in words only, they are said, not guessed.
  for (const raw of lines) {
    const r = RELAXATION_LINE.exec(raw);
    if (!r) continue;
    const line = cleanLine(raw);
    const parts = [...r[1].matchAll(/(\d{1,2})\s*(?:years?|yrs?)\s+(?:for|to)\s+([A-Za-z][A-Za-z/&, ()-]{1,40}?)(?:\s+candidates)?(?=[,;.]|$|\s+and\s+\d)/gi)];
    if (parts.length === 0) { out.refused.push({ fieldPath: "age", reason: `“${line}”: the relaxation is given in words only, no years by category — enter it in the editor` }); continue; }
    for (const p of parts) {
      const category = p[2].trim();
      if (!value.relaxations.some((x) => x.category === category)) value.relaxations.push({ category, years: Number(p[1]) });
      evidence.push({ about: `relaxation (read by code): ${category}`.slice(0, 120), value: p[1], quote: line });
    }
  }
  // The date the age is counted on, from a sentence that states this age limit "as on" one date (G3).
  if (!value.asOf && value.max !== undefined) {
    const said = lines.map(cleanLine).find((l) => /\bage\b/i.test(l) && /\bas\s+(?:on|of)\b/i.test(l) && new RegExp(`\\b${value.max}\\s*years?\\b`, "i").test(l) && parseDatesInText(l).length === 1 && l.length <= 300);
    if (said) {
      value.asOf = parseDatesInText(said)[0];
      evidence.push({ about: "asOf (read by code)", value: value.asOf, quote: said });
      const at = notes.indexOf("the line gives no date the age is counted on");
      if (at >= 0) notes.splice(at, 1);
    }
  }
  // "Born on or after 1 August 1996": the window as written; said when it does not fit the age limit and its date.
  let doubt: string | undefined;
  const born = lines.map(cleanLine).find((l) => /\bborn\s+on\s+or\s+after\b/i.test(l) && l.length <= 300);
  const bornDate = born ? writtenDate(born.slice(born.search(/\bborn\s+on\s+or\s+after\b/i))) : null;
  if (born && bornDate) {
    value.bornFrom = bornDate;
    evidence.push({ about: "bornFrom (read by code)", value: bornDate, quote: born });
    if (value.max !== undefined && value.asOf) {
      const d = new Date(`${value.asOf}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - value.max - 1);
      d.setUTCDate(d.getUTCDate() + 1);
      const expected = d.toISOString().slice(0, 10);
      if (expected !== bornDate) doubt = `the text says born on or after ${bornDate}, but a maximum of ${value.max} years as on ${value.asOf} means born on or after ${expected} — check the notice`;
    }
  }
  if (evidence.length) value.evidence = [...(value.evidence ?? []), ...evidence];
  out.values.push({ fieldPath: "age", value, quote: one.quote, ...(notes.length ? { notes } : {}), ...(doubt ? { doubt } : {}) });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** A date written "1 August 1996" or "01.08.1996" (any year: a date of birth), as YYYY-MM-DD. */
function writtenDate(s: string): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  const w = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+((?:19|20)\d{2})\b/.exec(s);
  if (w) { const m = MONTHS.findIndex((x) => x.startsWith(w[2].toLowerCase().slice(0, 3))); if (m >= 0 && Number(w[1]) <= 31) return `${w[3]}-${pad(m + 1)}-${pad(Number(w[1]))}`; }
  const n = /\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})\b/.exec(s);
  if (n && Number(n[1]) <= 31 && Number(n[2]) <= 12) return `${n[3]}-${pad(Number(n[2]))}-${pad(Number(n[1]))}`;
  return null;
}

function readPay(lines: string[], out: LabelledReading): void {
  const found = lines.flatMap((raw) => {
    const m = PAY_LINE.exec(raw);
    const value = m ? cleanLine(m[1]).replace(/[.;]+$/, "") : "";
    return value && value.length <= 160 && (/\d/.test(value) || /\blevel\b/i.test(value)) ? [{ value, quote: cleanLine(raw) }] : [];
  });
  const one = single("financial.payScale", "pay scales", found, out);
  if (one) out.values.push({ fieldPath: "financial.payScale", value: one.value, quote: one.quote });
}

/** The posts the text names in its post lines ("Post Name: Assistant Manager"). */
export function postsNamed(lines: string[]): string[] {
  return [...new Set(lines.flatMap((raw) => {
    const m = POST_LINE.exec(raw);
    const named = m ? cleanLine(m[1]).replace(/[.;]+$/, "").split(/,|\band\b/i).map((p) => p.trim()) : [];
    return named.filter((p) => p.length <= 120 && /[a-z]{3}/i.test(p));
  }))];
}

// A qualification and the experience written after it: "B.E. (Fire) …; with minimum 2 years experience in fire safety".
const EXPERIENCE_TAIL = /[;,]?\s*(?:with|and|plus)\s+(?:a\s+)?(?:minimum|min\.?|at\s+least)\s+(?:of\s+)?\d+\s*(?:\+\s*)?years?\b.*\bexperience\b.*$/i;
/** A qualification compared as written, but with "National Fire Service College (NFSC)" read as "NFSC" (G3). */
const sameQualification = (s: string) => s.replace(/\b((?:[A-Z][a-z]+\s+){1,6})\(([A-Z]{2,8})\)/g, (all, words: string, acr: string) =>
  (words.trim().split(/\s+/).map((w) => w[0]).join("") === acr ? acr : all)).toLowerCase().replace(/[^a-z0-9]+/g, "");

function readEligibility(lines: string[], out: LabelledReading): void {
  const experience: Array<{ value: string; quote: string }> = [];
  const found = lines.flatMap((raw) => {
    const m = ELIGIBILITY_LINE.exec(raw);
    let value = m ? cleanLine(m[1]).replace(/[;]+$/, "") : "";
    const tail = EXPERIENCE_TAIL.exec(value);
    if (tail) {
      experience.push({ value: tail[0].replace(/^[;,]?\s*(?:with|and|plus)\s+/i, "").replace(/[.;]+$/, "").trim(), quote: cleanLine(raw) });
      value = value.slice(0, tail.index).trim();
    }
    return value.length >= 6 && value.length <= 600 ? [{ value, quote: cleanLine(raw) }] : [];
  });
  for (const raw of lines) {
    const m = EXPERIENCE_LINE.exec(raw);
    const value = m ? cleanLine(m[1]).replace(/[.;]+$/, "") : "";
    if (!m || value.length < 3 || !/\d|\bno\b|\bnot\b|\bfresher/i.test(value)) continue;
    // As long as a qualification may be: alternative pathways are often written out in one line (SBI Fire: 399
    // characters). Longer still: said for the editor, never dropped without a word.
    if (value.length <= 600) experience.push({ value, quote: cleanLine(raw) });
    else out.refused.push({ fieldPath: "eligibility", reason: `the experience line is too long to read (${value.length} characters): enter it under its post in the editor — “${cleanLine(raw).slice(0, 120)}…”` });
  }
  // Two lines that say the same qualification, one abbreviating a name the other spells out, are one.
  const distinct = [...new Map(found.map((f) => [sameQualification(f.value), f])).values()];
  const one = single("eligibility", "eligibility lines", distinct.map((f) => ({ value: sameQualification(f.value), quote: f.quote })), out);
  const chosen = one ? distinct.find((f) => f.quote === one.quote) ?? null : null;
  if (!chosen && found.length > 0) return;
  if (!chosen && experience.length === 0) return;
  // Eligibility is kept post by post: the post is the one the text names, when it names exactly one.
  // "Posts: Clerk, Typist" names two posts: no single one to put the eligibility under.
  const posts = postsNamed(lines);
  const quote = chosen?.quote ?? experience[0].quote;
  if (posts.length !== 1) {
    out.refused.push({ fieldPath: "eligibility", reason: `“${quote}” names no${posts.length > 1 ? " single" : ""} post, and eligibility is kept post by post — enter it under its post in the editor` });
    return;
  }
  const exp = [...new Map(experience.map((e) => [e.value.toLowerCase(), e.value])).values()];
  const notes = [`the post is the one the text names (“${posts[0]}”)`];
  if (found.length > distinct.length) notes.push("two lines give the same qualification (one abbreviates a name the other spells out): one is kept");
  if (exp.length) notes.push(`experience as written: ${exp.map((e) => `“${e}”`).join("; ")}`);
  out.values.push({ fieldPath: "eligibility", quote,
    value: [{ post: posts[0], ...(chosen ? { qualification: [chosen.value] } : {}), ...(exp.length ? { experience: exp } : {}) }] satisfies CmsRecruitmentPost[], notes });
}

function readSelection(lines: string[], out: LabelledReading, stageType: (name: string) => SelectionStageType): void {
  const found = lines.flatMap((raw) => {
    const m = SELECTION_LINE.exec(raw);
    if (!m) return [];
    const names = m[1].split(/,|;|→|->|\bfollowed\s+by\b|\bthen\b|\band\b(?![^(]*\))/i)
      .map((s) => s.replace(/^\s*(?:a|an|the)\s+/i, "").replace(/[.\s]+$/, "").trim()).filter((s) => s.length >= 2 && s.length <= 80);
    return names.length ? [{ value: names, quote: cleanLine(raw) }] : [];
  });
  const one = single("selection", "selection processes", found, out);
  if (one) {
    out.values.push({ fieldPath: "selection", quote: one.quote,
      value: { stages: one.value.map((name, i) => ({ name, order: i + 1, type: stageType(name) })) } satisfies CmsSelectionInformation });
  }
}

function readHowToApply(lines: string[], out: LabelledReading): void {
  for (let i = 0; i < lines.length; i++) {
    const m = HOW_LINE.exec(lines[i]);
    if (!m) continue;
    let steps = m[1].trim() ? m[1].split(/;|\.\s+|,\s*then\b|\bthen\b|,/i) : [];
    let quote = cleanLine(lines[i]);
    if (!m[1].trim()) {
      // The steps on the lines below the label, as a list.
      const list: string[] = [];
      for (let j = i + 1; j < lines.length && /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/.test(lines[j]); j++) list.push(lines[j].replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, ""));
      steps = list;
      quote = list.length ? cleanLine(lines[i + 1]) : quote;
    }
    const clean = steps.map((s) => cleanLine(s).replace(/[.;]+$/, "")).filter((s) => s.length >= 3 && s.length <= 220).slice(0, 8);
    if (clean.length) { out.values.push({ fieldPath: "howToApply", value: clean, quote }); return; }
  }
}

/** What the labelled lines of a pasted text give, each value quoted from its own line. */
export function readLabelledLines(text: string, opts: { stageType: (name: string) => SelectionStageType }): LabelledReading {
  const out: LabelledReading = { values: [], refused: [] };
  const raw = text.replace(/\r/g, "").split("\n");
  // G3: a pasted article's table rows, next-line values and fee tables, as labelled lines, each with its own words.
  const pairs = pairsOf(raw);
  const extra = labelledFromPairs(raw, pairs);
  const quoteOf = new Map(extra.map((e) => [cleanLine(e.line), e.quote]));
  // A copied table row ("Post Name<TAB>Assistant Manager - Engineer (Fire)") is read as its pair above, never as a
  // labelled line, whose " - " would split it in the wrong place.
  const lines = [...raw.map((l) => (l.includes("\t") ? "" : l)), ...extra.map((e) => e.line)];
  readFees(lines, out);
  readPay(lines, out);
  readAge(lines, out);
  readEligibility(lines, out);
  readSelection(raw, out, opts.stageType);
  readHowToApply(raw, out);
  // A value read from a written-out line is quoted with the words of the text it came from.
  for (const v of out.values) v.quote = quoteOf.get(v.quote) ?? v.quote;
  const article = readArticle(raw, pairs, postsNamed(lines), opts);
  out.values.push(...article.values);
  out.refused.push(...article.refused);
  return out;
}
