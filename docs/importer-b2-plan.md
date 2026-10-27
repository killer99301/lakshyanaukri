# Stage B2 — Reading the whole document: plan for approval

Nothing is built yet. This plan says why long notices lose information today, what B2 changes, the decisions only you can make, and how each part will be accepted.

## 1. Why the IBPS exam pattern and stages were missed

I traced both misses on the real IBPS CRP RRBs-XV PDF (76 pages, 191,963 characters of text).

**The exam pattern (missed in both runs).** Two readers can supply it, and both failed.

1. **The dedicated pattern reader picks the wrong part of the notice.** It only looks near headings such as "scheme of examination", "pattern of examination" or "syllabus".
   - IBPS calls its pattern "**structure of the Examinations**" (pages 21–24, with tables of test, questions, marks and duration). That wording matches no rule.
   - The only match was a passing sentence on page 4 ("…pattern of examination, issuance of call letters…").
   - So the reader was given one 4,500-character piece of page 4, found no pattern, and said "not found". This is a deterministic fault and fails the same way on every run.
2. **The whole-text reading is one request over the whole notice.** It sends all 192k characters and asks for every field at once (dates, fees, age, eligibility, stages, pattern, vacancies…).
   - On a 76-page notice the model returns some fields and drops others, and which ones it drops changes between runs.
   - It could have filled the gap from step 1, but returned no pattern in either run.

**The exam stages (found in run 1, not in run 2).** Stages come only from that single whole-text request, so they share its unreliability. Run 2 also shows "AI service unavailable" for two other sections: four AI requests go out at once for each source, and some fail under load.

**Conclusion.** The fault is not the model alone. It is (a) finding sections by a short list of heading words, and (b) asking one request to read a whole long notice. B2 replaces both with page-by-page reading and content-based section finding.

## 2. What B2 builds

### 2.1 One page map for every document
- **Text PDFs:** every page's text, as now (the reader already marks page ends).
- **Scanned or image-only pages:** detected per page (a page with almost no text is a scan page), so a mixed PDF is handled page by page.
- **The map records, per page:** its kind, whether it was read, the sections and tables found on it, and any failure.

### 2.2 Page-batched reading of long notices
- The whole-text reading runs over **batches of pages** (about 8–10 text pages, or 3–5 scan pages) instead of one request.
- Each batch is asked only for what that batch can hold; quotes must come from that batch, and every value keeps its page.
- **Merging batches is done by code:**
  - The same value from two batches counts once.
  - Different values become a conflict for you to resolve, never a silent choice.
  - A list such as exam stages or the pattern's papers is joined, with duplicates removed by name.
- **Coverage:** a batch that fails or times out is reported as *pages N–M not read*. The import never says "complete" while any page is unread.

### 2.3 Finding sections by what they contain, not one heading word
- The exam pattern is recognised by its table (test, number of questions, marks, duration), wherever it appears and whatever its heading.
- The same approach applies to fees (category + amount), age (years + relaxation) and dates (dates beside event words).
- Each is checked with a test on the real notice where the old rule failed: IBPS "structure of the Examinations".

### 2.4 Tables from scanned pages
- For scan pages, the AI is asked to **transcribe tables line by line exactly as printed**: heading lines, then one printed row per line, with the page number and `[unclear]` where it cannot read.
- That transcription then goes through the **same code reader as B1**, so a scan's table becomes the same structured vacancy table.
- **Code checks the arithmetic it can:** each row's categories against its printed row total, and column sums against printed totals.
  - A row that fails is flagged, never corrected.
  - `[unclear]` becomes "no figure", never a guess.
- In the review, scan rows are marked "**read from the image by AI — check against the page**".
- This is the one place figures are read by AI rather than code, because there is no text to read. Decision D1 below asks you to approve it.

### 2.5 Tables across page boundaries
- B1 already joins a table that continues under the same heading. B2 also joins tables that continue without their heading being printed again, and tables split across batches.
- Rows are matched by every dimension, so a row repeated at a page break counts once, and the review says it was repeated.

### 2.6 One coverage report
In the review screen, above the sections:
- pages read and not read
- tables found and tables extracted
- sections found, by field
- what failed and why

"Complete" appears only when every page was read.

### 2.7 Saving and reopening
The preview, the coverage report and the per-page evidence are stored with the import. Reopening the import, or the job, shows the same report and evidence. Browser test: import → save → reopen.

## 3. Decisions needed from you

| | Decision | My recommendation |
|---|---|---|
| **D1** | Scanned tables: may the AI transcribe a scan's table rows (checked by code arithmetic and marked "read by AI"), given that a scan has no text for code to read? | **Yes**, with those safeguards. The alternative is OCR software on the server, which is heavier, weaker on Hindi, and still not exact. |
| **D2** | Time limit: a 76-page notice read in batches takes several minutes; the preview request has 60 seconds (Vercel). | **Make the reading a background job with a progress bar**: "reading pages 17–24…". It can be reopened if you leave the page. |
| **D3** | Upload size: uploads stop at 4 MB, and long scans are often 10–40 MB. | **Split the PDF in your browser into page ranges before upload**, so no new storage is needed. (Using the Blob store instead waits on your Blob-store decision.) |
| **D4** | AI cost: one notice becomes about 8–12 requests instead of 4. | Count each batch against the daily cap, and show the number of requests before reading. |

## 4. Sources needed

On disk I have IBPS CRP RRBs-XV, LIC HFL (text PDF and its scan) and the BTSC article. I don't have:

- **SSC CGL** notice and its **corrigendum**
- **UPSC CSE** notice
- **BPSC 72nd CCE** notice

Please put the PDFs in one folder (for example `D:\b2-sources`) and tell me the path. I will not fetch them from the official sites (they block the server), and I won't search your personal Downloads folder.

## 5. Order of work and acceptance

| Step | What | Accepted when |
|---|---|---|
| B2.1 | Content-based section finding (pattern, fees, age, dates) | IBPS pattern found from pages 21–24 with no AI variance in the finding step; existing suites unchanged |
| B2.2 | Page map and page-batched whole-text reading, code merge, coverage | IBPS: stages and pattern in 2 of 2 real runs; a forced batch failure shows "pages N–M not read" and never "complete" |
| B2.3 | Background reading job with progress; browser-side PDF splitting (if D2/D3 approved) | 76-page IBPS PDF and a >4 MB scan imported in the browser; leave and reopen mid-read |
| B2.4 | Scan pages: AI transcription into the B1 table reader, arithmetic checks | LIC scan Table E: 181 rows, 232, with every row's page; any rows that fail the checks flagged rather than corrected |
| B2.5 | Tables across pages and batches | Made-up split tables (heading not repeated, a row repeated at the break) and IBPS/LIC unchanged |
| B2.6 | Real-source acceptance and regression | Two real-Gemini runs over IBPS, LIC (text and scan), BTSC, SSC CGL + corrigendum, UPSC CSE, BPSC 72nd; differences reported; browser save and reopen; full regression |

Each step is committed locally only when its tests pass. Tests are not loosened to get a pass. Stage C, the publishing gate, production, migration, push and deploy are untouched.
