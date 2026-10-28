# Smart intake — B2.6 final acceptance report

Updated 2026-10-28, 23:00 IST.

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
