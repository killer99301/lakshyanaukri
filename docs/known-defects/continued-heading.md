# Known defect: a "(continued)" heading joins the next row's name

Found on 1 November 2026, in Stage C, C1. **Not fixed.** Fixing it needs the owner's go-ahead; it belongs with B2.5, tables across pages.

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
