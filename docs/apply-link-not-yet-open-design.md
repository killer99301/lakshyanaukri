# Apply link not yet released — design (Option B), revision 3 (approved)

Revision 3, 8 Nov 2026.

- **Revision 2** took in the owner's design decision ("APPLY LINK NOT YET RELEASED"): D1–D8 settled, two
  corrections, and a check of public-page caching.
- **Revision 3** takes in the owner's review of revision 2:
  - link-release and application-opening dates are kept apart (§2.1, §4);
  - the static page wording stays true whatever happens after publishing (§4.2);
  - the reminder runs until a verified link is on the public page (§5).

With these, the owner treats the design as **approved**. **Not implemented.** No code, gate, schema or migration
has been changed. Implementation and the production migration each need their own authorisation. The checkpoint is
local commit `fcb8bdc`.

## 1. Scope

| Situation in the official notice | Path |
|---|---|
| The **application link itself** will be released later | **New**: "Link not released yet" decision (this design) |
| Applications open later, and the notice already gives the application address | **Normal route**: add the link and verify it (§2.3) |
| Applications open later; the notice gives a schedule only and says nothing about the link | **Blocked**, as today: the notice does not support "link not released" (§2.3) |
| Offline application (post, hand delivery) | Unchanged: **Not applicable**, with the official words |
| Notice says nothing about applying | Unchanged: **blocked** |
| Broken or unverified link | Unchanged: **blocked** until a link is verified |

The decision applies to "Apply Online link" (`links#APPLY_ONLINE`) only. It is never the same as
"Not applicable", and no address is ever made up or approved automatically. Publishing stays the owner's.

## 2. The decision: `ADMIN_NOT_YET_OPEN`

### 2.1 What is recorded

This is a new kind of admin decision. The name has 18 characters, so it fits the current `kind VARCHAR(20)` column.

- **Document (D6).** The recruiting body's own notice (`origin_role = AUTHORITY`), confirmed or attested. A
  partner's or a portal's document is refused.
- **Exact words, and the page for a PDF.** The page is checked by the page check of `fcb8bdc`.
- **When and where.** The notice can give two different dates. They are two separate events, kept as two separate
  values, and neither is ever copied into the other:
  - `linkReleaseOn`: the date the notice says the **application link** will be released or activated. It must
    appear in the quoted words, stated as the link's date.
  - `applicationsOpenOn`: the date the notice says **applications open**. It is given only when the notice supports
    it, in one of two ways:
    - it is in the quoted words, stated as the applications' opening date; or
    - it is the job's own "Applications open" field, verified against the same notice.

    It is otherwise empty. A link-release date is **never** taken as the opening date.
  - `where`: the site or page named. It must appear in the quoted words.
  - At least `linkReleaseOn` or `where` is required. A location without a date is allowed **only** when the words
    describe a future link arrangement (§2.3) (D3).
  - Example. The notice says "The link will be activated on 01.12.2026; online registration from 03.12.2026 to
    23.12.2026". This records `linkReleaseOn = 2026-12-01` and `applicationsOpenOn = 2026-12-03`, and the page shows
    both, each with its own wording (§4).
  - When the quote gives one date and it is unclear which event it belongs to, the reviewer must choose. The server
    accepts a date as `linkReleaseOn` only when the words around it name the link, portal or facility (§2.3). It
    accepts a date as `applicationsOpenOn` only when the words around it name applications or registration.
- **Reason.** At least 10 characters.
- **The reviewer's own statement (required).** "The official notice says the online application link itself is not
  available yet — not only that applications open later." It is stored with the decision as the reviewer's
  confirmation. A server match is never accepted without it.
- **Public note.** Optional, at most 160 characters. When it is left empty, the note is generated as in §4.

The decision is stored in `recruitment_field_claims` with
`value = {"linkReleaseOn": "2026-12-01" | null, "applicationsOpenOn": "2026-12-03" | null, "where": "www.ibps.in" | null, "linkNotReleased": true}`.
The quote, page, reason and public note are stored as for the other decisions.

### 2.2 What the server refuses

- The job already has an Apply Online link. Verify that link instead.
- The words are not in the document, or (for a PDF) are not on the page cited.
- A date or place is not in the words. A date is given for one event while the words state it for the other.
- The document is not the body's own, or is not confirmed or attested.
- The field is not `links#APPLY_ONLINE`.
- The reviewer's statement is missing.
- The words fail the future-link test in §2.3.

### 2.3 "Link released later" versus "applications open later" (correction 2)

The server applies three safeguards. They **filter** out wrong uses; passing them does **not** prove the meaning.
The reviewer's statement in §2.1 is always required as well (D4).

