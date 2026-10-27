# Stage B2 — progress

The plan and your decisions are in `importer-b2-plan.md`. This file records each step as it is finished. Everything is local on `feature/importer`: nothing has been pushed, merged, migrated or deployed.

## B2.1 — Finding sections by their content (done)

### What changed

`src/lib/cms/passage-finder.ts` (new, code only, no AI) recognises passages by what they contain.

- **Exam pattern:** rows of figures with a duration ("1 Reasoning * 40 40 25 minutes"), or rows of figures under a heading that names at least three of questions, marks, duration and tests ("General English 25 25"). The pattern's own title line just above it ("Single level Examination (objective)") is included.
  - These are not a pattern: compensatory-time sentences, lists of states or centres, fee tables, date tables.
- **Age limit:** ages in years beside age words, date-of-birth ranges and relaxations, reading wrapped table cells ("Between 18 years" / "and 28 years") together.
  - These are not an age limit: form blanks ("Age ____ years") and years of service.
- Passages are exact slices of the text, so quotes stay verbatim and page markers stay inside. A long passage is cut at line ends into pieces the reader accepts.

How the readers use it:

- **Pattern and syllabus reader:** gets the pattern passages first (the strongest that fit, in document order), then its old heading-word windows that don't overlap them. For web pages, a section whose content is a pattern table is sent even when its heading is not a pattern word.
- **Age, eligibility and selection reader:** gets the two strongest age passages first.
- **Dates and fees** were already found by content (dates and amounts close together). Their keyword lists now also cover "Commencement / Closure of registration", "Activity schedule" and "Application charges".

These builders are shared with AI Assist in the job editor, so AI Assist gains the same detection.

### Results

**Deterministic** — `tests/cms/passage-finder.test.ts`, 10/10.

- **Real pages:** IBPS pages 6–8 and 20–25, LIC pages 1–4, the BTSC article.
- **Made-up wordings:** "Plan of Examination", a Tier with hours, and a web section headed only "Written Test".
- **Made-up false lookalikes:** text that resembles a pattern or an age but is neither.
- **Run against the old builders:** 4 tests fail (the IBPS pattern, the IBPS age table, the other wordings, and the date and fee words). So the tests do catch the old fault.

**What the IBPS pattern reader is given**

| | Before | Now |
|---|---|---|
| Passages | one sentence from page 4 ("…pattern of examination, issuance of call letters…") | pages 21–22 (preliminary and main) and pages 23–24 (single level), with their titles |

**Real Gemini (gemini-3.5-flash-lite)**

| | Run 1 | Run 2 |
|---|---|---|
| Overall | 45/46 | 46/46 |
| IBPS exam pattern | found: 5 of 7 papers (both Officer Scale I papers left out) | found: all 7 papers, every figure correct |
| IBPS exam stages | not found | found (3 stages) |
| Vacancy tables (B1) | unchanged | unchanged |

- Before B2.1 the IBPS exam pattern was missed in every run.
- Run 2 was first attempted straight after run 1 and hit Gemini's per-minute rate limit: 17 checks failed with "AI rate limit reached". It was repeated after a pause, and only the repeat is counted above. This is what D4 (controlled concurrency, retries and backoff) is for.

**Regression**

- all 18 local-stack suites pass
- `cms:test` 42/42 suites
- intake 332/332
- PostgreSQL 17 concurrency 30/30
- `tsc` clean
- intelligence 12/13 and lint 7 errors / 26 warnings, both unchanged baselines

### Still open after B2.1 (honestly)

