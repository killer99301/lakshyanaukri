# Phase 2 report — Smart intake (local), 25 Oct 2026

**Status: done locally, waiting for your review.** Nothing is deployed, no production
database was touched, and no migration has run. Everything is on branch `feature/importer`
in `D:\LakshyaNaukri-importer`: 29 commits on top of production's 715e4e4, with 70 files
changed (49 new, 21 edited). Main (`D:\LakshyaNaukri`, bc6ab6e) is untouched.

## What it does now

**Smart intake** (Jobs list → "Smart intake", or "Smart intake: fill this job…" on any job)
is an additional way to fill the existing editor:

1. **Provide information.** Paste an article or ChatGPT answer; upload a notice PDF (scans
   too), a photo or a screenshot; or give an address the server fetches. Up to four sources.
2. **Review.** A summary gives the title, organisation, vacancies, sections found and what
   the sources are. A single "Before saving" list covers research-only sources, a missing
   official notification or apply link, a last date that has passed, and conflicts. The
   values are then grouped by the editor's own sections. Quotes, pages and sources sit under
   "View evidence".
3. **Save as draft.** Everything ticked is saved as Pending in one step, or nothing is. A
   tick means "save as Pending", never "verify"; the screen says so.

Behind it:
- **Whole-text reading.** It fills what AI Assist's topic readers leave out: vacancy
  breakdown by category, exam stages, category-wise age limits, exam pattern, syllabus,
  selection with descriptions, how to apply, and the notice's rules as admin-only notes
  (never published). Every value must quote the source word for word, and every value goes
  through the editor's own rules before it is offered.
- **Links.** Addresses written without `https://` (`btsc.bihar.gov.in`) are found. "Apply
  Online:" before an address makes it the apply link. Portals are never official.
- **Verification display (your decision).**
  - In the editor, each imported field shows its check state beside its usual status:
    "Verified against official notification", "Not stated — reviewed", "Research — pending",
    and so on.
  - This is worked out from the checks for that field's exact current value. The field's own
    CMS status is not changed.
  - A published imported job that passed the gate shows **"Key details checked against
    official notification"** on its public page. Other jobs are unchanged.
  - "Check before publishing" is now one line with progress. A research-only job is told to
    add the official notice first.
- **BTSC portal (your decision).** `btsc.pariksha.nic.in` is a BTSC partner for the Apply
  Online link only. It is never trusted for the notice, eligibility, age, vacancies or fees,
  and no other pariksha.nic.in site is covered.
- **Job discovery, on demand.** Give one listing page. If its robots.txt allows, that page is
  read once. Its links are sorted into New and Update and matched against jobs already in the
  CMS; each opens in Smart intake as research. Nothing is saved, no AI is used, no link is
  followed.
- **Existing jobs.** Smart intake into a job previews a corrigendum or newer source against it.
  Replacing a checked value needs a second confirmation and then a new check.
- **Kept and not kept.** Kept: each source's text, SHA-256 fingerprint, size, pages and
  address. Not kept: the original file. The screen says this.

**Unchanged and still independent:** AI Assist (URL, PDF, scan, pasted text), the
prepared-file parser and syllabus library, manual "New job", the editor, Check for updates,
publish, revert and take-down. With the importer switched off, its screens and links
disappear, and the rest works as before. This was tested in the browser.

## Test results (local)

| Suite | Result | Phase 0 baseline |
|---|---|---|
| Type check | clean | clean |
| Lint | 7 errors, 26 warnings (all pre-existing) | 7 errors, 26 warnings |
| CMS unit suites (`cms:test`) | 36 / 36 suites pass | 31 / 31 (5 importer suites added) |
| 11 original local-stack suites | 262 / 262 | 262 / 262 |
| Importer: schema and triggers | 84 / 84 | new |
| Importer: end-to-end flow | 56 / 56 | new |
| Importer: six real notices | 59 / 59 | new |
| Manual create under the lock | 9 / 9 | new |
| Intake extractor | 332 / 332 | 329 (3 regression cases added) |
| Intelligence suite | 12 / 13: the known failure "Approving vacancy change…" | same failure |
| Production build | passes | passes |
| Production-cache test | 31 / 31 (fresh database, then build, then start) | 31 / 31 |

**PostgreSQL:**
- The local test database is PostgreSQL 18.3, so the schema, flow and six-notice suites run
  on 18.
- The concurrency test (two sessions at once: locks, duplicates, stale saves, replays) passes
  21 / 21 on **PostgreSQL 18.6** (the version Neon runs) and 21 / 21 on 17.11.
