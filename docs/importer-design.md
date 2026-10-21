# Recruitment importer — Phase 1 design, revision 4 (final, for approval)

Status: DESIGN ONLY. Nothing here is implemented, migrated or deployed.
Branch: `feature/importer` (worktree `D:\LakshyaNaukri-importer`, from production `715e4e4`).

The importer is an addition to the existing CMS. The existing editor, AI Assist,
prepared-file parser, field save route, history, evidence, publishing, revert and
take-down stay as they are. Jobs that were never imported keep today's rules.

Two rules this design exists to protect:
1. A fact never regains verification because an old value happens to match again.
2. Missing information never passes as information that does not apply.

## Changes from revision 1

| # | Review point | Resolution (section) |
|---|---|---|
| 1 | Verification could become valid again when an old value returns | Bound to the exact field revision, not the value (§5) |
| 2 | "Not applicable" mixed with "not in the notice" | Separate NOT_APPLICABLE and NOT_STATED, both cited; gate tiers (§5, §8) |
| 3 | Corrigendum supersession was per document | Claim-level supersession table; a field is superseded only by a claim for that field (§7) |
| 4 | Two imports could create the same job at once | Advisory locks on the normalised identity, recheck inside the transaction, audited override (§3) |
| 5 | Append-only was only a comment | Triggers refuse UPDATE/DELETE; revocations point at the revoked claim (§2, §5) |
| 6 | Partner origin could not confirm a document | Authenticity (where it came from) separated from authority (what it may speak for) (§4) |
| 7 | Same PDF in two imports | Documents deduplicated by hash; each import links to them through a retrieval row (§2) |
| 8 | Existing jobs' old values under the gate | "Legacy" class, acknowledged at preview, one-click review list (§9) |
| 9 | Function security | INVOKER, fixed search_path, schema-qualified, admin checked, values taken from the stored preview only (§10) |
| 10 | Original PDF | Text, hash, size, pages and URL archived; private copy of the bytes is a separate decision (§11) |

## Changes from revision 2

Decisions taken (§12): Tier A + Tier B gate; the advisory lock also added to the
existing manual "New job" route; text + hash only for PDFs; five tables.

| # | Review point | Resolution (section) |
|---|---|---|
| A | NOT_APPLICABLE / NOT_STATED evidence was not enforced in SQL | NOT_APPLICABLE needs page + quote or table cell; NOT_STATED needs a recorded review scope of an authoritative, authentic document; both checked by constraint and trigger; never written automatically (§2, §5) |
| B | Keys that drive the safety checks could change | `identity_key`, `org_year_key`, `base_revision` (and `import_id`, `mode`) immutable by trigger (§2) |
| C | A hash match could point at any retrieval | Trigger: the matched retrieval must be a server fetch of the same source from the same host (§2) |
| D | Owner-role limitation overstated | §10 rewritten: the site connects as the owner, so INVOKER gives no privilege isolation; triggers and checks guard against our own bugs only |

## Changes from revision 3 (last architecture review)

| # | Review point | Resolution (section) |
|---|---|---|
| 1 | CHECKs could pass through SQL NULL | Authenticity written as five explicit, complete combinations; every CHECK written to be TRUE or FALSE, never NULL (§2.1) |
| 2 | Lock keys could be NULL; manual create atomicity | Organisation + year key mandatory for every creation and always locked; notification key locked when present; manual create uses one `sql.transaction([...])` batch (§3) |
| 3 | A claim could point at another job's evidence | Composite foreign key (retrieval belongs to the claim's import) plus an insert trigger (retrieval's import belongs to the claim's job) (§2) |
| 4 | Same document twice in one import | `UNIQUE (import_id, source_id)` removed; every acquisition is its own retrieval row (§2.2) |
| 5 | Two simultaneous revocations; several decisions on one revision | Unique index: a claim can be revoked once; decisions serialised per field, ordered by a sequence, latest unrevoked wins (§5.2) |
| + | Decisions on a field that was never saved | A decision always writes its own field revision in the same transaction (§5.3) |

---

## 1. Words used below

| Term | Meaning |
|---|---|
| Import | One run of the importer for one job: sources in, preview out, then applied, discarded or expired. |
| Source | One document or text, identified by its content hash. The same PDF is one source however often it is used. |
| Retrieval | One time a source was given to an import: by whom, how (fetched, uploaded, pasted), from which address, what the uploader declared, and how its authenticity was established. |
| Claim | One statement about one field: "the source says V", or an admin's verification, not-applicable or not-stated record. Append-only. |
| Field revision | A row in the existing `field_revisions` table. Every write to a field creates one, with a unique id. |
| Critical field | See §8. |

---

## 2. Schema (additive; no existing table is altered)

Five new tables, one function, three triggers. Every new table is append-only or
has its allowed changes enforced by a trigger.