- **IBPS exam stages** still come only from the single whole-notice request, so they still vary between runs. B2.2's page batches address this.
- **The pattern reader's own variance:** in run 1 the model left out two papers that it had been given. Detection is now right; the model's reading still varies. The review screen shows what was found, and B2.2's merge across batches will be checked against this.
- **IBPS age is refused in both runs**, correctly. IBPS gives a different age range for each post (18–28, 18–30, 21–32, 21–40), but the age field holds one range. The model returns one range and the quote check refuses it. Storing ages per post is a product decision (a change to the record's age field), and it is not part of B2.

## B2.2 — Page-batched reading, merged by code, with coverage (done)

### What changed

**Page batches** (`src/lib/cms/importer/article.ts`)

- A notice with page marks and more than 40,000 characters is read in **batches of whole pages**: at most 8 pages or 30,000 characters each. IBPS (76 pages) becomes 10 batches.
- A page with no text (a scanned page) is in no batch. It is named as "no text (scanned)".
- Each request is told which pages it holds. Each value's page is counted in the whole document.
- Shorter texts are still read whole, in one request, as before.

**Merging, by code**

- A list (exam stages, papers, posts, eligibility, syllabus, steps, notes) is joined across batches. An entry given twice the same way counts once, and the joined value keeps every contributing batch's quote and page.
- When two batches give the same entry differently, nothing is joined for that field. Each batch's version is offered, so the review shows a conflict.
- A single value (a date, a fee, the age limit) is offered as each batch gives it: the same value from two batches is one item with two quotes, and different values are a conflict.
- Nothing is chosen between differing values.

**Coverage**

- Each batch is recorded as read, failed (with the reason) or not read (the time ran out). This is stored with the preview and shown in the review's Sources panel.
- Any unread page range becomes a warning: "pages 17–24 of 40 were not read (…). What those pages state is missing from this preview." "Complete" is never claimed while a page is unread.

**Pacing** (`src/lib/cms/importer/pacing.ts`)

- **A gate per import:** at most 2 AI requests at a time. A task starts its request, and its timeout, only when it gets a place, so queuing never uses up a request's time.
- **Resends:** a request refused for load (429 or 5xx) is resent at most twice, after 5 s and then 12 s. Each resend is counted against the daily allowance first, and each refused attempt is counted as a failure. Nothing is resent once the allowance is used up.
- A batch that still fails is tried once more as a whole.
- The preview stores the number of requests (sent, resent, failed), and the review shows it.

**Time limit in the browser.** The preview route stops starting new batches 45 s into its 60 s. Batches not started are reported as not read. B2.3's background reading removes this limit.

**Two real faults found by batching, fixed generally**

- A batch without the schedule took unrelated dates, such as the notice's signature date as the admit-card date, or a qualification deadline as the exam date. A date's quote must now **name its event** (exam, admit card, interview, result, registration, fee payment, correction), or the date is refused with that reason.
- Schedule steps with only a month ("November / December, 2026") were left out of the exam stages. The reading now asks for them, keeping the month as written, never as a date. Stages are limited to examination, interview and document-verification steps. A stage name longer than the editor's 80 characters drops that stage only, and says so.

### Results

**Deterministic tests**

- `tests/cms/batch-reading.test.ts`: 12/12. Covers:
  - pages and batches
  - each value's page in the whole document
  - lists joined across batches, and conflicts kept apart
  - a failed batch, and batches not started in time
  - short texts read whole
  - the date-event rule and month-only stages
  - resends, the allowance and the gate
- `tests/local-stack/importer-batches.test.ts`: 8/8, through the real preview service and test database:
  - a batch refused once for load is resent and read
  - a batch that keeps failing is named with its pages in the coverage and warnings
  - a value on a failed page is missing, not guessed
  - a scanned page is named
  - the requests are counted
  - the time limit leaves batches "not read"

**Real Gemini, final two runs:** 47/47 and 47/47.

| | Run 5 | Run 6 |
|---|---|---|
| IBPS batches read | 10 of 10 | 10 of 10 |
| AI requests (sent, resent after a refusal for load) | 18, 4 resent | 14, 0 resent |
| IBPS exam stages | the same 4 stages from page 1, months as written (Pre-Exam Training; Preliminary; Main / Single; Interview) | same |
| IBPS exam pattern | 7 of 7 papers | 4 of 7 papers |
| Wrong dates | none | none |

- Earlier runs on the way, before the two faults were fixed, showed the wrong dates and the missing stages. That is how the faults were found.
- In run 6, the fee-payment deadline was refused by the date reader (its quote did not contain the date), so it is missing from that preview. This rule predates B2.

**Browser (local test copy, real Gemini)**

- The full 76-page IBPS text was pasted into Smart Intake. It was read in 17 s: 10 of 10 batches, 10 AI requests, inside the browser's time budget.
- The review showed the four exam stages, the exam pattern, age, fees, dates, vacancies and eligibility, plus "Read in 10 page batches: 10 of 10 read (76 pages)" and the request count.

**Regression**

- 19 local-stack suites pass
- `cms:test` 43/43 suites
- intake 332/332
- PostgreSQL 17 concurrency 30/30
- `tsc` clean
- intelligence 12/13 and lint 7 / 26, both unchanged baselines

### Still open after B2.2

- **The pattern reader's variance** (4 to 7 of IBPS's 7 papers). It reads the content-found passages from B2.1, not the page batches. When the batches also return the pattern, the stricter section reader still wins. Running the pattern through the batch merge too, and offering a difference as a conflict, would show the gap. Whether to do that is for you to say.
- **IBPS age** is refused correctly: its age differs by post, and the age field holds one range.
- **A document longer than about 45 s to read in the browser** is reported as partly read until B2.3.

## B2.3 — Background reading of long documents (done)

This implements the approved mechanism (`importer-b2-3-mechanism.md`): the job is held in the database, the browser drives the steps, pdf-lib splits the PDF, and there is no QStash.

### What was built

**Upload**
- You select one PDF of any size, up to 60 MB and 400 pages.
- The browser opens it with pdf-lib. An encrypted or damaged PDF is refused there, with the reason, before anything is sent.
- The browser splits the PDF into pieces of whole pages: at most 40 pages each, and under 4 MB.
- It computes the whole file's SHA-256 and sends the pieces one by one. Each piece is tried 3 times.
- The **server** reads each piece's text itself and renumbers the page marks as pages of the original ("-- 43 of 76 --").
- **A single page over 4 MB is not shrunk or changed.** It is recorded as not uploaded, with its size.
- **A page with no text** is named as scanned, and its piece is kept until B2.4 reads it from the image. Every other piece keeps only its text.
- **Pasted text** can be part of the same reading. Addresses and images still use the one-request preview, and a PDF over 4 MB mixed with them is refused with an explanation.

**Database (local test databases only):** `recruitment_import_jobs`, `…_job_parts` and `…_job_tasks`, also added to the migration manifest. Nothing has been migrated in production.

**Before reading**
- The page shows the estimated AI requests and today's allowance.
- Missing or unreadable pages are named. Reading starts only when every page is in, or when you tick "read without them".

**Steps**
- While the page is open, it asks for a step again and again.
- Each step takes at most 2 tasks (a page batch or a section reader) with a 55 s **lease**, in one statement with `FOR UPDATE SKIP LOCKED`.
- It reads them with the B2.2 pacing and saves each result **only if it still holds that task's lease** and the reading wasn't cancelled.
- A task whose step died is taken again when its lease runs out.
- A failed task is retried once automatically; after that it is marked failed, with its pages and the reason.
- When the daily allowance runs out, the reading **pauses** with that note. The waiting task is not marked failed and keeps its tries.

**Controls:** Pause, Resume, Retry failed pages (only those tasks), Finish without them (their pages are reported as not read), and Cancel (the kept pieces are deleted).

**Reopen:** the address carries `?job=…`, and the import page lists your unfinished readings.
- **After a reload or return**, finished tasks stay finished and the reading carries on.
- **If an upload was interrupted**, the page asks for the same file again. A different file is refused because its SHA-256 doesn't match, and only the missing pages are sent.

