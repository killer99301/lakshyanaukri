// ═══════════════════════════════════════════════════════════
// G3: a pasted recruitment article read by code (no AI)
// ═══════════════════════════════════════════════════════════
//
// Pure. Portal articles (Adda247, GovtJobGuru and the like) print most facts
// as a label and its value: "Label: value", a table row copied as
// "Label<TAB>value" or "| Label | value |", or the label on one line and the
// value on the next. This module finds those pairs for a fixed list of labels
// only, so a FAQ, a "related jobs" box or a tag line is never read as a field,
// and gives:
//   - the pairs the labelled-line readers (prepared-fields.ts) already
//     understand, written as "Label: value" lines, each with the words of the
//     text as its quote (a fee table's rows become fee lines);
//   - readers of its own for what those do not read: the notice number, the
//     total and the category-wise vacancies, the dates, the stages and the exam
//     pattern of a selection section, the steps of a "How to apply" section,
//     and the conditions the job's fields have no place for (contract, posting,
//     probation, documents…), kept as the job's admin notes;
//   - what it could not place, said for the review (Left out), never dropped.
// Every value is quoted from the text. Nothing is worked out or filled in: a
// total that is "Not specified" stays without a number, a figure that could be
// a year is said, and two values for one field are both shown.

import type { CmsSelectionInformation, ExamPatternPaper, SelectionStageType } from "@/types/recruitment-record";
import type { VacancyRow } from "@/types";
import { parseDatesInText } from "@/lib/cms/ai-assist";

export interface ArticleValue { fieldPath: string; value: unknown; quote: string; doubt?: string; notes?: string[] }
export interface ArticleReading { values: ArticleValue[]; refused: Array<{ fieldPath: string; reason: string }> }

export interface Pair { label: string; value: string; quote: string; line: number; shape: "colon" | "tab" | "table" | "below" }

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const LABEL = (s: string) => clean(s).replace(/[:：]\s*$/, "").replace(/^[-*•]\s*/, "");