- 18.6 came from EDB's portable zip in the session scratch folder: no installer, no service,
  and the throwaway cluster was removed.

## Real recruitments

- **Six notices end to end:**
  - LIC HFL Apprentice: the real batch-10 PDF layout.
  - SSC CGL, then its corrigendum.
  - UPSC CSE: the site blocked, then an upload, then your attestation.
  - BPSC 72nd CCE: an official HTML page.
  - A walk-in interview from an unlisted body (AIIMS Patna).
- **BTSC FSO article** (copied from Adda247): 15 values across all 13 sections. The last date
  of 24 Oct is flagged as passed, the missing official links are warned, it saved as a draft,
  and it opened in the editor with "Research — pending" badges.
- **Screenshot** of the article's dates table, brought into the BTSC draft. It matched the
  dates and was added as evidence.
- **Discovery on the live Adda247 Bihar page:** 46 announcements found. The BTSC FSO article
  was matched to the draft.
- **AI Assist** filled the empty SC/ST fee on the imported draft. **Prepared-file parser**
  saved a pattern and syllabus and updated the library entry.

**Bugs found on real notices and fixed.** The first five are in shared code that live AI
Assist also uses:
- "Advertisement **No**tification" was read as the number "tification".
- SSC's "last date … for making online fee payment" was taken as the last date to apply. AI
  Assist then dropped the right date as a conflict.
- UPSC's "Examination Notice No." was not accepted as a number's label.
- "No application fee is charged" was not accepted as a fee of 0.
- Dashed table dates ("Last Date to Apply Online - 24-10-2026") were not read as the last date.
- Importer-only:
  - wrong link types (the NATS manual offered as the notification)
  - a false "tracking removed" flag
  - a research-only critical date ticked by default
  - a document heading replacing your typed title
  - an article's posting date accepted as an exam date
  - impossible dates (30 Feb) accepted
  - a value the editor would refuse that only failed at save time
  - a false duplicate match (Touring Veterinary Officer matched to Food Safety Officer)

## Screenshots

In `docs/importer-phase2-screens/` (not committed):
- 01–10: the first LIC journey
- 11: the old preview, before simplification
- 20–24: BTSC article, from input to saved draft
- 25: the editor's check panel
- 26–27: image upload
- 28–29: discovery
- 30–31: the prepared-file parser
- `source-btsc-dates-screenshot.png`: the image that was read

## Known limits (honest list)

1. **The real AI reading is untested.** Every AI answer came from a local stand-in, including
   answers I wrote that quote the article. The screens, checks and saving are proven; the real
   model's reading quality is not. Before switching it on, run the BTSC article, a PDF and a
   screenshot with a dedicated Gemini test key in this worktree's `.env.local`.
2. **Unlisted organisations.** Trusted hosts live in code. Fields of an organisation that is
   not listed can be imported but not checked, so such a job cannot pass the gate until its
   host is added (as was done for BTSC).
3. **Not built yet:** AI Research, recurring discovery, automatic existing-job checks. See
   `docs/smart-recruitment-assistant.md` for the plan.
4. **Category split display.** It is shown in the editor's vacancy table, but not yet on the
   public page's table.
5. **Old publish checklist.** The existing checklist below "Check before publishing" is still
   dense. It now agrees with the gate, but I have not redesigned it.
6. **Approve & Publish order.** On an unchecked imported job, the button approves first and
   then the gate refuses publishing. The job stays Approved, not live.
7. **Carried over from Phase 1:**
   - Creating a job from an intelligence draft does not use the new duplicate lock.
   - DNS rebinding remains a small residual risk for addresses the server fetches.
   - Original files are not kept, by design.

## Exact deployment requirements (when you say "deploy")

1. Take a **Neon recovery point**.
2. Run the migration on Neon: `npx tsx scripts/cms-add-importer-tables.ts`, then
   `npx tsx scripts/cms-add-importer-tables.ts --check`. It adds five tables and their
   functions; nothing existing changes. The publish route reads the new tables, so this must
   happen **before** the code is live.
3. Merge `feature/importer` into main. Main also carries the undeployed SEO fix bc6ab6e, so
   it would go live in the same deploy.
4. **Settings:**
   - No new environment variables.
   - The importer switch lives in Redis and is **off** until you turn it on.
   - Smart intake uses the existing Gemini key and daily cap, counted as "Smart intake".
5. Deploy, then check the live site: an existing job publishes as before, and Smart intake
   shows "Importer off".
6. Turn the switch on only after the real-AI acceptance run (limit 1 above).