**Finish**
- When every task is settled, one step moves the reading to FINISHING and builds the ordinary preview from the saved results (B2.2 merge, B1 tables, proposal).
- Other tabs wait. A finish whose step died is redone after 90 s.
- The status shows **"Complete" only when every page was uploaded, had text and was read, and nothing failed**. Otherwise it shows "Finished — incomplete", and the preview's warnings and Sources panel name every page not read and why.

**Fingerprint:** the file's fingerprint comes from the browser, so it can never confirm a match with a server fetch.

**Access:** every route goes through the importer guard (session, origin, switch). Every job function checks that the reading belongs to the admin asking; another admin gets "not found".

**Clean-up**
- Pieces are dropped when a reading ends or is cancelled.
- Readings untouched for 7 days are cancelled, and ended readings older than 30 days are deleted.
- This runs whenever a reading is started and in the existing daily cron job.

**Refactor:** the one-request preview now shares these pieces: target, read, assemble, and section readers that can run one at a time. Its behaviour is unchanged (same tests).

### Results

**Deterministic and local tests**
- `tests/local-stack/importer-jobs.test.ts`: **30/30**, with the real IBPS PDF split by pdf-lib exactly as the browser splits it. Covers:
  - renumbered pages
  - limits: piece size, piece pages, overlap, 400 pages, damaged piece
  - an interrupted upload, and a piece sent twice
  - another admin, and steps of at most two tasks
  - a failing batch failed and then retried alone, with done tasks untouched
  - evidence pages after splitting (page 1 and page 21) and the 280-row vacancy table
  - the browser fingerprint never confirming a server fetch
  - two tabs: B can't take A's task while A holds the lease, B takes it when the lease runs out, and A can't overwrite B's saved result
  - pause, and the daily allowance
  - scanned pages kept and then dropped, cancel, and "never complete"
  - abandoned and old readings cleaned up
- **Real PostgreSQL 17** (`tests/pg/importer-concurrency.test.ts`, now 35/35):
  - two sessions claiming at the same moment get different tasks, without waiting
  - a save under the wrong lease is refused
  - nothing is saved into a cancelled reading

**Browser (local test copy, real Gemini)**
- The test file is **made up from a real source**: the IBPS notice plus two heavy image-only pages and one page of 4.8 MB, 79 pages and 12.6 MB in all. There was no real notice over 4 MB on this machine.
- It was split and uploaded automatically: 78 of 79 pages. Page 79 is reported as too large, and pages 77–78 as scanned. The estimate was 13 requests.
- Reading was started, and the page was **reloaded** mid-reading and **opened in a second tab**.
- Afterwards the database shows **13 of 13 tasks done, none read twice (most tries = 1), and 13 AI requests**: exactly the estimate.
- The finished reading opened in the review. Its warnings named page 79 (too large) and pages 77–78 (scanned), and the status said "Finished — incomplete", not "Complete".
- **Saved and reopened:** the job holds the 280-row table (at least 13,706), 7 exam papers and 9 exam stages.
- **An interrupted upload:** reloading at 59 of 79 pages kept those pages. A different PDF was refused, and the same file sent only pages 60–79.
- **Cancel:** the reading shows Cancelled, and the database holds no kept pieces for it.
- Faults found in the browser and fixed:
  - Other tabs stopped watching while the preview was being built, so they now wait for it.
  - "Send the rest again" showed for a page too large to send, so it is now hidden in that case.
  - The Sources panel didn't list the too-large page, so it now does.
- **A failed task retried in the browser** was not forced with the real model. The stand-in model covers it in the local test.

**Regression**
- 20 local-stack suites pass, including the new reading-job suite
- `cms:test` 43/43 suites
- intake 332/332
- PostgreSQL 17: 35/35
- `tsc` clean
- production build passes, and the cache test on it is 31/31
- intelligence 12/13 and lint 7 / 26, both unchanged baselines

**Real Gemini, one-request preview after the refactor:** 46/47.
- The one failure: the IBPS page batch for pages 17–24 came back from the model as an incomplete answer twice.
- It was reported as "pages 17–24 not read", not hidden. The reading is never called complete, which is the intended behaviour.
- It is the same B2.2 batch reading. It is noted below as something to improve, not fixed here.

### Still open (kept visible, not solved by B2.3)

- **A page batch the model answers incompletely** (seen once, pages 17–24 of IBPS) fails after two tries. Cutting such a batch into smaller ones before giving up would recover it. To do before final B2 acceptance.

- **The IBPS exam-pattern reader still varies between 4 and 7 of its 7 papers** from run to run (B2.2 runs 5 and 6). The browser reading in B2.3 got 7 of 7, but one good run is not a fix. It stays open until it is addressed, before B2 is accepted.
- **Exam stages:** in the browser run the model also listed download and result steps (9 stages), although the reading asks only for exam, interview and verification steps.
- **IBPS age:** the saved age is 18–28, which is only the Office Assistants' range. IBPS ages differ by post, and the age field holds one range. This is a product decision. The value stays Pending.
- **Scanned pages** are named and kept, but not read until B2.4.
- **A reading moves only while an import page is open.** This is the approved limit, without QStash.
- **Existing one-request previews** (`/api/admin/cms/import/:importId`) can still be opened by any admin, as before B2. Only the new reading jobs are per admin. Restricting previews too is your call.

## B2.4 — Scanned pages and their vacancy tables (done)

### What was built

**Detecting scanned pages, page by page.** The server reads each uploaded piece's text. A page with almost no printed text (fewer than 12 characters, such as a bare "Page 9 | 10") is a scanned page. This works for mixed PDFs too: in the LIC test file, pages 1–4 are text, pages 5–9 are images, and page 10 holds only its running header.

- The threshold was 40 characters in B2.2. It is lower now so that a short real text page counts as text.

**The page itself goes to the model.**
- For each scanned page, the browser cuts that page out as its own one-page PDF with pdf-lib and uploads it.
- The server sends that page to Gemini 3.5 Flash-Lite (unchanged), which reads the page image. Nothing is taken from another AI's prose.
- A page larger than 4 MB on its own is recorded as not uploaded, with its size. It is never shrunk.

