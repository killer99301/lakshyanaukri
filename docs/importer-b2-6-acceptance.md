# Smart intake — B2.6 final acceptance report

Updated 2026-10-29, 11:30 IST. Part 3 (the decisions and fixes of 29 October) is at the end: read it first. The final real-Gemini runs follow after the daily quota resets (12:30 IST).

**Status: NOT ACCEPTED YET.**
- **Supplied sources:** IBPS, LIC and BTSC have been run twice with the real
  model, through the browser, and saved and reopened. Two strict checks
  failed in one run each on scanned pages; both are reported below, not
  loosened.
- **Outstanding:** the SSC CGL notification, its corrigendum, UPSC CSE and
  BPSC 72nd CCE have not been supplied. B2 is not complete until they pass.

Branch: `feature/importer` in `D:\LakshyaNaukri-importer`, local only.
Nothing pushed, merged, migrated or deployed; no production data touched.
Model: `gemini-3.5-flash-lite`, unchanged. Stage C not started.

---

## 1. Source documents

| Source | Kind | Status | What it covers |
|---|---|---|---|
| IBPS CRP RRBs-XV (76 pages) | official PDF, text | **tested**: 2 real runs; browser reading job; saved and reopened | 280-row annexure table; 4 posts' ages with birth-date windows; 7 pattern papers; 9 schedule entries; batches |
| IBPS + 3 blank scanned pages (79 pages) | made-up test PDF | **tested** (local suite, 53/53) | reading jobs, scans, quota pause, headless-table re-read |
| LIC HFL Apprentices Batch 10 (10 pages) | official PDF, text + scanned page 10 | **tested**: 2 real runs; saved and reopened (stand-in AI) | Table E 181 / 232, age 20–25, online-test pattern, fees, dates |
| LIC HFL, pages 5–9 as images | scan PDF made from the official one | **tested**: 2 real runs (run 1 failed, see 3.1) | Table E read from images |
| LIC HFL, 6 scanned pages of 10 | mixed PDF | **tested**: 2 real runs; browser reading job; saved and reopened | AI-read rows marked; pages kept for review |
| LIC HFL, text then scan / scan then text | mixed PDFs | **tested**: 2 real runs each (one name corrected by the model, see 3.2) | one table across text and scanned pages |
| Telangana junior assistants, page 23 | scanned page | **tested**: 2 real runs (run 1 misread cells, see 3.3) | post-wise G/W category tables |
| BTSC FSO (Adda247 article + screenshot) | research text and image | **tested**: 2 real runs | printed category maximums, pattern table, 105-post split, research-only warning |
| **SSC CGL 2026 notification** | official PDF | **outstanding: to be supplied** | |
| **SSC CGL corrigendum** | official PDF | **outstanding: to be supplied** | corrigendum against an existing record |
| **UPSC CSE 2026 notification** | official PDF | **outstanding: to be supplied** | |
| **BPSC 72nd CCE notification** | official PDF | **outstanding: to be supplied** | |

Nothing was taken from `D:\My info`. Its files look like personal admit
cards and application forms.

---

## 2. Real-Gemini acceptance, two runs (2026-10-28, evening)

| Suite | Run 1 | Run 2 |
|---|---|---|
| `importer-gemini.acceptance.ts` (BTSC article and screenshot, LIC PDF and scan, IBPS) | **56/56** | **55/55** (one check is conditional and did not run, see 3.4) |
| `importer-scans.acceptance.ts` (LIC scan, text→scan, scan→text, mixed, Telangana) | 21/23 | 27/28 |

- **Requests:** about 30 per run of the first suite (IBPS 13–14) and about
  45 per run of the second. Today, including the browser runs, about 175
  requests were used of the key's 500.
- **IBPS across both runs:**
  - all 10 page batches read;
  - 7 of 7 pattern papers with every figure as printed;
  - all 9 schedule entries classed as in the notice;
  - 280 vacancy rows;
  - 4 posts' ages from page 7;
  - fees ₹850 / ₹175, dates 1–21 Sep 2026.
- **LIC across both runs:**
  - dates 20 Oct, 1 Nov, exam 7 Nov, interview 15 Nov;
  - fees ₹800 / ₹200;
  - age 20–25;
  - Table E 181 cities, 232;
  - the online-test pattern.
