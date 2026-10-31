# Smart intake — product vision and roadmap

Set by the owner on 1 November 2026. This is the measure for everything below it.

## The vision

LakshyaNaukri is **not a PDF-reading application**. It is an intelligent
recruitment CMS:
- it accepts recruitment information from practically any source;
- it organises that information into one complete recruitment record;
- it publishes the record, after the owner's review, through the existing
  public recruitment page.

> The measure of success is not how many PDF pages the AI can read. It is how
> easily the owner can provide recruitment information from any source and
> receive a complete, accurate, well-organised recruitment draft.

## Ways in, and their role

| Input | Role |
|---|---|
| Official or third-party web page (address) | Primary, everyday |
| Text copied from an article or the browser's Reading Mode | Primary, everyday (also the way round sites that block the server) |
| Information prepared by ChatGPT, Claude or another AI, or by hand: fields and structured vacancy tables | Primary, assisted. A core capability, not a workaround |
| Official text PDF | Automatic convenience |
| Scanned PDF or screenshot | Automatic convenience, best effort |

**Every way in leads to the same structured draft.** Nothing is lost or
duplicated because of the way it came in.

## What Smart intake does with any of them

- Identifies the recruitment and the organisation, and detects possible
  duplicates.
- Maps every piece of information to the right section:
  - overview;
  - dates;
  - vacancies;
  - eligibility;
  - age limits and relaxations;
  - fees;
  - pay;
  - selection process;
  - exam stages and pattern;
  - syllabus;
  - how to apply;
  - links;
  - documents.
- Understands vacancy tables post-wise and category-wise, and also bank-,
  city-, district- or state-wise. Code calculates the totals; the AI never
  does.
- Reports what is missing and shows conflicts side by side.
- Keeps provenance and evidence for each value: its source, its quote and
  its page.

**Safeguards that do not change with the way in:**

| What | How it is treated |
|---|---|
| Information supplied | Placed in the correct field, with its source |
| Missing information | Left empty and reported, never invented |
| Conflicting information | Both versions shown |
| Calculated figures | By deterministic code |
| AI interpretation | Marked for human review |
| Prepared outside (an AI, a third party) | Research, not official; "Prepared outside, to check" |
| Official verification | The existing verification and publishing process |

**Scans:** the scan reader and its checks stay. A scan reading is never
complete while something is unread, and its figures stay Pending. When it is
unreliable:
- the problem is reported;
- structured paste-in takes over;
- the original source is kept;
- a person checks;
- figures are never invented or silently corrected.

**No further specialised OCR work** without a clear business need.

## Roadmap

| Stage | State |
|---|---|
| A1–A3: vacancy tables | Done |
| B1: tables read by code | Done |
| B2.1–B2.5: long and scanned documents | Done |
| B2.6: final acceptance | **Accepted by the owner on 1 November 2026**; formal report in `docs/importer-b2-acceptance-report.md` |
| **C: verification and publishing safeguards** | Next, only after B2 is formally accepted |
| **Pre-release: admin CMS UI/UX redesign** | After Stage C, once core functions and publishing safeguards are stable; **required before the public launch** (see below) |
| Backup of `feature/importer` to GitHub | After the owner's go-ahead; separate from any production release |
| Controlled production release (migration and deployment) | Only with the owner's explicit approval |

**Stage C entry checklist.** Carried forward from the B2 report; done first
in Stage C, before anything else in it.

1. **IBPS selection fallback (`38b5593`).** It has unit tests but has not
   run with the real model. A focused replay or integration check is to
   verify:
   - the selection process built from the schedule;
   - its schedule evidence (quote and page);
   - that it is Pending when saved;
   - that a reading's own selection process is never overwritten.
2. **The intelligence baseline E8** ("Approving vacancy change generates
   ProposedChange without writing canonical data"). Before any change to the
   approval workflow:
   - inspect the exact failing assertion and document it;
   - treat that workflow as not fully verified until then.

**After Stage C, the next priorities.** These are not new OCR work, and each
is planned and approved separately:

1. Address and pasted-text intake made exceptionally reliable.
2. Externally prepared information made easy to import: fields and
   structured vacancy tables mapped automatically.
3. Every field and vacancy-table shape mapped to the right section.
4. A check that a saved draft renders as the complete public recruitment
   page.
5. Evidence, provenance and publishing safeguards intact throughout.

### Order after Stage C (approved by the owner, 1 November 2026)

The five functional priorities above and the UI/UX redesign below may overlap.
The approved order, so that no screen is built twice:

1. **Design concepts and the component system** are prepared and reviewed
   while the functional priorities are worked on. They change no code.
2. **A screen is redesigned only after its functional work is settled.** For
   example, the Smart intake review waits for the paste-import mapping it
   will show.
3. **Both are done before the public launch.** The order within that is the
   owner's call.

**When the concepts work starts:** once Stage C is complete. No redesign
implementation starts until the owner has reviewed and approved the concepts.

**A safeguard on every redesigned screen:** a functional regression check
before and after. The redesign must not change:
- validation;
- data handling;
- permissions;
- evidence;
- publishing behaviour;
- any other existing safeguard.

## Pre-release workstream: admin CMS UI/UX redesign

Set by the owner on 1 November 2026. The CMS was built for function. Before the
public launch it must also be visually beautiful, modern and exceptionally easy
to use. **Usability comes before decoration.**

**The aim:**
- intuitive, with fewer unnecessary clicks;
- clear navigation and simple language;
- well-organised forms;
- easy vacancy editing;
- a genuinely pleasant Smart intake.

**The look:**
- a premium, modern SaaS aesthetic;
- tasteful glassmorphism and translucent panels;
- gradient buttons and subtle glowing accents;
- rounded cards, refined type and generous spacing;
- elegant transitions and micro-interactions;
- high-quality dark and light themes, responsive and with accessible contrast.

**Built on:** consistent design tokens and reusable components.

**Areas of special attention:**
1. The admin dashboard.
2. The recruitment editor.
3. Smart intake and its review workflow.
4. The vacancy-table editor and paste-in.
5. Change history and evidence review.
6. The publishing and verification workflow.
7. Smaller screens.

**Ground rules:**
- **Not a coat of glass over the cramped interface:** review the whole admin
  workflow, simplify it where that helps, and build one coherent design
  system.
- **Preserve everything:** all existing functions, validation, safeguards,
  API behaviour and data structures.
- **Concepts first:** visual design concepts and the proposed component
  system go to the owner for approval before the full redesign is built.
- **Kept separate:** its own work and commits, never mixed into acceptance
  testing; no production change.

## How acceptance is judged

- **The essential requirement:** whatever the way in, the information reaches
  the correct CMS fields, can be reviewed with its evidence, and produces the
  correct public recruitment record.
- **PDF and scan accuracy** is evaluated and reported honestly.
- **A difficult document may pass through the prepared-information and
  paste-in route.** That is an accepted workflow, recorded as such, not as an
  automatic extraction.