```sql
-- ── Imports ─────────────────────────────────────────────────────────
CREATE TABLE recruitment_imports (
  import_id        UUID         PRIMARY KEY,                 -- idempotency key, generated at preview
  mode             VARCHAR(10)  NOT NULL CHECK (mode IN ('NEW', 'EXISTING')),
  recruitment_id   UUID         REFERENCES recruitments(id), -- EXISTING: set at preview; NEW: set at apply
  base_revision    VARCHAR(64),                              -- record_revision the preview was computed on
  identity_key     TEXT,                                     -- normalised notification number; NEW only, when the notice has one
  org_year_key     TEXT,                                     -- organisation id + ':' + year; required for NEW
  status           VARCHAR(12)  NOT NULL DEFAULT 'PREVIEWED'
                   CHECK (status IN ('PREVIEWED', 'APPLIED', 'DISCARDED', 'EXPIRED')),
  proposal         JSONB        NOT NULL,                    -- immutable: every proposed item, each with an id
  selected_items   TEXT[],                                   -- ids of the ticked proposal items
  duplicate_override JSONB,                                  -- {reason, matches[]} when "create anyway" was chosen
  result           JSONB,                                    -- what was written (fields, revision ids, claim ids)
  created_by       UUID         NOT NULL REFERENCES admins(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  applied_by       UUID         REFERENCES admins(id),
  applied_at       TIMESTAMPTZ,
  CHECK ((status = 'APPLIED') = (applied_at IS NOT NULL AND applied_by IS NOT NULL)),
  CHECK (mode = 'NEW' OR (recruitment_id IS NOT NULL AND base_revision IS NOT NULL)),
  CHECK (mode = 'EXISTING' OR (org_year_key IS NOT NULL AND length(org_year_key) > 0)),
  CHECK (identity_key IS NULL OR length(identity_key) > 0),
  UNIQUE (import_id, recruitment_id)                          -- target of the claims' composite key
);
CREATE INDEX idx_recruitment_imports_recruitment ON recruitment_imports(recruitment_id, created_at DESC);

-- ── Sources: one row per distinct document or text ─────────────────
CREATE TABLE recruitment_sources (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  content_sha256  CHAR(64)     NOT NULL UNIQUE,              -- of the PDF bytes, or of the exact text
  content_kind    VARCHAR(8)   NOT NULL CHECK (content_kind IN ('PDF', 'HTML', 'TEXT')),
  byte_size       INTEGER      NOT NULL CHECK (byte_size > 0),
  page_count      INTEGER      CHECK (page_count > 0),
  text            TEXT         NOT NULL,                     -- extracted text with page markers; max 1 MB
  first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Retrievals: each time a source was brought into an import ──────
CREATE TABLE recruitment_source_retrievals (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id            UUID         NOT NULL REFERENCES recruitment_imports(import_id),
  source_id            UUID         NOT NULL REFERENCES recruitment_sources(id),
  -- (1) what the uploader declared
  declared_kind        VARCHAR(30)  NOT NULL CHECK (declared_kind IN
                         ('OFFICIAL_NOTIFICATION', 'OFFICIAL_CORRIGENDUM', 'OFFICIAL_PAGE', 'RESEARCH', 'OTHER')),
  version_label        TEXT,                                 -- "Notification", "Corrigendum 1 dated 30 Oct 2026"
  document_date        DATE,
  -- how it arrived
  method               VARCHAR(10)  NOT NULL CHECK (method IN ('FETCHED', 'UPLOADED', 'PASTED')),
  origin_url           TEXT,                                 -- the address fetched, or the address declared for an upload/paste
  origin_host          TEXT,
  -- (2) authority of that host for this organisation, frozen at retrieval time
  origin_role          VARCHAR(10)  NOT NULL CHECK (origin_role IN ('AUTHORITY', 'PARTNER', 'UNLISTED', 'NONE')),
  origin_purposes      TEXT[]       NOT NULL DEFAULT '{}',   -- AUTHORITY: {all}; PARTNER: e.g. {exam, fee_payment}
  -- (3) authenticity: did this document really come from origin_host?
  authenticity         VARCHAR(14)  NOT NULL CHECK (authenticity IN
                         ('CONFIRMED', 'ATTESTED', 'UNCONFIRMED', 'NOT_APPLICABLE')),
  authenticity_method  VARCHAR(30)  CHECK (authenticity_method IN
                         ('FETCHED_BY_SERVER', 'HASH_MATCHES_SERVER_FETCH', 'ADMIN_ATTESTED')),
  matched_retrieval_id UUID         REFERENCES recruitment_source_retrievals(id), -- the server fetch a hash match refers to
  attested_by          UUID         REFERENCES admins(id),
  attested_at          TIMESTAMPTZ,
  attestation_note     TEXT,                                 -- e.g. "downloaded from rrbcdg.gov.in, site blocks servers"
  retrieved_by         UUID         NOT NULL REFERENCES admins(id),
  retrieved_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (id, import_id),                                    -- target of the claims' composite key
  -- §2.1: exactly one of five complete combinations; no column left to NULL semantics
  CHECK (
    (authenticity = 'CONFIRMED' AND authenticity_method = 'FETCHED_BY_SERVER'
       AND method = 'FETCHED' AND origin_host IS NOT NULL
       AND matched_retrieval_id IS NULL
       AND attested_by IS NULL AND attested_at IS NULL AND attestation_note IS NULL
       AND declared_kind <> 'RESEARCH')
    OR
    (authenticity = 'CONFIRMED' AND authenticity_method = 'HASH_MATCHES_SERVER_FETCH'
       AND method = 'UPLOADED' AND origin_host IS NOT NULL
       AND matched_retrieval_id IS NOT NULL
       AND attested_by IS NULL AND attested_at IS NULL AND attestation_note IS NULL
       AND declared_kind <> 'RESEARCH')
    OR
    (authenticity = 'ATTESTED' AND authenticity_method = 'ADMIN_ATTESTED'
       AND method IN ('UPLOADED', 'PASTED') AND origin_host IS NOT NULL
       AND matched_retrieval_id IS NULL
       AND attested_by IS NOT NULL AND attested_at IS NOT NULL
       AND attestation_note IS NOT NULL AND length(trim(attestation_note)) >= 10
       AND declared_kind <> 'RESEARCH')
    OR
    (authenticity = 'UNCONFIRMED' AND authenticity_method IS NULL
       AND method IN ('UPLOADED', 'PASTED')
       AND matched_retrieval_id IS NULL
       AND attested_by IS NULL AND attested_at IS NULL AND attestation_note IS NULL
       AND declared_kind <> 'RESEARCH')
    OR
    (authenticity = 'NOT_APPLICABLE' AND authenticity_method IS NULL
       AND matched_retrieval_id IS NULL
       AND attested_by IS NULL AND attested_at IS NULL AND attestation_note IS NULL
       AND declared_kind = 'RESEARCH')
  )
);
CREATE INDEX idx_source_retrievals_source ON recruitment_source_retrievals(source_id);
CREATE INDEX idx_source_retrievals_import ON recruitment_source_retrievals(import_id);

-- ── Claims: append-only statements about one field ─────────────────
CREATE TABLE recruitment_field_claims (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 BIGINT       GENERATED ALWAYS AS IDENTITY UNIQUE,  -- total order of claims (§5.2)
  recruitment_id      UUID         NOT NULL REFERENCES recruitments(id),
  field_path          VARCHAR(255) NOT NULL,       -- same paths as field_revisions; links as "links#APPLY_ONLINE"
  kind                VARCHAR(20)  NOT NULL CHECK (kind IN
                        ('EXTRACTED', 'ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_NOT_STATED', 'ADMIN_REVOKED')),
  value               JSONB,                       -- the value stated (EXTRACTED, ADMIN_VERIFIED)
  value_hash          CHAR(64),                    -- sha256 of canonical JSON of value; a consistency check only
  retrieval_id        UUID         REFERENCES recruitment_source_retrievals(id),  -- which document, as retrieved
  page                INTEGER      CHECK (page > 0),
  quote               TEXT,                        -- exact words, when a sentence matches
  table_cell          JSONB,                       -- {page, table, row, column, text} when only a table cell matches
  review_scope        JSONB,                       -- NOT_STATED: what was checked, e.g. {"pages": [1,2,3], "whole_document": true, "sections": ["Vacancies"]}
  field_revision_id   UUID         REFERENCES field_revisions(id), -- ADMIN_*: the exact revision this decision is about
  revokes_claim_id    UUID         REFERENCES recruitment_field_claims(id),
  justification       TEXT,                        -- admin-facing reason; required for NOT_APPLICABLE and NOT_STATED
  public_note         TEXT,                        -- NOT_STATED: optional words for the public page, e.g. "Vacancies will be notified later"
  import_id           UUID         REFERENCES recruitment_imports(import_id),
  claimed_by          UUID         REFERENCES admins(id),
  claimed_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- EXTRACTED claims come only from an import; ADMIN_* claims never do (they are not written by the importer)
  CHECK ((kind = 'EXTRACTED') = (import_id IS NOT NULL)),
  CHECK (kind <> 'EXTRACTED' OR (retrieval_id IS NOT NULL AND value IS NOT NULL)),
  CHECK (kind = 'EXTRACTED' OR claimed_by IS NOT NULL),
  -- (page is required for PDF sources by trigger; web pages have no pages, so the quote carries it)
  CHECK (kind <> 'ADMIN_VERIFIED' OR (retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL
                                      AND value IS NOT NULL
                                      AND (quote IS NOT NULL OR table_cell IS NOT NULL))),
  -- Not applicable: the document must say so, in words or a table cell
  CHECK (kind <> 'ADMIN_NOT_APPLICABLE' OR (retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL
                                            AND (quote IS NOT NULL OR table_cell IS NOT NULL)
                                            AND length(trim(coalesce(justification, ''))) >= 10)),
  -- Not stated: the admin records which document and which part of it was read
  CHECK (kind <> 'ADMIN_NOT_STATED' OR (retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL
                                        AND review_scope IS NOT NULL
                                        AND (coalesce(review_scope->>'whole_document', '') = 'true'
                                             OR coalesce(jsonb_typeof(review_scope->'pages') = 'array'
                                                         AND jsonb_array_length(review_scope->'pages') > 0, false)
                                             OR coalesce(jsonb_typeof(review_scope->'sections') = 'array'
                                                         AND jsonb_array_length(review_scope->'sections') > 0, false))
                                        AND length(trim(coalesce(justification, ''))) >= 10)),
  CHECK (public_note IS NULL OR (kind = 'ADMIN_NOT_STATED' AND length(public_note) <= 160)),
  CHECK ((kind = 'ADMIN_REVOKED') = (revokes_claim_id IS NOT NULL)),
  -- §2: an extracted claim's retrieval belongs to the claim's import, and the
  -- import belongs to the claim's job (both enforced by the database)
  FOREIGN KEY (retrieval_id, import_id)   REFERENCES recruitment_source_retrievals(id, import_id),
  FOREIGN KEY (import_id, recruitment_id) REFERENCES recruitment_imports(import_id, recruitment_id)
);
CREATE INDEX idx_field_claims_lookup ON recruitment_field_claims(recruitment_id, field_path, seq DESC);
-- §5.2: a decision can be revoked once, even by two simultaneous requests
CREATE UNIQUE INDEX uq_field_claims_revoked_once ON recruitment_field_claims(revokes_claim_id)
  WHERE kind = 'ADMIN_REVOKED';

-- ── Supersession: a claim for one field replaces claims for the same field ──
CREATE TABLE recruitment_claim_supersessions (
  superseding_claim_id UUID        NOT NULL REFERENCES recruitment_field_claims(id),
  superseded_claim_id  UUID        NOT NULL REFERENCES recruitment_field_claims(id),
  decided_by           UUID        NOT NULL REFERENCES admins(id),
  decided_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (superseding_claim_id, superseded_claim_id),
  CHECK (superseding_claim_id <> superseded_claim_id)
);
```