- **BTSC across both runs:**
  - minimum age 21 as on 1 Aug 2026;
  - four printed category maximums;
  - 105 posts with the full category split;
  - the pattern table;
  - fee ₹100;
  - the research-only warning.

## 3. Failures in these runs, and what was done

### 3.1 LIC scan only (run 1): the whole table was lost

- **What happened:** the model wrote Table E's first scanned page out with
  its rows but no column headings, so no table could be built. The reading
  was *not* called complete, and the preview warned that 182 lines could not
  be read.
- **Fixed in `5855673`:** such a page is read once more. A second headless
  answer is kept as it is, its rows reported as not read, and "complete"
  withheld.
- **Result:** run 2 read 181/181.
- **Tests:** a reading-job test pins both paths (re-read used; twice
  headless reported).

### 3.2 LIC scan → text (run 2): a printed misspelling was corrected

- **What happened:** the notice prints "Thiruvananthpuram". The model,
  reading scanned page 7, wrote "Thiruvananthapuram", with the right figure
  and page. All 181 rows and the total of 232 were intact.
- **Why it still fails:** the strict check requires names exactly as
  printed, and it is kept.
- **Known limitation:** the model can silently correct printed text on
  scanned pages. Every AI-read row stays Pending and marked "Read from image
  by AI — human verification required", next to the page image.

### 3.3 Telangana page 23 (run 1): five cells of post 15 misread

- **What happened:** the subtotal checks caught it. The review said the G
  and W columns do not add up to the printed totals.
- **Result:** run 2 read every cell as printed.
- **Known limitation:** this is the same scan-accuracy limit as in B2.4.

### 3.4 LIC scan written out as text (run 2): no exam stages proposed

- **What happened:** the check "every schedule entry has a class" only runs
  when stages are proposed, and in this run none were. It ran and passed in
  run 1.
- **Known limitation:** model variance on scans; the stages are left for the
  admin to add.

### 3.5 Found in the field-by-field check: half a birth-date window

- **What happened:** in run 2, IBPS Officer Scale-II and III were read with
  only their earliest date of birth. The public age checker then treated
  half a window as the whole and ignored the printed minimum age. A
  candidate who is too young would have been told "within the limit".
- **Fixed in `5855673`:**
  - with one end of the window missing, the printed age on that side
    applies;
  - without the reference date, there is no answer;
  - the review flags "only one date of birth was read for … — check the
    notice".
- **Tests:** PA13 failed before the fix and passes after; PA14 covers the
  flag.

### 3.6 Found in the browser: ages invisible in the review

- **What happened:** an age read post by post, with no overall range,
  showed no value in the import review, only its flags.
- **Fixed in `d9cebcc`:** the review lists the reference date, then each
  post with its range, birth-date window, own date, relaxations and printed
  maximums.
- **Test:** PA15.

### 3.7 Earlier today: quota and incomplete answers

These are described in section 6.
- **Daily quota:** a refusal for the provider's daily quota is no longer
  resent, and is reported as such (`3b38da7`).
- **Answer room:** a short notice read in one request gets the same answer
  room as a batch, and an answer stopped at its length limit counts as
  incomplete (`f031f23`).

---

## 4. Field-by-field check against the notices (run 2)

| Field | IBPS | LIC | BTSC |
|---|---|---|---|
| Notification number | CRP RRBs XV ✓ | — (none printed) | 29/2026 ✓ |
| Dates | open 1 Sep, close 21 Sep, fee 21 Sep ✓; flagged as passed | open 20 Oct, close 1 Nov, exam 7 Nov, interview 15 Nov ✓ | open 25 Sep, close 24 Oct ✓ |
| Fees | ₹850 / ₹175 ✓ | ₹800 / ₹200 ✓ | ₹100 ✓ |
| Vacancy table | 280 rows, 10 posts, at least 13,706; Tripura Gramin Bank NR rows kept as not reported ✓ | 181 rows, 232 printed ✓ | 1 row, 105 with the full split ✓ |
| Ages | 4 posts with ranges and windows, page 7 ✓; Scale-II/III latest birth date missing in run 2 (now flagged, 3.5); specialist posts named without their scale flagged "no age read" | 20–25 ✓ (the reference date is not read) | min 21 as on 1 Aug; four printed maximums ✓ |
| Exam pattern | 7 / 7 by code ✓ | 1 / 1 by code ✓ | 1 / 1 by code ✓ |
| Schedule | 9 entries, 3 selection, 6 announcements ✓ | exam and DV/interview with dates ✓ | CBT "To be announced" ✓ |
| Selection process (details reader) | Prelim, Main, Single — **leaves out the officers' interview** (variance) | ✓ | CBT, DV ✓ |
| Eligibility | per post, specialist posts by their own names ✓ | ✓ | ✓ |
| Evidence | every item quoted with its page; table rows with printed line and page | ✓ | article without pages (pasted text) |

