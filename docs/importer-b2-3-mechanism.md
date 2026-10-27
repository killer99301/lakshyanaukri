# B2.3 — How a long reading runs, and is kept: mechanism and limits

You asked for this before any worker is built. It describes what will actually run, where every piece of progress is stored, and what this design cannot do. Nothing here is built yet.

## 1. What the platform gives us (checked, not assumed)

| Fact | Consequence |
|---|---|
| Each request to the site runs at most **60 s** (`maxDuration = 60` on the import routes; Vercel ends the function after that). | No single request can read a 76-page notice and its scanned pages. The work must be cut into steps of well under 60 s. |
| Anything still running in memory when a function ends is lost. That includes Next.js `after()` work, which ends with its function. | Progress can never live in memory. Every finished piece is written to the database before the step that did it returns. |
| The only scheduled job in `vercel.json` runs **once a day** (`/api/cron/attention`). | A scheduler cannot keep a reading moving minute by minute. |
| A request body is limited to about **4.5 MB** on Vercel. | A 30 MB PDF cannot be sent in one request. |
| The database is the existing Postgres (Neon); imports, sources and retrievals already live there. | Job progress can be stored in new tables beside them, with no new paid service. |
| pdf.js (`pdfjs-dist`) is already installed; pdf-lib is not. | Splitting a PDF in the browser needs one small free library (pdf-lib, MIT licence). No paid service is needed. |

## 2. The design: the job lives in the database; the browser keeps it moving

### 2.1 What is stored (three new tables, local test database only until you approve a migration)

- **`recruitment_import_jobs`** — one row per reading.
  - **Fields:** who started it; new job or existing job; the subject; the state; the estimate and actual AI requests; the times.
  - **State:** `UPLOADING`, `READY`, `READING`, `PAUSED`, `CANCELLED`, `DONE` or `FAILED`.
  - When the reading is finished, it links to the ordinary preview (`recruitment_imports`) it produced.
- **`recruitment_import_job_parts`** — one row per uploaded piece of a PDF.
  - **Fields:** source number, original first and last page, SHA-256 of the piece, its bytes, its extracted text, and which of its pages have no text.
  - **Bytes kept only while needed:** a piece's bytes are deleted once its pages are read, and every job's bytes are deleted when the job ends or is cancelled. Text and fingerprints are kept, as for any import.
- **`recruitment_import_job_tasks`** — one row per unit of work, each well under 60 s:
  - a text batch (pages N–M)
  - a group of scanned pages to transcribe (B2.4)
  - a section reader (dates/fees, details, pattern)
  - the vacancy tables

  Each task has a status (`PENDING`, `RUNNING`, `DONE`, `FAILED` or `SKIPPED`), attempts, a lease (who is running it, until when), its result (the checked values, with quotes and pages) and its AI request count.

### 2.2 What runs

1. **Upload.** You pick one PDF, of any size.
   - The browser splits it into pieces of whole pages (each under 4 MB, original page numbers kept) and uploads them one at a time to the job.
   - The **server** reads each piece's text with the same PDF reader as today and records which pages have no text.
   - A piece that fails to upload is shown and can be sent again. The job can't start reading until every piece is in, or until you choose to read without the missing pages (they are then reported as not read).
2. **Estimate.** The server lists the tasks and shows the number of AI requests they will take next to what is left of today's allowance.
   - Reading starts only when you press **Start**.
   - If the estimate is more than the allowance left, it says so. You can then start (reading pauses when the allowance runs out) or wait for tomorrow.
3. **Steps.** While the import page is open, the browser calls `POST /api/admin/cms/import/jobs/:id/step` again and again. Each step:
   - takes up to two pending tasks in one database statement, giving each a lease of 55 s. A task whose lease ran out (its step died) is taken again; two tabs never take the same task.
   - runs them with the pacing from B2.2 (gate, resends, daily allowance);
   - writes each result **only if it still holds that task's lease**, so a late or duplicate step can never overwrite or double a result;
   - returns the progress, for example "pages 17–24 of 76 being read, 9 of 14 tasks done, 11 AI requests used".
4. **Leaving and coming back.** If you close the tab, steps stop. Nothing is lost: finished tasks stay finished, and an unfinished task's lease runs out. Opening the import again (from the job list or the job's page) resumes stepping where it stopped.
5. **Failures.**
   - A task that fails after its retries is marked `FAILED`, with the reason and its pages.
   - "Retry failed pages" puts only those tasks back to `PENDING`. Finished tasks are not run again, so nothing is duplicated.
   - When the daily allowance runs out, the job is `PAUSED` with that reason.
6. **Cancel.** It is always shown. A cancelled job takes no more steps; a task already running finishes, but its result is dropped. The job's bytes are deleted.
7. **Finish.** When every task is `DONE`, `FAILED` or `SKIPPED`, the last step builds the preview exactly as today (the merge from B2.2, the vacancy tables from B1, the proposal) and stores it. You review and save it as today.
   - The coverage report lists every page that was not read.
   - The state is `DONE` only when every page with text was read; otherwise the preview says which pages are missing.

## 3. Limits of this design (stated, not hidden)

- **Reading moves forward only while an import page is open**, in any admin's browser. Closed, the job waits; it doesn't run on its own. Making it run without a browser would need a server-side trigger. The free option is Upstash QStash (an Upstash account is already used for Redis, and QStash has a free tier). That would be a new service, so it's not part of this plan unless you want it.
- **The browser is trusted with the splitting, not the reading.** The server reads every piece it receives. But the SHA-256 of the *whole original file* is computed in your browser, because the server never receives the original in one piece. Each piece's SHA-256 is computed by the server.
- **A single page larger than 4 MB** (a very heavy scan) cannot be uploaded as it is. It is reported as not read. Shrinking such a page in the browser is possible later, but it changes the image, so it's not done silently.
- **Encrypted or damaged PDFs** that pdf-lib can't open can't be split. They are refused at the start with that reason, not half-read.
- **Database space:** while a job runs, its PDF pieces sit in Postgres (a 40 MB notice uses 40 MB until it is read). Bytes are deleted as soon as they are read, when a job ends or is cancelled, and in a daily clean-up of jobs older than 7 days.
- **The daily allowance:** the estimate is only an estimate, because resends after refusals for load add requests. Every request and resend is counted, and reading stops at the cap rather than going over it.
- **The 60 s limit per step:** a step starts only tasks that fit. A text batch is about 5–20 s; a group of scanned pages is kept small enough (B2.4 will measure it).

## 4. What I need from you

1. **Approve this mechanism:** database-held job, browser-driven steps, the limits above.
2. **Adding pdf-lib** (free, MIT licence) for splitting in the browser. The alternative is to have the browser read the text with pdf.js (already installed) and upload only text and page images. That trusts the browser with the reading itself, which I don't recommend.
3. **QStash for reading without a browser open:** not now, unless you want it.

Once approved, B2.3 is built and tested in this order:

1. the tables, on the local test database only
2. the step route with leases
3. the upload and splitting
4. the progress, cancel and retry screen
5. leave-and-reopen in the browser
6. a forced step failure and a duplicate step
