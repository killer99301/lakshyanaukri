# Smart Recruitment Assistant — the product, the gaps, and the plan

Status: proposal for review, 26 Oct 2026. Nothing here is built yet. Branch `feature/importer`,
local only. Read with `importer-design.md` (the approved architecture, revision 4) and
`smart-recruitment-assistant.md` (the module map and later milestones).

## 1. What we are building

You give LakshyaNaukri a recruitment source: an article, an official link, a PDF of any length, a
scan, a screenshot, research text, a corrigendum, or a request ("find new jobs", "has anything
changed in this one?"). The system reads all of it, works out which recruitment it is about,
extracts and organises everything, calculates what can be calculated, compares it with what the
CMS already holds, and hands you **one prepared draft** in the existing editor.

Your work is the part that needs a person: check what the system is unsure of, decide conflicts,
confirm the key facts against the official notice, and publish.

The yardstick for every change from now on: **does it remove a task you do by hand today**
(reading pages, copying values, adding up vacancies, comparing two PDFs, finding links), without
weakening what is trusted and what is published?

What stays fixed:

- One CMS, one record per recruitment, the existing editor, publish, revert, take-down, history.
- AI Assist, the prepared-file parser and manual New job keep working on their own.
- The AI never verifies, approves or publishes; third-party text is never official; nothing is
  invented; every published figure traces back to a document or to a calculation you can redo.

## 2. What already exists (on this branch)

| Need | Today |
|---|---|
| Any input | Pasted text, PDF (text or scan), image, address. Up to four sources at once. |
| Read and extract | AI Assist's topic readers, then one whole-text reading of every section. Long notices are now read whole up to 200,000 characters (3967e9a). |
| Evidence | Every value must quote its source word for word; claims are stored per field with source, page and quote; page numbers survive PDF reading. |
| Authority | Trusted-host list per organisation (authority / partner / purpose); research is never official; authenticity (fetched, matched, attested). |
| Verification | Per field, bound to the exact field revision; Tier A / Tier B gate; NOT_APPLICABLE vs NOT_STATED; public badge. |
| Existing records | Duplicate lock on every creation path; Smart intake into an existing job; corrigendum supersession at field level; Check for updates. |
| Discovery | One listing page on demand, matched to existing jobs. |
| Review | Three steps, one warning list, evidence folded, save as draft; editor check panel; shorter publish checklist. |
| Vacancies | A total, and one row per post with an optional category split; shown publicly since dbce507. |

## 3. The gaps between that and the experience you want

1. **Vacancies have one shape.** "One row per post" cannot hold bank-wise, state-wise, zone-wise,
   district-wise or department-wise tables. IBPS CRP RRBs-XV gives about eight bank-wise tables (one per post) × 28 banks with
   category columns and PwBD "out of which" columns, and no totals at all. Today the system can
   only refuse it (correctly) and leave you to add it up.
2. **No calculated figures.** There is no notion of "the system added these up": no method, no
   inputs, no check that the inputs were complete, no way to show "calculated" next to "stated".
3. **Long documents are read in one pass.** 200,000 characters now fit, but a 150-page notice or a
   20-table annexure will not, the answer size limits how many rows come back, and a scan is read
   in a single request. Nothing tells you which pages were actually read.
4. **Evidence is per field, not per row.** For a 140-row table you need to see which page and row
   each figure came from, and which rows are missing.
5. **Updates compare fields, not tables.** A corrigendum that changes three banks' figures should
   show those three rows, not "vacancy table changed".
6. **Several doors.** Smart intake, discovery, AI Assist and Check for updates are separate
   screens. You still choose the tool.
7. **Variation between runs.** The same notice read twice can miss a section once. Nothing
   re-asks for a section that came back empty while the document clearly has it.

Gaps 1–4 decide whether the system can be trusted with real notices; they come first.

## 4. A vacancy table that fits the notice

### 4.1 The shape

A recruitment's vacancies become a **table with named dimensions**, stored inside the existing
`vacancies` column (it is JSON already: no new database table, no change to `recruitments`).

```ts
interface VacancyTable {
  // The ways the notice splits its figures, outermost first. The first one is
  // what the public summary groups by (almost always the post).
  dimensions: Array<{ key: string; label: string }>;
  //   e.g. [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }]
  //        [{ key: "post", label: "Post" }, { key: "state", label: "State" }, { key: "city", label: "City" }]
  //        [{ key: "post", label: "Post" }]                       ← today's simple case

  // The category columns, as the notice names them.
  categories: Array<{
    key: string;            // "sc", "st", "obc", "ews", "ur", or the notice's own name ("EBC", "BC Women")
    label: string;
    kind: "VERTICAL" | "HORIZONTAL";   // horizontal = counted inside the others (PwBD, ESM, women)
    partOf?: string;        // "pwbd" for HI / OC / VI / ID
  }>;

  // One row per combination the notice prints. Nothing is summed here.
  rows: Array<{
    id: string;
    at: Record<string, string>;       // { post: "Officer Scale II (GBO)", bank: "Gujarat Gramin Bank", state: "Gujarat" }
    status: "STATED" | "NIL" | "NOT_REPORTED";   // "0" in the notice is NIL; "NR" is NOT_REPORTED
    total?: number;                    // the row's total, when printed
    cells: Record<string, number>;     // category key → figure, when printed
    source: { retrievalId: string; page: number | null; line: string };  // the row as printed
  }>;

  // Totals the notice itself prints (a post total, a grand total), kept to check against.
  statedTotals: Array<{ at: Record<string, string>; total: number; cells?: Record<string, number>;
                        source: { retrievalId: string; page: number | null; line: string } }>;
}
```

This one shape covers: one row per post (one dimension); post × category (BTSC); post × bank
(IBPS); state × city (LIC HFL Table E); zone × post (railways); district × post (police); department
× post (state services); a walk-in with one post and no split. The notice's own category names are
kept; only the usual ones are given standard keys.

### 4.2 Calculated, never guessed

Totals are worked out by code from the stored rows, never by the AI, and every result carries how
it was made:

```ts
interface CalculatedFigure {
  value: number;
  basis: "STATED" | "CALCULATED";
  method?: string;          // "sum of 28 bank rows, Annexure I pp. 46–47; SC+ST+OBC+EWS+GEN"
  complete: boolean;        // false when any input row is NOT_REPORTED or missing
  inputs?: string[];        // row ids used
}
```

Rules:

- A post's total is its printed total if the notice gives one; otherwise the sum of its rows.
- A row's total is checked against the sum of its vertical categories. Horizontal ones (PwBD,
  ESM, women) are never added to totals; they are shown as "of which".