---

## 5. Browser workflows (local test copy)

- **Real model, IBPS PDF (76 pages):**
  - uploaded through the form; it went to a reading job (estimate 13
    requests, 12 used);
  - **reloaded at 4 of 13 parts:** it carried on to 13 of 13, with nothing
    repeated;
  - the review showed everything in section 4.
  - **Saved as draft and reopened:** DRAFT, never published, NOT_VERIFIED.
    Age, stages, pattern and table are all PENDING; ages keep 5 evidence
    entries per post.
  - **Public preview of the draft:**
    - the dates list shows "Selection stages" (two exams and the interview)
      and "Other announcements";
    - the age box says "Differs by post", with each post's window;
    - the public age checker, for Scale-II: born 2006, "below the minimum
      age"; born 1999, "within".
- **Real model, LIC with 6 scanned pages:**
  - all 6 pages were read from their images: 181 rows, 232 as printed;
  - all rows marked "Read from image by AI — human verification required"
    with pages 6–9;
  - saved and reopened: the table is PENDING, and all 181 rows keep the
    AI-read mark.
- **Stand-in AI, LIC pages 1–9 pasted:** saved and reopened; the editor
  shows "Needed to publish: a link marked official" and "10 imported key
  details to check".

Incomplete or unverified information stays visible throughout:
- an unread table line withholds "complete";
- a missing paper is named and its item left unticked;
- missing post ages and half birth-date windows are flagged;
- AI-read figures are marked;
- nothing is saved except as Pending, nothing is published, and nothing is
  verified.

---

## 6. The quota and the incomplete answers (investigated earlier today)

### The "rate limit" failure on IBPS pages 65–72

- **How:** a probe recorded every request's time, status and the quota
  Gemini names in its 429 reply (`quotaId`, `quotaValue`, `retryDelay`; the
  key and the message text are never shown).
- **The cause:** the key is on Gemini's **free tier**, which allows **500
  requests a day for this model**
  (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). The quota resets
  at midnight Pacific time, 12:30 IST. The runs of 27–28 October had used
  it up.
- **What the code did wrong:**
  - it resent a daily refusal twice, and then the batch tried once more;
  - so an IBPS reading sent 69 requests, 46 of them resends that could not
    succeed;
  - and it told the admin "wait a minute".
- **Fixed in `3b38da7`:**
  - a per-day 429 is not resent;
  - the reason reads "The AI provider's daily request quota is used up (500
    requests a day on this key); it resets in about N hours";
  - a reading job pauses on it without failing a task or using a try, and
    resumes complete;
  - a per-minute 429 waits the delay Gemini asks for (at most 30 s).
- **Tonight:** in four full runs, two refusals were resent and succeeded,
  and no request failed for quota.

### "AI response was incomplete" on LIC

- **The cause:** a short notice read in one request had half the answer room
  of a batch (8,192 tokens against 16,384), and with longer answers LIC's
  answer could run out.
- **Fixed in `f031f23`:**
  - both now get 16,384;
  - an answer stopped at its length limit (`finishReason: MAX_TOKENS`) is
    refused as incomplete, even if the part received parses;
  - a short notice is then read again in halves (since `96038aa`).
- **Tonight:** LIC was read whole and complete in all four runs. The shared
  AI Assist and the scan reader also refuse a cut-off answer now.

---

## 7. Known limitations and remaining risks

1. **Untested formats.** SSC CGL, its corrigendum, UPSC CSE and BPSC 72nd
   have not been run. This is the largest open risk: their tables, age rules
   (attempts, categories) and the corrigendum path against an existing
   record are untested on real documents.
