# Stage C — Verification and publishing safeguards: plan for approval

Dated 1 November 2026. **Nothing in Stage C is built yet.** The two entry checks are done and recorded in
`docs/smart-intake-roadmap.md`:
- the selection fallback passes on the real IBPS path, 17 of 17;
- the intelligence baseline E8 is inspected; the old review queue is not verified, and Stage C does not rely on it.

## 1. What Stage C is

The vision (`docs/smart-recruitment-vision.md` §8–§10) defines it:
- row-level evidence in the review and the editor;
- "stated" and "calculated" badges;
- your decision 3 of 26 October: a calculated total counts as checked for Tier B only when:
  - every input row has its evidence;
  - coverage is complete;
  - no conflict is open;
  - a recalculation from the stored rows gives the same figure.

The roadmap calls the stage "verification and publishing safeguards".

## 2. What already exists, and the gap

| Piece | State |
|---|---|
| Each row's page and printed line, in the import review and the editor | **Built** (A2/A3, B2) |
| Badges: Printed in the notice / Calculated / Entered by hand / Prepared outside, to check / AI-read from image | **Built** |
| Page images beside AI-read rows | **Built** (B2.4) |
| Public wording: "At least N", "Calculated by adding…" | **Built** (A3) |
| A field check bound to the field's revision, so an edit reopens it | **Built** (Phase 1 design §4–5) |
| `calculatedTotalReady`: decision 3 written as code, with its reasons | **Written, but used only by tests.** Neither the publish gate nor any screen calls it |
| Recording "this table was checked against the notice" | **Missing.** `vacancies.table` has no gate tier, and no decision for the whole table exists |

**So the gap is the gate, not the evidence.** As far as I have traced it, an imported job's calculated total is gated like any other field:
- it is checked through a quote;
- a sum has no printed quote of its own;
- rows read by AI from a scan, or prepared outside, can reach the public page without the table ever being checked as a whole.

Step C0 confirms this with a test before anything changes.

## 3. Decisions needed from you

| | Decision | My recommendation |
|---|---|---|
| **C-D1** | **How a table check is recorded.** | **One "Checked against the notice" decision for the whole table**, as the vision §4.4 says. It names the pages compared and is bound to the table's revision, so editing any row reopens it. No check per row. |
| **C-D2** | **When the table check is required for publishing.** | **Required when the total is calculated, or when any row was AI-read from an image or prepared outside.** A printed total on a table read by code from text is checked as it is now (quote and page). |
| **C-D3** | **An incomplete total** (for example IBPS before Tripura reports). | Keep decision 1: it never passes Tier B as checked. It can be published only if you record "not stated in full". The public page then says "At least N", as it does now. |
| **C-D4** | **The old intelligence review queue** (E8). | **Leave it untouched in Stage C** and recorded as not verified. Whether to retire it or point it at the CMS is a separate decision, later. |

## 4. Steps and acceptance

| Step | What | Accepted when |
|---|---|---|
| **C0** | Measure first. A stack test pins today's gate for imported jobs with tables of each kind: printed total; calculated total; incomplete; AI-read rows; prepared rows. | Its results are reported to you before any change. No product code changed. |
| **C1** | The whole-table check, on the server. Recorded through the existing decision route on `vacancies.table`, citing the pages compared, bound to the table's revision, and revocable like any check. | Unit and stack tests: recorded; reopened by any row edit; refused on a stale revision; revoked. Existing decisions unchanged. |
| **C2** | The gate. A derived total is VERIFIED only when the table check stands at the current table revision **and** `calculatedTotalReady` gives ready (including the recalculation against the stored fingerprint). A table with AI-read or prepared rows blocks publishing until it is checked (C-D2). Each blocker says why, in the reasons the code already gives. | Tests for every reason in `calculatedTotalReady`. A table that is not checked cannot publish, and a checked one can. Editing a row reopens the check. Jobs that were not imported are not gated, as now. |
| **C3** | The check list in the editor shows the table's state and its reasons, with a **Check the table** action: pages to compare, page images for scanned rows, rows prepared outside listed. Functional, in today's styling; the redesign comes later. | Browser review of the **IBPS and BTSC drafts** (the vision §9 acceptance). Also: **LIC scan** (AI-read rows held until checked); **BPSC 72nd** prepared table (held, then checked); IBPS incomplete total (only "not stated in full" lets it publish, and the page says "At least"). |
| **C4** | Regression and report. | All stack, CMS, intake and PostgreSQL suites; type check; lint at baseline; production build; cache test. A formal report like B2's, then your acceptance. |

## 5. Rules for this stage