- A NOT_REPORTED row makes every total it feeds **incomplete**: shown as "at least 1,234 (2 banks
  not reported)", never as a plain total.
- Where the notice prints a total and the rows also add up, both are kept; a difference is a
  conflict for you to decide, shown with both figures and both pages.
- Duplicate rows (same `at`), rows with numbers that are not in their printed line, and a table
  with fewer rows than the notice's own index lists are flagged.

### 4.3 How it fits what already reads vacancies

Cards, sorting, filters, Telegram posts, the publish checks and the public page read
`vacancies.total` and `vacancies.breakdown` today. They keep doing so:

- `vacancies.table` is the new source of truth when present.
- `vacancies.total` and `vacancies.breakdown` (one row per post, with category split) are
  **derived** from it, marked `basis: "CALCULATED"` with the method. Old records without a table
  are untouched and keep working as now.
- Editing the table in the editor re-derives both and creates new revisions, so their checks
  reopen as they do for any edited field.

### 4.4 Evidence and checking

- Each table row keeps the page and the printed line it came from; the editor shows them.
- Checking the table means checking it against the notice once, for the whole table (the field
  revision covers the table). A calculated total is "checked" when the table it comes from is
  checked at that revision and the calculation still matches. Editing any row reopens both.
- The Tier B rule for total vacancies is met by a checked table whose totals are complete. An
  incomplete total cannot pass Tier B unless you record it as not stated in full.

### 4.5 On the public page

- **Summary first:** one line per post: post, total, category split, and a small note
  "Calculated from bank-wise figures in the official notice" when it is calculated.
- **Incomplete** totals say so: "At least 1,234: 2 banks have not reported vacancies yet."
- **Details folded:** each post has "Show bank-wise vacancies (28)". It opens a compact table
  (bank, state, categories, total), with "Not reported" written out. Nothing extra loads until opened.
- The overall figure in the header and on cards is the grand total, marked "about" or "at least"
  when it is incomplete, never a bare number.
- One-dimension notices (most jobs) look exactly as they do now.

## 5. Reading a long document without losing it

1. **Split by pages, not characters.** The reader already marks every page. Long texts are cut into
   sections of whole pages (about 40,000 characters each), each read for the fields it holds.
2. **Find the tables.** Pages dense with numbers under headings like "vacancies", "annexure",
   "post-wise", "category-wise" go to a **table pass**: the AI names the table's dimensions and
   columns; plain numeric rows are then read by code from the page text, line by line, and every
   number must sit in its own printed line. The AI only reads rows when the layout defeats code.
3. **Scans in batches of pages**, each written out as text with its page number, so a 100-page
   scan is read in parts instead of one answer that runs out of room.
4. **Combine and reconcile:** the same field found in two sections becomes one value, or a
   conflict with both pages; never two silent copies.
