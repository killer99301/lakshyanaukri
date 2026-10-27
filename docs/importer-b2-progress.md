# Stage B2 — progress

The plan and your decisions are in `importer-b2-plan.md`. This file records each step as it is finished. Everything is local on `feature/importer`: nothing has been pushed, merged, migrated or deployed.

## B2.1 — Finding sections by their content (done)

### What changed

`src/lib/cms/passage-finder.ts` (new, code only, no AI) recognises passages by what they contain.

- **Exam pattern:** rows of figures with a duration ("1 Reasoning * 40 40 25 minutes"), or rows of figures under a heading that names at least three of questions, marks, duration and tests ("General English 25 25"). The pattern's own title line just above it ("Single level Examination (objective)") is included.
  - These are not a pattern: compensatory-time sentences, lists of states or centres, fee tables, date tables.
- **Age limit:** ages in years beside age words, date-of-birth ranges and relaxations, reading wrapped table cells ("Between 18 years" / "and 28 years") together.
  - These are not an age limit: form blanks ("Age ____ years") and years of service.
- Passages are exact slices of the text, so quotes stay verbatim and page markers stay inside. A long passage is cut at line ends into pieces the reader accepts.

How the readers use it:

- **Pattern and syllabus reader:** gets the pattern passages first (the strongest that fit, in document order), then its old heading-word windows that don't overlap them. For web pages, a section whose content is a pattern table is sent even when its heading is not a pattern word.
- **Age, eligibility and selection reader:** gets the two strongest age passages first.
- **Dates and fees** were already found by content (dates and amounts close together). Their keyword lists now also cover "Commencement / Closure of registration", "Activity schedule" and "Application charges".

These builders are shared with AI Assist in the job editor, so AI Assist gains the same detection.

### Results

**Deterministic** — `tests/cms/passage-finder.test.ts`, 10/10.

- **Real pages:** IBPS pages 6–8 and 20–25, LIC pages 1–4, the BTSC article.
- **Made-up wordings:** "Plan of Examination", a Tier with hours, and a web section headed only "Written Test".
- **Made-up false lookalikes:** text that resembles a pattern or an age but is neither.
- **Run against the old builders:** 4 tests fail (the IBPS pattern, the IBPS age table, the other wordings, and the date and fee words). So the tests do catch the old fault.

**What the IBPS pattern reader is given**

| | Before | Now |
|---|---|---|
| Passages | one sentence from page 4 ("…pattern of examination, issuance of call letters…") | pages 21–22 (preliminary and main) and pages 23–24 (single level), with their titles |

**Real Gemini (gemini-3.5-flash-lite)**

| | Run 1 | Run 2 |
|---|---|---|
| Overall | 45/46 | 46/46 |
| IBPS exam pattern | found: 5 of 7 papers (both Officer Scale I papers left out) | found: all 7 papers, every figure correct |
| IBPS exam stages | not found | found (3 stages) |
| Vacancy tables (B1) | unchanged | unchanged |

- Before B2.1 the IBPS exam pattern was missed in every run.
- Run 2 was first attempted straight after run 1 and hit Gemini's per-minute rate limit: 17 checks failed with "AI rate limit reached". It was repeated after a pause, and only the repeat is counted above. This is what D4 (controlled concurrency, retries and backoff) is for.

**Regression**

- all 18 local-stack suites pass
- `cms:test` 42/42 suites
- intake 332/332
- PostgreSQL 17 concurrency 30/30
- `tsc` clean
- intelligence 12/13 and lint 7 errors / 26 warnings, both unchanged baselines

### Still open after B2.1 (honestly)

- **IBPS exam stages** still come only from the single whole-notice request, so they still vary between runs. B2.2's page batches address this.
- **The pattern reader's own variance:** in run 1 the model left out two papers that it had been given. Detection is now right; the model's reading still varies. The review screen shows what was found, and B2.2's merge across batches will be checked against this.
- **IBPS age is refused in both runs**, correctly. IBPS gives a different age range for each post (18–28, 18–30, 21–32, 21–40), but the age field holds one range. The model returns one range and the quote check refuses it. Storing ages per post is a product decision (a change to the record's age field), and it is not part of B2.