- **No AI request is needed.** The acceptance uses saved readings and replays, so the Gemini quota is not touched. If a real run turns out to be needed, I ask first.
- No production database, push, merge, migration or deployment.
- A schema change, if C1 needs one, stays in the local schema file and is listed for the release migration. It is never applied anywhere but the test database.
- No verification is automatic. Code only refuses or explains; a person checks.
- Each step is its own local commit, made only when its tests pass. Tests are never loosened to get a pass.

## 6. Approved, 1 November 2026

The owner approved this plan and C-D1 to C-D4 as recommended, with one more safeguard for C-D3:
- recording "not stated in full" resolves only the incomplete-total condition;
- it never clears another blocker: missing row evidence, an open conflict, invalid data, or a table check required for another reason.

Order: C0, report, then C1 to C4. Each step is its own local commit.

## 7. C0 baseline, 1 November 2026 (no product code changed)

The test is `tests/local-stack/stage-c-baseline.test.ts`. The raw output is in `docs/acceptance-runs/stage-c-c0-2026-11-01/c0.log`.

| Table | Stored total | Gate before a decision | "Verify" citing one row's line (not the total) | Afterwards |
|---|---|---|---|---|
| 1. Printed total | 30, STATED, complete | total UNSUPPORTED, blocks | **accepted** | total VERIFIED, does not block |
| 2. Calculated total | 30, CALCULATED, complete | UNSUPPORTED, blocks | **accepted** | VERIFIED; a row edit reopens it (UNSUPPORTED again) |
| 3. Incomplete total | 22, CALCULATED, incomplete | UNSUPPORTED, blocks | **accepted** | **VERIFIED**, does not block |
| 3b. Incomplete, "not stated" | 22 | UNSUPPORTED, blocks | "not stated" **refused** ("not an editable field while the job has a vacancy table") | still blocks |
| 4. AI-read rows, printed total | 30, STATED | UNSUPPORTED, blocks | **accepted** | VERIFIED, does not block |
| 5. Prepared rows, printed total | 30, STATED | UNSUPPORTED, blocks | **accepted** | VERIFIED, does not block |

**What the baseline shows:**
- **Any quote verifies the total.** The decision route accepts any words that are in the document. A single row's "Officer A Bank 10" marks a total of 30 as checked. Nothing compares the quote with the figure, or with the table.
- **The table is not in the gate** in any case, and nothing records a check of it.
- **An incomplete total can become VERIFIED.** That breaks decision 1 and C-D3.
- **"Not stated" is refused for a table total,** so the honest route for an incomplete total does not exist yet.
- **AI-read and prepared rows** reach VERIFIED through the total alone, and the table is never checked.
- **Already right:** an edit to a row reopens the check on the total, because the check is bound to the revision.
- **`calculatedTotalReady`** gives the right reasons in every case, but nothing calls it.

**Limitation of the measurement:** the tables were saved through the editor's field route, not proposed by the import. So the total starts as UNSUPPORTED, not SUPPORTED. That does not change what a decision can do.

## 8. C1 done, 1 November 2026: the whole-table check (waits for the owner's review)

**What was built.** No schema change.
- **The rules:** `src/lib/cms/importer/table-check.ts`.
- **Where they are applied:** the existing decision path, `decide` in `service.ts`. Its route is `POST /api/admin/cms/records/[id]/decisions`.

**A decision on `vacancies.table`:**
- **What is accepted:** "checked against the notice" only. "Not applicable" and "not stated" are refused on a table.
- **The pages compared:** they must be named, and they must include every page the table's rows and printed totals cite. A page left out is refused by name. They are stored as `review_scope { pages, sections: ["the whole vacancy table"] }`.
- **The words cited:** they must be in the notice, and on one of the pages compared.
- **The binding** is the existing one for every decision:
  - it is bound to the table's exact revision;
  - a decision made on a stale revision is refused (409);
  - it is revoked like any decision;
  - any save of the table leaves it behind. That includes saving the table unchanged.

**The reader** is `tableCheckFor(record)`, also returned by `checksFor` as `tableCheck`. The table counts as checked only when:
- the decision is the effective one at the table's latest revision;
- it was made on the table exactly as it is now.

**What did not change:**
- The publish gate. C2 will use `tableCheck`.
- The total's own decisions.
- Every other field decision.

**Tests:**
- Unit: `tests/cms/table-check.test.ts`, 8 of 8.
- Stack: `tests/local-stack/table-check.test.ts`, 19 of 19. It covers two pathways, kept apart:
  - **I: a table created by the import.** The table is SUPPORTED from the import's extracted claim.
  - **E: a table saved in the editor.** The table is UNSUPPORTED, with no claim.