1. **The words must be about the link or the online facility being made available.** They must name the link,
   portal, website or online application facility, together with a future verb: "will be activated", "will be made
   available", "will be released", "shall be available", "will be hosted", "to be enabled", or "will be live".
   - Passes: "The link for online registration will be activated on www.ibps.in from 01.12.2026."
   - Refused: "Online registration: 01.12.2026 to 21.12.2026" (a schedule only). The screen then says: "These
     words give dates only. If the notice gives the application address, add it as the Apply Online link and
     verify it; otherwise the job stays blocked until the link is out."
   - Refused: "Candidates can apply online from 01.12.2026" (applications open later, but nothing is said about
     the link).
2. **No application address in the words.** If the words contain an address with a path beyond the site's home
   page (for example `https://ibps.in/crp-xv-registration/`), the link already exists and the decision is refused:
   "The notice gives the application address: add it as the Apply Online link and verify it." A bare site name
   (`www.ibps.in`) is accepted only as `where`.
3. **No Apply Online link already on the job** (§2.2).

A notice that gives the application address but opens later follows the normal route: the link is added and
verified. The public page then shows the Apply Online button. Its existing "Upcoming" status and dates already say
that applications have not opened.

### 2.4 When the decision ends

The decision is tied to the Apply Online link's revision (`decisionRevisionPaths`). It ends when any of these
happens:

- **A link is added.** The decision lapses. The field shows "not checked", and the gate blocks any republish until
  the link is verified. The reminder carries on (§5, correction 1).
- **It is withdrawn** (Withdraw, which records `ADMIN_REVOKED`). The field shows as missing and the gate blocks
  republishing. The reminder carries on while the live page still shows the pending wording.

## 3. The gate

- A new field state, `NOT_YET_OPEN`, shown in the editor as **"Link not released yet — reviewed"**.
- `publishGate` lets `NOT_YET_OPEN` pass **for `links#APPLY_ONLINE` only**. Every other mandatory check is
  unchanged.
- **After the announced date passes without a verified link (D2):** a job already published stays live. Its wording
  changes (§4) and it is flagged urgent (§5). It is **never unpublished automatically**. The gate is not tightened
  on that date, so a correction elsewhere in the job can still be republished. The urgent flag stays until the link
  is verified.

## 4. The public page, and caching

### 4.1 What caching does today (checked)

`/jobs/[slug]` is built as static HTML (●, `generateStaticParams`, no `revalidate`). It is refreshed **only** when
the job is published, taken down or put back (`revalidatePath("/", "layout")` in those routes). Nothing refreshes
it on a date. Text worked out on the server from "today" therefore stays as it was at the last publish. The existing
"N days left" countdown in `JobDetailHeader` has the same limit: it is computed at render, so the HTML holds the
publish-day figure until the browser's own render replaces it. That is a pre-existing risk, outside this design.

### 4.2 The design: wording that stays true whatever happens later

The cached page can outlive the facts. The link may be released on the official site before this page is
republished. So the page **never says the link is unreleased**. It says only two things: what the official notice
announced, and what this page provides. Both stay true until the next publish.

**Built into the HTML (true on any day):**

| Notice gives | Text |
|---|---|
| Link release date (and place) | **No direct Apply Online link is provided on this page.** The official notice states that the application link was scheduled for release on **1 Dec 2026** (at **www.ibps.in**). |
| Place only | **No direct Apply Online link is provided on this page.** The official notice states that the application link would be released at **www.ibps.in**. |
| Also an application-opening date | Add: The official notice gives **3 Dec 2026** as the date applications open. |

The opening-date sentence appears only when `applicationsOpenOn` is recorded (§2.1). It is never worked out from
the link-release date.

**Drawn in the browser after loading**, from the visitor's own date in India time. Each line states only what the
recorded dates support:

| Line | Before the date | On or after the date |
|---|---|---|
| Link release (`linkReleaseOn`) | "Link scheduled for release on 1 Dec 2026." | "The scheduled release date (1 Dec 2026) has passed. This page does not have the link yet — look for it on the official website." |
| Applications open (`applicationsOpenOn`, only if recorded) | "Applications open on 3 Dec 2026." (D1) | Nothing extra. The job's existing dates and status cover it. |

- No line says or implies that the official website still lacks the link. Nobody has checked that, so it is never
  claimed.
- "Applications opening on …" is shown only from `applicationsOpenOn`, never from the link-release date.
- A visitor without scripts, or a crawler, gets only the built-in sentences, which stay true.

**Optional, needs approval:** the existing morning cron (`/api/cron/attention`, 08:00 IST) could also refresh the
pages of jobs whose announced date is today. It would write no record, only refresh the cached page. This changes a
scheduled job, so it is listed as R5 and not assumed.