**Transcription, not interpretation.** The model returns, as JSON:
- every text line on the page, and whether the page is blank;
- each table: its title, whether it continues from the previous page, every lowest-level column heading in order (a two-level heading becomes, for example, "OC G" and "OC W"), and every row cell by cell.

Figures come back exactly as printed: "01", "-", "NR", "0", "Nil", "[blank]" for an empty cell, "[unclear]" when unreadable, and notes such as "01 (VH)". The model is told never to guess, correct or add up.

**Code does the reading** (`src/lib/cms/importer/scan-tables.ts`):
- **Columns:** row-name columns come first; the first column whose every cell is a figure starts the figure columns.
- **Totals:** the total is "Grand Total", or the single total column, or the only figure column. Printed subtotals ("TOTAL G", "TOTAL W") are checked against their columns, and against the total, in every row.
  - When every row agrees, the columns are established by the source as part of the total, with a note saying how.
  - When a row disagrees, the difference is reported and nothing is corrected.
- **Continuing tables:** a page with no heading row joins the previous page's table, whether it gives no columns or gives its first row as the headings.
- **Repeated rows:** a row repeated at the top of the next page is counted once, and the review says so.
- **Wrong cell counts:** a row with the wrong number of cells is not read; it is listed as an unread line, with its page.
- **Text in a figure column** is treated as unreadable and reported.
- **Same builder:** the result goes through the B1 table builder and the A1 vacancy engine. A table that runs from a text page onto a scanned page stays one table.
- **No double reading:** scanned pages are never read twice. Their tables come from the transcription, not from the text reader.

**Marks and checks** (`src/lib/vacancy-table.ts`):
- Every row from a scanned page carries `readBy: "AI_IMAGE"`. An unreadable figure is recorded in `unclear` and never filled in.
- The engine adds an **UNCLEAR_FIGURE** error. A total that needs an unreadable figure is incomplete.
- "The total is ready" now also lists the rows read from images by AI until the table is checked. The arithmetic adding up is not treated as proof.
- The "figures not in the printed line" check now compares "01" with 1 numerically.

**The rest of a scanned page.**
- Once every scanned page is written out, a second round reads what those pages say, in page batches like any text.
- Any value found on a scanned page (a date, a fee) carries the flag "read from a scanned page by AI — check it against the page image".

**Retries and nearly empty pages.**
- Scanned pages are read one per task, through the B2.3 leases, pacing, resends, allowance and resume. A failed page is retried once, then reported.
- A page where the model finds almost nothing (and does not call it blank) is read once more. If it is still nearly empty, it is kept but flagged ("the AI found almost nothing, twice — check the page"), and the reading is not called complete.
- This came from a real browser run in which the model returned no table at all for page 9.

**Side by side.**
- In the review, the vacancy section shows "Read from image by AI — human verification required" with the row count and a button for each page.
- Each AI-read row shows its page, and clicking it draws the scanned page beside its rows. pdf.js draws the page in the browser for viewing only, because the site's `X-Frame-Options: DENY` header forbids showing PDFs in frames. pdf.js was already installed with the PDF reader; it is now listed directly at the same version, 5.4.296.
- Other values read from a scanned page show the same mark and can show their page.
- After saving, the job editor marks each such row "AI-read from image", and any unreadable figure in red. Typing the figure clears that mark.

**"Complete" is withheld** while any table line could not be read, even when every page was processed. Run 3 showed the need: one LIC row split by the model was reported, yet the reading had said "complete". The reading now finishes with a note: "N line(s) inside a vacancy table could not be read as rows; the review lists them."

**Storage:** page images are kept only for the review. They are dropped when the preview is saved or discarded, at once on cancel, and after 7 days at most. Each image is served only to its own admin.

**"Opening the reading…"**
- **Likely cause:** on the development server, the first request to a reading compiles the routes. That took over 30 s, and the panel waited for ever. An answer with no progress in it would also have left it waiting.
- **Fix:**
  - The open request has a 30 s limit and is retried once by itself ("still opening").
  - After that, a clear error with "Try again" and "Back to Smart intake".
  - Malformed answers are reported, and a successful open clears any earlier error.
- **Checked in the browser:** an address with no reading showed the time-out, then "Reading not found" on Try again; a real reading opened after one retry.

### Results

**Deterministic**
- `tests/cms/scan-tables.test.ts`: **11/11**
  - Telangana page 23: three posts in G/W columns read from a person's reading of the page, giving 1 + 26 + 2 = 29 with no issues and the columns established by the subtotals.
  - LIC Table E over four scanned pages: 181 cities, Ananthapur 1, Grand Total 232.
  - A row repeated at a page break; unreadable, zero, NR and blank cells; text in a figure column; wrong cell counts.
  - **Deliberately wrong figures:**
    - Telangana post 15 with OC W read as 04: the row is an ERROR, the W subtotal disagrees, the figure is unchanged, and the total is not ready.
    - LIC with one city read as 3: the printed Grand Total disagrees.
  - The two real-model misreads kept as tests; a mixed text-and-scan document.
- `tests/local-stack/importer-jobs.test.ts`: **43/43**. It adds a row split into too many cells leaving the reading "finished — incomplete" with a note, plus:
  - scanned-page images uploaded and refused (not a scanned page, or more than one page)
  - estimates, one read per page, and the second round
  - the table over three pages with a repeated row, unreadable, zero and NR
  - AI-read marks on rows and on a date
  - page images served to their admin only, kept for the review, dropped on discard and on cancel
  - nearly empty pages retried, then flagged; a blank page accepted

**Real Gemini (gemini-3.5-flash-lite), the whole pipeline on the in-memory test database** (`tests/local-stack/importer-scans.acceptance.ts`):