// ── The labels this reader knows ──
const L = {
  notice: /^(?:notification|notice|advt\.?|advertisement)\s*(?:number|no\.?)$|^advt\.?\s*no\.?$/i,
  organisation: /^(?:conducting\s+|recruiting\s+)?organi[sz]ation(?:\s+name)?$|^name\s+of\s+(?:the\s+)?organi[sz]ation$|^recruiting\s+body$/i,
  post: /^(?:name\s+of\s+(?:the\s+)?posts?|post\s+names?|posts?)$/i,
  total: /^(?:total\s+(?:number\s+of\s+)?vacanc(?:y|ies)|(?:no\.?|number)\s+of\s+(?:vacanc(?:y|ies)|posts)|total\s+posts|vacanc(?:y|ies))$/i,
  qualification: /^(?:minimum\s+|educational\s+|essential\s+|academic\s+)?qualifications?$|^eligibility(?:\s+criteria)?$/i,
  experience: /^(?:work\s+|minimum\s+|required\s+)?experience$/i,
  age: /^(?:age\s*limits?|age|(?:maximum|minimum|upper|lower)\s+age(?:\s+limits?)?)$/i,
  relaxation: /^age\s+relaxations?$/i,
  fee: /^(?:application|exam(?:ination)?|registration)\s+fees?$|^fees?$/i,
  pay: /^(?:pay\s*scale|pay\s*level|pay|salary|(?:total\s+)?ctc|cost\s+to\s+company|emoluments|remuneration|stipend)$/i,
  selection: /^(?:selection\s+(?:process|procedure)|mode\s+of\s+selection)$/i,
  // Conditions the job's fields have no place for: kept as the job's notes (admin only, not published).
  condition: /^(?:job\s+location|posting(?:\s+location)?|place\s+of\s+posting|probation(?:\s+period)?|(?:initial\s+)?contract(?:\s+period)?|job\s+(?:role|profile|type)|grade\s*\/\s*scale|grade|(?:service\s+)?bond|perquisites|application\s+mode|mode\s+of\s+application|documents?\s+required|travel\s+reimbursement(?:\s+for\s+interview)?|biometric\s*\/\s*iris\s+verification|key\s+responsibility\s+areas|specific\s+skills\s+required|obc\s+candidates|ews\s+candidates|legal\s+jurisdiction|examination\s+centres?|bank['’]s\s+right)$/i,
} as const;
const DATE_LABEL = /\b(?:date|dates|starts?|begins?|opens?|ends?|closes?|last\s+date|deadline|period|window)\b/i;
const known = (label: string) => Object.values(L).some((r) => r.test(label)) || (DATE_LABEL.test(label) && dateKind(label) !== null);

/** Which date a label names: the application's opening or closing, the fee deadline, or both ends of a range. */
export function dateKind(label: string): "open" | "close" | "fee" | "range" | null {
  const l = label.toLowerCase();
  if (/\b(?:birth|born|age|as\s+on)\b/.test(l)) return null;
  if (/\b(?:fee|payment)\b/.test(l)) return /\b(?:last|end|ends|close|closes|closing|deadline)\b/.test(l) ? "fee" : null;
  if (/^(?:online\s+)?(?:application|registration)\s+(?:dates?|period|window)$/.test(l)) return "range";
  const applying = /\b(?:registration|application|apply|applying|online\s+form)\b/.test(l);
  if (applying && /\b(?:start|starts|starting|begin|begins|beginning|commence\w*|open|opens|opening)\b/.test(l)) return "open";
  if (/^(?:starting|opening|start)\s+date$/.test(l)) return "open";
  if (/\blast\s+date\b/.test(l) && !/\b(?:exam|interview|result|admit|call\s+letter|correction)\b/.test(l)) return "close";
  if (applying && /\b(?:end|ends|close|closes|closing)\b/.test(l)) return "close";
  return null;
}

/** A line that ends a section: a short heading that names another section, or any title-like line of four words or more. */
const SECTION_WORDS = /\b(?:important\s+(?:links|dates)|application\s+fees?|documents?\s+required|selection\s+(?:process|procedure)|salary|pay\s+scale|eligibility|age\s+limits?|qualifications?|vacanc(?:y|ies)|how\s+to\s+apply|frequently\s+asked|faqs?|other\s+important|related\b|tags\b|must\s+check|overview|job\s+profile|posting\s+location|work\s+experience|notification\s+\d{4}\s+pdf|apply\s+online\s+\d{4})\b/i;
function headingLike(line: string): boolean {
  const t = clean(line);
  if (!t || t.length > 110 || /[.,;]$/.test(t) || /^[-*•]/.test(t) || /\t|https?:\/\//.test(t) || /:\s*\S/.test(t)) return false;
  const words = t.replace(/[:?]$/, "").split(/\s+/);
  const capitals = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
  return words.length >= 2 && capitals / words.length >= 0.6;
}
const endsSection = (line: string) => headingLike(line) && (SECTION_WORDS.test(line) || clean(line).split(/\s+/).length >= 4);

// ── Pairs ──
/** The label-value pairs of a text, for the labels above. */
export function pairsOf(lines: string[]): Pair[] {
  const out: Pair[] = [];
  const cells = (raw: string): string[] | null => {
    const md = /^\s*\|(.+)\|\s*$/.exec(raw);
    if (md) { const c = md[1].split("|").map(clean); return c.every((x) => /^:?-{2,}:?$/.test(x)) ? null : c; }
    if (raw.includes("\t")) return raw.split("\t").map(clean).filter((x, i, a) => x || (i > 0 && i < a.length - 1));
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const c = cells(raw);
    if (c && c.length === 2 && c[0] && c[1]) {
      const label = LABEL(c[0]);
      if (known(label)) out.push({ label, value: c[1], quote: `${c[0]} ${c[1]}`, line: i, shape: raw.trim().startsWith("|") ? "table" : "tab" });
      continue;
    }
    if (c) continue;
    const colon = /^\s*(?:[-*•]\s*)?([A-Za-z][A-Za-z0-9 .'’/&()-]{1,60}?)\s*[:：]\s+(\S.*)$/.exec(raw);
    if (colon && !/https?$/i.test(colon[1])) {
      const label = LABEL(colon[1]);
      if (known(label)) { out.push({ label, value: clean(colon[2]), quote: clean(raw), line: i, shape: "colon" }); continue; }
    }
    // The label alone on its line, the value on the next: a value is short, not a sentence, and not another label.
    const label = LABEL(raw);
    if (label && label.length <= 60 && !/[.?!]$/.test(clean(raw)) && known(label)) {
      let j = i + 1;
      while (j < lines.length && !clean(lines[j])) j++;
      const value = j < lines.length ? clean(lines[j]) : "";
      if (value && value.length <= 160 && !/[.!?:]$/.test(value) && !lines[j].includes("\t") && !known(LABEL(value)) && !/^show\s+(?:more|less)$/i.test(value)) {
        out.push({ label, value, quote: `${label} ${value}`, line: i, shape: "below" });
        i = j;
      }
    }
  }
  return out;
}

/**
 * The pairs the labelled-line readers understand, written as "Label: value" lines (tab, table and next-line pairs,
 * and the rows of a fee table), each with the words of the text that state it. Lines already written "Label: value"
 * are left to those readers as they are.
 */
export function labelledFromPairs(lines: string[], pairs: Pair[]): Array<{ line: string; quote: string }> {
  const out: Array<{ line: string; quote: string }> = [];
  const forReaders = (label: string) => L.fee.test(label) || L.pay.test(label) || L.age.test(label) || L.relaxation.test(label) || L.qualification.test(label) || L.post.test(label) || L.experience.test(label);
  for (const p of pairs) if (p.shape !== "colon" && forReaders(p.label)) out.push({ line: `${p.label}: ${p.value}`, quote: p.quote });
  // A fee table: a header row naming the category and the fee, then a category and its fee on each row.
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].includes("\t") ? lines[i].split("\t").map(clean) : null;
    if (!head || head.length !== 2 || !/categor/i.test(head[0]) || !/\bfees?\b/i.test(head[1])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j].includes("\t") ? lines[j].split("\t").map(clean) : null;
      if (!row || row.length !== 2 || !row[0] || !row[1]) break;
      out.push({ line: `Application fee: ${row[0]} ${row[1]}`, quote: `${row[0]} ${row[1]}` });
    }
  }
  return out;
}

// ── Readers of their own ──

function readNotice(pairs: Pair[], out: ArticleReading): void {
  const found = pairs.filter((p) => L.notice.test(p.label)).map((p) => {
    let v = p.value.replace(/^(?:advt\.?|advertisement|notice|notification)\s*(?:no\.?|number)\s*[:.-]?\s*/i, "").replace(/[.,;]+$/, "").trim();
    // A closing bracket the number does not open belongs to the sentence around it.
    if (v.endsWith(")") && (v.match(/\(/g) ?? []).length < (v.match(/\)/g) ?? []).length) v = v.slice(0, -1);
    return { v, p };
  }).filter(({ v }) => /\d/.test(v) && v.length <= 60);
  for (const { v, p } of found) out.values.push({ fieldPath: "identity.notificationNumber", value: v, quote: p.quote });
}

function readOrganisation(pairs: Pair[], out: ArticleReading): void {
  for (const p of pairs.filter((x) => L.organisation.test(x.label))) {
    out.refused.push({ fieldPath: "identity.organizationName", reason: `the text names the recruiting body “${p.value}”: the job's organisation is the one set for the job — check that it is the same` });
  }
}

const CATEGORY = /\b(UR|GEN(?:ERAL)?|EWS|OBC|SC|ST|PWBD|PWD|PH)\s*[-–:=]?\s*(\d{1,6})\b/gi;
const KEY: Record<string, "ur" | "ews" | "obc" | "sc" | "st" | "pwbd"> = { UR: "ur", GEN: "ur", GENERAL: "ur", EWS: "ews", OBC: "obc", SC: "sc", ST: "st", PWBD: "pwbd", PWD: "pwbd", PH: "pwbd" };
const yearLike = (n: number) => n >= 1900 && n <= 2199;

function readVacancies(pairs: Pair[], posts: string[], out: ArticleReading): void {
  for (const p of pairs.filter((x) => L.total.test(x.label))) {
    if (/\bnot\s+(?:specified|mentioned|disclosed|notified|announced|given)\b|\bto\s+be\s+(?:announced|notified)\b|^(?:tba|tbd|n\/?a|nil|various|—|-)$/i.test(p.value)) {
      out.refused.push({ fieldPath: "vacancies.total", reason: `the text says “${p.quote}”: no number is offered. When checking against the notice, record it as not stated if the notice gives none.` });
      continue;
    }
    // A date where a count should be ("Total Vacancies: 25/11/2026") is not read as 25 vacancies.
    if (parseDatesInText(p.value).length > 0 || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(p.value)) {
      out.refused.push({ fieldPath: "vacancies.total", reason: `“${p.quote}” gives a date, not a number of vacancies: not read` });
      continue;
    }
    const m = /^(\d[\d,]*)(?![\d.,/-]*\d)\b/.exec(p.value);
    if (!m) { out.refused.push({ fieldPath: "vacancies.total", reason: `“${p.quote}” gives no figure at its start: not read as a number of vacancies` }); continue; }
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isInteger(n) || n <= 0 || n > 200_000) continue;
    const doubt = yearLike(n) && !/\b(?:posts?|vacanc|seats?)\b/i.test(p.value) ? `${n} could be a year, not a number of vacancies — check it against the notice` : undefined;
    out.values.push({ fieldPath: "vacancies.total", value: n, quote: p.quote, ...(doubt ? { doubt } : {}) });
    // Category-wise vacancies written after the total: "17 (SC-2, ST-2 [including 1 backlog], OBC-1, EWS-1, UR-11)".
    const rest = p.value.slice(m[0].length);
    const split: Partial<Record<"ur" | "ews" | "obc" | "sc" | "st" | "pwbd", number>> = {};
    let repeated = false;
    for (const c of rest.matchAll(CATEGORY)) {
      const k = KEY[c[1].toUpperCase()];
      if (split[k] !== undefined) repeated = true;
      split[k] = Number(c[2]);
    }
    const keys = Object.keys(split) as Array<keyof typeof split>;
    if (keys.length < 2) continue;
    const sum = keys.filter((k) => k !== "pwbd").reduce((s, k) => s + (split[k] ?? 0), 0);
    if (repeated || /\bSC\s*\/\s*ST\b|\bOBC\s*\/\s*EWS\b/i.test(rest)) {
      out.refused.push({ fieldPath: "vacancies.breakdown", reason: `“${p.quote}”: categories are combined or repeated, so the split is not read — enter it in the editor` });
      continue;
    }
    if (sum !== n) {
      out.refused.push({ fieldPath: "vacancies.breakdown", reason: `“${p.quote}”: the categories add up to ${sum}, not ${n} — the split is not offered; check the notice` });
      continue;
    }
    if (posts.length !== 1) {
      out.refused.push({ fieldPath: "vacancies.breakdown", reason: `“${p.quote}” gives a split by category, but the text names ${posts.length ? "more than one post" : "no post"} for it — enter it under its post in the editor` });
      continue;
    }
    const { pwbd, ...main } = split;
    const notes = [/\bbacklog\b/i.test(rest) ? `the text says part of it is backlog (“${(/\[[^\][]*backlog[^\][]*\]/i.exec(rest) ?? /\([^()]*backlog[^()]*\)/i.exec(rest) ?? [""])[0]}”): kept as printed in the quote` : "",
      pwbd !== undefined ? `PwBD ${pwbd} is not added to the total (PwBD posts are usually counted within the categories)` : ""].filter(Boolean);
    out.values.push({ fieldPath: "vacancies.breakdown", value: [{ post: posts[0], count: n, breakdown: main }] satisfies VacancyRow[], quote: p.quote, ...(notes.length ? { notes } : {}) });
  }
}

function readDates(pairs: Pair[], out: ArticleReading): void {
  const field = { open: "dates.applicationOpenDate", close: "dates.applicationCloseDate", fee: "dates.feePaymentCloseDate" } as const;
  for (const p of pairs) {
    const kind = dateKind(p.label);
    if (!kind || L.notice.test(p.label)) continue;
    const dates = parseDatesInText(p.value);
    if (kind === "range") {
      if (dates.length === 2 && dates[0] <= dates[1]) {
        out.values.push({ fieldPath: field.open, value: dates[0], quote: p.quote });
        out.values.push({ fieldPath: field.close, value: dates[1], quote: p.quote });
      } else if (dates.length) out.refused.push({ fieldPath: field.open, reason: `“${p.quote}”: not read as a start and an end date` });
      continue;
    }
    if (dates.length === 1) out.values.push({ fieldPath: field[kind], value: dates[0], quote: p.quote });
    else if (dates.length > 1) out.refused.push({ fieldPath: field[kind], reason: `“${p.quote}” gives ${dates.length} dates: not offered — enter the right one in the editor` });
  }
}

function readConditions(lines: string[], pairs: Pair[], out: ArticleReading): void {
  const items: Array<{ text: string; quote: string }> = [];
  // A note holds up to 500 characters (the editor's limit): a longer one is split at its sentences, never cut off.
  const add = (text: string, quote: string) => {
    const t = clean(text);
    if (!t || items.some((i) => i.text === t)) return;
    if (t.length <= 500) { items.push({ text: t, quote }); return; }
    let piece = "";
    for (const s of t.split(/(?<=[.;])\s+/)) {
      if (piece && (piece + " " + s).length > 500) { items.push({ text: piece, quote }); piece = "(continued) "; }
      piece = piece ? `${piece}${piece.endsWith(" ") ? "" : " "}${s}` : s;
      while (piece.length > 500) { items.push({ text: piece.slice(0, 500), quote }); piece = `(continued) ${piece.slice(500)}`; }
    }
    if (piece.trim()) items.push({ text: piece, quote });
  };
  for (const p of pairs) if (L.condition.test(p.label)) add(`${p.label}: ${p.value}`, p.quote);
  // A section the fields have no place for, under its own heading: the first sentences under it, as they are.
  const SECTIONS: Array<[RegExp, string]> = [
    [/\bposting\s+location\b|\bplace\s+of\s+posting\b/i, "Posting"],
    [/\bjob\s+profile\b|\bemployment\s+terms\b|\bservice\s+conditions\b/i, "Job profile and terms"],
  ];
  for (let i = 0; i < lines.length; i++) {
    const head = clean(lines[i]);
    const sec = SECTIONS.find(([r]) => r.test(head));
    if (!sec || !headingLike(head)) continue;
    const said: string[] = [];
    for (let j = i + 1; j < lines.length && said.length < 8; j++) {
      const l = clean(lines[j]);
      if (!l) continue;
      if (endsSection(l)) break;
      if (/[.]$/.test(l) && l.length >= 30) said.push(l);
    }
    if (said.length) add(`${sec[1]}: ${said.join(" ")}`, said[0]);
  }
  // Allowances stated in a sentence of their own, and a salary's components table.
  for (const raw of lines) {
    const l = clean(raw);
    if (/\ballowance\b/i.test(l) && /(?:₹|rs\.?)\s*[\d,]+/i.test(l) && l.length <= 400 && !l.includes("\t")) add(`Allowance: ${l}`, l);
  }
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].includes("\t") ? lines[i].split("\t").map(clean) : null;
    if (!head || head.length !== 2 || !/^component$/i.test(head[0]) || !/^amount$/i.test(head[1])) continue;
    const rows: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j].includes("\t") ? lines[j].split("\t").map(clean) : null;
      if (!row || row.length !== 2) break;
      rows.push(`${row[0]}: ${row[1]}`);
    }
    if (rows.length) add(`Pay components: ${rows.join("; ")}`, rows[0].replace(": ", " "));
  }
  if (items.length === 0) return;
  // The job holds up to 30 notes: any beyond are named for the review, not dropped unsaid.
  if (items.length > 30) out.refused.push({ fieldPath: "conditions", reason: `${items.length - 30} more notes than the job can hold: ${items.slice(30).map((i) => `“${i.text.slice(0, 60)}”`).join("; ")} — add them in the editor if they matter` });
  out.values.push({ fieldPath: "conditions", value: items.slice(0, 30).map((i) => i.text), quote: items[0].quote,
    notes: ["each note is a labelled line or section of the text, kept as it is for the editor (admin only, not published)"] });
}