5. **Coverage report** on every import: pages with text, pages read, scanned pages read, sections
   that failed or were cut short. Anything unread is a warning in the review: "Pages 61–76 were not
   read (the AI did not answer); re-run or read them yourself."
6. **Ask again for what is missing:** when a section the document plainly has (an exam pattern
   heading, a vacancy annexure) comes back empty, that section is asked once more on its own.

## 6. Updates and corrigenda

What exists (field-level supersession, preview against the existing job, re-checks after a change)
extends to tables: a corrigendum's rows are matched to the stored rows by their `at` values and the
review lists only the changed rows ("Gujarat Gramin Bank, Officer Scale II: 60 → 64, page 3 of the
corrigendum"). Previous figures and their evidence stay in history. Recalculated totals reopen
their checks.

Matching a new source to an existing job, suggested automatically (notification number, then
organisation + year + title), so you confirm "this is an update to SSC CGL 2026" instead of
searching for it.

## 7. One review screen

Built on the current three-step review, ordered by what needs you:

1. **Needs your decision:** conflicts, incomplete totals, values from research only, changed rows.
2. **Missing:** what the notice should have but nothing was found, with the coverage report.
3. **Ready:** everything supported by the official document, folded by section, one tick per
   section, evidence one click away.

"Smart intake" becomes the single entry: drop anything in, or type a request; it routes to a new
job, an update of a matched job, or discovery. AI Assist and Check for updates stay where they are.

## 8. Essential now, and later

**Essential before Smart intake is switched on**

- A. The vacancy table (4.1–4.5): model, calculation and checks, editor view, public summary with
  folded details, derived total and breakdown.
- B. Long documents (5.1–5.5): page sections, table pass, scans in batches, coverage report.
- C. Row-level evidence in the review and editor; stated vs calculated badges.

**Next**

- D. Table-aware corrigenda and automatic matching to existing jobs (6).
- E. The prioritised single review screen and single entry (7); asking again for missing sections (5.6).

**Later (already in `smart-recruitment-assistant.md`)**

- AI Research, recurring discovery, automatic checks of existing jobs, trusted hosts in the admin.

## 9. Staged plan with acceptance tests on real notices

Each stage ends with the unit and local suites, the full regression, and the real-Gemini acceptance
run on the notices listed. A stage is done when its notices pass on two runs in a row.

| Stage | Builds | Accepted on |
|---|---|---|
| A1 | `VacancyTable` type, calculation and checks (pure code), derivation of total and breakdown | Unit tests from the IBPS, BTSC, LIC Table E and SSC tables typed in by hand: totals, NR handling, horizontal columns, duplicates, stated vs calculated |
| A2 | Editor: table view and paste-in (like the prepared-file parser), evidence per row | Local browser run: paste IBPS Annexure I for one post, see totals and checks |
| A3 | Public summary and folded details; header/card wording for incomplete totals | Browser at desktop and phone: IBPS (about 8 posts × 28 banks), BTSC (one post, categories), a one-row walk-in unchanged |
| B1 | Page sections and the table pass in Smart intake; coverage report | Real Gemini: IBPS CRP RRBs-XV (every bank-wise table, NR rows), LIC HFL (Table E, 232), SSC CGL (post-wise table) |
| B2 | Scans in page batches | Real Gemini: a scanned state notice in Hindi, 20+ pages; LIC scan in full |
| C | Row evidence in review; stated vs calculated badges | Browser review of IBPS and BTSC drafts |
| D | Corrigenda by row; suggested match to the existing job | SSC CGL + corrigendum; an IBPS vacancy revision; BPSC date extension |
| E | Prioritised review, single entry, ask again | The full set above, timed: from source to a draft ready for checks |

Real notices to collect for the set (official PDFs, kept in the test sources folder, never in Git):
IBPS CRP RRBs-XV, LIC HFL batch 10, BTSC FSO 29/2026, SSC CGL 2026 and its corrigendum, UPSC CSE
2026, BPSC 72nd CCE, an RRB zone-wise notice, a state police district-wise notice, a university
teaching notice, an apprenticeship, a walk-in, and one scanned Hindi notice.

## 10. Decisions for you

1. **Not-reported banks:** show the total as "at least N" with the count of banks not reported,
   and keep it out of Tier B until you decide? (Proposed: yes.)
2. **Horizontal columns:** PwBD, ESM and women shown as "of which", never added. (Proposed: yes.)
3. **Calculated total and the gate:** a calculated, complete total from a checked table counts as
   checked for Tier B. (Proposed: yes.)
4. **Public details:** folded by default, one fold per post. (Proposed: yes.)
5. **Order of work:** A1 → A2 → A3 → B1 → B2 → C, then D and E. Smart intake stays switched off
   until A–C pass.
