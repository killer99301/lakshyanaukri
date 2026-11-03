# Smart intake — Stage C formal acceptance report

Dated 3 November 2026.

> **NOT YET ACCEPTED as a whole.** C3 was accepted by the owner on 3 November 2026, and C4.1 on 3 November 2026. **Stage C's final acceptance is the owner's separate decision** (section 6).

**Branch:** `feature/importer` in `D:\LakshyaNaukri-importer`, tested at **`c48683b`**.
- Local only: nothing pushed, merged, migrated or deployed.
- No production data used.

**No Gemini request** was made in Stage C's acceptance. Saved readings were used instead (section 1.3).

**The plan, the steps' details and the decisions:** `docs/importer-stage-c-plan.md`.

**The evidence:** `docs/acceptance-runs/stage-c-final-2026-11-03/`.

## Verdict

### Under the plan's acceptance criteria: **PASS**, with the limitations in section 4

- **Every Stage C test passes:** 204 checks in 12 suites.
- **The full regression:** 92 of 95 test files pass. **The only 3 failures are the known, older ones** (section 2), unchanged since before Stage C.
- **Type check:** clean.
- **Lint:** at the baseline, with none of its errors in a Stage C file.
- **Production build:** passes.
- **Production cache test:** 31 / 31.
- **The real-notice review the vision sets for Stage C** (IBPS and BTSC drafts) passed in the browser (C4.1). It used saved readings, with the limitations in section 4.1.

**Defects:**
- **During Stage C:** D1 and D2 were found in Step 4's browser acceptance and fixed (`c48683b`). The "(continued)" heading defect was found in C1 and fixed (`8269da8`).
- **Open now:** none that affects Stage C's safeguards. The findings left open (O1–O5) are listed in section 4.3. **O2 is a priority before any unattended discovery.**

## 1. Final-run results

### 1.1 Stage C suites, at `c48683b`

| Suite | Result | What it covers |
|---|---|---|
| `tests/local-stack/stage-c-baseline.test.ts` | 6/6 | C0: the gate before Stage C, measured and kept as a test |
| `tests/cms/table-check.test.ts` | 8/8 | C1: the whole-table check's rules |
| `tests/local-stack/table-check.test.ts` | 19/19 | C1 through the real routes: pages, stale (409), withdrawal, a row edit leaving the check behind |
| `tests/cms/table-total-gate.test.ts` | 22/22 | C2: each route for the total, the printed-line safeguard, incomplete totals |
| `tests/local-stack/table-total-gate.test.ts` | 22/22 | C2 through the import, decisions, field and publish routes, including a real "At least 22" publish |
| `tests/cms/c21-page-free.test.ts` | 27/27 | C2.1's rules |
| `tests/local-stack/c21-page-free.test.ts` | 20/20 | C2.1 through the routes |
| `tests/cms/c3-step1.test.ts` | 22/22 | C3 Step 1: `tableTotal`, the "worth a look" marks, the file fingerprint |
| `tests/local-stack/checks-table-total.test.ts` | 7/7 | the checks route the screen reads |
| `tests/cms/c3-step2.test.tsx` | 11/11 | C3 Step 2: reasons, and only the actions the server allows |
| `tests/cms/c3-step3.test.tsx` | 20/20 | C3 Step 3 and the D1/D2 fix: the panel's form rules, rendered |
| `tests/local-stack/c3-step3.test.ts` | 20/20 | the panel's own form against the real server, including D1's cited page |

**Related suites on the same code, all passing:**
- `cms/attention` 13/13 and `local-stack/attention` 16/16;
- `cms/vacancy-table` 21/21 and `local-stack/vacancy-table` 40/40;
- `cms/vacancy-reader` 17/17 and `cms/cross-page` 14/14;
- `local-stack/continued-heading` 8/8;
- `local-stack/importer-flow` 64/64;
- `local-stack/importer-jobs` 53/53 (the real IBPS PDF);
- intake 332/332;
- PostgreSQL concurrency 35/35 (17.11).

### 1.2 The whole project, at `c48683b` (the C3 Step 5 audit, 3 November)

By the owner's decision C4-D1, this counts as C4's regression, since no product code has changed since.