**Triggers (database-enforced, not comments):**

| Table | Rule |
|---|---|
| `recruitment_field_claims`, `recruitment_claim_supersessions`, `recruitment_sources`, `recruitment_source_retrievals` | `BEFORE UPDATE OR DELETE` → raise. Corrections are new rows. |
| `recruitment_claim_supersessions` | `BEFORE INSERT`: both claims must be EXTRACTED, same `recruitment_id`, same `field_path`. |
| `recruitment_field_claims` | `BEFORE INSERT` for every ADMIN_* claim with a retrieval: the retrieval's import has `recruitment_id` equal to the claim's (the composite keys cover EXTRACTED claims; this covers decisions, which carry no `import_id`). For ADMIN_REVOKED: the revoked claim is an ADMIN_* claim (not EXTRACTED, not another revocation), same job, same field (the unique index makes "only once" hold under concurrency). For ADMIN_*: `field_revision_id` belongs to the same job and field. For ADMIN_VERIFIED, ADMIN_NOT_APPLICABLE and ADMIN_NOT_STATED: the retrieval's `authenticity` is CONFIRMED or ATTESTED and its `origin_role` is AUTHORITY or PARTNER; for ADMIN_NOT_STATED the role must be AUTHORITY (a partner page being silent proves nothing about the notice). When the retrieval's source is a PDF, ADMIN_VERIFIED and ADMIN_NOT_APPLICABLE must give `page`; for a scanned PDF the admin reads the page number off the document. The field-to-purpose check is done in the verify route (§4). |
| `recruitment_source_retrievals` | `BEFORE INSERT` when `authenticity_method = 'HASH_MATCHES_SERVER_FETCH'`: the `matched_retrieval_id` row has the **same `source_id`**, `method = 'FETCHED'`, `authenticity_method = 'FETCHED_BY_SERVER'`, and the **same `origin_host`** as the new row. Anything else → raise. |
| `recruitment_imports` | `BEFORE UPDATE`: `import_id`, `proposal`, `mode`, `identity_key`, `org_year_key`, `base_revision`, `created_by`, `created_at` never change; `recruitment_id` only NULL→value, and only for `mode = 'NEW'`; status only PREVIEWED→APPLIED, PREVIEWED→DISCARDED, PREVIEWED→EXPIRED; `selected_items`, `duplicate_override`, `result`, `applied_*` set only together with →APPLIED. `BEFORE DELETE` → raise. |

