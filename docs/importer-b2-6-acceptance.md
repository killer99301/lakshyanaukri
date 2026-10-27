# Smart intake — B2.6 final acceptance (in progress)

**Status: NOT ACCEPTED YET.**
- **Source PDFs:** four of the required source documents have not been
  supplied.
- **Real-Gemini runs:** the two runs of this stage are waiting for the
  Gemini key's daily quota to reset, around 12:30 IST on 2026-10-28.

B2 is not complete until every row in the table below passes.

Branch: `feature/importer` in `D:\LakshyaNaukri-importer`, local only.
Nothing pushed, merged, migrated or deployed. Model: `gemini-3.5-flash-lite`,
unchanged.

---

## 1. Source documents

| Source | Kind | Status | What it covers |
|---|---|---|---|
| IBPS CRP RRBs-XV (76 pages) | official PDF, text | available — B2.6 runs pending | annexure vacancy tables (280 rows), 4 posts' ages with birth-date windows, 7 exam-pattern papers, 9 schedule entries, long-document batches |
| IBPS + 3 blank scanned pages (79 pages) | made-up test PDF | available (local suite) | reading jobs, scanned pages, cancel and clean-up |
| LIC HFL Apprentices Batch 10 (10 pages) | official PDF, text + scanned page 10 | available — B2.6 runs pending | Table E (181 cities, total 232), age 20–25, the online-test pattern, fee |
| LIC HFL, pages 5–9 as images | scan PDF made from the official one | available — B2.6 runs pending | Table E read from images |
| LIC HFL, text then scan / scan then text | mixed PDFs made from the official one | available — B2.6 runs pending | one table across text and scanned pages |
| Telangana junior assistants, page 23 | scanned page | available — B2.6 runs pending | post-wise G/W category tables |
| BTSC FSO (Adda247 article text + screenshot) | research text and image | available — B2.6 runs pending | category maximum ages, pattern table, research-only warning |
| **SSC CGL 2026 notification** | official PDF | **outstanding: to be supplied** | |
| **SSC CGL corrigendum** | official PDF | **outstanding: to be supplied** | corrigendum handling |
| **UPSC CSE 2026 notification** | official PDF | **outstanding: to be supplied** | |
| **BPSC 72nd CCE notification** | official PDF | **outstanding: to be supplied** | |

The four outstanding PDFs were not taken from anywhere on this machine.
Files in `D:\My info` look like personal admit cards and application forms,
and were not opened.

---

## 2. Found and fixed in B2.6 so far

### The "rate limit" failure on IBPS pages 65–72 — investigated

- **How:** a probe recorded every request's time, status and the quota
  Gemini names in its 429 reply (`quotaId`, `quotaValue`, `retryDelay`; the
  message text and the key are never shown).
- **The cause:** the key is on Gemini's **free tier**, which allows
  **500 requests a day for this model**
  (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). The development
  and acceptance runs of 27–28 October used them up. The quota resets at
  midnight Pacific time, 12:30 IST.
- **What the code did wrong:**
  - it resent a daily-quota refusal twice, then the page batch tried again;
  - so each IBPS probe sent 69 requests, 46 of them resends that could not
    succeed;
  - and it reported the refusal as "rate limit reached — wait a minute",
    which is untrue for a daily quota.
- **Fixed in `3b38da7`:**
  - **Daily quota:** a 429 naming a per-day quota is not resent. The reason
    now reads "The AI provider's daily request quota is used up (500
    requests a day on this key); it resets in about N hours."
  - **Reading jobs:** they pause on it without failing a task or using a
    try, and resume complete once the quota is back.
  - **Per-minute limit:** a per-minute 429 waits the delay Gemini asks for
    (at most 30 s), otherwise the usual 5 s / 12 s.
  - **Tests:** PC04 and PC05 in batch reading, and a new reading-job section
    (51/51).