| | Run 1 | Run 2 |
|---|---|---|
| LIC scan (pages 5–9 as images) | 180/181 cities, total 232 | 181/181, 232, every row's page correct |
| LIC mixed (text 1–4, images 5–10) | 181/181, 232 | 181/181, 232 |
| Telangana page 23 | 1, 26, 2 = 29 | 1, 26, 2 = 29; every category cell as printed |
| Checks | 12/14 | 14/14 |

A third run, on the final code, repeated run 1 exactly: 12/14, with the same two misreads, both flagged.

What run 1 got wrong, and how it was caught:
- **LIC:** the model split "Jammu And Kashmir" into two cells. That row is not read, is listed as an unread line with its page, and the review warns about it.
- **Telangana post 16:** the model swapped SC G and SC W. Both subtotal checks flag it in the review. The post totals stay right.

In all three runs the model also swapped post 14's TOTAL G and TOTAL W. The subtotal checks flag it each time.

**Browser (local test copy, real Gemini)**
- A missing-reading address showed the time-out, then "Reading not found", with Try again and Back.
- The mixed LIC PDF was uploaded: 10 of 10 pages, and the 6 scanned page images were sent automatically. The estimate was 11 requests.
- **Reloaded** at 2 of 6 scanned pages: it carried on from 2 of 6, with nothing repeated.
- **The first browser run exposed the page-9 omission** (the model returned no table on page 9). The total then showed "178 (calculated)" with no warning. That led to the nearly-empty retry and flag.
- **The second run:** 181 rows from pages 6–9, all marked AI-read, Total 232 as printed, complete, 11 requests (exactly the estimate).
- **Side by side:** page 9 drawn beside its 44 rows (screenshot taken).
- **Production build:** the one-page Telangana scan was read through the UI on the built app: 29 vacancies, and the page drawn beside its table. The build prints a warning that pdf.js's worker file "can't be external", because pdf.js is on the server's external-package list for the PDF reader. The view works in the build; the warning stays and is noted here.
- **Saved and reopened:** the page image was dropped on save (404 afterwards). The reloaded draft holds 181 rows, all AI-read, Ananthapur 1, Total Vacancies 232 (printed, page 9), all Pending. The editor marks all 181 rows "AI-read from image".

**Regression**
- 20 local-stack suites pass
- `cms:test` 44/44 suites, including the new scan-table suite
- intake 332/332
- PostgreSQL 17: 35/35
- `tsc` clean
- production build passes, and the cache test on it is 31/31
- intelligence 12/13 and lint 7 / 26, both unchanged baselines

### Limits and what is still open

- **Missing rows:** a row the model leaves out in the middle of a page, or a split cell it produces, is caught only by a printed total that then disagrees, or as an unread line. Without a printed total on that table, a missing row is not detectable by code. That is why every AI-read row stays Pending and is to be checked against its page.
- **Model variance:** the model's reading varies from run to run, as seen in runs 1 and 2. Arithmetic checks catch some misreads (subtotals, totals), never all.
- **Earlier open items, unchanged by B2.4:**
  - the IBPS exam-pattern reader (4 to 7 of 7 papers)
  - page batches answered incompletely needing smaller-batch recovery
  - exam-stage over-extraction (download and result steps)
  - ages per post (the age field holds one range)
- **Plan before final B2 acceptance:**
  - B2.5: tables across text and scan pages, plus the smaller-batch recovery for incomplete answers.
  - Then the pattern reader's variance (to try: running the pattern through the batch merge so differences show as conflicts), and stages limited to exam, interview and verification by a code rule, not only the prompt.
  - Ages per post needs your product decision.
  - B2.6: real-source acceptance including the SSC CGL, corrigendum, UPSC CSE and BPSC 72nd PDFs.
- **Migration:** the schema changed (`recruitment_import_job_pages`, the `SCAN_PAGE` task kind, `scan_reading_added`), local test databases only. Nothing is migrated in production.

---

## B2.5 — Tables across text and scanned pages; incomplete answers read again in halves (done)

### What was built

- **One table across text and scanned pages** (`readVacancyTables` with
  `scanPages`):
  - A scanned page whose first table has no heading continues the text
    table that ended on the page before, if the widths match: same names
    and figures. Example: LIC Table E, text pages 6–7, scanned pages 8–9.
  - Rows at the top of a text page with no heading continue the table that
    ended on the page before, text or scanned. Example: scanned 6–7, text
    8–9.
  - Each row keeps its own page and how it was read. Rows from a scanned
    page are marked AI-read; rows from a text page are not, even inside the
    same table.
- **A row printed again at the page break** is counted once, across either
  kind of page, and the review says so.
- **What cannot be joined is reported, never dropped:**
  - A scanned continuation row whose width differs from its table (for
    example a name split over two cells) is listed as an unread line with
    its page, and a problem is noted.
  - Heading-less rows that continue no table read are reported as unread.
    This applies when a table ended on the page before, or that page was
    scanned and its table may have been missed. Elsewhere, for example an
    index of clauses with page numbers, they are no table and are passed
    over, as before. The first version flagged the IBPS index page and two
    numbered paragraphs; the regression caught it and the rule was
    tightened.
  - Unread lines still withhold "complete".
- **An answer cut off for a page batch is read again in halves:**
  - **One-request path** (`readArticleInBatches`): the batch is halved
    recursively, at most three levels, down to one page.
  - **Reading jobs:** the batch's task is marked `SPLIT` and two new tasks
    for its halves are added. Each half can be split again. A single page
    still cut off fails after its tries, with why, and the reading is never
    "complete".
  - Progress counts split batches apart from tasks to do.
  - The preview lists batches in page order, so lists joined from halves
    keep the document's order. It records the split ranges.
  - The review says "pages 1–8 answered incompletely at first, so read
    again in halves".
- **Schema:** the tasks status CHECK now allows `SPLIT`. This applies to
  local test databases only; nothing is migrated in production.

### Results

