# Smart intake — B2 formal acceptance report

Dated 1 November 2026.

> **ACCEPTED by the owner on 1 November 2026** ("Accept B2"), under the approved criteria and the documented limitations in section 4. The Stage C entry checklist in `docs/smart-intake-roadmap.md` carries two items forward.

**Branch:** `feature/importer` in `D:\LakshyaNaukri-importer`.
- Local only: nothing pushed, merged, migrated or deployed.
- No production data used.

**Model:** Gemini 3.5 Flash-Lite, unchanged.

**Stage C:** not started.

## Verdict

### Under the criteria the owner approved on 1 November: **PASS**

Every required check of every real-Gemini suite ran and passed. Two
conditions apply to that:
- the scan criterion is the revised one the owner approved (section 4);
- the B2.6 suite's SSC part was re-run after its fix (section 1).

**B2 is not accepted until the owner says so.** This report stops here for
that decision.

| Suite | Required | Passed | Failed | Not run | Not applicable | Verdict | Run |
|---|---|---|---|---|---|---|---|
| IBPS / LIC / BTSC | 62 | 60 | 0 | 0 | 2 | **PASS** | Round 2 (31 Oct) |
| Scans (LIC, Telangana), revised criterion | 37 | 37 | 0 | 0 | 0 | **PASS** | Round 2's saved readings, replayed (no new request) |
| B2.6: UPSC and BPSC parts | 15 | 15 | 0 | 0 | 0 | **PASS** | Round 2 (31 Oct) |
| B2.6: SSC part | 8 | 8 | 0 | 0 | 0 | **PASS** | Run 3, SSC only (1 Nov) |

**The SSC run: 8 required checks, 12 executions.**
- Required checks: 8, all passed.
- Assertion executions: 12, all passed.
- The difference: "SSC: no announcement among the selection stages" is one
  required check that runs once per selection reading. This run returned
  five conflicting selection readings, so it ran five times, passing each
  time.

**Under the original scan criterion**, before the owner's decision 1, round
2's scans suite was FAILURES: 3 of 28 checks. Those three are the documented
scan limitations in section 4. They are not counted as correct readings.

## 1. Final-run results

### Real-Gemini runs