### 2.1 No constraint may pass through NULL

PostgreSQL accepts a row when a CHECK evaluates to NULL. Every CHECK above is
written so it can only be TRUE or FALSE: combinations are listed explicitly
(the authenticity CHECK is the five complete, mutually exclusive cases), every
nullable column is tested with `IS [NOT] NULL` or wrapped in `coalesce(…, false)`,
and no CHECK compares a nullable expression with `=`. The acceptance tests try
every invalid combination, including each relevant column set to NULL.

Composite foreign keys use PostgreSQL's default MATCH SIMPLE: they are checked
when all their columns are set, which is exactly the EXTRACTED case (both
`import_id` and `retrieval_id` required by CHECK). Decisions have no
`import_id`, so the insert trigger checks their job instead.

### 2.2 The same document more than once

There is no uniqueness on (import, source). Each acquisition is its own
retrieval row with its own method, origin and authenticity: an admin's upload
(UNCONFIRMED or ATTESTED) and the server's fetch of the same file from the
official site (CONFIRMED) are two rows pointing at the one `recruitment_sources`
row, in the same import or in different ones. The upload may then be recorded
as CONFIRMED by hash match, pointing at the fetch row (trigger-checked).

When the preview extracts from a document that has several retrievals, each
EXTRACTED claim records the retrieval it relies on: the strongest one in the
order CONFIRMED > ATTESTED > UNCONFIRMED, and within that, an AUTHORITY host
before a PARTNER. The other retrievals stay recorded and visible.

### 2.3 Owner account

The site connects as the database owner, which can switch a trigger off or
bypass a check; the application never does. The triggers and constraints
protect against mistakes and bugs in our code, not against anyone using the
owner account directly (§10).

**Relationships:**

```
recruitments 1──< recruitment_imports
recruitment_imports 1──< recruitment_source_retrievals >──1 recruitment_sources
recruitments 1──< recruitment_field_claims >──0..1 recruitment_source_retrievals
recruitment_field_claims >──0..1 field_revisions (the existing table)
recruitment_field_claims 1──< recruitment_claim_supersessions (both columns)
recruitment_field_claims 0..1──< recruitment_field_claims (revokes_claim_id)
admins 1──< imports, retrievals, claims, supersessions
```

No `ON DELETE CASCADE`. Nothing here is read by public pages or placed in a
published snapshot; public pages keep reading `published_recruitments` only.

---

## 3. Import lifecycle, idempotency and duplicate jobs

```
            preview                     apply (one transaction)
 sources ──────────▶ PREVIEWED ──────────────────────────────▶ APPLIED
                         │ └─────── discard ─────────────────▶ DISCARDED
                         └──────── 7 days unused ────────────▶ EXPIRED
```

**Preview** (changes no job). The server reads each source, stores it (or finds
it by hash), records a retrieval, extracts candidates, classifies them and
compares them with the job. It stores the import with an immutable `proposal`:
every item has an id, the field, the proposed value, its claims (retrieval, page,
quote or cell) and its class. The admin ticks items.

**Apply** is one call: `cms_apply_import(import_id, admin_id, selected_item_ids, duplicate_override)`.
The browser sends ids only, never values.

Inside the function, in order:
1. Lock the import row (`FOR UPDATE`). `APPLIED` → return its stored `result`
   (retry or double click). Not `PREVIEWED` → raise.
2. Check `admin_id` exists in `admins`. Check every selected id is in `proposal`.
3. **EXISTING**: lock the job row (`FOR UPDATE`); `record_revision` ≠
   `base_revision` → raise `STALE`.
4. **NEW**: take the creation locks (below), then re-run **both** duplicate
   checks inside the transaction: same normalised notification number (when
   the import has one), and same organisation + year among non-archived jobs.
   A match → raise `DUPLICATE` with the matches, unless `duplicate_override`
   is present with a reason of at least 10 characters; the override is stored
   on the import and written as a `DUPLICATE_OVERRIDE` audit event. Two
   different imports of the same job therefore queue on the lock, and the
   second finds the first's job.