| Check | Result |
|---|---|
| Full regression (stack, CMS, PostgreSQL, intake, intelligence) | **92 of 95** test files pass; the 3 known exceptions, section 2 |
| Type check | clean |
| Lint | 7 errors and 26 warnings: the baseline. The 7 errors are in 6 files last changed between 24 September and 26 October |
| Production build | passes; its one warning ("package seems invalid") also appeared in earlier builds |
| Production cache test | 31 / 31, against the built app on the local test database, with Gemini and Telegram off |

### 1.3 C4.1: real-notice browser acceptance (3 November)

The vision (`docs/smart-recruitment-vision.md` §9) accepts Stage C on "Browser review of IBPS and BTSC drafts".

**How it was run:**
- the built app at `c48683b`, on the local test database, with Gemini off;
- driven by a headless browser.

**How the drafts were made.** B2.6 round 2's saved readings were used (`docs/acceptance-runs/round2-2026-10-31/gemini/`). Their limits are in section 4.1.

| Draft | Result |
|---|---|
| **IBPS CRP RRBs-XV** | **Pass.** The vacancy table is the same as round 2's: 280 of 280 rows, every cell, page and printed line. **Vacancy section:** "at least 13,706", Calculated, Incomplete; Tripura Gramin Bank "not reported in the notice" for each post; every row with its page and "As printed (page 46): …". **The total:** the whole-table route (incomplete, calculated). Its only action is "Not stated in full", marked "needs the whole-table check", with the full reason. **"Check the whole table"** is offered and opens in its simple single-PDF form (pages 46–55). **Publishing:** refused, 422 `IMPORT_CHECKS_PENDING` with all 10 key details; the job stays a draft |
| **BTSC FSO** (a research article) | **Pass.** "This job was filled from research only"; each value "From research only". No Verify, Not applicable, Not stated or "Check the whole table" anywhere; the reason is shown. **Publishing:** refused, 422 `MISSING_OFFICIAL_EVIDENCE` ("add at least one link marked Official"); the job stays a draft |

**AI requests:** none reached Google. The app's own counter shows 0 today and 0 in the last 7 days.

### 1.4 Browser acceptance in earlier steps

| Step | What was checked in the browser |
|---|---|
| C3 Steps 1–2 (1 Nov) | Reported in the session, with screenshots, including Step 2's before-and-after. Not saved as files |
| C3 Step 3 (1 Nov), B1–B6 | single PDF; a different file refused and the genuine one accepted; a web page as a whole document; a printed total on a web page; mixed sources with bulk assignment; a stale table (409) resetting the panel |
| C3 Step 4 (2 Nov) | **A fresh Smart intake job end to end:** refused with 10 blockers, then with 1, and published only after the whole-table check. **A printed-total job:** published without a table check, as C-D2 allows. **Read-only jobs:** no actions |
| D1/D2 fix (2 Nov) | an empty, zero or uncompared cited page keeps Record off; page 2 records; no "open for editing" text while the panel is open |

## 2. Known baselines, kept apart from new results

**No Stage C commit touches their code.** Unchanged since before Stage C:

| Test | Now | Why |
|---|---|---|
| `tests/intelligence/review-queue-e2e.test.ts` (**E8**) | **FAILS**, 12 of 13 | "one diff applied": 0 against 1. The old file-based review queue finds no job in its legacy dataset, empty since `bf6b84f`. Left untouched by decision C-D4 and recorded as not verified (see `docs/smart-intake-roadmap.md`, Stage C entry checklist, item 2) |
| `tests/cms/sitemap-ticker.test.ts` | **FAILS**, 6 of 8 (TK02, TK03) | Stale: it imports `IMPORTANT_UPDATES`, removed from the site's code on 4 October (`5d5d9a9`) |
| `tests/cms/phase-d-integration.test.ts` | **NOT RUN** | It needs a live `DATABASE_URL` and stops without one. It is never pointed at a real database |
| Lint | 7 errors, 26 warnings | The same files as before Stage C |

## 3. Final safeguards (the final code, `c48683b`)

**What Stage C adds,** for imported jobs (jobs never imported are not gated, as before):
- **One whole-table check (C-D1):**
  - a person's single decision, "checked against the notice";
  - it names every document compared, and the pages compared in each PDF;
  - it is bound to the table's exact revision, so any later save leaves it behind;
  - it is refused when stale (409), and can be withdrawn.