2. **Free-tier quota.** 500 requests a day is the hard ceiling for daily use
   and for acceptance runs. One 76-page notice takes about 13 requests; the
   site's own allowance defaults to 150 a day.
3. **Scan accuracy.** The model can misread cells (caught only where a
   printed subtotal or total disagrees), correct printed spellings, or drop
   column headings (now re-read once). Every AI-read figure stays Pending
   and marked, beside the page image.
4. **Model variance in AI-read fields.**
   - **Selection process:** IBPS's lost the officers' interview in one run.
   - **Schedule entries:** a scanned LIC gave none in one run.
   - **Ages:** a birth date was dropped in one run (now flagged).
   - **Post names:** posts named without their scale are flagged, not
     matched.

   Code-read parts did not vary across the runs: vacancy tables, the exam
   pattern and stage classes.
5. **Links are copied as printed.** LIC prints its NATS address as
   `nats.education.gov.in.in`, a dead address, and Smart intake offers it as
   an official website. Nothing checks that a link opens.
6. **Small display points:**
   - the review shows the positive note "all N papers read" with the same ⚠
     mark as warnings;
   - the exam-schedule box says "Exam date not declared" when the notice
     gives only months; the months show in the dates list.

---

## 8. What is needed to accept B2

1. **The four PDFs.** Each is run through the same acceptance (both suites'
   checks, the field-by-field table, the browser save and reopen). Any
   failure is investigated and fixed, or reported, as here.
2. **A clean run of the scan suite**, or your decision that 3.2 (a model
   correcting a printed spelling, flagged for human checking) is an
   acceptable known limitation. The check itself stays strict either way.


---
---

# Part 2 — SSC CGL, UPSC CSE and BPSC 72nd (2026-10-28 night)

**Status: B2 NOT ACCEPTED.**
- **Passes:** SSC CGL and its reopening notice, as an update to an existing
  job, in the script and in the browser. UPSC is read with its pattern
  correctly flagged incomplete.
- **Fails — the BPSC corrigendum:** Smart intake cannot yet remove a deleted
  post's vacancies. A design for that is below, for your decision.
- **Fails — BPSC's Hindi vacancy table:** not read by code. Correctly
  reported as unread.

## P2.1 Source documents (copies in the scratchpad; the originals in `D:\b2-sources` untouched)

| File | Pages | Size | Opens | Text layer | Tested |
|---|---|---|---|---|---|
| SSC_cgl_2026.pdf (CGL 2026 notification) | 132 | 4.05 MB | yes | yes; pages 65–70, 76–80 scanned (11); Hindi parts garbled in the text layer | 2 real runs; browser |
| CGLE_Reopen_23062026.pdf (reopening notice) | 1 | 0.57 MB | yes | yes | 2 real runs as an update; browser as an update |
| UPSC-CSP-2026-Engl-060226Rev.pdf (CSE 2026) | 159 | 2.76 MB | yes | yes (page 156 blank) | 2 real runs |
| Advertisement-Integrated-72th-CCE…pdf (BPSC 72nd) | 16 | 1.05 MB | yes, with stream-length faults (poppler recovers; pdf-lib splits it) | **none**: all pages are images, in Hindi | 2 real runs (plus one stopped run) |
| Corrigendum…Sugarcane-Officer-deleted…pdf | 1 | 0.03 MB | yes | **none**: one Hindi image | 2 real runs as an update |

**Requests:**

| Run | Requests |
|---|---|
| SSC notification | 34 |
| SSC reopening notice | 3 |
| UPSC | 24–25 |
| BPSC notification | 19–21 |
| BPSC corrigendum | 2–3 |
| **A full pass** | **about 85** |
| The browser SSC run, with its update | 36 |
| Probes | 3 |

In total about 400 of the day's 500 were used (the quota resets at 12:30
IST). No request failed for quota.

## P2.2 Results against the notices

### SSC CGL 2026

- **Correct:**
  - dates 21.05–22.06.2026, fee by 23.06;
  - fee ₹100, with women, SC, ST, PwBD and ESM exempt (₹0);
  - about 12,256 tentative vacancies;
  - Tier-I August–September and Tier-II December 2026, both as selection
    stages.