**Creation locks (shared by the importer and the manual "New job" route):**
- Every new job has an organisation and a year: the existing create route
  already refuses a job without them, and the import table requires
  `org_year_key` for NEW (CHECK). So **every** creation takes
  `pg_advisory_xact_lock(hashtextextended('job-org-year:' || org_year_key, 0))`.
  There is no creation without an effective lock.
- When a notification number is known, it also takes
  `pg_advisory_xact_lock(hashtextextended('job-id:' || identity_key, 0))`.
  With no number, this lock is skipped; the organisation + year lock and check
  still apply.
- Order is always organisation + year first, then notification number, so two
  creations can never wait on each other in a cycle.
- Transaction-level locks are released at commit or rollback; none can be left behind.
- Keys are normalised by one shared function (lower case, spaces and
  punctuation collapsed, as the existing duplicate detector does).

**How the manual route does it with the Neon driver.** The site's driver sends
HTTP requests; it cannot hold a transaction open between requests, but
`sql.transaction([...])` sends several statements that run as **one
transaction** (the local test database already behaves the same way). The
manual route becomes one batch:
1. `SELECT pg_advisory_xact_lock(…org-year…)`
2. `SELECT pg_advisory_xact_lock(…notification…)` (only when a number is given)
3. `INSERT INTO recruitments (…) SELECT … WHERE $force OR NOT EXISTS (<the existing duplicate conditions>) RETURNING id`
4. `INSERT INTO recruitment_audit_events … SELECT … FROM` the row inserted in 3,
   recording `DUPLICATE_OVERRIDE` with the reason when `$force` was used

Under PostgreSQL's default isolation each statement sees everything committed
before it starts, so statement 3 runs after the lock is held and sees a job
another request has just committed. If 3 inserts nothing, the route reads the
matches and returns the same duplicate warning the form shows today. The
form, its fields and "create anyway" are unchanged. A manual "create anyway"
is recorded as a `DUPLICATE_OVERRIDE` audit event with the admin, the time and
the matching jobs (no new reason box on the form; the importer's override does
require a reason, as it is a new screen).
5. Build the writes from the stored `proposal` for the selected ids (§10), write
   the job, one `field_revisions` row per changed field, the EXTRACTED claims
   (now linked to the job), any supersessions chosen in the preview, one
   `IMPORT_APPLIED` audit event, and mark the import `APPLIED` with `result`.
6. Any error → everything rolls back.

**Manual "New job" route (approved):** the existing create route takes the
same two advisory locks, through one shared helper, and re-runs its existing
duplicate check inside the same transaction as the insert. Nothing else in the
route or the form changes: the same fields, the same duplicate warning, the
same "create anyway". Its existing tests stay as they are, and new ones cover
two simultaneous manual creates and a manual create racing an import.

---

## 4. Provenance: four states, kept apart

| # | State | Question it answers | Set by | Stored in |
|---|---|---|---|---|
| 1 | Declared | What did the uploader say this is? | Uploader | `retrievals.declared_kind`, `version_label`, `document_date` |
| 2 | Authority | What may this host speak for, for this organisation? | Trusted-domain list | `retrievals.origin_role`, `origin_purposes` |
| 3 | Authenticity | Did this exact document really come from that host? | Server fetch, hash match, or recorded admin attestation | `retrievals.authenticity`, method, attestation |
| 4 | Field verified | Is this value correctly read from this document? | Admin, per field, per revision | `recruitment_field_claims` |

**Authenticity is about origin, not authority.** A PDF the server fetched itself
from `bfsissc.com` is CONFIRMED as coming from bfsissc.com, whatever bfsissc.com
may speak for.

**Authority is about purpose.** The trusted-domain list (a reviewed code file):

```
organization_id → [{ host, role: AUTHORITY | PARTNER, purposes }]
lic-hfl:
  lichousing.com, cdn.lichousing.com      AUTHORITY  {all}
  bfsissc.com, beep.bfsissc.com           PARTNER    {exam, fee_payment}
  nats.education.gov.in                   PARTNER    {application}
```

Every field has a purpose (`dates.applicationCloseDate` → application,
`financial.feeGeneral` → fee_payment, `dates.examDate` → exam, `eligibility`,
`age`, `vacancies.*` → recruitment_rules, which only AUTHORITY covers).

**A field may be verified from a retrieval only if:**
- its authenticity is CONFIRMED or ATTESTED, **and**
- its host's role covers the field's purpose (AUTHORITY, or PARTNER with that purpose).

So a genuine bfsissc.com document can verify the exam fee, never the age limit.
An UNCONFIRMED upload or research text can never verify anything. Research text
matching official wording proves only that the research text says it.

---

## 5. Field classes and verification

**Every admin decision is bound to the exact field revision.** ADMIN_VERIFIED,
ADMIN_NOT_APPLICABLE and ADMIN_NOT_STATED each store `field_revision_id`: the id
of the field's latest `field_revisions` row when the admin decided. A decision
counts only while that is still the field's latest revision. Any later write —
hand edit, Restore, AI Assist, corrigendum, import — creates a new revision and
the old decision stops counting, **even if the value is byte-identical to the
one that was verified**. `value_hash` is only a consistency check, never the test.

### 5.1 Recording a decision is guarded

The admin's screen sends the revision id and the current decision id it
showed. The route runs one `sql.transaction([...])` batch:
1. `SELECT pg_advisory_xact_lock(hashtextextended('field:' || recruitment_id || ':' || field_path, 0))`
2. the writes of §5.3 and the claim insert, each conditional on the field's
   latest revision and current decision still being the ones the screen showed.
If either changed, nothing is written: "the field changed while you were checking it".

### 5.2 Several decisions on one revision, and revocations

- Decisions on the same field are serialised by the field lock (§5.1), so two
  admins cannot record decisions from the same stale screen.