const initials = (s: string) => s.split(/[\s/-]+/).filter(Boolean).map((w) => w[0]).join("").toLowerCase();
const sameStage = (a: string, b: string) => {
  const x = a.toLowerCase().replace(/[^a-z ]/g, "").trim(), y = b.toLowerCase().replace(/[^a-z ]/g, "").trim();
  return x === y || x === initials(b) || y === initials(a);
};

function readSelectionSection(lines: string[], pairs: Pair[], out: ArticleReading, stageType: (name: string) => SelectionStageType): void {
  // The stages a summary line gives ("Shortlisting, GD and/or PI, Psychometric Assessment").
  const summary = pairs.filter((p) => L.selection.test(p.label) && p.shape !== "colon").map((p) => ({
    names: p.value.split(/,|;|→|->|\band\s*\/\s*or\b|\bfollowed\s+by\b|\bthen\b|\band\b(?![^(]*\))/i).map(clean).filter((s) => s.length >= 2 && s.length <= 80), quote: p.quote,
  })).filter((s) => s.names.length > 0);
  let found: { stages: string[]; quote: string; pattern: ExamPatternPaper | null; descriptions: Record<string, string>; merit: string[]; patternQuote: string } | null = null;
  for (let i = 0; i < lines.length && !found; i++) {
    const head = clean(lines[i]);
    if (!/\bselection\s+(?:process|procedure|stages?)\b/i.test(head) || !(headingLike(head) || /^selection\s+(?:process|procedure)\s*:?$/i.test(head))) continue;
    const headers: Array<{ name: string; at: number }> = [];
    const list: Array<{ name: string; at: number }> = [];
    const body: Array<{ text: string; at: number }> = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = clean(lines[j]);
      if (!l) continue;
      if (/\bselection\s+(?:process|procedure|stages?)\b/i.test(l) && l.length <= 60 && !/[.]$/.test(l)) continue; // the heading repeated
      if (endsSection(l) && !/:$/.test(l)) break;
      if (/:$/.test(l) && l.length <= 60) { headers.push({ name: l.replace(/:$/, "").trim(), at: j }); continue; }
      if (l.length <= 60 && !/[.:;,]/.test(l) && !/\d/.test(l)) { list.push({ name: l, at: j }); continue; }
      body.push({ text: l, at: j });
    }
    const stageHeaders = headers.filter((h) => !/\b(?:merit|tie|cut[\s-]?off|normali[sz]ation|note)\b/i.test(h.name));
    if (stageHeaders.length >= 1) {
      // Under each stage header, its lines; an exam pattern from "Subject: N Questions, M Marks, T Minutes" rows.
      const under = (h: { at: number }) => {
        const next = headers.find((x) => x.at > h.at)?.at ?? Infinity;
        return body.filter((b) => b.at > h.at && b.at < next).map((b) => b.text).concat(list.filter((b) => b.at > h.at && b.at < next).map((b) => b.name));
      };
      let pattern: ExamPatternPaper | null = null;
      let patternQuote = "";
      const descriptions: Record<string, string> = {};
      for (const h of stageHeaders) {
        const rows = under(h);
        const sections = rows.flatMap((r) => {
          const m = /^(.+?):\s*(\d+)\s*questions?\s*,\s*(\d+)\s*marks?/i.exec(r);
          return m && !/^total$/i.test(m[1].trim()) ? [{ subject: m[1].trim(), questions: Number(m[2]), marks: Number(m[3]) }] : [];
        });
        if (sections.length >= 1 && !pattern) {
          const total = rows.map((r) => /^total\s*:\s*(\d+)\s*questions?\s*,\s*(\d+)\s*marks?\s*(?:,\s*(\d+)\s*(hours?|minutes?|mins?))?/i.exec(r)).find(Boolean);
          const negative = rows.find((r) => /\bnegative\s+marking\b|\bpenalty\b/i.test(r));
          pattern = { name: h.name, sections,
            ...(total ? { totalQuestions: Number(total[1]), totalMarks: Number(total[2]) } : {}),
            ...(total?.[3] ? { durationMinutes: Number(total[3]) * (/hour/i.test(total[4]) ? 60 : 1) } : {}),
            ...(negative ? { negativeMarking: negative } : {}) };
          patternQuote = rows.find((r) => /questions?/i.test(r)) ?? "";
          const sum = sections.reduce((s, x) => s + x.questions, 0);
          if (total && sum !== Number(total[1])) pattern.note = `the sections add up to ${sum} questions; the total line says ${total[1]}`;
        } else if (rows.length) descriptions[h.name] = rows.slice(0, 2).join("; ").slice(0, 200);
      }
      const merit = headers.filter((h) => /\bmerit\b/i.test(h.name)).flatMap((h) => under(h)).slice(0, 6);
      found = { stages: stageHeaders.map((h) => h.name), quote: clean(lines[stageHeaders[0].at]), pattern, descriptions, merit, patternQuote };
    } else if (list.length >= 2) {
      found = { stages: list.map((x) => x.name).slice(0, 8), quote: list[0].name, pattern: null, descriptions: {}, merit: [], patternQuote: "" };
    }
  }
  const stagesOf = (names: string[], descriptions: Record<string, string> = {}) => names.map((name, i) => ({ name, order: i + 1, type: stageType(name), ...(descriptions[name] ? { description: descriptions[name] } : {}) }));
  if (found) {
    const value: CmsSelectionInformation = { stages: stagesOf(found.stages, found.descriptions), ...(found.merit.length ? { finalMeritFormula: found.merit.join("; ").slice(0, 400) } : {}) };
    out.values.push({ fieldPath: "selection", value, quote: found.quote, notes: ["the stages are the selection section's own list, read by code"] });
    if (found.pattern) out.values.push({ fieldPath: "examPattern", value: [found.pattern], quote: found.patternQuote || found.quote, ...(found.pattern.note ? { doubt: found.pattern.note } : {}) });
    // A summary line naming the same stages (by name or initials, "GD" for Group Discussion) agrees; one that does not is shown too.
    for (const s of summary) {
      const agrees = s.names.length === found.stages.length && s.names.every((n, k) => sameStage(n, found!.stages[k]));
      if (!agrees) out.values.push({ fieldPath: "selection", value: { stages: stagesOf(s.names) } satisfies CmsSelectionInformation, quote: s.quote });
    }
    return;
  }
  for (const s of summary) out.values.push({ fieldPath: "selection", value: { stages: stagesOf(s.names) } satisfies CmsSelectionInformation, quote: s.quote });
}