- **Pattern** (after the fix): Tier-I read by code (4 subjects, 25 questions
  and 50 marks each). Tier-II's three-level table is counted and named as
  not read (page 25). The item is flagged "incomplete: 1 of 2", left
  unticked, and the job is not complete.
- **Ages:** not read post by post. SSC prints age groups mapped to posts in
  an annexure. "PwBD (SC/ST): 15" was offered as an upper age in run 1; it
  is now refused (it's relaxation years).
- **Selection process:** six conflicting readings (one per post group), all
  unticked.
- **Scanned page 79:** almost nothing found, twice; flagged, so the job is
  not complete.

### SSC reopening notice, as an update to the SSC job

- **Run 1:** the new last date and fee deadline were offered but left
  unticked, so saving changed nothing. The notice's file number was saved as
  the notification number.
- **Fixed (`263f28e`):**
  - an official corrigendum's replacement of a single unverified value (a
    date, a fee, the total) starts ticked;
  - lists and verified values still wait for the admin;
  - a corrigendum's own file number is not used as the notification number.
- **Run 2 and the browser:**
  - last date 22.06 → **25.06**, fee 23.06 → **26.06**, correction window
    end 01.07 → **03.07**, each shown as "Replaces …" and superseding the
    old claim;
  - the 10 other fields are unchanged;
  - the job stays a DRAFT and NOT_VERIFIED, with everything Pending. ✓

### UPSC CSE 2026

- **Correct:**
  - dates 04.02–24.02.2026;
  - fee ₹100 with exemptions;
  - 933 vacancies;
  - age 21–32;
  - selection Preliminary → Main → interview.
- **Pattern:** the AI gave only the two Preliminary papers. Code now counts
  the papers the notice states: Preliminary 2 (stated twice, counted once)
  and Main 9, so 11. The pattern is flagged "incomplete: 2 of 11" and the job
  is not complete.
- **Not right:**
  - the notification number picked was an internal file number (F.No.
    1/2/2025-E.I(B)) instead of 05/2026-CSE;
  - the age reference date ("1st of August, 2026") and the relaxations were
    not read.

### BPSC 72nd CCE (Hindi, scanned)

- **Read from the images:** dates 07.05–31.05.2026, fee ₹100, minimum age
  20/21, the printed upper ages by category, Hindi conditions and how to
  apply.
- **Vacancy table not built.** Table I has 22 posts × two rows (all and
  women) with Hindi category headings, and Table II has 3 posts. 20–60 table
  lines are reported as unread, and the job is not complete.
- **The AI's post list and total disagree:** 18 posts making 1205, or 1004
  in run 2; the total offered is 1077 (Table I only), while the notice's is
  1230. Both are now flagged "the posts add up to X, the total says Y" and
  left unticked.
- **Ages:** the overall maximum was read as 42, the SC/ST figure. It is now
  refused, because it is above the lowest printed upper age (37).
- **Public age checker:** it did not know the Hindi category names, and
  dropped rows printed "(Male and Female)". Fixed: a general candidate gets
  37, BC/EBC 40, SC/ST 42. The English BTSC row "(Male and Female)" is fixed
  by the same change.
- **Run 1, page 11:** the model returned an unreadable answer twice. A
  direct re-request was fine, and pressing Retry (as an admin would) worked.

### BPSC corrigendum (Sugarcane Officer, 44 posts deleted), as an update — **FAILS**

- **Correct:** the new total, **1186** (1230 − 44, as printed), is offered
  and superseded the old total.
- **What failed:**
  - the deleted post (serial 11, ईख पदाधिकारी, 44 posts; 14 for women) is
    **not removed** from the job's posts or vacancy table;
  - the model wrote the deleted post as a one-row "breakdown". Ticked, that
    would have replaced the job's whole list with the deleted post.
- **Now prevented (`3f78735`):** a corrigendum's post list is never ticked
  by default, and is flagged "lists only the posts it adds, changes or
  deletes". In run 2 nothing was saved, and the job was not damaged.

## P2.3 Proposal for your decision: removing a deleted post

1. **Reading.** The whole-text reading of a corrigendum gains
   `removedPosts: [{ post as printed, count?, quote }]`. Each needs its own
   quote, and the count, if given, must be in the quote.
