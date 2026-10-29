// ═══════════════════════════════════════════════════════════
// Upper-age relaxations printed as a list, read by code (B2.6)
// ═══════════════════════════════════════════════════════════
//
// UPSC prints its relaxations as lettered clauses under "The upper age-limit
// prescribed above will be relaxable": "(a) up to a maximum of five years if
// a candidate belongs to a Scheduled Caste or a Scheduled Tribe; (b) up to a
// maximum of three years in the case of … Other Backward Classes …". The AI
// read them in one run and left them out in another. Code reads each clause
// that names one group and a number of years, word for word, so the reading
// keeps every printed relaxation; a clause naming several groups, or none, or
// no number of years, is left to the AI and the admin, never guessed.

export interface StatedRelaxation { category: string; years: number; quote: string }

const ANCHOR = /(?:upper\s+age[\s-]*limit[^.;]{0,80}?relaxable|relaxable\s*:|age\s+relaxation|relaxation\s+(?:in|of)\s+(?:the\s+)?upper\s+age)/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15 };
const YEARS = /up\s+to\s+(?:a\s+)?(?:maximum\s+(?:of\s+)?)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\s+years?/i;
// Each group a clause may name, with the label the age checker matches; first match wins within a clause,
// in this order (an ex-servicemen clause also says "Commissioned Officers"; a defence clause is its own).
const GROUPS: Array<{ re: RegExp; label: string; members: string[] }> = [
  { re: /ex-?\s?servicem[ae]n/i, label: "Ex-Servicemen", members: ["esm"] },
  { re: /\bECOs?\b|\bSSCOs?\b/, label: "ECOs/SSCOs", members: ["eco"] },
  { re: /defence\s+services?\s+personnel/i, label: "Defence Services Personnel", members: ["defence"] },
  { re: /benchmark\s+disabilit|\bPwBDs?\b|\bPwDs?\b/i, label: "Persons with Benchmark Disabilities (PwBD)", members: ["pwbd"] },
  { re: /other\s+backward\s+class|\bOBCs?\b/i, label: "Other Backward Classes (OBC)", members: ["obc"] },
  { re: /scheduled\s+castes?|scheduled\s+tribes?|\bSC\b|\bST\b/i, label: "", members: [] }, // SC, ST or both: labelled below
];

/** The groups a relaxation's category stands for, to tell whether two readings name the same one. */
export function relaxationMembers(category: string): string[] {
  for (const g of GROUPS) {
    if (!g.re.test(category)) continue;
    if (g.members.length) return g.members;
    return [...(/scheduled\s+castes?|\bSC\b/i.test(category) ? ["sc"] : []), ...(/scheduled\s+tribes?|\bST\b/i.test(category) ? ["st"] : [])];
  }
  return [];
}

export function statedRelaxations(text: string): StatedRelaxation[] {
  const at = text.search(ANCHOR);
  if (at < 0) return [];
  // The list runs from its heading to the first note or the next numbered paragraph; at most a few pages' worth.
  const window = text.slice(at, at + 4000);
  // Case matters: "(III) Educational Qualifications" ends it, "(iii) on invalidment" inside a clause does not.
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
    const named = GROUPS.filter((g) => g.re.test(clause));
    // An ex-servicemen clause names commissioned officers and ECOs as part of it: it is one group.
    const groups = named.length > 1 && named[0].label === "Ex-Servicemen" ? [named[0]] : named;
    if (groups.length !== 1) continue;
    const g = groups[0];
    let label = g.label;
    if (!label) {
      const sc = /scheduled\s+castes?|\bSC\b/i.test(clause), st = /scheduled\s+tribes?|\bST\b/i.test(clause);
      label = sc && st ? "Scheduled Caste / Scheduled Tribe (SC/ST)" : sc ? "Scheduled Caste (SC)" : "Scheduled Tribe (ST)";
    }
    if (seen.has(label)) continue; // the first clause for a group is its relaxation; a later one is a special case of it
    seen.add(label);
    const n = /^\d+$/.test(years[1]) ? Number(years[1]) : WORDS[years[1].toLowerCase()];
    // The quote: the clause up to and including its figure and the group it names, as printed.
    out.push({ category: label, years: n, quote: clause.length > 400 ? clause.slice(0, 400) : clause });
  }
  return out;
}