const FILLER = /^(?:here\s+is|here\s+are|candidates\s+(?:can|should|are\s+advised|may)|the\s+candidates|the\s+application\s+(?:procedure|process)|we\s+advise|eligible\s+candidates\s+can|follow\s+the|read\s+the\s+steps|the\s+steps)/i;

function readHowSection(lines: string[], out: ArticleReading): void {
  for (let i = 0; i < lines.length; i++) {
    const head = clean(lines[i]);
    if (!/^how\s+to\s+apply\b/i.test(head) || head.length > 110 || /[.]$/.test(head) || /[:：]\s*\S/.test(head)) continue;
    const steps: string[] = [];
    for (let j = i + 1; j < lines.length && steps.length < 12; j++) {
      const l = clean(lines[j]);
      if (!l || /^show\s+(?:more|less)$/i.test(l)) continue;
      if (endsSection(l)) break;
      if (FILLER.test(l) || l.length > 220 || l.length < 6) continue;
      steps.push(l.replace(/^(?:[-*•]|\d{1,2}[.)])\s*/, "").replace(/[.;]+$/, ""));
    }
    if (steps.length >= 2) { out.values.push({ fieldPath: "howToApply", value: steps.slice(0, 10), quote: steps[0], notes: ["the steps under the text's “How to apply” heading, read by code"] }); return; }
  }
}