### 4.3 Elsewhere on the page

- No Apply Online button is shown. The "Official Website" button stays when the job has a website link, labelled as
  the website.
- When the job has no steps of its own, "How to apply" gives the same sentence as the header.
- **Telegram (D5):** a post is sent only when the box is ticked. It adds the line "Application link: scheduled for
  release on 1 Dec 2026 (official notice); not provided here yet". It adds "Applications open: 3 Dec 2026" only when
  `applicationsOpenOn` is recorded. It links only to our own page, as it does today.
- There is no JobPosting structured data (checked), so no apply URL is exposed to search engines.

## 5. Updates Needed (correction 1)

The reminder is **not** tied to the decision being in force. It starts when a "link not released" decision is
first recorded. It ends only when the **published** page carries a verified Apply Online link: the link is verified
**and** the job is republished. A new item, `APPLY_LINK_PENDING`, is worked out by the Updates Needed service. It
reads the field's claims and the published copy, which are not in the record, so the pure `attentionFor` gets a
small input from that service.

**When it turns urgent (D7):** from `linkReleaseOn`; if no release date is recorded, from `applicationsOpenOn`; if
neither is recorded, it stays SOON. When both dates are given, the message names both.

| Situation | Level | Message |
|---|---|---|
| Decision in force; urgent date ahead, or no date | SOON | "No Apply Online link yet. The notice schedules its release for 1 Dec 2026. Add it and verify it when it is out." |
| Decision in force; urgent date reached or passed (D7) | **NOW** | "The link was scheduled for release on 1 Dec 2026 (applications open 3 Dec 2026) and there is no verified link. Check the official site." |
| Link added, **not verified** (decision lapsed) | NOW from the date, SOON before it | "An Apply Online link was added but is not verified. Verify it against the official notice before it can be shown." |
| Decision withdrawn, no link, live page still shows the pending wording | NOW | "The live page still shows the scheduled-link wording, but no decision supports it now. Verify a link, or record the correct decision." |
| Link **verified**, live page not yet republished | NOW from the urgent date, SOON before it | "The link is verified but the public page does not show it yet. Republish to show the Apply Online button." |
| Verified link on the published page | — | Cleared |

- Nothing is fetched, filled in or approved automatically.
- The morning owner message (cron) lists the NOW items, as it does for the other reminders today.

## 6. Database and migration

These changes add to the database and change none of the existing rows.

1. In the `recruitment_field_claims` kind check, add `'ADMIN_NOT_YET_OPEN'`.
2. A new check for that kind:
   - a document, a field revision and a quote;
   - `value` holding `linkNotReleased = true` and at least `linkReleaseOn` or `where`, with `applicationsOpenOn`
     optional;
   - a reason of at least 10 characters.
3. In the `public_note` check, allow the new kind.
4. In the decision trigger in `schema.sql`:
   - add the new kind to the list of decision kinds;
   - require the body's own document only;
   - require a page for a PDF.
5. Update `schema-manifest.ts` and add an idempotent migration script in the style of
   `scripts/cms-add-importer-tables.ts`.

**Release order:** database first, then code. Rolling back is safe both ways. Old code ignores the new kind, so the
field shows as missing and blocks publishing. New code on an old database cannot save the decision.

**D8:** the production migration needs separate approval, after the local implementation and its tests are
accepted.

## 7. Tests (to write once the implementation is authorised)

**Unit tests**

- The gate passes `NOT_YET_OPEN` for the Apply Online link only.
- The future-link test, with examples:
  - Pass: "link will be activated on … from …", "online application facility will be made available at …".
  - Refuse: a schedule only; "apply online from …"; words with an application address; a date or place not in the
    words.
- The reviewer's statement is required.
- The two dates:
  - "link activated on 01.12.2026; registration from 03.12.2026" is kept as two values;
  - a link date given as the opening date is refused, and the reverse too;
  - with no `applicationsOpenOn`, the opening-date sentence never appears.
- The public wording, built into the HTML:
  - it is the same on every date;
  - it never contains "not yet released", "not released" or "unreleased";
  - it says "No direct Apply Online link is provided on this page";
  - no Apply Online button is drawn;
  - the website button keeps its own label.
- The browser-only lines:
  - the link line before and after `linkReleaseOn`;
  - the opening line only with `applicationsOpenOn`;
  - no line says the official website lacks the link;
  - India time at the day boundary.
- Every row of the Updates Needed table in §5, including the added-but-unverified link.
- The Telegram message gets the pending line only when the box is ticked.

**Database tests (local test database only)**