| Run | Suite | Gemini requests |
|---|---|---|
| Round 2, 31 Oct | IBPS / LIC / BTSC | 31 sent, 5 resent, 7 failed attempts (all recovered on retry; every one of IBPS's 10 page batches read) |
| Round 2, 31 Oct | Scans | 43 sent, 5 resent, 0 failed |
| Round 2, 31 Oct | B2.6 (SSC, UPSC, BPSC) | 77 sent, 11 resent, 0 failed |
| Run 3, 1 Nov | B2.6, SSC only | 41 sent, 3 resent, 0 failed |

- **Before each round:** the quota was confirmed with one request (Google's
  free tier reports whether a request is accepted, not how many remain).
- **Use in the 31 October – 1 November quota day:** about 290 of 500, all
  told:
  - round 2;
  - the browser workflow;
  - run 3;
  - three checks.
- **Not re-run with the real model:** the IBPS/LIC/BTSC suite after the
  selection fallback was added. The fallback has unit tests, and that
  suite's round 2 already passed.

### Every run, for comparison

All raw outputs are kept in `docs/acceptance-runs/`: every log and every
preview as JSON, with no API key in any file.

| Run | IBPS / LIC / BTSC | Scans (original criterion) | B2.6 |
|---|---|---|---|
| Round 1, 29 Oct (reconstructed from its saved logs; 2 not applicable proven from the saved result) | FAILURES 59/62 | FAILURES 27/28 | FAILURES 16/23 |
| Round 2, 31 Oct (corrected harness) | PASS 60/62 + 2 not applicable | FAILURES 25/28 | FAILURES 22/23 |
| Run 3, 1 Nov (SSC only) | — | — | PASS 8/8 |

Recounting:
- `node docs/acceptance-runs/reconstruct-round.mjs 1|2` recounts a round
  against the declared checks;
- `REPLAY=<run dir>` applies the scans suite to saved readings.

**Not applicable means only this:** the two scan-table guards for
`lic-scan.pdf`. That file is the notice's pages 1–5, which print no vacancy
table.

### The real-model browser workflow (local test copy, 31 Oct – 1 Nov)

| Workflow | Result |
|---|---|
| IBPS, 76 pages, reloaded mid-read | Resumed the same reading job. At least 13,706 vacancies, 280 rows, "✓ all 7 papers read by code". Saved and reopened as a Draft. |
| LIC scanned PDF | 232 as printed; 182 rows marked as read from the image by AI. A spelling suggestion was applied with "use it"; the printed form was kept after reopening. |
| SSC CGL, then its reopening notice against the saved job | 38 posts each with its own age, age counted on 1 Aug 2026, eight relaxations. Reopening: 25 Jun, 26 Jun and 3 Jul replace 22 Jun, 23 Jun and 1 Jul; saved and reopened. |
| UPSC age checker | 05/2026-CSE; 21–32 as of 1 Aug 2026; six relaxations. Born 15 Jan 1990: General and OBC above the limit, SC within with relaxation. |
| BPSC scanned corrigendum | Read "ईंख". Matched with the reason shown, unticked. Ticked: 1,186; restored: 1,230. The rows stay "Prepared outside, to check". |

## 2. Known baselines, kept apart from new results

**No new failure in any suite.** Two long-standing baselines, recorded
before B2 and unchanged:

| Baseline | Now | Before B2.6 |
|---|---|---|
| Intelligence suite: `E8: Approving vacancy change generates ProposedChange without writing canonical data` | 12/13, the same single failure | 12/13 |
| Lint | 7 errors and 26 warnings, in the same files | 7 errors and 26 warnings |

- The first lint pass found 8 errors. The extra error was in a scratch
  script of mine in the git-ignored `tests/local-stack/.tmp/` folder, not in
  the project.
- After removing my scratch files, lint matched the baseline exactly.

**Earlier failures, all fixed with tests:**

| Commit | Fix |
|---|---|
| `c231440` | BTSC evidence across lines |
| `9661fc9` | SSC age field lengths |
| `157b5ac` and `23231af` | BPSC near-name match, with the table required |
| `9af9a62` | SSC age date from the heading |
| `38b5593` | Selection process built from the schedule |

## 3. Final safeguards (the final code, `d831e37`)

| Check | Result |
|---|---|
| Local-database stack suites | 21 of 21 ALL PASS (from 5 to 84 checks each; the removal test 20/20) |
| CMS suites | 54 of 54 pass |
| Intake | 332 / 332 |
| Intelligence | 12 / 13: the known baseline E8, unchanged |
| PostgreSQL concurrency | 35 / 35 (PostgreSQL 17.11) |
| Type check | clean |
| Lint | 7 errors and 26 warnings: the baseline, unchanged |
| Production build | passes (the `pdfjs-dist` "can't be external" warning has appeared in every build) |
| Production cache test | 31 / 31 |

## 4. Outstanding limitations (agreed and documented)

### Scan recognition (the owner's decision 1)

Gemini can misread or split a cell on a page image. For example:
- Telangana page 23, post 16: "-" read as 1, and "01" read as blank;
- LIC page 7: "Jammu And | Kashmir" split into two cells.

The two scan readings are **not** correct and are not counted as correct.
What the revised criterion verifies, and what passed:
- a misread is caught wherever the page offers a check (Telangana: a
  printed subtotal disagrees and flags the post);
- a row not read is listed as not read, never filled in;
- a reading with anything unread is never complete;
- AI-read rows keep the table from being marked ready, so it cannot be
  published as checked, until a person compares them with the page.

**The negative test.** Copies of the saved readings with the flags removed,
and with an unread reading claimed complete, fail those checks. The
criterion is not a formality.

### The prepared-information route (accepted alternative workflow)

**BPSC 72nd CCE's Hindi vacancy tables:**
- entered through the paste route from a prepared table (1,077 + 153 =
  1,230);
- every row is marked "Prepared outside, to check" and is Pending;
- never shown as printed in the notice;
- the notice's own inconsistencies in सारणी II are reported.

**This is an accepted alternative workflow, not an automatic extraction.**

### Other known limitations

- **The model's reading varies between runs:**
  - scan cells;
  - whether a field comes back;
  - conflicting selection readings.

  The code-read parts gave the same results in every run: tables, pattern
  tables, post ages, relaxations, the post removal, and the selection
  process built from the schedule.
- **Flagged as incomplete, not failures:**
  - SSC Tier-II's three-level pattern table;
  - UPSC's nine papers stated in prose;
  - SSC posts 10 and 11 (merged cells, no age of their own).
- **The Gemini free tier, 500 requests a day,** limits how much can be read
  in one day.

## 5. Commits in this closing stage (local, `feature/importer`)

| Commit | What |
|---|---|
| `c231440` | Split evidence across lines (BTSC) |
| `9661fc9` | SSC age kept whole within the field's limits |
| `157b5ac` | BPSC near-name match (serial, table, count) |
| `00e5b6f` | Harness: required checks, NOT RUN, not applicable, INCOMPLETE |
| `9af9a62` | SSC age date from the age heading |
| `23231af` | Near-name match requires the table |
| `38b5593` | Selection process built from the schedule when the reading has none |
| `d831e37` | The revised scan criterion; replay mode |

The documents:
- `docs/smart-intake-roadmap.md` — the product vision, the roadmap, the
  order after Stage C, and the pre-release UI/UX redesign;
- this report;
- `docs/acceptance-runs/` — all three rounds' raw outputs.

## 6. For the owner's decision

1. **Accept B2**, under the approved criteria and the limitations in
   section 4, or ask for more.
2. **After acceptance:** Stage C, then the GitHub backup of
   `feature/importer` on your go-ahead.

No push, merge, migration or deployment without your explicit approval.
