# Stage C — Verification and publishing safeguards: plan for approval

Dated 1 November 2026. **Nothing in Stage C is built yet.** The two entry checks are done and recorded in
`docs/smart-intake-roadmap.md`:
- the selection fallback passes on the real IBPS path, 17 of 17;
- the intelligence baseline E8 is inspected; the old review queue is not verified, and Stage C does not rely on it.

## 1. What Stage C is

The vision (`docs/smart-recruitment-vision.md` §8–§10) defines it:
- row-level evidence in the review and the editor;
- "stated" and "calculated" badges;
- your decision 3 of 26 October: a calculated total counts as checked for Tier B only when:
  - every input row has its evidence;
  - coverage is complete;
  - no conflict is open;
  - a recalculation from the stored rows gives the same figure.

The roadmap calls the stage "verification and publishing safeguards".

## 2. What already exists, and the gap

| Piece | State |
|---|---|
| Each row's page and printed line, in the import review and the editor | **Built** (A2/A3, B2) |
| Badges: Printed in the notice / Calculated / Entered by hand / Prepared outside, to check / AI-read from image | **Built** |
| Page images beside AI-read rows | **Built** (B2.4) |
| Public wording: "At least N", "Calculated by adding…" | **Built** (A3) |
| A field check bound to the field's revision, so an edit reopens it | **Built** (Phase 1 design §4–5) |
| `calculatedTotalReady`: decision 3 written as code, with its reasons | **Written, but used only by tests.** Neither the publish gate nor any screen calls it |
| Recording "this table was checked against the notice" | **Missing.** `vacancies.table` has no gate tier, and no decision for the whole table exists |

**So the gap is the gate, not the evidence.** As far as I have traced it, an imported job's calculated total is gated like any other field:
- it is checked through a quote;
- a sum has no printed quote of its own;
- rows read by AI from a scan, or prepared outside, can reach the public page without the table ever being checked as a whole.

Step C0 confirms this with a test before anything changes.

## 3. Decisions needed from you

| | Decision | My recommendation |
|---|---|---|
| **C-D1** | **How a table check is recorded.** | **One "Checked against the notice" decision for the whole table**, as the vision §4.4 says. It names the pages compared and is bound to the table's revision, so editing any row reopens it. No check per row. |
| **C-D2** | **When the table check is required for publishing.** | **Required when the total is calculated, or when any row was AI-read from an image or prepared outside.** A printed total on a table read by code from text is checked as it is now (quote and page). |
| **C-D3** | **An incomplete total** (for example IBPS before Tripura reports). | Keep decision 1: it never passes Tier B as checked. It can be published only if you record "not stated in full". The public page then says "At least N", as it does now. |
| **C-D4** | **The old intelligence review queue** (E8). | **Leave it untouched in Stage C** and recorded as not verified. Whether to retire it or point it at the CMS is a separate decision, later. |

## 4. Steps and acceptance

| Step | What | Accepted when |
|---|---|---|
| **C0** | Measure first. A stack test pins today's gate for imported jobs with tables of each kind: printed total; calculated total; incomplete; AI-read rows; prepared rows. | Its results are reported to you before any change. No product code changed. |
| **C1** | The whole-table check, on the server. Recorded through the existing decision route on `vacancies.table`, citing the pages compared, bound to the table's revision, and revocable like any check. | Unit and stack tests: recorded; reopened by any row edit; refused on a stale revision; revoked. Existing decisions unchanged. |
| **C2** | The gate. A derived total is VERIFIED only when the table check stands at the current table revision **and** `calculatedTotalReady` gives ready (including the recalculation against the stored fingerprint). A table with AI-read or prepared rows blocks publishing until it is checked (C-D2). Each blocker says why, in the reasons the code already gives. | Tests for every reason in `calculatedTotalReady`. A table that is not checked cannot publish, and a checked one can. Editing a row reopens the check. Jobs that were not imported are not gated, as now. |
| **C3** | The check list in the editor shows the table's state and its reasons, with a **Check the table** action: pages to compare, page images for scanned rows, rows prepared outside listed. Functional, in today's styling; the redesign comes later. | Browser review of the **IBPS and BTSC drafts** (the vision §9 acceptance). Also: **LIC scan** (AI-read rows held until checked); **BPSC 72nd** prepared table (held, then checked); IBPS incomplete total (only "not stated in full" lets it publish, and the page says "At least"). |
| **C4** | Regression and report. | All stack, CMS, intake and PostgreSQL suites; type check; lint at baseline; production build; cache test. A formal report like B2's, then your acceptance. |

## 5. Rules for this stage

- **No AI request is needed.** The acceptance uses saved readings and replays, so the Gemini quota is not touched. If a real run turns out to be needed, I ask first.
- No production database, push, merge, migration or deployment.
- A schema change, if C1 needs one, stays in the local schema file and is listed for the release migration. It is never applied anywhere but the test database.
- No verification is automatic. Code only refuses or explains; a person checks.
- Each step is its own local commit, made only when its tests pass. Tests are never loosened to get a pass.
