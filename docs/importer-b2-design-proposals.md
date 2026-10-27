# Smart intake — design proposals before final B2 acceptance

Written 2026-10-27, at the end of stage B2.5. **Nothing here is built.** Each
proposal waits for the owner's decision; none needs a production migration
of existing rows, and each keeps every record already published readable as
it is today.

---

## 1. Post-wise age limits

### What exists today

`AgeCriteria` (src/types/recruitment-record.ts) already has more than one
age:

| field | meaning today |
|---|---|
| `min`, `max` | one range for the recruitment; with `postWise`, the widest range |
| `asOf` | the date ages are counted on |
| `relaxations: AgeRelaxation[]` | `{ category, years?, text? }`, for the whole recruitment |
| `postWise?: PostAgeRange[]` | `{ post, min?, max?, bornFrom?, bornTo? }` |
| `bornFrom`, `bornTo` | a date-of-birth window for the whole recruitment |

`postWise` is read by the public age checker (`EligibilityChecker.tsx`,
`eligibility-finder.ts`), the editor (`AgeEditor.tsx`) and the pre-publish
check. **Smart intake never fills it.** It proposes one `age` item: one
min/max, one `asOf`, and category maximums as relaxations.

### What notices print that the model cannot hold

- A different **reference date** for each post. Some notices count Officer
  Scale-I on one date and Office Assistant on another.
- **Relaxations that differ by post.** For example, ESM relaxation counted
  from service length for some posts only, or a PwBD figure for one cadre.
- **Category-specific maximums for each post.** Tables of post × category
  (UR 30, OBC 33, SC/ST 35) repeated for each post.
- **Evidence for each post.** Today an age item has one quote. A post-wise
  table needs each post's figures traceable to their own line and page.

### Proposal

Extend `PostAgeRange`. Every new field is optional, so every stored record
stays valid:

```ts
export interface PostAgeRange {
  post: string;
  min?: number;
  max?: number;
  bornFrom?: string;              // existing
  bornTo?: string;                // existing
  /** NEW: the date this post's ages are counted on, when it differs from AgeCriteria.asOf. */
  asOf?: string;
  /** NEW: relaxations for this post only. Absent = the recruitment's relaxations apply. */
  relaxations?: AgeRelaxation[];
  /** NEW: the upper limit for each category, as printed (UR 30, OBC 33, SC 35). Never calculated from a relaxation. */
  categoryMax?: Array<{ category: string; max: number }>;
  /** NEW: where this post's figures were read: retrieval, page, the printed line. Set by Smart intake; empty for hand entry. */
  source?: { retrievalId: string; page: number | null; line: string; readBy?: "AI_IMAGE" };
}
```

**Legacy compatibility (unchanged behaviour):**

- `AgeCriteria.min`, `max`, `asOf` and `relaxations` keep their meaning. When
  `postWise` is filled, Smart intake still writes `min`/`max` as the widest
  range, as the editor already does. Every page and check that reads only
  the single range keeps working.
- No stored row is rewritten. A record without the new fields renders
  exactly as now.
- The public age checker uses a post's `asOf` / `categoryMax` /
  `relaxations` when present, and falls back to the recruitment's values
  when absent. This is the one public change. It is opt-in per record,
  because only new imports or hand edits fill these fields.
- `CmsRecruitmentPost.ageOverride` stays as it is. It is unused by Smart
  intake and is not merged into this.

**How Smart intake would fill it:**

- A post × age table is read by code, like vacancy tables (B1): the heading
  matched, each row's figures taken as printed, and each row's own line and
  page kept as its source.
- A post-wise age written in prose is read by the AI with one quote per post.
  The quote must contain that post's numbers, as the date checks require
  today.
- The review shows one line per post, each with its quote and page. A post
  with no figures found is shown as "not read", never given the
  recruitment's range.
- No relaxation is ever added to a limit to "work out" a maximum. Only
  printed maximums go into `categoryMax`.

**Decision needed:**

1. Approve the four optional fields above.
2. Should the public age checker use per-post `asOf` and `categoryMax` in
   the same change, or only after the editor can show them?

No migration is needed. These are JSON fields inside the record's stored
document.

---

## 2. Selection stages and recruitment milestones

### What happens today

The real IBPS reading proposes nine "exam stages". Only some of them are
selection stages:

| proposed as a stage | what it is |
|---|---|
| Conduct of Pre-Exam Training (PET) | training (milestone) |
| Download of call letters – Preliminary | admit card (milestone) |
| Online Examination – Preliminary | **selection stage** |
| Result of Online exam – Preliminary | result (milestone) |
| Download of Call letter – Main / Single | admit card (milestone) |
| Online Examination – Main / Single | **selection stage** |
| Declaration of Result – Main / Single | result (milestone) |
| Download of call letters for interview | admit card (milestone) |
| Conduct of interview | **selection stage** |

