# Stage B1 — Smart intake fills the vacancy table

Branch `feature/importer`, local only. Nothing pushed, merged, migrated or deployed. All saving was tested on the in-memory test database.

## What it does

A notice's vacancy tables are **read by code**, not by the AI:

1. **Reading.** Code finds every vacancy table in the text: the column heading, the rows ending in the same number of figures, wrapped names, Total and Grand Total lines, NR, nil, dash and blank. Each row keeps its page and its printed line. Exam-pattern and fee tables are not vacancy tables, so they are left out.
2. **Interpreting.** Code matches each figure to a heading column (SC, ST, OBC (NCL), EWS, General → UR, Total, the PwBD parts, ESM, DESM).
   - When code cannot match a heading, the AI is asked which column each figure is in. Its labels must be copied from the heading, or the table is reported as not read.
   - A table matched by the AI is marked **"interpreted by AI"** on the review screen. The figures always stay as printed.
   - Without a key, or when the AI cannot tell, the table is listed as not read and nothing is guessed.
3. **Calculating.** Totals per post and in all are worked out by the existing table code (stage A1). A total is "at least" whenever a row is NR or has no figure.
4. **Verifying.** Nothing is verified. Values are saved as Pending; checking is done in the job editor as before.

When no table is printed (an article's category list, as in BTSC), the whole-text reading's quoted split becomes a one-row table. Its evidence is the document's own lines, from the quote until every figure has appeared.

### Into a job that already has a table

Rows are matched by **every dimension** (post, state, bank, city…), never by page:

- **A corrigendum** changes or adds the rows it prints and removes nothing.
- **A re-issued notice** replaces the posts whose tables it gives. A row it no longer lists is shown as **removed** only when every table and line of the document was read. Otherwise the row is kept, and the review says so.
- Posts the document does not mention are kept as they are, in the job's order.
- Row ids are kept, so history follows a row.
- A table that replaces an existing one starts **unticked**.
- A separate Total Vacancies or breakdown read by the AI is shown, unticked, with "worked out from the vacancy table below when it is saved". The server also refuses to save those against a table.

### Review screen (Vacancies section)

- Rows, posts and total, plus a per-post table of rows, total ("≥" when incomplete) and missing rows.
- **Missing or conflicting:** NR and no-figure rows with their pages, merge problems, and table errors.
- **Uncertain:** AI-interpreted headings, and columns whose place in the total is undecided.
- **Against the job's table:** counts of new, changed, removed and unchanged rows; each changed row as before → after with its page; removed rows; rows held back; posts kept.
- **What was read:** each table with its pages and row count, any tables not read and why, and any lines not read with their pages.
- **Every row** with its figures, page and printed line.

### Saving

`vacancies.table` goes through the ordinary field builder, so validation and history are the same as any edit. The calculated total and breakdown are saved with it, each with its own revision.

The database function checks that the saved table is exactly the previewed one (`cms_import_item_holds`), and the claim records the page.

## Results

### Deterministic tests (no AI)

| Suite | Result |
|---|---|
| `tests/cms/vacancy-reader.test.ts` (new) | 16/16 |
| `tests/local-stack/importer-tables.test.ts` (new) | 25/25 |
| Local-stack suites (18) | all pass (importer schema 84, flow 64, real 59, cms-workflows 61, vacancy-table 40, …) |
| `npm run cms:test` (41 suites) | all pass |
| Intake | 332/332 |
| Intelligence | 12/13 — the known E8 baseline failure, unchanged |
| PostgreSQL 17 concurrency | 30/30 |
| `tsc` | clean |
| Lint | 7 errors / 26 warnings — the baseline, none in B1 files |
| Production build; cache test on the built app | builds; 31/31 |

### Real Gemini (gemini-3.5-flash-lite), two runs

**Vacancy-table checks:** identical in both runs, all pass.

| Case | Read by | Result |
|---|---|---|
| IBPS CRP RRBs-XV, uploaded PDF | code | 10 of 10 tables, pages 46–55; 280 rows; at least 13,706 (Tripura NR in all ten); General → UR; PwBD counted within; no lines left unread |
| LIC HFL batch 10, uploaded PDF | code | Table E: 181 cities; Ananthapur 1; 232, complete |
| BTSC FSO article | whole-text reading's quoted split | 1 row of 105, UR 41 · EWS 11 · SC 17 · ST 2 · EBC 18 · BC 12 · BC women 4; every figure in its evidence lines |
| LIC scan (AI write-up) | — | No table found in the write-up (the AI writes Table E as prose), so no table is offered. Total 232 still comes from the AI reading. |

The tables do not depend on the AI, so they do not vary between runs.

**Differences between the runs, all outside the table:**
- IBPS exam pattern: not found in either run.
- IBPS exam stages: found in run 1, not in run 2.
- The old check "IBPS vacancies from the annexure (AI breakdown)" failed in both runs. The table replaces that path, so the check now accepts the table.

The earlier runs showed the same IBPS pattern and stage variance. It belongs to the whole-text reading of long notices, not to B1.

### Browser (local test copy)

1. Pasted IBPS pages 45–56 into a new job. The review showed 280 rows, 10 posts, "at least 13,706", ten Tripura NR rows with pages, 10 of 10 tables read, and every row with its line.
2. The duplicate guard asked for a reason (the seed IBPS job).
3. Saved. The job editor shows Total Vacancies "at least 13,706, calculated, incomplete", with the per-post split.
4. Pasted a made-up corrigendum into that job. The review showed 2 changed rows (Bihar 394 → 395; Tripura not reported → 10), 1 unchanged, 0 removed, and 9 posts kept. The table started unticked.
5. Ticked it and saved. Officer Scale I is now complete at 4,267, the total is at least 13,717, and post order is kept.

Two faults were found in the browser and fixed, each with a test:
- A corrected post moved to the end of the table.
- The header badge said "13,706 vacancies" without "at least".

## Work saved

| | IBPS CRP RRBs-XV | LIC HFL batch 10 | BTSC FSO |
|---|---|---|---|
| Rows read | 280 (144 with figures, 126 nil, 10 NR) | 181 | 1 |
| Figures read | 2,754 | 181 | 8 |
| Entries a person would otherwise type (place and figures) | ≈ 3,594 | ≈ 543 | 9 |
| Rows correct against a person's reading | Officer Scale I 28/28 (person-checked); 144/144 rows' categories add up to their printed totals | 181/181 (person-checked, with page) | 1/1 |
| Manual entries still needed | 0 (Tripura is NR in the notice: nothing to type) | 0 | 0 |
| Corrections needed | 0 | 0 | 0 |
| Coverage | 10/10 tables, 0 lines unread | 1/1 table, 0 lines unread | — (no printed table) |

The admin is left with the checking: reading the review and confirming the table against the notice in the job editor.

## Not done in B1 (by your instruction or out of scope)

- B2 (page sections for long documents) and Stage C were not started.
- SSC CGL, listed against B1 in the vision document's plan, was not in this request's case list and was not tested.
- A scanned notice's table: the AI's write-up of a scan is prose, so no table is read from it. Its vacancies still come from the AI reading as before. Reading tables from scans needs a decision (for example, asking the scan reader to keep table rows as lines).
- The IBPS exam pattern and stages variance in the whole-text reading is unchanged.

## Before any deploy

`src/lib/cms/importer/schema.sql` changed: `cms_import_item_holds` now also checks `vacancies.table`, `vacancies.total` and `vacancies.breakdown`. The change goes out with the importer's database migration, which is still waiting for your approval. It has been applied only to the local test databases.