- **Yesterday's pages 65–72:** that failure was most likely the same quota
  running out at the end of a long day. It may instead have been a
  per-minute limit; the reply body was not recorded then.
- **Operational limit:** on the free tier, 500 requests a day is the real
  ceiling. A 76-page notice takes about 13–20 requests; a full acceptance
  run (both suites) takes far more. The site's own allowance defaults to 150
  a day, below 500.

### "AI response was incomplete" on LIC — investigated

- **The cause:** a short notice read in one request had half the answer
  room of a page batch: 8,192 tokens against 16,384. It can be just as long
  (up to 30,000 characters). With the longer answers since the stage and
  age work, LIC's answer could run out of room.
- **Fixed in the commit after `3b38da7`:**
  - the same 16,384 for both;
  - an answer the model stopped at its length limit (`finishReason:
    MAX_TOKENS`) is refused as incomplete, saying so, even when the part
    received happens to parse;
  - since `96038aa`, a short notice whose answer is incomplete is read again
    in halves.
- **Note:** the shared AI Assist and the scan reader also refuse a cut-off
  answer now, instead of using what arrived.
- **Not yet confirmed against the live model:** it waits for the quota.

---

## 3. Browser so far: save and reopen, with the stand-in AI (no quota used)

- **The run:** the local test copy with `--fake-ai`, which answers the AI
  requests from the text itself, offline. LIC HFL pages 1–9 were pasted as
  the official notice, with its address and the "I copied this myself"
  attestation.
- **Review:**
  - Table E read by code: 181 rows, 232 as printed.
  - The online-test pattern read by code, "all 1 papers read by code".
  - Every value flagged "no confirmed official document states this".
  - Warnings for the missing official notification and apply links.
- **Saved as draft, then reopened in the editor:**
  - the job is DRAFT, never published, provenance NOT_VERIFIED;
  - the vacancy table (181 rows), the exam pattern and both dates are
    PENDING;
  - the editor shows "Needed to publish: a link marked official" and "10
    imported key details to check in Check before publishing";
  - the vacancy total is shown as "Printed in the notice (page 9)", marked
    PENDING and "No official source — needs review".
- **Found:** the LIC notice prints its NATS address as
  `https://nats.education.gov.in.in`. Smart intake offers it exactly as
  printed, as an "Official website" link, though that address is dead.
  Links are not checked for whether they open. This is a known limitation
  (see section 5).
- **Not yet done:** the same workflow with the real model, a long PDF
  through a reading job (reload, resume), and a scanned PDF. They wait for
  the quota.

---

## 4. Still to do after the quota resets

1. Real-Gemini acceptance, twice each: `importer-gemini.acceptance.ts` and
   `importer-scans.acceptance.ts`. Record the requests used per run.
2. Field-by-field check of IBPS, LIC and BTSC against the notices:
   - all recruitment fields;
   - vacancy tables;
   - ages per post;
   - exam patterns;
   - selection stages and milestones;
   - evidence and pages.
3. Browser:
   - import, review, save as draft;
   - reopen in the editor: Pending and unverified, incomplete flags
     visible;
   - a long PDF through a reading job, with reload and resume.
4. The four outstanding PDFs, once supplied.

---

## 5. Known limitations and risks (so far)

- **The free-tier quota** (500 requests a day) is the hard ceiling for real
  use and for acceptance runs. Every full run must be planned against it.
- **Links are copied as printed,** including the notice's own mistakes (LIC's
  `gov.in.in`). Nothing checks that an official link opens.
- **Model variance** remains in AI-read lists: extra schedule entries from
  the pattern pages, and posts named without their scale. These are flagged
  or shown for the admin, never auto-verified.
- **Scan transcription** can misread or omit rows. The subtotal and total
  checks catch some, not all, so every AI-read row stays Pending.
- **Untested formats:** SSC, UPSC and BPSC notices, and a corrigendum
  against an existing record. This is the largest open risk until those
  four PDFs are run.