- If a revision nevertheless has several decisions (one replaced by another
  through a fresh screen), the **effective decision** is the one with the highest
  `seq` that is not revoked. `seq` is a database-generated sequence, strictly
  increasing, so the order is deterministic (timestamps can tie; `seq` cannot).
- A decision is revoked by an ADMIN_REVOKED claim pointing at it. The unique
  index `uq_field_claims_revoked_once` lets the database accept only one
  revocation per decision, however many requests arrive at once; the loser gets
  "already revoked". Revoking the effective decision makes the next-highest
  unrevoked decision effective, if any; otherwise the field falls back to its
  claim-based class.

### 5.3 Fields that were never saved

Creating a job writes no field history (checked in the code: the create route
inserts the job row only), so a field such as the title, or any empty field,
may have no `field_revisions` row at all. Therefore **every decision writes its
own field revision**, in the same transaction as the claim, through the
existing field-update builder (`routeFieldUpdate`), so history and validation
work exactly as for any other save:
- **NOT_APPLICABLE / NOT_STATED:** the field is saved as `NOT_SPECIFIED`
  (value null), reason "Recorded as not applicable/not stated: <justification>".
  This creates a revision even if the field was never saved before, and the
  claim references it. If the field held a value, that value is replaced and
  stays in history (Restore works as usual, and a restore unverifies).
- **VERIFIED:** the value does not change. A baseline revision is written
  (old value = new value, reason "Checked against <document, version>, p.<n>"),
  and the claim references it. This also gives fields that were never saved
  their first history row.
The revision id is generated by the route so the revision and the claim can
reference each other inside one batch; the record's `record_revision` check
(as in every save) refuses the batch if the job changed meanwhile.

Links: all links share the `links` revision, so any link change unverifies every
link claim. Strict on purpose.

| Class | Meaning |
|---|---|
| VERIFIED | Admin verified this revision against an eligible retrieval, page, quote or table cell |
| NOT_APPLICABLE | Admin recorded that the field does not exist for this job, citing the page and the words or table cell that say so ("No application fee is charged", p.3), with a justification |
| NOT_STATED | Admin recorded that the authoritative notice does not give it, naming the document and the pages or sections read, with a justification; may quote what the notice does say ("Vacancies will be notified later", p.1) |
| SUPPORTED | An eligible source states the current value; no person has verified it |
| RESEARCH_ONLY | Only research supports the current value |
| UNSUPPORTED | No claim backs the current revision (typed, restored, or differs from the sources) |
| CONFLICTING | Non-superseded claims disagree |
| LEGACY | Value existed before the job's first import and has no claim yet (§9) |
| MISSING | No value and no admin record |

Revocation: an ADMIN_REVOKED claim points at the exact decision it withdraws.
Nothing is ever edited or deleted.

**NOT_STATED and NOT_APPLICABLE are only ever deliberate admin decisions.**
The importer and the apply function never write them (constraint: ADMIN_*
claims cannot carry an `import_id`). A field the extraction did not find is
MISSING, never NOT_STATED. The admin records NOT_STATED from the field's
"Check before publishing" row: pick the authoritative document (only
CONFIRMED or ATTESTED retrievals from an AUTHORITY host are offered), tick
"I read the whole document" or list the pages and sections read, write the
reason, and optionally the public wording.

---

## 6. Conflicts

- Several sources in one import: candidates grouped per field; different values
  from non-superseded claims → CONFLICTING. Shown with source, declared kind,
  authority and authenticity, ordered corrigendum > notification > official page
  > research. **Nothing is ticked for the admin.**
- Importing into an existing job: a different current value is shown side by
  side; replacing it is an explicit tick, and replacing a value whose current
  revision is VERIFIED needs a second, separate tick.
- A conflict ends only when the admin verifies one value (§5) or records a
  supersession (§7). The losing claims remain in history.

---

## 7. Corrigenda and revised notices: per-field supersession

- A corrigendum is a source retrieved with `declared_kind = OFFICIAL_CORRIGENDUM`
  and its own `version_label` and `document_date`.
- Extraction from it proposes only the fields it states. Unmentioned fields are
  not in the preview, so their claims and decisions are untouched.
- For each field it changes, the preview proposes a supersession: this new claim
  replaces the earlier EXTRACTED claim(s) **for that field**. Applying writes one
  `recruitment_claim_supersessions` row per pair; the trigger refuses a pair from
  different fields or jobs. A document-level link is never used to infer anything.
- Notification A (last date, fees, vacancies, eligibility) + Corrigendum B (last
  date only) → only A's last-date claim is superseded; A's fee, vacancy and
  eligibility claims and their verifications stay valid.
- The changed field gets a new revision, so its old verification stops counting;
  it is flagged "changed by Corrigendum 1 — verify again".
- An unticked "Official update" entry is offered for the public update history.

---

## 8. Publish gate for imported jobs

Applies to a job with at least one APPLIED import. Every other job publishes
exactly as today. Enforced in the publish route (server); the checklist shows
the same list with links.

| Tier | Fields | Passes when | Blocks when |
|---|---|---|---|
| A — must be known | Last date to apply, eligibility, age limit, Apply Online link, official notification link | VERIFIED; NOT_APPLICABLE (cited, justified) | NOT_STATED, SUPPORTED, RESEARCH_ONLY, UNSUPPORTED, CONFLICTING, LEGACY, MISSING |
| B — may be honestly absent | Application opening date, fee-payment deadline, fees, total vacancies | VERIFIED; NOT_APPLICABLE; NOT_STATED (deliberate, scoped, justified — §5) | SUPPORTED, RESEARCH_ONLY, UNSUPPORTED, CONFLICTING, LEGACY, MISSING |

Why two tiers (approved): SSC CGL notices regularly say vacancies "will be
notified later". If NOT_STATED blocked every critical field, such jobs could
never be published, or an admin would be tempted to mark them "not
applicable". Tier B lets the honest answer through; Tier A never accepts "not
stated".

