# Recruitment importer — Phase 1 design, revision 2 (for approval)

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
  identity_key     TEXT,                                     -- normalised notification number, for NEW
  org_year_key     TEXT,                                     -- organisation id + year, for NEW
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
  CHECK (mode = 'NEW' OR (recruitment_id IS NOT NULL AND base_revision IS NOT NULL))
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
  UNIQUE (import_id, source_id),
  CHECK ((authenticity = 'CONFIRMED') = (authenticity_method IN ('FETCHED_BY_SERVER', 'HASH_MATCHES_SERVER_FETCH'))),
  CHECK ((authenticity = 'ATTESTED')  = (authenticity_method = 'ADMIN_ATTESTED' AND attested_by IS NOT NULL
                                         AND attested_at IS NOT NULL AND attestation_note IS NOT NULL)),
  CHECK ((authenticity_method = 'HASH_MATCHES_SERVER_FETCH') = (matched_retrieval_id IS NOT NULL)),
  CHECK (declared_kind <> 'RESEARCH' OR authenticity = 'NOT_APPLICABLE'),
  CHECK (authenticity <> 'CONFIRMED' OR origin_host IS NOT NULL)
);
CREATE INDEX idx_source_retrievals_source ON recruitment_source_retrievals(source_id);

-- ── Claims: append-only statements about one field ─────────────────
CREATE TABLE recruitment_field_claims (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
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
  field_revision_id   UUID         REFERENCES field_revisions(id), -- ADMIN_*: the exact revision this decision is about
  revokes_claim_id    UUID         REFERENCES recruitment_field_claims(id),
  justification       TEXT,                        -- required for NOT_APPLICABLE and NOT_STATED
  import_id           UUID         REFERENCES recruitment_imports(import_id),
  claimed_by          UUID         REFERENCES admins(id),
  claimed_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (kind <> 'EXTRACTED' OR (retrieval_id IS NOT NULL AND import_id IS NOT NULL AND value IS NOT NULL)),
  CHECK (kind = 'EXTRACTED' OR claimed_by IS NOT NULL),
  CHECK (kind <> 'ADMIN_VERIFIED' OR (retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL
                                      AND value IS NOT NULL AND (quote IS NOT NULL OR table_cell IS NOT NULL))),
  CHECK (kind NOT IN ('ADMIN_NOT_APPLICABLE', 'ADMIN_NOT_STATED')
         OR (retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL AND length(trim(justification)) >= 10)),
  CHECK ((kind = 'ADMIN_REVOKED') = (revokes_claim_id IS NOT NULL))
);
CREATE INDEX idx_field_claims_lookup ON recruitment_field_claims(recruitment_id, field_path, claimed_at DESC);

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
| `recruitment_field_claims` | `BEFORE INSERT` for ADMIN_REVOKED: the revoked claim is an ADMIN_* claim (not EXTRACTED, not another revocation), same job, same field, not already revoked. For ADMIN_*: `field_revision_id` belongs to the same job and field. |
| `recruitment_imports` | `BEFORE UPDATE`: `proposal`, `mode`, `created_*` never change; status only PREVIEWED→APPLIED, PREVIEWED→DISCARDED, PREVIEWED→EXPIRED; `recruitment_id` only NULL→value; `selected_items`, `duplicate_override`, `result`, `applied_*` set only together with →APPLIED. `BEFORE DELETE` → raise. |

The site connects as the database owner, which could switch a trigger off; the
application never does. The triggers protect against mistakes and bugs in our
code, not against someone holding the owner password (§10).

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
4. **NEW**: take transaction-level advisory locks on
   `hashtextextended('job-id:' || identity_key, 0)` and
   `hashtextextended('job-org-year:' || org_year_key, 0)`, always in that
   order (no deadlocks). Then re-run **both** duplicate checks inside the
   transaction: same normalised notification number, and same organisation +
   year among non-archived jobs. A match → raise `DUPLICATE` with the matches,
   unless `duplicate_override` is present with a reason of at least 10
   characters; the override is stored on the import and written as a
   `DUPLICATE_OVERRIDE` audit event. Two different imports of the same job
   therefore queue on the lock, and the second finds the first's job.
5. Build the writes from the stored `proposal` for the selected ids (§10), write
   the job, one `field_revisions` row per changed field, the EXTRACTED claims
   (now linked to the job), any supersessions chosen in the preview, one
   `IMPORT_APPLIED` audit event, and mark the import `APPLIED` with `result`.
