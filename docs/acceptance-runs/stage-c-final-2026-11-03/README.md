# Stage C final evidence (compact), 3 November 2026

The evidence behind `docs/importer-stage-c-acceptance-report.md`.

**Tested commit:** `feature/importer` at `c48683b`.

**How it was run:** on the local test stack only, with no Gemini request, no external fetch and no production access.

**Kept out of Git:**
- the full logs (95 test logs, the build and cache-test output);
- the screenshots;
- the local test data.

They stay in the session's scratch folder on the owner's machine.

| File | What it is |
|---|---|
| `regression-exit-codes.txt` | The full regression of the C3 Step 5 audit (3 Nov), at `c48683b`: the exit code of each of the 95 test files (0 = passed). It counts as C4's regression by the owner's decision C4-D1 |
| `regression-suite-results.txt` | The same 95 files, each with its own summary line |
| `checks-summary.txt` | Type check, lint (with the 7 baseline errors by file), production build, production cache test |
| `o2-table-reader-diagnostic.log` | Finding O2: which layouts the code table reader finds a table in (run in memory, no database) |
| `c4-1-seed-report.json` | C4.1: how the IBPS and BTSC drafts were made from B2.6 round 2's saved readings, and their comparison with round 2 (the tables identical) |
| `c4-1-browser-evidence.json` | C4.1: in the browser, what each draft's check list, table line and panel showed; the server's checks; the refused publish |
| `c4-1-vacancy-section-evidence.json` | C4.1: each draft's vacancy section in the editor (the summary, row pages, a row's printed line) |
| `c4-1-ai-usage.txt` | C4.1: the app's own AI usage counter during the review: 0 |

**The record IDs** in the C4.1 files belong to a throwaway in-memory test database. They exist nowhere else.