**On the public page**, a Tier B field recorded NOT_STATED shows "Not stated in
the official notification", followed by the admin's public wording when given
(for vacancies: "Vacancies will be notified later"). It is never shown as a
number, a blank or "not applicable". To do this, publishing an imported job
adds a `notStated` map (field → public wording) to the published snapshot, and
the job page reads it. This is the only addition to public page data; jobs
that were never imported publish the same snapshot as today.

The existing official-link gate still applies. Republishing re-checks the gate.
No automatic verification, approval or publishing anywhere. The kill switch does
not affect the gate: switching the importer off never releases an imported job.

---

## 9. Importing into an existing job

- Before the first import, the job's values have no claims. After it, the job is
  gated (§8), so every critical field without a current decision shows as
  LEGACY — including values marked VERIFIED under the old CMS. Nothing old is
  silently treated as verified.
- The preview says so before anything is applied: "This job will need N critical
  fields checked before it can be published again", listing them. Applying needs
  that acknowledgement ticked.
- After applying, the editor shows one "Check before publishing" list: each
  critical field, its class, and the sources offered for verifying it. Verifying
  a LEGACY value is the same one-step action as any other.
- A live job's public page does not change until it is republished, as today.

---

## 10. Function and route security

**What the database can and cannot guarantee here.** The site connects to
Neon as `neondb_owner`, the owner of every table. So:
- `SECURITY INVOKER` means the function runs with the caller's rights, and the
  caller is the owner. It gives **no** least-privilege isolation.
- `REVOKE EXECUTE ... FROM PUBLIC` is kept as hygiene only; it does not
  restrict the owner.
- The owner can disable triggers and bypass constraints. They protect against
  bugs and mistakes in our own code, not against misuse of the owner account.
- The real access control is the application: admin sign-in, origin check and
  kill switch on every route, before the function is ever called.
- A separate least-privilege application role would change this; it is outside
  this project unless separately proposed and approved.

**Function `cms_apply_import`:**
- `SECURITY INVOKER`; `SET search_path = pg_catalog, pg_temp` in its
  definition; every table and function reference inside is schema-qualified
  (`public.recruitments`, …), so objects created elsewhere cannot hijack it.