- **The total's route (C-D2, with the owner's printed-line safeguard):**
  - **A printed total read by code from text** is verified only by its own printed line, figure and page. A web page's or text's printed total is verified by its line, with no page, from the same document.
  - **A calculated, entered or incomplete total, or any AI-read or prepared row,** needs the whole-table check.
  - A quote of anything else is refused.
- **Incomplete totals (C-D3):**
  - never VERIFIED;
  - "not stated in full" answers only the missing figures and never clears another blocker;
  - the public page says "At least N".
- **Documents (C2.1):**
  - a PDF row needs its page; a web page or text has none;
  - each document's standing is judged by the server: eligible only when CONFIRMED or ATTESTED, trusted for recruitment rules, and not research;
  - research and prepared rows must be compared with an eligible official document, a prepared row on the page it claims.
- **The screen (C3):**
  - the check list shows the server's reasons and offers only the actions the server allows;
  - the whole-table check panel has four steps:
    1. the original: the same file, by fingerprint, or the official address, declared;
    2. the rows, each with its document, page and line, labelled by where it came from;
    3. the marked rows, with one acknowledgment;
    4. the pages, the words cited, and the final confirmation.
  - Bulk assignment never ticks the confirmation. Everything is cleared after a change of document, of revision, or a 409.
  - **"Worth a look" marks** are advisory and never block.
  - **How the original was obtained** is validated when given, and never required.
- **The "(continued)" heading reader fix (`8269da8`):** a repeated column heading or a "contd." line on the next page no longer joins the next row's name.

**What did not change:**
- every other field decision;
- jobs never imported;
- the old intelligence review queue (C-D4);
- the database schema (no migration from Stage C).

## 4. Outstanding limitations (agreed and documented)

### 4.1 C4.1's replay method (accepted by the owner, 3 November)

- **Round 2's raw AI replies were never saved.** Its saved files hold the proposals the reading produced. So the AI reading itself was not replayed.
- **A stored preview cannot be changed.** The database refuses it, and that safeguard was kept. The drafts were made by the real import and apply instead:
  - **IBPS:**
    - the same PDF and attestation, with no AI;
    - its tables were read by code in round 2 too, so they are identical;
    - **the fields round 2 had only from the AI are absent:** age, eligibility, fees, the fee deadline, selection, how to apply, the schedule, conditions.
  - **BTSC:**
    - the same article, pasted as research;
    - a stand-in answered the one AI reading only with round 2's saved values and quotes, with the article's own category lines;
    - its table is identical;
    - age, eligibility, selection, the schedule, syllabus, how to apply and conditions are absent.
- **BTSC's publishing was refused by the official-link rule** (`MISSING_OFFICIAL_EVIDENCE`), which comes before the imported-job gate. That shows publishing is blocked. **It is not an independent end-to-end test of every condition of the imported-job gate** for that draft.
- **Not done on the real IBPS draft:**
  - field verification;
  - recording "not stated in full" or the whole-table check on its 280 rows;
  - publishing it.

  The same rules are covered on test tables by `tests/local-stack/table-total-gate.test.ts`.
- **The duplicate safeguard.** The test database's own seed has an IBPS clerk job for 2026. So the IBPS draft was saved as a separate job, with a recorded reason, as an admin would.

### 4.2 Evidence gaps (accepted with C3, 3 November)

**Covered by tests, but with no saved browser proof:**
- a mislabelled row marked "worth a look", with Record held until acknowledged;
- the LIC scan rows;
- the BPSC prepared table, checked and withdrawn;
- the IBPS incomplete total published as "At least".

**Not tested:**
- a double click on Record (the button is disabled while a request is in flight; a second request would be stale);
- that the typed words are kept after a refused citation.

**Steps 1–2's browser checks** were reported in the session only.

**The screenshots** of Steps 3–4, the D1/D2 fix and C4.1 are not in Git. They are in the session's scratch folder, which is temporary.

### 4.3 Open findings (none blocks Stage C's safeguards; each needs its own authorisation)