The public "exam schedule" box (d4ab20d) shows the next stage. So today it
can show "Download of call letters" as the next exam. Dropping those rows
would lose real, dated information candidates want, such as when call
letters come out or when results are due.

### Proposal

Classify each item rather than filter it. Add one optional field to
`ExamStage` (src/types/index.ts):

```ts
export interface ExamStage {
  // … existing fields unchanged …
  /** NEW. Absent = a selection stage (every stored stage reads as today). */
  kind?: "SELECTION" | "ADMIT_CARD" | "RESULT" | "TRAINING" | "DOCUMENT" | "OTHER_MILESTONE";
}
```

- **Classification is done by code on the stage's own printed name**, not by
  the AI. For example, "call letter|admit card|hall ticket" → ADMIT_CARD,
  "result|declaration of result|merit list" → RESULT, "pre-exam training"
  → TRAINING, "provisional allotment|joining" → OTHER_MILESTONE.
  Everything else is SELECTION. A name matching nothing stays SELECTION, as
  now, and the review shows the class next to each row so the admin can
  change it.
- **The review** lists selection stages and milestones under separate
  headings. The admin can move a row between them.
- **The public pages:** the "next exam" box counts only `SELECTION` (or
  absent `kind`). Milestones appear in the dates list ("Call letters:
  November / December 2026"). Nothing is dropped.
- **Legacy:** every stored stage has no `kind`, so it reads as SELECTION and
  renders exactly as today. No data is rewritten.
- The fixed date fields (`dates.admitCardDate`, `dates.resultDate`) stay the
  single source for those dates. A milestone with a full date can fill them
  only through the existing date checks: the quote must name its event.

**Decision needed:**

1. Approve the `kind` field and the name-based classes above.
2. Should milestones show on the public page in this change, or only be kept
   and shown in the admin until a later public change?

---

## 3. Exam-pattern variance (IBPS: 4 to 7 of 7 papers)

### What the runs show

| run | papers read (of 7) |
|---|---|
| B2.1 run 1 | 5 |
| B2.1 run 2 | none |
| B2.1 run 2b | 7 |
| B2.2 runs 1–6 | 4, 5, 7, 7, 7, 4 |
| B2.3 run 1 | 7 |
| B2.5 run 1 | 6 |

The pattern is one AI request over the pattern section (`SECTION_PATTERN`).
The model leaves papers out at random. Nothing tells the admin a paper is
missing: a 4-paper reading looks just as finished as a 7-paper one.

### Proposal (a plan, not built)

1. **Count the papers by code first.** Notices print each paper as a
   headed table: the heading ("Preliminary Examination", "Main
   Examination", "Single level Examination", for a named post) followed by
   a "Sr. No. / Name of Tests / No. of Questions / Maximum Marks / Duration"
   row. Code finds these headings in the text, as B1 finds vacancy
   headings. That gives the expected number of papers and the page each
   starts on.
2. **Read each paper by code where it is a text table.** The rows are
   subject, questions, marks and duration, the same shape the B1 reader
   handles. Only papers code cannot read (prose patterns, scanned pages) go
   to the AI. The AI then gets one request per missing paper, with only
   that paper's lines.
3. **Never call it complete when papers are missing.** If code counted 7
   headings and fewer papers were read, the item is flagged "5 of 7 papers
   read; Officer Scale-II (Specialist Cadre) and Officer Scale-III not read",
   and the reading is not "complete", as with unread vacancy lines.
4. **Tests:** the real IBPS text (all 7 papers, by code, no AI), the LIC
   pattern, a prose-only pattern (AI path), and a notice whose heading count
   and reading disagree (flagged).

This is no IBPS hardcoding. The heading words are general ("Preliminary",
"Main", "Single", "Phase", "Paper", "Tier", "Stage"), and the table shape
is the same check B1 uses.

**Decision needed:** approve this as its own stage (B2.6 or later), after
items 1 and 2.

---

## 4. Also found in this round (no change made)

- **A quote shortened with "..." passed the details reader once** (LIC,
  selection: "Online remote proctored to be given by candidates from their
  home..."). `quoteFound` in `src/lib/cms/ai-assist-details.ts` removes
  punctuation before matching. A quote cut short therefore matches the
  sentence it was cut from. The words are all the notice's own, but the
  quote is not verbatim as shown. This happened once in 16 real runs. That
  file is shared with the CMS AI Assist, which is under the feature freeze,
  so it was not changed. A fix would remove a trailing "..." / "…" before
  saving the quote, or refuse it. It needs the owner's yes.
- **Scan transcription can still misread or omit rows.** B2.5 does not
  change this. The safeguards from B2.4 remain:
  - subtotal checks;
  - wrong-width rows reported as unread;
  - nearly empty pages re-read, then flagged;
  - AI-read rows marked;
  - the reading not "complete" while any table line is unread.