- Recorded on a confirmed IBPS PDF.
- Refused:
  - the wrong page;
  - a portal's document;
  - a link already on the job;
  - a schedule-only quote;
  - a quote containing an application address;
  - without the reviewer's statement.
- The gate passes with the other checks done, and blocks when one is missing.
- Adding an unverified link:
  - the decision lapses;
  - the gate blocks republishing;
  - the reminder stays and changes its message;
  - after verification it says "Republish to show…";
  - it clears only when the **published** copy carries the verified link.
- Withdrawing the decision while the job is live keeps a reminder.
- The migration script:
  - running it twice is safe;
  - old rows stay valid;
  - old code ignores the new kind.
- **Caching:**
  - after publishing, the built HTML contains only the date-independent sentences;
  - a page built before the release date and read after it, with the link added to the record but not yet
    republished, shows nothing false.

**Regressions.** G1–G3, `safety-corrections`, `c3-step3`, `channel-post`, `telegram-isolation`, and the full sweep.
These failures are known exceptions:

- phase-d-integration;
- ticker TK02/TK03;
- importer-jobs, which needs a PDF argument;
- production-cache, which needs its launcher.

**Browser demo.** The decision form, with its refusals and the reviewer's statement. A draft preview. Updates
Needed before and after the date, with the test clock moved rather than real time.

## 8. Decisions settled (owner, 8 Nov 2026)

| | Decision |
|---|---|
| D1 | Wording as in §4.2 (revision 3). It is durable: it states what the notice announced and what this page provides. The date-sensitive lines are drawn in the browser only. "Applications open on …" is shown only from a recorded application-opening date. |
| D2 | Stay live, truthful wording, urgent flag. Never unpublished automatically. |
| D3 | A location alone only when the words describe a future link arrangement. |
| D4 | Server safeguards plus the reviewer's required statement. A keyword match is never enough. |
| D5 | Telegram only when ticked, with the pending-link line. |
| D6 | The recruiting body's own confirmed or attested notice only. |
| D7 | Urgent from the link-release date; if none is recorded, from the application-opening date. |
| D8 | Production migration only with separate approval. |

## 9. Remaining implementation risks

- **R1. Wording variety.** Real notices phrase the link arrangement in many ways (Hindi or bilingual text, "web
  portal", "will go live"). The future-link test will refuse some genuine cases; the reviewer then cannot record
  the decision and the job stays blocked. This errs on the safe side. The phrase list must be tested on real
  notices before release, and widening it needs the owner's review.
- **R2. "Applications open later" mixed with a link sentence.** A notice may give the application address in one
  place and say "the link will be activated on …" in another. The address check only sees the quoted words. The
  reviewer's statement covers the rest, but the server cannot prove it.
- **R3. Static pages.** The existing "days left" figure and the job status badge are worked out at render time on a
  static page, which is a pre-existing staleness risk. The new wording avoids it by design (§4.2). The older parts
  are not fixed by this design.
- **R4. The reminder needs claims data.** Updates Needed and the morning cron must read the field's claims for each
  live job, which they do not do today. That means one more query per job list. The cron's query must stay within
  its time limit.
- **R5. Optional page refresh on the opening date** (§4.2). This changes the existing scheduled job and needs
  separate approval.
- **R6. Older PDF-page decisions.** Decisions recorded before `fcb8bdc` were not page-checked, and they must be
  assessed before production. This also applies to any `NOT_APPLICABLE` already recorded on Apply Online links.
- **R7. The withdrawn-decision case** (§5, row 4). A live page can keep the pending wording with no decision behind
  it until the next republish. The reminder flags it as NOW, but the page is not changed automatically, per D2.
- **R8. Date forms.** `linkReleaseOn` and `applicationsOpenOn` must match the many date forms in notices
  (01.12.2026, 1st December, 01-12-2026, Hindi month names). A date the matcher misses means the decision can only
  be recorded with a place, or not at all.
- **R9. Which event a date belongs to.** One quoted sentence can carry both dates ("link activated on 01.12.2026,
  registration 03.12.2026 to 23.12.2026"). The server ties a date to the words nearest to it. It refuses when it
  cannot tell, and the reviewer then quotes the two sentences apart. Tables of dates in notices make this harder.
  The examples in the tests must include real notice layouts.
- **R10. The live page between the link's release and the republish.** For that time, the page truthfully says it
  gives no direct link and that the link was scheduled for release, but visitors do not get the link from
  LakshyaNaukri. Only a quick verify-and-republish closes the gap. The reminder becomes urgent on the release date
  to push for it.

## 10. Not part of this design

- Fetching or finding the link automatically.
- Any change to "Not applicable", to silent notices, or to broken links.
- Any change to the gate, the schema or the cron before approval.
