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
