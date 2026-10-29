// ═══════════════════════════════════════════════════════════
// Upper-age relaxations printed as a list or a coded table, read by code (B2.6)
// ═══════════════════════════════════════════════════════════
//
// UPSC prints its relaxations as lettered clauses under "The upper age-limit
// prescribed above will be relaxable": "(a) up to a maximum of five years if
// a candidate belongs to a Scheduled Caste or a Scheduled Tribe; (b) up to a
// maximum of three years in the case of … Other Backward Classes …". SSC
// prints a table of codes: "01 SC/ST 5 years", "04 PwBD (OBC) 13 years". The
// AI read them in one run and left them out in another. Code reads each
// clause or row that gives a number of years, word for word, so the reading
// keeps every printed relaxation; a clause naming several groups, or none, or
// no number of years, is left to the AI and the admin, never guessed.

export interface StatedRelaxation { category: string; years: number; text?: string; quote: string }

const ANCHOR = /(?:upper\s+age[\s-]*limit[^.;]{0,80}?relaxable|relaxable\s*:|age\s+relaxation|relaxation\s+(?:in|of)\s+(?:the\s+)?upper\s+age)/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15 };
const YEARS = /up\s+to\s+(?:a\s+)?(?:maximum\s+(?:of\s+)?)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\s+years?/i;
// Each group a clause may name, with the label the age checker matches. An ex-servicemen clause also says
// "Commissioned Officers" and ECOs: it is the ex-servicemen's.
const GROUPS: Array<{ re: RegExp; label: string; member: string }> = [
  { re: /ex-?\s?servicem[ae]n/i, label: "Ex-Servicemen", member: "esm" },
  { re: /\bECOs?\b|\bSSCOs?\b/, label: "ECOs/SSCOs", member: "eco" },
  { re: /defence\s+(?:services?\s+)?personnel/i, label: "Defence Services Personnel", member: "defence" },
  { re: /benchmark\s+disabilit|\bPwBDs?\b|\bPwDs?\b/i, label: "Persons with Benchmark Disabilities (PwBD)", member: "pwbd" },
  { re: /other\s+backward\s+class|\bOBCs?\b/i, label: "Other Backward Classes (OBC)", member: "obc" },
  { re: /scheduled\s+castes?|\bSC\b/i, label: "Scheduled Caste (SC)", member: "sc" },
  { re: /scheduled\s+tribes?|\bST\b/i, label: "Scheduled Tribe (ST)", member: "st" },
];

/**
 * The groups a relaxation's category stands for, all of them: "PwBD (OBC)" is
 * PwBD and OBC, a different row from "PwBD". Two readings name the same
 * relaxation only when the sets are equal.
 */
export function relaxationMembers(category: string): string[] {
  const all = GROUPS.filter((g) => g.re.test(category)).map((g) => g.member);
  return all[0] === "esm" ? ["esm"] : all.sort();
}

export function statedRelaxations(text: string): StatedRelaxation[] {
  const at = text.search(ANCHOR);
  if (at < 0) return [];
  const window = text.slice(at, at + 4000);
  const lettered = listed(window);
  return lettered.length ? lettered : coded(window);
}