- Negative check: with the new rules switched off, 5 stack checks fail. Without them, a table could be marked checked with no pages named.

**Found on the import pathway, for C2.** The import's claim is on the table, not on the total. So the total worked out from an imported table is UNSUPPORTED on both pathways. C0's UNSUPPORTED start was therefore not only an artefact of the editor route.

**A defect found, not fixed (outside C1).** The code table reader goes wrong when a table continues on the next page under a "(continued)" heading and a repeated column heading. The first row there takes those lines into its name: the bank read as "Annexure I (continued) Sr. No. Name of the Bank … 3 Gamma Gramin Bank". A continuation page without the heading reads correctly. It belongs with the B2.5 cross-page reading and needs the owner's go-ahead to fix.

**Regression, 1 November 2026, with C1 in place:**

| What | Result |
|---|---|
| Stack, CMS, PostgreSQL and intelligence suites | 81 of 84 suites pass |
| Intake | 332 / 332 |
| PostgreSQL concurrency | 35 / 35 (17.11) |
| Production cache test | 31 / 31 |
| Production build | passes; only the existing pdfjs-dist warning |
| Type check | clean |
| Lint | baseline, 7 errors and 26 warnings, none in the C1 files |

All three failures predate C1, and C1 touches none of their code:
- **Intelligence E8:** the known baseline (item 2 of the Stage C entry checklist in the roadmap).
- **`tests/cms/sitemap-ticker.test.ts`, TK02 and TK03:** the test imports `IMPORTANT_UPDATES`, which was removed from the site's code on 4 October (5d5d9a9, already on main). The test is stale.
- **`tests/cms/phase-d-integration.test.ts`:** it needs a live `DATABASE_URL` and stops without one. It was not run against any real database.

## 9. C2: the publish gate for Total Vacancies worked out from a table (waits for the owner's review)

Approved on 1 November 2026, with the owner's added safeguard: a printed total is verified only by evidence that is its own line, figure and page.

**Where the rules are:**
- `classifyTableTotal` in `classify.ts`, with its rules in `table-check.ts`: `totalRoute`, `printedTotalEvidence`, `quoteIsPrintedTotal`;
- `tableTotalContext` in `service.ts`, which feeds `checksFor` and `publishGateFor`;
- `decide`, which refuses wrong decisions up front.

They apply only when the total is derived from the job's vacancy table. A total entered on its own is classified exactly as before. A job that was never imported is not gated, as before. No schema change.

| The total | How it can become VERIFIED | "Verify" by a quote |
|---|---|---|
| Printed, rows read by code from text, its printed line established | Its own printed line, holding the figure, on its page; or the whole-table check | Accepted only for that line on that page. A row's line, the bare figure, or the right line on the wrong page is refused |
| Printed, but the line cannot be established: none covers the whole table, more than one does, a different figure, no page, or no figure in the line | The whole-table check only | Refused |
| Calculated or entered | The whole-table check only | Refused |
| Any row read by AI from an image, or prepared outside | The whole-table check only | Refused |
| Incomplete | **Never.** It can be NOT_STATED (Tier B accepts) with "not stated in full" | Refused |

**In every case,** `calculatedTotalReady`'s reasons must be clear:
- every row with its evidence;
- no row duplicated or missing a dimension;
- no figure unclear or bad;
- no column whose place in the total is undecided;
- row and printed totals agreeing;
- the stored total equal to a recalculation (by fingerprint).

No conflict may be open on the table: an open conflict makes the total CONFLICTING.

**"Not stated in full":**
- **When it is accepted:** only for an incomplete total, with a reason and the pages read.
- **What it records:** the figure is left as it is, so the page goes on saying "At least N".
- **What it clears:** only the incompleteness reasons, that is, the total being incomplete and rows not reported or with no figure.
- **What it never clears:** a conflict, a row without its evidence, an undecided column, or the whole-table check that an incomplete total needs.

**"Not applicable"** is refused on a total worked out from the table.

**A printed total's line**, as the import stores it, can also be the single post's own total (`at: { post }`). Any printed total that covers every row counts. Two such totals are ambiguous, so they need the whole-table check.

### C2 tests

**Unit:** `tests/cms/table-total-gate.test.ts`, 22 of 22.

**Stack:** `tests/local-stack/table-total-gate.test.ts`, 22 of 22, through the real import, decisions, field and publish routes. It covers:
- **I (tables created by the import):** a printed total and a calculated total, both starting with the table SUPPORTED;
- **E (tables saved in the editor on imported jobs):** AI-read rows, prepared rows, and an incomplete total;
- **N:** a job that was never imported.