function readLinksNote(lines: string[], out: ArticleReading): void {
  const named = lines.map(clean).filter((l) => /\bclick\s+here\b/i.test(l) && !/https?:\/\//i.test(l) && /\b(?:apply|notification|official\s+website|careers?)\b/i.test(l))
    .map((l) => l.replace(/\s*click\s+here.*$/i, "").trim()).filter(Boolean);
  if (named.length === 0) return;
  out.refused.push({ fieldPath: "links#APPLY_ONLINE", reason: `the text lists ${named.slice(0, 4).map((n) => `“${n}”`).join(", ")} as “Click Here” with no address in the pasted text: no link is made up. Bring the page in by its address (the links come with it), or add them in Links.` });
}

/** What a pasted article gives beyond the labelled-line readers, every value quoted from it. */
export function readArticle(lines: string[], pairs: Pair[], posts: string[], opts: { stageType: (name: string) => SelectionStageType }): ArticleReading {
  const out: ArticleReading = { values: [], refused: [] };
  readNotice(pairs, out);
  readOrganisation(pairs, out);
  readVacancies(pairs, posts, out);
  readDates(pairs, out);
  readSelectionSection(lines, pairs, out, opts.stageType);
  readHowSection(lines, out);
  readConditions(lines, pairs, out);
  readLinksNote(lines, out);
  return out;
}