2. **Matching, by code.** Each removed post is matched to the job's posts
   (post-wise breakdown and vacancy-table posts), by the same word rule as
   the age check. An unmatched name is reported, never guessed. If a count
   is stated, it must equal the job's figure for that post (44). Otherwise
   the removal is flagged and left unticked.
3. **Check against the total.** The job's total minus the removed posts must
   equal the corrigendum's stated total (1230 − 44 = 1186). If not, the item
   is flagged.
4. **Review.** One item, "Remove: Sugarcane Officer (44 posts, page 1)",
   with its quote. It shows exactly which breakdown rows and table rows go.
   **Your decision:** ticked by default or not. I'd suggest unticked, because
   it removes data.
5. **Saving.** It removes those rows through the normal field route, so the
   change history keeps them and one restore brings them back. The claims
   they came from are superseded by the corrigendum's.
6. **Tests:** the BPSC corrigendum (real), a deletion with a wrong count, an
   unknown post name, and a corrigendum that both adds and removes.

## P2.4 Fixed in B2.6 part 2 (all local, regression green: 20 stack suites, 49 CMS suites, intake 332/332, PostgreSQL 35/35; baselines unchanged)

- **`263f28e`:**
  - corrigendum replacements of single values start ticked;
  - a corrigendum's file number is not the notification number;
  - SSC's tier tables are read;
  - UPSC's stated paper counts are used;
  - Hindi categories and "(Male and Female)" rows are matched;
  - an overall maximum above the lowest printed upper age is refused;
  - a breakdown that doesn't match the total is flagged;
  - an upper age below 18 is refused.
- **`3f78735`:** a corrigendum's post list is never saved over the job's by
  default.

## P2.5 What is needed to accept B2

1. **Your decision on P2.3,** then its build and a real BPSC corrigendum run
   that removes exactly the 44 Sugarcane Officer posts and leaves everything
   else intact.
2. **BPSC's Hindi two-level vacancy table.** Either read it (Hindi category
   headings and the women's sub-rows), or accept that such a scanned table
   stays "not read" for hand entry.
3. **Your call on the earlier limitation:** the AI correcting a printed
   spelling on scanned pages.
4. **Smaller open points:**
   - UPSC's notification number and age reference date;
   - SSC's post-wise ages;
   - the review's wording "printed total disagrees: … no printed total".

---

# Part 3 — the owner's decisions and the fixes (2026-10-29)

## P3.1 Decisions

- **Difficult tables come in prepared.** BPSC's Hindi tables go through the
  paste route, not a new scan parser. The criteria are revised in
  `docs/importer-b2-plan.md` §6.
- **P2.3 approved, with safeguards.** A post a corrigendum deletes:
  - is matched exactly;
  - is offered unticked;
  - can be restored in one click;
  - refuses whenever anything is uncertain.
- **Spelling on scanned pages.** The AI's correction is a suggestion. The
  printed form stays until an admin applies it, and the original is kept.

## P3.2 Commits (local, `feature/importer`)

| Commit | What |
|---|---|
| `b9d1089` | Printed spellings kept; the AI's corrections shown as suggestions, applied only by an admin, the printed form kept |
| `8f2d65a` | Paste route: Hindi and bilingual headings, women's share as a group, PwBD parts, "Total" lines as printed totals checked column by column, "prepared outside" marking; the unfinished scan parser parked |
| `e6bf352` | Corrigendum post removal (P2.3), by code, checked against the job's table, unticked, restorable |
| `5b701b7` | UPSC: labelled notice number over a file number; "1st of August, 2026" read as a date; lettered relaxations read by code |
| `fa1358a` | SSC: ages post by post from the table of posts; merged rows said, not guessed; coded relaxations, PwBD + OBC kept apart |
| `ce9c53d` | Selection process checked against stage names and the schedule; every change shown on the item |
| `067b538` | Review wording: warnings say what they mean; ✓ notes look done; months shown, not "not declared" |
| `24f8455` | A scanned corrigendum's removal marked as read from the image; the upload hint points to the right reader |

## P3.3 Results

### BPSC 72nd vacancy tables (paste route)

- **How:** both tables written out from the page images, pasted in two parts
  (page 1, then page 2) and marked "prepared outside".
- **Counts:** 22 + 3 posts; 1,077 + 153 = 1,230. Sugarcane Officer 44, of
  which 14 are for women.