6. Any error → everything rolls back.

**Known residual risk:** the existing manual "New job" form does not take the
advisory locks. A manual create racing an import of the same job at the same
second could still produce two records. Option: add the same two locks to the
existing create route (a small change to existing code; needs your approval).

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

Recording a decision is guarded: the admin's screen sends the revision id it
showed; the insert succeeds only if that is still the latest revision, otherwise
"the field changed while you were checking it".

Links: all links share the `links` revision, so any link change unverifies every
link claim. Strict on purpose.

| Class | Meaning |
|---|---|
| VERIFIED | Admin verified this revision against an eligible retrieval, page, quote or table cell |
| NOT_APPLICABLE | Admin recorded, with a cited source and justification, that the field does not exist for this job ("No application fee is charged", p.3) |
| NOT_STATED | Admin recorded, citing the document checked, that the notice does not give it ("Vacancies will be notified later", p.1) |
| SUPPORTED | An eligible source states the current value; no person has verified it |
| RESEARCH_ONLY | Only research supports the current value |
| UNSUPPORTED | No claim backs the current revision (typed, restored, or differs from the sources) |
| CONFLICTING | Non-superseded claims disagree |
| LEGACY | Value existed before the job's first import and has no claim yet (§9) |
| MISSING | No value and no admin record |

Revocation: an ADMIN_REVOKED claim points at the exact decision it withdraws.
Nothing is ever edited or deleted.

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
| B — may be honestly absent | Application opening date, fee-payment deadline, fees, total vacancies | VERIFIED; NOT_APPLICABLE; NOT_STATED (cited, justified, and shown publicly as "Not stated in the official notification") | SUPPORTED, RESEARCH_ONLY, UNSUPPORTED, CONFLICTING, LEGACY, MISSING |

Why two tiers: SSC CGL notices regularly say vacancies "will be notified
later". If NOT_STATED blocked every critical field, such jobs could never be
published, or an admin would be tempted to mark them "not applicable". Tier B
lets the honest answer through and tells candidates exactly that; Tier A never
accepts "not stated". (Decision requested — see §12.)

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

**Function `cms_apply_import`:**
- `SECURITY INVOKER` (runs with the caller's rights, never elevated).
- `SET search_path = pg_catalog, pg_temp` in its definition; every table and
  function reference inside is schema-qualified (`public.recruitments`, …).
- `REVOKE EXECUTE ... FROM PUBLIC`; granted to the application role only.
- Checks `admin_id` exists in `public.admins`.
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

**Database role:** the site connects as the database owner. A separate,
least-privilege application role would make the triggers and grants binding
even against bugs that try to disable them; that is a production change to
connection settings and is listed as an option, not part of this work.

---

## 11. Original PDF retention

Archived for every source: the extracted text with page markers, SHA-256 of the
original bytes, byte size, page count, and every address and time it was
retrieved from. The hash lets anyone later prove that a re-downloaded file is
the same document.

The original bytes are **not** kept by this design. Keeping them privately
needs storage the site does not have yet (no Vercel Blob store in production;
4 MB PDFs in the database would quickly fill Neon's storage). Options for
later, each a separate decision: a private Blob store, or a capped `bytea`
copy of notices only.

---

## 12. Decisions requested

1. **Gate tiers (§8):** Tier A / Tier B as above, or NOT_STATED blocks every critical field?
2. **Manual create lock (§3):** add the two advisory locks to the existing "New job" route?
3. **PDF bytes (§11):** text + hash only for now, or plan private storage?
4. **Five tables** instead of the three in revision 1 (sources split into
   documents and retrievals; supersessions in their own table). OK?

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

**Verification binding**
- Verify 7 Nov → edit to 10 Nov → restore 7 Nov → **not verified** (new revision).
- Same with NOT_APPLICABLE and NOT_STATED.
- Verification recorded while someone else edits → refused ("field changed").
- Revoking a verification → field unverified; revocation points at the exact claim.

**Provenance**
- Server-fetched bfsissc.com PDF → CONFIRMED; can verify exam fee; cannot verify age.
- Upload identical to a server fetch → CONFIRMED by hash match; one byte different → UNCONFIRMED.
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
  public page says "Not stated in the official notification".
- NOT_APPLICABLE without justification or source → refused at insert.
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