**Deterministic**
- `tests/cms/cross-page.test.ts` (new): **7/7**.
  - Real LIC text for some pages, the person-checked transcription for the
    others:
    - text 6–7 then scanned 8–9: 181 cities, 232, rows per page and source
      44/46/47/44;
    - scanned 6–7 then text 8–9: the same.
  - A row repeated at the break in each direction.
  - A missed scanned table leaving 92 heading-less lines (reported, every
    one listed).
  - A split-name row on a scanned continuation (not read, said; 180 rows
    joined).
  - An index page (passed over, nothing reported).
- `tests/cms/batch-reading.test.ts`: **15/15** (3 new):
  - an 8-page batch cut off, then read as 4-page halves: every page read
    once, values on their pages, the split recorded;
  - always cut off: every piece failed, nothing taken, the reading says so;
  - halving bounded.
- `tests/local-stack/importer-jobs.test.ts`: **48/48** (5 new):
  - the cut-off batch is SPLIT and its halves 1–4 and 5–8 are read;
  - every page read once;
  - the reading complete, with 1 split and 14 done;
  - the stage still on page 1;
  - the split recorded, halves in page order;
  - a page cut off at every size is failed with "incomplete", the reading
    PAUSED and not complete.

**Real Gemini (gemini-3.5-flash-lite), whole pipeline on the in-memory test database**

The PDFs were built from the real LIC notice. `lic-text-then-scan.pdf` has
pages 8–9 as images; `lic-scan-then-text.pdf` has pages 6–7 as images.
Run with `ONLY_CROSS=1 … importer-scans.acceptance.ts`.

| | Run 1 | Run 2 |
|---|---|---|
| LIC text 6–7 → scanned 8–9 | 181/181, 232, complete | 181/181, 232, complete |
| LIC scanned 6–7 → text 8–9 | 181/181, 232, complete | 181/181, 232, complete |
| Checks | 12/12 | 12/12 |

Only the rows on scanned pages are marked AI-read, and the page images are
kept for the review.

`importer-gemini.acceptance.ts` was run once more: 46/47. IBPS read every
batch this time, so the split was not exercised against the real model. A
B2.3 run had lost pages 17–24 to exactly this. Exam pattern: 6 of 7 papers.

The one failure is older than B2.5. An LIC selection quote ending in "..."
passed the details reader, which matches quotes without punctuation. That
reader is shared with the CMS AI Assist, so it was left unchanged; see the
proposals file.

**Regression**
- 20 local-stack suites pass, including jobs 48/48
- `cms:test`: 45/45 suites, including the new cross-page suite
- intake 332/332
- PostgreSQL 17: 35/35
- `tsc` clean
- production build passes (the pdf.js warning as in B2.4); the cache test
  on it is 31/31
- intelligence 12/13 and lint 7 / 26, both unchanged baselines (the same
  files as B2.4)

### Still open

The proposals are in `docs/importer-b2-design-proposals.md`. Nothing there
is built, and each waits for a decision:

- post-wise age limits (extending `PostAgeRange`, legacy single range kept);
- selection stages vs recruitment milestones (an optional `kind`, classified
  by code on the printed name, nothing dropped);
- the exam-pattern plan (count papers by code, read text tables by code,
  never "complete" with papers missing);
- the shortened-quote finding.

Scan transcription can still misread or omit rows. The B2.4 safeguards are
unchanged. Stage C and B2.6 are not started.

---

## Quote fix — a quote shortened with "..." is not verbatim (done)

- **Where:** the details reader (`quoteFound` in
  `src/lib/cms/ai-assist-details.ts`, shared with the CMS AI Assist and the
  exam-pattern reader) and `verifyEvidence` in
  `src/intelligence/structured-extractor.ts` (dates and fees).
- **The problem:** both match quotes with punctuation removed, so a quote
  cut short with "..." or "…" matched the sentence it was cut from.
- **The fix:** a quote containing an ellipsis is accepted only when the
  source prints the same words with the same marks, contiguously. Only case,
  spacing, and typographic quotes and dashes are evened out. Every other
  quote is checked exactly as before.
- **Smart intake's whole-text reader** already kept punctuation. A new test
  now pins that.
- **Tests:**
  - AI Assist details 21/21 (QV01, QV02);
  - structured extractor 22/22 (SE12b);
  - Smart intake article 14/14 (IA14).
- **Regression:**
  - 20 local-stack suites pass; `cms:test` 45/45 suites; intake 332/332;
    PostgreSQL 35/35;
  - `tsc` clean;
  - intelligence 12/13 and lint 7 / 26, the same baseline failures as
    before.

---

## Selection stages and recruitment milestones (done)

- **Model:** `ExamStage.kind` (optional) is one of SELECTION, ADMIT_CARD,
  RESULT, TRAINING, DOCUMENT, OTHER_MILESTONE or UNCLASSIFIED. A stored
  stage without one is a selection stage, exactly as before.
- **Classified by code** from the printed name (`src/lib/exam-stage-kind.ts`),
  never by the AI:
  - Milestone rules are tried before selection words, so "Download of call
    letters for online examination" is a call letter, not an exam.
  - A name no rule recognises is UNCLASSIFIED. Examples: "PET" alone, which
    means pre-exam training in banking and physical efficiency test in
    police notices; "Counselling".
- **Smart intake:**
  - The whole-text reading now keeps call letters, results and training as
    schedule entries. Application-window dates are still read only into the
    date fields.
  - Each entry gets its class.
  - The review shows each entry's class. An unclassified entry is flagged:
    "choose in the exam stages editor".
- **Editor:**
  - A "What it is" selector on each stage. A new stage's class follows its
    name until the admin picks one.
  - Unclassified entries are marked, with a note above the list.
  - The pre-publish check warns about an unclassified entry.
  - Note: the import review ticks items but does not edit values, so the
    class is corrected in the editor, where every imported value is
    checked.