| | Finding | Kind | Recommended timing |
|---|---|---|---|
| **O2** | The code table reader **misses a vacancy table** with fewer than 3 rows, or **after a fee line such as "Rs.850/-" anywhere earlier in the document**. The import then has no table, and a person must enter it. Fail-safe (nothing wrong is verified) but costly. Evidence: `docs/acceptance-runs/stage-c-final-2026-11-03/o2-table-reader-diagnostic.log` | Stage B reader | **Priority: a separately authorised Stage B fix after Stage C, before any unattended discovery or URL-intake expansion** |
| **O3** | Ticking "The official site blocks the server, so I downloaded…" **without the note** (10+ characters) quietly saves the upload as UNCONFIRMED. Nothing on that job can then be checked | intake form | after O2, before discovery |
| **O4** | The editor's vacancy section labels a total from a **research article "Printed in the notice"** (seen on BTSC). The check list says "From research only" | wording (`VacancyTableEditor.tsx`) | before discovery |
| **O5** | The check list's badge for Total vacancies says **"No official source"** on IBPS, whose table comes from an attested official PDF. The reason underneath is right (incomplete, not checked) | wording (badge for UNSUPPORTED) | before discovery |
| **O1** | After a printed-line verification, the table line still reads as if something is left to do. A similar "when the job is open for editing" line shows on a research-only job that is already open | wording | UI polish / redesign |
| **Record button** | No dimmed look when disabled. "Still needed" just above it says what is missing | UI polish | redesign |

### 4.4 Kept apart by the plan (unchanged)

- **The import preview** classifies without the table's context (`service.ts`, the preview step). A separate small fix.
- **Any save of the table leaves its check behind,** even an identical save. This is the design rule for every field, and is stricter than "any relevant change".
- **A property of C-D2, as approved:** a printed total read by code from text can be VERIFIED by its printed line without a person checking every row.

## 5. Commits in Stage C (local, `feature/importer`)

| Commit | What | Owner's decision |
|---|---|---|
| `3cb43db` | C0: baseline of the publish gate for vacancy tables (test only) | reported, 1 Nov; C1 authorised |
| `50dc0be`, `094ed49` | C1: one check for the whole vacancy table (with a note's reference fixed) | accepted, 1 Nov |
| `adf3655` | C2: the publish gate for a total worked out from the table | accepted, 1 Nov |
| `8269da8` | The "(continued)" heading reader fix | accepted, 1 Nov |
| `764b167` | C3 Step 1: read-only `tableTotal`, rows worth a look, the local file fingerprint | accepted, 1 Nov |
| `4294791` | C3 Step 2: the check list's reasons and route-aware actions | accepted, 1 Nov |
| `8d6d8ba` | C2.1: pages follow each row's document; every document named in a table check | accepted, 1 Nov |
| `31e34bc` | C3 Step 3: the whole-table check panel | accepted, 2 Nov |
| *(no commit)* | C3 Step 4: browser acceptance | passed, 2 Nov |
| `c48683b` | D1/D2: the panel asks for the cited page of a PDF; no "open for editing" text while checking | accepted, 2 Nov |
| *(no commit)* | C3 Step 5: final audit | **C3 accepted, 3 Nov** |
| *(no commit)* | C4.1: IBPS and BTSC real-notice browser review | **accepted, 3 Nov** |
| this commit | C4.2: this report and the documentation updates | for the owner's review |

**The documents:**
- `docs/importer-stage-c-plan.md`: the plan, each step and the decisions;
- `docs/known-defects/continued-heading.md`: the defect and its accepted fix;
- `docs/smart-intake-roadmap.md`: the stage's status;
- `docs/acceptance-runs/stage-c-c0-2026-11-01/`: C0's baseline;
- `docs/acceptance-runs/stage-c-final-2026-11-03/`: the compact final evidence.

## 6. For the owner's decision

1. **Accept Stage C**, under the criteria in the plan and the limitations in section 4, or ask for more.
2. **After that, the order recommended** (each step separately authorised):
   1. O2;
   2. O3;
   3. O4 and O5;
   4. reliable URL and pasted-text intake;
   5. the New Jobs Found and Updates Needed inboxes.

   The redesign concepts (no code) may start once Stage C is complete, as the roadmap says.

No push, merge, migration or deployment without your explicit approval.
