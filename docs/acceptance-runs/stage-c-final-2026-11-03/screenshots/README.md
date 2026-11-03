# Stage C browser screenshots (curated), saved 3 November 2026

Existing screenshots from Stage C's browser acceptance, copied as they were. None was regenerated.

**Where they came from:**
- the admin editor on the **local test stack only**: a throwaway in-memory database, with Gemini off;
- signed in as the local test admin;
- captured with headless Edge.

**What they show:**
- test records, and the public notice text of IBPS CRP RRBs-XV and BTSC FSO;
- no production data.

**Checked before saving:**
- each image was looked at;
- none shows a credential, session token, cookie, email address or other private data;
- none carries embedded text metadata.

**C3 Step 3 (B1–B6) has no screenshots.** Capture timed out at the time, so its record is text only, in the Stage C report, section 1.4.

| File | Scenario | Original (session scratch folder) |
|---|---|---|
| `step4-1-end-to-end-published-readonly.png` | C3 Step 4, 2 Nov: the fresh Smart intake job after publishing. Every key detail checked; "Vacancy table: checked against the notice (page 2)"; read-only | `c3-step4/screens/s1-e2e-published-readonly.png` |
| `step4-2-printed-total-published-readonly.png` | C3 Step 4: the printed-total job, published without a table check. Total verified by the printed total; read-only guidance shown | `c3-step4/screens/s2-printed-total-published-readonly.png` |
| `step4-3-printed-total-editable-optional-check.png` | C3 Step 4: the same job open for editing. The whole-table check is offered as an option | `c3-step4/screens/s3-printed-total-editable-optional-check.png` |
| `step4-4-panel-filled.png` | C3 Step 4: the whole-table check panel filled in on the printed-total job (before the D1/D2 fix) | `c3-step4/screens/s5-panel-filled-ready.png` |
| `step4-5-defect-d1-before-fix.png` | **Defect D1, before the fix:** the cited page empty, yet Record on. The line above also shows **D2**'s "open for editing" text while the panel is open | `c3-step4/screens/s6-defect-quote-page-not-required.png` |
| `fix-1-panel-open-no-d2-text.png` | **After the D1/D2 fix (`c48683b`):** the panel open, with no "open for editing" text above it | `c3-step4-fix/screens/f1-panel-open-d2-line.png` |
| `fix-2-d1-cited-page-missing.png` | After the fix: the cited page empty. "Still needed: the page of the words you cite", and Record off | `c3-step4-fix/screens/f2-d1-page-missing.png` |
| `fix-3-ready-with-page.png` | After the fix: page 2 cited, nothing still needed, Record on | `c3-step4-fix/screens/f3-ready.png` |
| `fix-4-recorded.png` | After the fix: "Vacancy table: checked against the notice (page 2)" | `c3-step4-fix/screens/f4-recorded.png` |
| `c4-1-ibps-1-check-list.png` | C4.1, 3 Nov: the IBPS draft's check list. The total offers only "Not stated in full" (needs the whole-table check); "Check the whole table" offered. **Also shows O5** ("No official source" on Total vacancies) | `c4-1/screens/ibps-1-checks.png` |
| `c4-1-ibps-2-vacancy-section.png` | C4.1: the IBPS vacancy section. "at least" totals, Calculated and Incomplete, Tripura not reported, rows with their page and printed line | `c4-1/screens/ibps-2-vacancy-section.png` |
| `c4-1-ibps-3-table-check-panel.png` | C4.1: the IBPS whole-table check panel. One PDF, rows with page and line | `c4-1/screens/ibps-3-panel.png` |
| `c4-1-btsc-1-check-list.png` | C4.1: the BTSC draft's check list. Research only, no actions, the reason shown | `c4-1/screens/btsc-1-checks.png` |
| `c4-1-btsc-2-vacancy-section.png` | C4.1: the BTSC vacancy section. **Shows O4** ("Printed in the notice" for a research article's total) | `c4-1/screens/btsc-2-vacancy-section.png` |