- **Public pages:**
  - **"Exam schedule" box, card badge, status badge, "Exam Postponed":**
    selection stages only (unclassified counts as selection). A call letter
    or training dated before the exam is not shown as the next exam.
  - **Dates table:** "Selection stages", then "Other announcements", each in
    the notice's order. A record with no milestone renders as one list,
    unchanged.
  - **Timeline:** keeps every announcement, marked `milestone`. "What's next"
    is still the nearest dated event, and its fallbacks use selection
    stages only.
- **Other changes:**
  - The update check classes a new stage it adds.
  - The stage limit was raised from 12 to 20, to make room for the
    announcements.

### Results
- **`tests/cms/stage-kinds.test.ts`: 12/12.** It covers:
  - the nine IBPS entries;
  - LIC, SSC, BTSC and police names;
  - the real model's LIC and BTSC names;
  - unclassified names;
  - the next exam with training and call letters dated first;
  - a postponed result vs a postponed exam;
  - announcements only;
  - grouping;
  - a legacy record unchanged (same array, same order, same summary);
  - timeline kinds;
  - save, refuse unknown, 20 stages;
  - Smart intake classes and the flag;
  - the pre-publish warning.
- **Real Gemini, three runs** of `importer-gemini.acceptance.ts` (52/52,
  52/52, 51/52):
  - IBPS: all nine entries classed as in the notice in every run (3
    training, admit-card or result announcements; 3 selection; 3 more
    announcements).
  - LIC and BTSC: classed right after two rule fixes:
    - an application or fee step is an announcement even when it names
      the exam;
    - a documents deadline is DOCUMENT, while "document verification"
      stays a selection stage.
  - Run 3 failed only "IBPS: exam pattern found": the known pattern
    variance, for the pattern stage.
  - Run 3 also shows model variance in the list itself:
    - IBPS gained "Preliminary Exam" and "Main Exam" from the pattern pages,
      both classed as selection;
    - LIC's PDF reading left out document verification.
    The admin sees and edits both.
- **Browser (local test copy):**
  - "Download of call letters - Preliminary" was classed "Admit card / call
    letter" as it was typed.
  - "Counselling" was flagged and then reclassified.
  - The draft preview shows "Selection stages" (Online Examination, 22 Nov
    2026) and "Other announcements".
  - The exam-schedule box shows the exam, not the call letter.
  - A style warning the dev overlay showed for the selector was fixed.
- **Regression:**
  - 20 local-stack suites pass; `cms:test` 46/46 suites; intake 332/332;
    PostgreSQL 35/35; `tsc` clean;
  - intelligence 12/13 and lint 7 / 26 (baselines).
  - The first run caught BR08, which expected a stage without a class; it
    now expects SELECTION.

---

## Post-wise age limits (done)

- **Model.** All new fields are optional, so older records read as before.
  - Each post (`PostAgeRange`) can have its own `asOf`, `relaxations`,
    `categoryMax` (upper ages printed by category) and `evidence`. Evidence
    is one entry per value: what it is about, its value, the quote and the
    page.
  - The whole age (`AgeCriteria`) gains `categoryMax` and `evidence`.
  - The save validates every new field.
- **Fixed on the way:** the save refused any date of birth before 2000. It
  reused the exam-date check, which only accepts 20xx. Every IBPS window
  hit this.
- **Nothing is worked out:**
  - When ages differ by post, no overall range is invented.
  - Category maximums are kept as printed.
  - The earlier reader derived relaxation years from printed category
    maximums and took the general maximum as the lowest of them. That is
    removed, and test IA03 now pins the new behaviour.
  - A "maximum age" below 14 (for example SC/ST 5) is relaxation years and
    is refused as such.
- **Smart intake:**
  - **Reading:** the whole-text reading reads ages post by post. Each figure
    must be in that post's own quote, and the quote must name the post. A
    birth date must be written in the quote. A post's own cut-off date,
    relaxations and printed maximums each need their own quote.
  - **Refusals:** anything that fails is listed under "Left out", with why.
  - **Merge:** a post-wise reading takes the age field from the
    single-range details reader, which can hold only one range.
  - **Flags:** an eligibility post that no age row covers is flagged on the
    age item. A row covers a post when one name's words contain the
    other's.
  - **Page lookup:** finding a quote's page now evens out curly quotes and
    dashes the same way the quote check does.
- **Public pages:**
  - **Age box:** shows "Differs by post" instead of the widest range. Each
    post shows its own date-of-birth window, cut-off date, printed upper
    ages and post-only relaxations.
  - **Checker:**
    - Uses the chosen post's own rules: its range, its date, the
      recruitment's relaxations with the post's own rows replacing the
      same category, and its own printed maximums only.
    - A printed category maximum is used as printed. Rows for women,
      ex-servicemen and similar groups are not used for others, and rows
      that disagree give no answer.
    - The "eligible jobs" finder uses the same rules.
- **Editor:**
  - Three new line inputs: a post's own cut-off date; post-only
    relaxations; upper ages by category ("All | OBC | 33" or
    "Post | OBC | 33"), with a warning never to add relaxation years to
    make one.
  - It lists where each value was read. On save it keeps a value's quote
    only while that value is unchanged.
- **Also:**
  - A timed-out AI request now says "AI took too long to answer". It used
    to say "AI service unavailable", which hid the cause during this work.
  - That one-line change is in the shared `callAiJson`. Every retry rule
    already recognises the wording.

### Results
- **`tests/cms/post-ages.test.ts`: 12/12.**
  - The real IBPS age table: four posts from page 7, no overall range.
  - A figure not in its quote; a quote naming another post.
  - A post's own date, relaxation and maximum, each with its quote.
  - The missing-post flag, using the model's real IBPS post names.
  - New fields saved; older ages save back unchanged.
  - The checker never uses the widest range (born 1 Mar 1995: too old for
    Scale-I, inside for Scale-II).
  - Post relaxations merged, and the post's date used.
  - BTSC printed maximums, including the women's row not applied to a
    general candidate.
  - Relaxation years refused as an "upper age".
  - The page of a quote with a straightened curly quote.
