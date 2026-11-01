# Known defect: a "(continued)" heading joins the next row's name

Found on 1 November 2026, in Stage C, C1. **Fixed on 1 November 2026** in the B2.5 reader, a narrow correction approved by the owner. See "The fix" below.

## What happens

The code table reader joins a vacancy table that runs on to the next page. Sometimes that page begins with:
- a "(continued)" heading, and
- the column heading printed again.

The first row on that page then takes both lines into its name. Its figures are read correctly.

## Reproduction

Run `npx tsx --tsconfig tsconfig.json tests/local-stack/known-defect-continued-heading.repro.ts`. It makes no AI request and runs on the in-memory test database.

Page 2 printed as:

```
Annexure I (continued)
Sr. No. Name of the Bank SC ST OBC EWS UR Total
3 Gamma Gramin Bank 1 1 2 1 3 8
Total 5 3 8 3 11 30
```

is read as:

| Page | Bank | Total |
|---|---|---|
| 1 | Alpha Gramin Bank | 10 |
| 1 | Beta Gramin Bank | 12 |
| 2 | **Annexure I (continued) Sr. No. Name of the Bank SC ST OBC EWS UR Total 3 Gamma Gramin Bank** | 8 |

The same page without its first two lines reads "Gamma Gramin Bank" correctly.

## Why it matters for Stage C

The figures, and so the totals, are right, but a row label is wrong. Under C-D2, a printed total read by code from text is verified by its own printed line. The whole-table check is not required for it. So the total can be VERIFIED while the bank-wise table shown on the public page carries this wrong label.

**For the owner's decision at C3:** the table review must make such a label easy to catch. Requiring the whole-table check before publishing any job with a vacancy table, whatever its total, would also stop it. That would change C-D2, so it is the owner's call.

## The owner's decision (1 November 2026)

This is a data-integrity issue, not only a matter for the screen: correct figures with wrong labels are still wrong recruitment information. A narrow fix to the B2.5 reader was approved. C-D2 is unchanged: no blanket manual check for every text table.

## The fix

In `findVacancyTables` (`src/lib/cms/importer/vacancy-tables.ts`), while a table's rows are being read, two kinds of word-only line are passed over instead of being held as the next row's wrapped name:
- a line repeating one of the table's own column-heading lines exactly;
- a line saying "continued" or "contd." with no figures.

This applies only on a page after the last row read. On the same page, every wrapped name line is kept as before.

## Evidence

**Regression tests:**
- **`tests/cms/cross-page.test.ts`**, CP10 to CP14:
  - the exact example gives "Gamma Gramin Bank", page 2, with its own printed line;
  - the table with no heading printed again reads as before;
  - only a repeated heading, or only a "contd." line, is handled the same way;
  - a genuine wrapped name after the repeated heading is kept;
  - on the same page, nothing is passed over.
- **`tests/local-stack/continued-heading.test.ts`**, 8 of 8, through the real import, apply, decisions and publish routes. For both layouts:
  - three rows stored by their own names, pages and printed lines;
  - 30 as printed, with nothing to decide;
  - verified by the printed line;
  - published with "Gamma Gramin Bank" in the public table.

**Negative check:** with the fix switched off, CP10, CP12 and CP13 fail.

**No change to real notices.** 21 documents went through the reader before and after the fix:
- the real IBPS CRP RRBs-XV PDF, 280 rows;
- LIC Table E, 181 rows;
- the SSC, UPSC and BPSC PDFs;
- every notice-text fixture.

All gave identical rows, printed totals and coverage.
