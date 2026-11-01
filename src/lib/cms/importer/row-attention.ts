// ═══════════════════════════════════════════════════════════
// Smart intake: vacancy rows worth a look (Stage C, C3 step 1)
// ═══════════════════════════════════════════════════════════
//
// For the whole-table check (owner's decision C3-D3): which rows a person
// should look at first, and why. Display only. A mark never verifies,
// rejects, edits or blocks a row, and is never a finding that a row is
// wrong. Two kinds are kept apart:
//   - problems: the table analysis's own issues (a figure not in its line,
//     a row total that does not add up, a duplicate…), facts about the data;
//   - worth a look: a reading that MAY be wrong, by three conservative rules.
// A label's length, or a single word such as "Annexure" or "continued", is
// never a reason on its own. Pure: no database, safe in the browser.

import { analyseVacancyTable, type IssueCode, type SourceKinds, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";

export type AttentionRule = "LABEL_NOT_IN_LINE" | "LABEL_HAS_COLUMN_HEADING" | "LINE_HAS_PAGE_BREAK";

export interface RowAttention {
  rowId: string;
  /** The row's own label (its innermost dimension, as printed when a spelling was applied), or null. */
  label: string | null;
  page: number | null;
  /** Readings that may be wrong. Worded "may"; never "wrong". */
  worthALook: Array<{ rule: AttentionRule; message: string }>;
  /** The analysis's own issues on this row, as it states them. */
  problems: Array<{ code: IssueCode; severity: "ERROR" | "WARNING"; message: string }>;
}

const squash = (s: string) => s.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A heading word as a word of its own: Latin or Devanagari, between spaces or punctuation. */
const asWord = (w: string) => new RegExp(`(?:^|[\\s\\p{P}])${escape(w)}(?=$|[\\s\\p{P}])`, "iu");
const SERIAL_HEADING = /(?:^|[\s\p{P}])(?:sr|sl|s)\.?\s*no\.?(?=$|[\s\p{P}])/iu;
/** A page marker printed inside a row's line: the reader's own, or a page heading. */
const PAGE_BREAK = /^\s*(?:--\s*\d+\s+of\s+\d+\s*--|p\s?a\s?g\s?e\s+\d+\b.*|page\s+\d+(?:\s+of\s+\d+)?)\s*$/im;

/**
 * The dimension that is each row's own label: the innermost one whose value differs between rows. A value
 * the same on every row (a post the reader added for the whole table) was not printed on the row itself.
 */
function labelKey(table: VacancyTable): string | null {
  for (const d of [...table.dimensions].reverse()) {
    if (new Set(table.rows.map((r) => r.at[d.key] ?? "")).size > 1) return d.key;
  }
  return null;
}
const labelOf = (r: VacancyTableRow, key: string | null) => (key ? (r.printedAt?.[key] ?? r.at[key] ?? "").trim() || null : null);

/** The rows worth a look, and the analysis's problems on each row; rows with neither are left out. */
export function rowAttention(table: VacancyTable, opts: { sourceKinds?: SourceKinds } = {}): RowAttention[] {
  const key = labelKey(table);
  // The table's column-heading words: its categories' names, "Total", and the serial-number heading.
  const headingWords = [...new Set([...table.categories.map((c) => c.label.trim()), "Total"].filter((w) => w.length > 0))];
  const issues = analyseVacancyTable(table, { sourceKinds: opts.sourceKinds }).issues;
  const out: RowAttention[] = [];
  for (const r of table.rows) {
    const label = labelOf(r, key);
    const line = r.source?.line ?? "";
    // The label is looked for in the line without any page marker inside it: a marker is said by its own rule.
    const lineText = line.split(/\r?\n/).filter((l) => !PAGE_BREAK.test(l)).join("\n");
    const worthALook: RowAttention["worthALook"] = [];
    if (label && lineText.trim() && !squash(lineText).includes(squash(label))) {
      worthALook.push({ rule: "LABEL_NOT_IN_LINE", message: `The label may not match its line: “${short(label)}” is not in “${short(line.replace(/\s+/g, " "))}”.` });
    }
    if (label) {
      const found = headingWords.filter((w) => asWord(w).test(label));
      const serial = SERIAL_HEADING.test(label);
      // Conservative: the serial-number heading with another heading word, or three heading words together.
      if ((serial && found.length >= 1) || found.length >= 3) {
        worthALook.push({ rule: "LABEL_HAS_COLUMN_HEADING", message: `The label may include the table's column heading: ${[...(serial ? ["Sr. No."] : []), ...found].join(", ")}.` });
      }
    }
    if (line && PAGE_BREAK.test(line)) {
      worthALook.push({ rule: "LINE_HAS_PAGE_BREAK", message: "This row's line may run over a page break: check where the row is." });
    }
    const problems = issues.filter((i) => i.rowIds?.includes(r.id)).map((i) => ({ code: i.code, severity: i.severity, message: i.message }));
    if (worthALook.length || problems.length) out.push({ rowId: r.id, label, page: r.source?.page ?? null, worthALook, problems });
  }
  return out;
}