- **सारणी I** agrees with its printed Total line in every column.
- **The notice's own inconsistencies in सारणी II are reported, not
  corrected:**
  - post 02's categories add up to 30 against a printed 32;
  - the women-only post 03 prints its categories on the women's line.
- **Rows that needed reading from the page images:** the AI's own
  transcription of the scan had misread rows 4 and 17 of सारणी I.
- **Status:** the table stays "Prepared outside, to check" and is not ready
  until compared with the notice.
- **Browser:** pasted, saved and reopened on the local test copy.

### BPSC corrigendum (Sugarcane Officer, 44 posts)

- **Pasted text:** the review showed the removal unticked, with both
  sentences and the 1,230 − 44 = 1,186 check.
  - Ticked, saved and reopened: 1,186, every other post and field untouched.
  - Restored from the change history in one click: 1,230.
- **The real one-page scanned PDF, uploaded** (about 6 Gemini requests): the
  same result.
  - Gemini wrote the page out as printed; code found serial 11 of Table I,
    44 posts, the quotes on page 1, and the revised total.
  - Saved, reopened at 1,186, restored to 1,230.
- **Refusals tested:** wrong count; unknown post; a name that fits two
  posts; the wrong table; a revised total that doesn't add up; one that
  doesn't start from the job's total; a job with no table.
- **A corrigendum that adds and removes:** the new post is kept and the
  deleted one removed.
- **Found in this run:** the "Read the scan" button is the older translating
  summary reader and refused this short scan. The upload hint now points to
  Smart intake's own page-by-page reading.

### UPSC CSE 2026

- **Notification number:** `05/2026-CSE` from its labelled line, in both
  runs' readings. Run 1's file number "F.No. 1/2/2025-E.I(B)" gives way.
- **Age:** 21–32 as on 1 August 2026. The date had been dropped because
  neither date reader took "1st of August".
- **Relaxations:** read by code from the lettered list, with their clauses
  as quotes:
  - SC/ST 5, OBC 3, Defence 3, ex-servicemen 5, ECOs/SSCOs 5, PwBD 10.
- **The public checker:** 36 on 1 August 2026 is too old for General and
  OBC, and within the limit for SC/ST and PwBD.

### SSC CGL 2026

- **Ages by post:** 38 posts read from the table of posts, each with its
  own range (18–27, 18–30, 20–30, and 18–32 for the Junior Statistical
  Officer), in five pay levels.
- **Posts 10 and 11 of Pay Level-7** print no age of their own (merged
  cells). They are reported and not given post 12's range.
- **No overall range:** run 2's single 18–32 for every post is dropped, and
  the review says so.
- **Relaxations:** eight rows of the coded table read. "Up to 40 years of
  age" rows are upper ages, not relaxations. PwBD (OBC) 13 stays apart from
  PwBD 10.

### Selection process and schedule (real runs' readings)

- **IBPS:** the officers' interview, dated in the schedule, is added when
  the reading left it out, as printed: "Conduct of interview (For Officers
  Scale I, II and III)".
- **LIC:** Document Verification read as an interview is corrected to
  document verification.
- **BTSC:** "Appointment and Training" is taken out of the selection stages.
- **SSC:** a generic "Computer Based Examination" beside Tier-I and Tier-II
  is flagged, not removed.
- **Every change is shown on the item.**

## P3.4 Tests added

- `bpsc-paste`, 11 tests.
- `post-removal`: 12 tests, plus 20 checks in the stack test.
- `upsc-age`, 12 tests.
- `ssc-post-ages`, 9 tests.
- `selection-check`, 7 tests.
- `exam-summary`, one new case.

After each commit, these passed:
- all CMS suites;
- intake 332/332;
- the import-flow, table, jobs and restore stack tests.

## P3.5 Still to do before B2 can be accepted

1. **Two full real-Gemini runs** (Gemini 3.5 Flash-Lite) over:
   - IBPS, LIC (text and scan), BTSC, SSC CGL, UPSC CSE and the BPSC
     corrigendum against a local BPSC record;
   - after the 12:30 IST reset, within the 500-a-day quota.
2. **Browser:** save, reopen, history and restore with the real model.
3. **Full regression:**
   - every stack suite, CMS, intake and intelligence;
   - PostgreSQL concurrency;
   - type check and lint;
   - the production build.