- **Real Gemini (`importer-gemini.acceptance.ts`, four runs):**
  - The final run passed 52/52. All four IBPS posts were read with min,
    max and both birth dates, each from page 7.
  - Earlier runs found the problems fixed above:
    - the merge dropping the post-wise age;
    - SC/ST "5" taken as an upper age;
    - the missing page;
    - a false missing-post flag for the Scale-II specialist posts.
  - Some IBPS posts are named without their scale (for example "Law
    Officer"). Code cannot tie those to an age row, so they are flagged
    for the admin.
  - In runs 1–3 the LIC whole-text reading hit its 50 s limit while the
    service was slow. The same reading took 5–9 s when probed directly and
    15 s in run 4. It was reported, not hidden.
- **Browser (local test copy):** the editor and the public checker were
  tested together.
  - Saved four IBPS posts, common relaxations, an Office Assistant OBC
    relaxation, a Scale-I cut-off date and a Scale-III SC/ST maximum. The
    stored value is exactly what was typed.
  - The preview shows "Differs by post" and each post's own rules.
  - The checker gave:
    - Office Assistant, OBC, aged 29: within, with an upper limit of 32
      from the post's own relaxation;
    - Office Assistant, General, aged 36: over (the widest range's 40 not
      used);
    - Scale-I: age counted on the post's own 1 Oct date;
    - Scale-III, SC, aged 44: within, using the printed 46.
  - Evidence shown in the editor; changing Scale-II's maximum by hand
    dropped only that value's quote.
  - No console errors.
- **Regression:**
  - 20 local-stack suites pass; `cms:test` 47/47 suites; intake 332/332;
    PostgreSQL 35/35; `tsc` clean;
  - production build passes; the cache test is 31/31;
  - intelligence 12/13 (baseline). Lint is back to the 7 / 26 baseline
    after one new apostrophe error was fixed.

---

## Exam-pattern completeness, read by code (done)

- **`src/lib/cms/importer/pattern-tables.ts`**, pure, no AI.
  - **Finding the papers:** every pattern table is found first. A table's
    header names the tests or subjects, the questions and the marks. The
    count of tables is the number of papers the notice prints.
  - **Reading the rows**, as printed:
    - wrapped names;
    - numbered (1, 4a/4b), lettered (A–D under a Part or Section column) or
      unnumbered rows;
    - a medium column stripped only where most rows end with one, so "General
      English" stays whole;
    - marks-first headers read in that order;
    - tab-separated rows.
  - **Totals and duration:** the printed Total gives the questions, marks
    and duration. A duration on the next line or in the sentence after
    ("will be 60 minutes", "2 Hours") is also used.
  - **Paper names:** the stage heading plus the post's title. Titles listed
    together before their tables (IBPS single level) are given out in
    order. A sentence is never a title.
  - **Nothing is worked out:**
    - a sum that disagrees with its printed total is said, not corrected;
    - "4a / 4b" alternatives are counted once and noted;
    - a table whose rows cannot be read is named, with its page.
- **In the reading (`combineReading`):**
  - Where the text has pattern tables, the papers read by code are the
    pattern. The AI's papers are not used there; they came and went between
    runs, 4–7 of 7 for IBPS.
  - The AI's pattern is used only where the text has no pattern table
    (prose, or a scan not written out as a table).
  - The coverage (expected, read, tables, problems) is kept on the source
    reading.
- **Review:**
  - All papers read: the item says "all N papers read by code from the
    notice's tables".
  - Any paper missing: the item is flagged "incomplete: N of M papers read
    — not read: … (page P)" and left unticked, and the preview warns.
  - A disagreeing printed total is flagged.
  - Reading jobs never call a reading with a missing paper "complete": the
    job's note says so.
- **Also, recovery for short notices:** a notice short enough to be read in
  one request, whose answer comes back incomplete, is now read again in
  halves, as a page batch is. LIC's one-request reading was answered
  incompletely twice in one run and lost its total and exam date.

### Results
- **`tests/cms/pattern-tables.test.ts`: 10/10.** It covers:
  - IBPS from its real text: 7 tables on pages 21, 21, 22, 22, 24, 24, 24,
    and every paper's questions, marks and duration as printed;
  - LIC and BTSC from their real text;
  - an SSC-style two-tier scheme with lettered parts;
  - a marks-first table;
  - a disagreeing total, said;
  - an unreadable table, named with its page;
  - prose only (nothing counted);
  - in the reading, IBPS's AI four papers replaced by the code's seven;
  - with no table, the AI's papers kept.
- **`tests/cms/batch-reading.test.ts`: 16/16** (BR13: a short notice cut
  off, then read again in halves).
- **Real Gemini (`importer-gemini.acceptance.ts`, three runs):**
  - IBPS read 7 of 7 papers with every figure as printed in all three runs.
    The item said "all 7 papers read by code".
  - LIC and BTSC were read as printed. A web article's tabs come through as
    spaces, so BTSC's part label reads "Paper 1 General Studies…".
  - Run 3 passed 55/56. The one failure: Gemini answered "rate limit
    reached" for IBPS pages 65–72 after the retries. Those pages were
    reported as not read.
- **Browser (local test copy, real Gemini):**
  - IBPS pages 21–24 were pasted as the notice. The review lists all seven
    papers and "all 7 papers read by code".
  - With the Specialist Cadre table's figures removed (as a damaged text
    layer would), the item is flagged "incomplete: 6 of 7 papers read — not
    read: … (Specialist Cadre) (page 24)". It is left unticked, the preview
    warns, and the six good papers are still offered.
- **Regression:**
  - 20 local-stack suites pass; `cms:test` 48/48 suites; intake 332/332;
    PostgreSQL 35/35; `tsc` clean;
  - production build passes;
  - intelligence 12/13 and lint 7 / 26 (baselines).
- **Not changed:** the review shows the positive "all N papers read" note
  with the same ⚠ mark as warnings. That is how the review shows every
  flag.