- Checks `admin_id` exists in `public.admins` (the route has already validated
  the admin's session; the function cannot see sessions).
- **Takes values only from the stored proposal.** It receives item ids; for each
  it reads the item from `recruitment_imports.proposal` (immutable by trigger)
  and writes that value. The TypeScript side computes and validates the full
  new record from the same stored proposal (existing `validateRecord`) and
  passes the resulting column values; the function compares every written field
  value with the proposal item and raises on any difference. A browser-supplied
  value can never reach the job.

**Every importer route:** `requireAdmin` + `validateOrigin` (as today) + the kill switch.
- Kill switch: Redis key `cms:importer:enabled` = `"1"`, read per request;
  missing, other value or Redis unreachable → off (404). Toggled on an admin page
  with confirmation; each toggle written to the admin audit log.
- URL fetches: http(s) only; private, loopback and link-local addresses refused,
  including after redirects.
- Inputs: PDF ≤ 4 MB, text ≤ 200,000 characters; stored text ≤ 1 MB per source.
- Pasted and research text stored and shown as plain text only.
- AI requests count toward the existing daily cap; without AI the preview still
  shows what the non-AI parts found.


---

## 11. Original PDF retention

Archived for every source: the extracted text with page markers, SHA-256 of the
original bytes, byte size, page count, and every address and time it was
retrieved from. The hash lets anyone later prove that a re-downloaded file is
the same document.

The original bytes are **not** kept (decided: no new storage service in this
project). **Limitation:** a hash cannot rebuild a file. If the official site
removes or replaces the PDF, the original cannot be retrieved again; we keep
its text, its fingerprint, and the record of where and when it was obtained.
Private PDF storage is a possible later enhancement, separately decided.

---

## 12. Decisions (taken on review of revision 2)

1. **Gate tiers:** Tier A + Tier B, approved (§8). NOT_STATED only as a
   deliberate admin decision after reviewing the authoritative notice (§5).
2. **Manual create lock:** approved; minimal change to the existing route,
   shared helper, regression tests (§3).
3. **PDF bytes:** text, SHA-256, size, page count, URL and retrieval records
   only; limitation documented (§11).
4. **Five tables:** approved (§2).

---

## 13. Migration and rollback

- One script, `scripts/cms-add-importer-tables.ts`: `--check` reports only; the
  run creates the five tables, indexes, triggers and the function
  (`IF NOT EXISTS` / `CREATE OR REPLACE`), then verifies every object (columns,
  types, nullability, constraints, triggers, the function's signature,
  `search_path` and `SECURITY INVOKER`) and fails loudly on any mismatch. No
  existing table, row or index is changed.
- Tested on PGlite, PostgreSQL 17 (two-connection concurrency) and PostgreSQL 18
  (migration, triggers, function), matching Neon's 18.6, before asking for
  production approval.
- Deploy order: confirm Neon's restore window → create a Neon branch as the
  recovery point and record the timestamp → run the migration (with your yes)
  → `--check` → deploy the code with the switch off → you switch it on.
- Rollback by severity:
  1. Importer misbehaves → switch off (instant). Old CMS unaffected.
  2. Code problem → redeploy the previous commit; new tables stay, unused.
  3. Bad imported values on a job → existing Restore in Change history; claims
     and imports stay for audit; restored values need fresh verification.
  4. Database-level problem from the migration (not expected; it only adds
     objects) → Neon point-in-time restore to the recorded timestamp, then
     redeploy the previous commit. Loses writes after that time, so the steps,
     who does them and the expected duration are written down and rehearsed on
     a throwaway Neon branch before the production migration is approved.
- Dropping the new tables is never part of a rollback and needs separate approval.

---

## 14. Acceptance tests

**Constraints under NULL (§2.1)**
- Every invalid authenticity combination refused, including: CONFIRMED with a
  NULL method; CONFIRMED by hash match with a NULL `matched_retrieval_id`;
  ATTESTED with a NULL `attested_by`, `attested_at` or note; UNCONFIRMED with a
  method; RESEARCH declared anything but NOT_APPLICABLE; a fetch recorded as
  UNCONFIRMED; an upload recorded as FETCHED_BY_SERVER.
- Each of the five valid combinations accepted.
- NOT_STATED with `review_scope` = `{}`, `{"pages": []}`, `{"pages": "1"}`,
  `{"whole_document": false}` → refused.
- NEW import with NULL or empty `org_year_key` → refused.

**Claim consistency (§2)**
- EXTRACTED claim whose retrieval belongs to another import → refused (composite key).
- EXTRACTED claim whose import belongs to another job → refused (composite key).
- Decision citing a retrieval from another job's import → refused (trigger).

**Retrievals (§2.2)**
- Upload and server fetch of the same PDF in one import → one source row, two
  retrieval rows, each with its own method and authenticity; claims use the fetch.

**Database, atomicity, concurrency**
- Migration creates exactly the declared objects; idempotent; `--check` catches
  each missing or altered column, constraint, trigger and the function (PGlite, PG17, PG18).
- Same import applied on two PG17 connections at once → one applies, the other
  returns the same result.
- **Two different imports of the same notification applied at once → one job;
  the other gets DUPLICATE.** Same for organisation + year.
- "Create anyway" with a reason → second job created, override stored and audited.
- Failure forced inside the function after the first write → nothing written,
  import still PREVIEWED.
- Edit between preview and apply → STALE. Retry after lost response → same result.
- Browser sends a selected id not in the proposal, or a modified value → refused.
- UPDATE or DELETE on claims, sources, retrievals, supersessions → refused by trigger.
- Import proposal edited after preview, or status moved backwards → refused.
- `identity_key`, `org_year_key` or `base_revision` changed after preview → refused;
  `recruitment_id` changed on an EXISTING import → refused.
- Two simultaneous manual "New job" creates of the same notification → one job,
  the other sees the duplicate warning; manual create racing an import → one job.
- Manual "New job" behaves exactly as before in every existing test.

**Verification binding**
- Verify 7 Nov → edit to 10 Nov → restore 7 Nov → **not verified** (new revision).
- Same with NOT_APPLICABLE and NOT_STATED.
- Verification recorded while someone else edits → refused ("field changed").
- Revoking a verification → field unverified; revocation points at the exact claim.
- Two simultaneous revocations of one decision → exactly one stored, the other
  "already revoked" (unique index), tested on two PG17 connections.
- Two decisions recorded from the same stale screen at once → one stored, the
  other "field changed" (field lock), on two PG17 connections.
- Decisions A then B on one revision → B effective; revoke B → A effective;
  revoke A → claim-based class.
- NOT_STATED on a field that was never saved → one new revision (NOT_SPECIFIED)
  and a claim referencing it, in one transaction; failure in either → neither.
- VERIFIED on a never-saved field (e.g. the title) → baseline revision with
  unchanged value, claim referencing it.
- Manual create with no notification number → organisation + year lock still
  taken; two such creates at once → one job, one duplicate warning.

**Provenance**
- Server-fetched bfsissc.com PDF → CONFIRMED; can verify exam fee; cannot verify age.
- Upload identical to a server fetch → CONFIRMED by hash match; one byte different → UNCONFIRMED.
- Hash match pointing at a retrieval of a different source, at an upload rather
  than a server fetch, or at a fetch from another host → refused by trigger.
- Blocked official site → ATTESTED with note and admin; verifiable; shown as attested.
- Research text with official wording → RESEARCH_ONLY; never verifiable.
- Blog URL declared official → UNLISTED host, cannot verify.
- Same PDF in two imports → one source row, two retrieval rows, both imports linked.
- `utm_*` stripped; destination unchanged. Table-cell claims carry page/row/column.
  Scanned PDF → page null, stated.

**Corrigenda and conflicts**
- Notification A + Corrigendum B (last date only) → only the last-date claim
  superseded; fee/vacancy/eligibility claims and verifications unchanged.
- Supersession pair across two fields → refused by trigger.
- Research 7 Nov vs PDF 8 Nov → CONFLICTING, nothing ticked.

**Gate**
- Tier A field NOT_STATED → publish refused. Tier B field NOT_STATED → allowed,
  public page says "Not stated in the official notification" plus the public
  wording when given ("Vacancies will be notified later").
- NOT_APPLICABLE without page, without quote or table cell, or without
  justification → refused at insert.
- NOT_STATED without a review scope, from a PARTNER host, or from an
  UNCONFIRMED or research retrieval → refused.
- A field the extraction did not find → MISSING, never NOT_STATED; no import
  ever writes an ADMIN_* claim.
- LEGACY fields after first import into an old job → refused until checked.
- Non-imported job → publishes exactly as today (existing tests unchanged).
- Importer switched off → imported jobs still gated.

**Switch and permissions**
- Switch off / missing / Redis down → every importer route 404; all old workflows pass.
- No session → 401; foreign origin → 403, on every importer route.

**Real notices on the local copy**
- SSC CGL, LIC HFL Apprentice, a UPSC exam, a BPSC notice, an interview-only job,
  a corrigendum. Every critical value compared with the PDF and the rendered page.
  Any wrong date, fee, eligibility rule or apply link is a blocker.

**Regression**
- Phase 0 baseline re-run after every step (31 CMS suites, 11 local-database
  suites, build, cache test 31/31, lint counts, known failures); nothing may get worse.