The incomplete job is published through the real publish route, and its page says "At least 22".

**Negative check:** with the printed-line rule loosened to accept any quote (the behaviour before C2), 3 stack checks and 2 unit tests fail.

**C0 again, with C2 in place** (`stage-c-baseline.test.ts`, still a measurement):
- every attempt to verify a total of 30 with "Officer A Bank 10" is now refused, with the reason;
- "not stated" without the pages read is refused with a plain message.

**C1's stack test, two checks changed on purpose and kept as strict.** They had pinned "the gate is unchanged", which C2 changes by design. They now assert:
- a checked table verifies its printed total, and every other field's class is unchanged;
- after a row edit makes the rows add up to 31 against the printed 30, even the printed line leaves the total pending.

19 of 19.

**Known defect, documented and not fixed:** `docs/known-defects/continued-heading.md`, with its reproduction. It leads to an open question for C3, set out there.

### C2 regression, 1 November 2026

| What | Result |
|---|---|
| Suites (stack, CMS, PostgreSQL, intake, intelligence E8 suite) | **83 of 86 pass** |
| Intake | 332 / 332 |
| PostgreSQL concurrency | 35 / 35 (17.11) |
| Production build | passes; only the existing pdfjs-dist warning |
| Production cache test | **31 / 31**, from a clean build and fresh servers |
| Type check | clean |
| Lint | baseline, 7 errors and 26 warnings, none in the C2 files |

**The three exceptions, reported separately.** None is counted as passing, and none is touched by C2:

| Suite | Status | Why |
|---|---|---|
| `tests/intelligence/review-queue-e2e.test.ts` (E8) | **FAILS**, 12 of 13 | The known baseline: "one diff applied", 0 against 1. The old review queue finds no job since `bf6b84f`. Recorded as not verified (C-D4) |
| `tests/cms/sitemap-ticker.test.ts` | **FAILS**, 6 of 8 (TK02, TK03) | Stale: it imports `IMPORTANT_UPDATES`, removed from the site's code on 4 October (5d5d9a9, on main) |
| `tests/cms/phase-d-integration.test.ts` | **NOT RUN** | It needs a live `DATABASE_URL` and stops without one. It is never pointed at a real database |

**How the cache test was run.** A first attempt failed: 30 of 31 the first time, then a crash. It ran against the C1 run's test servers, still alive on ports 443 and 3000, and against a page that an aborted run had cached into the build folder. Those servers were stopped, the build was redone clean, and fresh servers gave 31 of 31. All test servers are stopped.

### The owner's decision on the "(continued)" heading defect (1 November 2026)

The owner treats it as a **data-integrity issue, to be resolved before Stage C is accepted**, not as a C3 screen improvement alone:
- a correct total does not prove that every vacancy row is correct;
- preserve the reproduction and the raw evidence;
- add a regression test for continued headings and repeated column headings;
- a suspicious or wrongly read table must not become publishable as verified;
- a human table check is required wherever the system cannot establish that the row labels are reliable;
- C-D2 is not weakened or silently changed;
- any reader correction is a separately authorised, narrowly scoped change.

**Status:** C2 is committed, and its acceptance waits on this defect decision. No fix has been made. C3 is not authorised.

## 10. The "(continued)" heading defect: fixed (1 November 2026, waits for the owner's review)

Approved by the owner as a narrow fix to the B2.5 reader, kept in its own commit. C-D2 is unchanged. The details and evidence are in `docs/known-defects/continued-heading.md`.

**Tests:**
- `tests/cms/cross-page.test.ts`: 14 of 14 (CP01–CP09 as before, CP10–CP14 new).
- `tests/local-stack/continued-heading.test.ts`, import to publication: 8 of 8.
- C1 and C2 tests unchanged:
  - `table-check.test.ts`: 19 of 19;
  - `table-total-gate.test.ts`: 22 of 22 (stack) and 22 of 22 (unit).
- Importer tables: 25 of 25. Importer jobs (real IBPS PDF): 53 of 53.

**Negative check:** with the fix switched off, 3 of the new tests fail.

**Real notices:** 21 read before and after the fix, identical.

**Regression:**
- **Suites:** 84 of 87 pass.
- **Other checks:** intake 332 of 332; PostgreSQL 35 of 35; build passes; type check clean; lint at baseline.
- **The same three exceptions, separately, unchanged:**
  - E8 **fails**, 12 of 13;
  - sitemap/ticker **fails**, 6 of 8 (stale);
  - phase-D integration **not run** (no database).