/** Lettered clauses (UPSC). */
function listed(window: string): StatedRelaxation[] {
  // The list runs from its heading to the first note or the next numbered paragraph. Case matters: "(III)
  // Educational Qualifications" ends it, "(iii) on invalidment" inside a clause does not.
  const end = window.search(/\n\s*(?:Note\b|NOTE\b|N\.B\.|\(III\)|\d+\.\s+[A-Z])/);
  const list = end > 0 ? window.slice(0, end) : window;
  const out: StatedRelaxation[] = [];
  const seen = new Set<string>();
  // Clauses lettered (a), (b)… at the start of a line; "(i)", "(ii)" inside a clause stay with it.
  const starts = [...list.matchAll(/(?:^|\n)\s*\(([a-h])\)\s/g)].map((m) => m.index! + (m[0].startsWith("\n") ? 1 : 0));
  for (let i = 0; i < starts.length; i++) {
    // A clause running on to the next page is quoted up to the page break: the quote stays word for word.
    const clause = list.slice(starts[i], starts[i + 1] ?? list.length).split(/\n-- \d+ of \d+ --/)[0].replace(/[;\s]+$/, "");
    const years = YEARS.exec(clause);
    if (!years) continue;
    const members = relaxationMembers(clause);
    // One group, or SC and ST together; a clause naming any other mix is not read.
    const scst = members.length === 2 && members[0] === "sc" && members[1] === "st";
    if (members.length !== 1 && !scst) continue;
    const label = scst ? "Scheduled Caste / Scheduled Tribe (SC/ST)" : GROUPS.find((g) => g.member === members[0])!.label;
    if (seen.has(label)) continue; // the first clause for a group is its relaxation; a later one is a special case of it
    seen.add(label);
    const n = /^\d+$/.test(years[1]) ? Number(years[1]) : WORDS[years[1].toLowerCase()];
    out.push({ category: label, years: n, quote: clause.length > 400 ? clause.slice(0, 400) : clause });
  }
  return out;
}

/**
 * A table of category codes (SSC): "01 SC/ST 5 years"; a category written over
 * several lines ends at its line of years ("3 years"). The category is kept
 * as printed. A row giving an age, not years ("Up to 40 years of age"), is an
 * upper age for that group, not a relaxation: not read here.
 */
function coded(window: string): StatedRelaxation[] {
  const head = window.search(/\bcode\b[\s\S]{0,40}\bcategory\b/i);
  if (head < 0) return [];
  // Rows: from a code ("01") to the next code or the end of the table; page lines left out.
  const rows: string[][] = [];
  for (const raw of window.slice(head).split("\n").slice(1)) {
    const line = raw.trim();
    if (!line || /^-- \d+ of \d+ --$|^page\s+\d+\s+of\s+\d+$/i.test(line)) continue;
    if (/^(?:note\b|\d+\.\d+\s)/i.test(line)) break;
    if (/^\d{2}\s+\S/.test(line)) rows.push([line]);
    else if (rows.length) rows[rows.length - 1].push(line);
  }
  const out: StatedRelaxation[] = [];
  for (const row of rows) {
    // "Up to 40 years of age" is an upper age for the group, not years of relaxation.
    if (row.some((l) => /^up\s+to\s+\d{2}\s+years\s+of\s+age/i.test(l))) continue;
    // The years: on the code's own line ("01 SC/ST 5 years", "06 Ex-Servicemen (ESM) 3 years after …"), or
    // on a line of their own under a category written over several lines ("3 years"). Never a figure inside
    // the category's words ("who have rendered not less than 3 years …").
    const first = /^\d{2}\s+(.+?)\s+(\d{1,2})\s+years?\b(.*)$/i.exec(row[0]);
    const alone = row.findIndex((l, i) => i > 0 && /^\d{1,2}\s+years?\.?$/i.test(l));
    let category: string, years: number, rest = "", used: number;
    if (first) {
      [category, years, rest] = [first[1], Number(first[2]), first[3].trim()];
      // A note under the figure continues it while its lines run on in lower case.
      used = 1;
      while (used < row.length && /^[a-z]/.test(row[used])) rest += ` ${row[used++]}`;
    } else if (alone > 0) {
      category = [row[0].replace(/^\d{2}\s+/, ""), ...row.slice(1, alone)].join(" ");
      years = Number(/^\d{1,2}/.exec(row[alone])![0]);
      used = alone + 1;
    } else continue;
    category = category.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
    out.push({ category, years, ...(rest ? { text: `${years} years ${rest.replace(/\s+/g, " ").trim()}` } : {}), quote: row.slice(0, used).join("\n") });
  }
  return out;
}
