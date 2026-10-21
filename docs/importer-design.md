# Recruitment importer — Phase 1 design (for approval)

Status: DESIGN ONLY. Nothing here is implemented, migrated or deployed.
Branch: `feature/importer` (worktree `D:\LakshyaNaukri-importer`, from production `715e4e4`).

The importer is an addition to the existing CMS. The existing editor, AI Assist,
prepared-file parser, field save route, history, evidence, publishing, revert and
take-down stay as they are. Jobs that were never imported keep today's rules.

---

## 0. Words used below

| Term | Meaning |
|---|---|
| Import | One run of the importer for one job: sources in, preview out, then applied, discarded or expired. |
| Source | One document or text given to an import: an official PDF, a copied page, a corrigendum, or research text (ChatGPT, Claude, a portal). |
| Claim | One statement "field F has value V", with where it came from (source, page, quote or table cell) or who asserted it (an admin). Append-only. |
| Critical field | A value that can cost a candidate an application if wrong: last date, opening date, fee-payment deadline, application fees, age limit, eligibility, total vacancies, Apply Online link, official notification link. |

---

## 1. Schema (additive; no existing table is altered)

Three new tables and one function. The reviewed plan named two tables; a third
(`recruitment_field_claims`) is proposed because field-level provenance and
human verification need an append-only home of their own. Putting them inside
the job's JSON field blocks would mix them into values that are restored,
hashed and copied, and a value restore or manual edit could silently drop them.

```sql
-- One row per import. The primary key is the idempotency key.
CREATE TABLE recruitment_imports (
  import_id       UUID         PRIMARY KEY,                 -- generated at preview
  mode            VARCHAR(10)  NOT NULL CHECK (mode IN ('NEW', 'EXISTING')),
  recruitment_id  UUID         REFERENCES recruitments(id), -- set at preview for EXISTING, at apply for NEW
  base_revision   VARCHAR(64),                              -- record_revision the preview was computed on (EXISTING)
  status          VARCHAR(12)  NOT NULL DEFAULT 'PREVIEWED'
                  CHECK (status IN ('PREVIEWED', 'APPLIED', 'DISCARDED', 'EXPIRED')),
  proposal        JSONB        NOT NULL,                    -- the full preview shown to the admin
  selected        JSONB,                                    -- what the admin ticked
  result          JSONB,                                    -- what was written (field paths, revision ids)
  created_by      UUID         NOT NULL REFERENCES admins(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  applied_by      UUID         REFERENCES admins(id),
  applied_at      TIMESTAMPTZ,
  CHECK ((status = 'APPLIED') = (applied_at IS NOT NULL)),
  CHECK (mode = 'NEW' OR recruitment_id IS NOT NULL),
  CHECK (mode = 'NEW' OR base_revision IS NOT NULL)
);
CREATE INDEX idx_recruitment_imports_recruitment ON recruitment_imports(recruitment_id, created_at DESC);

-- One row per source document or text.
CREATE TABLE recruitment_sources (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id            UUID         NOT NULL REFERENCES recruitment_imports(import_id),
  recruitment_id       UUID         REFERENCES recruitments(id),  -- null until a NEW import is applied
  -- State 1: what the uploader says it is
  declared_kind        VARCHAR(30)  NOT NULL CHECK (declared_kind IN
                         ('OFFICIAL_NOTIFICATION', 'OFFICIAL_CORRIGENDUM', 'OFFICIAL_PAGE', 'RESEARCH', 'OTHER')),
  -- State 2: whether its address is trusted for this organisation, and for what
  origin_url           TEXT,
  origin_host          TEXT,
  origin_trust         VARCHAR(12)  NOT NULL CHECK (origin_trust IN ('TRUSTED', 'PARTNER', 'UNTRUSTED', 'NONE')),
  origin_purposes      TEXT[]       NOT NULL DEFAULT '{}',        -- e.g. {all} or {exam,fee_payment}
  -- State 3: whether this exact document is the genuine one
  authenticity         VARCHAR(14)  NOT NULL CHECK (authenticity IN
                         ('CONFIRMED', 'ATTESTED', 'UNCONFIRMED', 'NOT_APPLICABLE')),
  authenticity_method  VARCHAR(30)  CHECK (authenticity_method IN
                         ('FETCHED_FROM_TRUSTED_ORIGIN', 'HASH_MATCHES_FETCHED', 'ADMIN_ATTESTED')),
  attested_by          UUID         REFERENCES admins(id),
  attested_at          TIMESTAMPTZ,
  -- The document itself
  content_sha256       CHAR(64),                                  -- of the PDF bytes or the exact text
  byte_size            INTEGER,
  page_count           INTEGER,
  retrieved_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  retrieved_by         UUID         NOT NULL REFERENCES admins(id),
  text                 TEXT         NOT NULL,                     -- extracted text, page markers kept; capped at 1 MB
  -- Versions
  version_label        TEXT,                                      -- "Notification", "Corrigendum 1 dated 30 Oct 2026"
  document_date        DATE,
  supersedes_source_id UUID         REFERENCES recruitment_sources(id),
  CHECK ((authenticity = 'ATTESTED') = (attested_by IS NOT NULL AND attested_at IS NOT NULL)),
  CHECK (declared_kind <> 'RESEARCH' OR authenticity = 'NOT_APPLICABLE'),
  CHECK (supersedes_source_id IS NULL OR supersedes_source_id <> id)
);
CREATE INDEX idx_recruitment_sources_recruitment ON recruitment_sources(recruitment_id, document_date DESC);
-- The same document twice for the same job is recognised, not stored twice.
CREATE UNIQUE INDEX uq_recruitment_sources_doc ON recruitment_sources(recruitment_id, content_sha256)
  WHERE recruitment_id IS NOT NULL AND content_sha256 IS NOT NULL;

-- Append-only. Never UPDATE or DELETE.
CREATE TABLE recruitment_field_claims (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_id  UUID         NOT NULL REFERENCES recruitments(id),
  field_path      VARCHAR(255) NOT NULL,          -- same paths as field_revisions; links as "links#APPLY_ONLINE"
  kind            VARCHAR(20)  NOT NULL CHECK (kind IN
                    ('EXTRACTED', 'ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_REVOKED')),
  value           JSONB,                          -- the value claimed (null for NOT_APPLICABLE)
  value_hash      CHAR(64),                       -- sha256 of the canonical JSON of value
  source_id       UUID         REFERENCES recruitment_sources(id),
  page            INTEGER,                        -- PDF page, when the PDF has a text layer
  quote           TEXT,                           -- the exact words, when a sentence matches
  table_cell      JSONB,                          -- {page, table, row, column} when only a table cell matches
  import_id       UUID         REFERENCES recruitment_imports(import_id),
  claimed_by      UUID         REFERENCES admins(id),   -- the admin, for ADMIN_* kinds
  claimed_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  note            TEXT,
  CHECK (kind <> 'EXTRACTED' OR source_id IS NOT NULL),
  CHECK (kind NOT IN ('ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_REVOKED') OR claimed_by IS NOT NULL),
  CHECK (kind <> 'ADMIN_VERIFIED' OR (source_id IS NOT NULL AND value_hash IS NOT NULL)),
  CHECK (page IS NULL OR page > 0)
);
CREATE INDEX idx_field_claims_lookup ON recruitment_field_claims(recruitment_id, field_path, claimed_at DESC);
```

Relationships:

```
recruitments 1 ──< recruitment_imports   (recruitment_id; null until a NEW import is applied)
recruitment_imports 1 ──< recruitment_sources (import_id)
recruitments 1 ──< recruitment_sources   (recruitment_id)
recruitment_sources 1 ──< recruitment_sources (supersedes_source_id: a corrigendum supersedes a notification)
recruitments 1 ──< recruitment_field_claims
recruitment_sources 1 ──< recruitment_field_claims (source_id)
admins 1 ──< imports, sources, claims (who did what)
```

No ON DELETE CASCADE anywhere new: imports, sources and claims are history and
must not disappear with a record (records are never deleted in this CMS; take-down hides them).

Nothing from these tables is ever read by the public pages or put into a
published snapshot. Public pages keep reading `published_recruitments` only.

---

## 2. Import lifecycle and idempotency

```
            preview                apply (one transaction)
 (sources) ─────────▶ PREVIEWED ─────────────────────────▶ APPLIED
                         │  └─────── discard ────────────▶ DISCARDED
                         └────────── 7 days unused ──────▶ EXPIRED
```

1. **Preview** (no change to any job). The server reads every source, extracts
   candidates, classifies each source (sections 3 and 4), compares with the job's
   current values and stores the import (`PREVIEWED`) with its sources and the
   proposal. The admin sees the preview and ticks what to apply.
2. **Apply** runs `cms_apply_import(import_id, admin_id, payload)` — one
   PL/pgSQL function call, one transaction:
   - `SELECT … FROM recruitment_imports WHERE import_id = $1 FOR UPDATE` — locks the import row.
   - Already `APPLIED` → return the stored `result` (a retry or double click changes nothing).
   - Not `PREVIEWED` → raise.
   - `EXISTING`: `SELECT record_revision FROM recruitments WHERE id = … FOR UPDATE`;
     different from `base_revision` → raise `STALE` (someone edited since the preview; re-preview).
   - `NEW`: insert the job.
   - Write the new field values, one `field_revisions` row per changed field,
     the `EXTRACTED` claims, link the sources to the job, one `IMPORT_APPLIED`
     audit event, and mark the import `APPLIED` with its `result`.
   - Any error anywhere → the whole call rolls back. There is no half-applied state.
3. **Why a function and not chained statements.** The Neon HTTP driver the site uses
   runs one statement or one non-interactive batch per request; it cannot read a
   row, decide, and then write in the same transaction. A function can, and the
   row lock makes two simultaneous applies queue: the second sees `APPLIED` and
   returns the first one's result. The TypeScript side still does all content
   work (routing, validation with the existing `validateRecord`, building the
   revision rows) and hands the function a complete payload; the function only
   does the guarded write. It is the first function in this database, so it is
   called out here for review.
4. **New-job duplicates.** Preview runs the existing duplicate check
   (notification number, then organisation + year). The admin must choose
   "update the existing job" or "create anyway"; the function re-runs the
   notification-number check inside the transaction and raises if a matching
   job appeared since the preview.

---

## 3. The four provenance states

Kept in separate columns, set by different actors, never derived from each other.

| # | State | Set by | Values | Stored in |
|---|---|---|---|---|
| 1 | Declared kind | Uploader | official notification, corrigendum, official page, research, other | `sources.declared_kind` |
| 2 | Trusted origin | System, from the trusted-domain list | trusted (for purposes…), partner (for purposes…), untrusted, none | `sources.origin_trust`, `origin_purposes` |
| 3 | Document authenticity | System, or an explicit admin attestation | confirmed, attested, unconfirmed, not applicable | `sources.authenticity`, `authenticity_method`, `attested_by/at` |
| 4 | Field verified | Admin only, per field | verified against source S, page P (or not applicable) | `recruitment_field_claims` |

**Trusted-domain list** (code file, reviewed like any change):

```
organization_id → [{ host, role, purposes }]
lic-hfl:  lichousing.com (authority, all), cdn.lichousing.com (authority, all),
          bfsissc.com / beep.bfsissc.com (partner: exam, fee_payment),
          nats.education.gov.in (partner: application)
```
A partner is trusted only for its purposes: a fee figure on bfsissc.com can be
verified from it; an age limit cannot.

**Authenticity rules:**
- `CONFIRMED`: the server fetched the file itself from a `TRUSTED` origin, or the
  uploaded file's SHA-256 equals a file the server fetched from that origin.
- `ATTESTED`: the official site blocks the server (common for RRB, some state
  sites), so the admin declares "I downloaded this from <official URL> on <date>".
  Recorded with the admin and time. Shown as attested, never as confirmed.
- `UNCONFIRMED`: any other upload. Its claims are shown but cannot verify a field.
- `NOT_APPLICABLE`: research text. Its claims are shown as research and can never verify a field.

Research text never becomes official by matching wording: the word-for-word
check proves a value is in the research text, nothing more.

---

## 4. Field-level evidence and verification

For every field, the current value is classified from the claims:

| Class | Meaning | Blocks an imported job's publish? (critical fields) |
|---|---|---|
| VERIFIED | Latest admin verification matches the current value (same hash) | No |
| NOT_APPLICABLE | Admin recorded "not in the notice / does not apply" (e.g. no fee) | No |
| SUPPORTED | An official, confirmed or attested, origin-trusted source states this value, not yet verified by a person | **Yes**, until verified |
| RESEARCH_ONLY | Only research supports it | Yes |
| UNSUPPORTED | No claim backs the current value (typed by hand, restored, or source says something else) | Yes |
| CONFLICTING | Current, non-superseded sources disagree | Yes |
| MISSING | No value and no not-applicable record | Yes |

**Verifying a field** is one explicit action in the editor: pick the source
(only confirmed or attested, origin-trusted sources are offered), the page, and
confirm. It writes an `ADMIN_VERIFIED` claim with the admin, time, source id
(hence document and version), page, quote or table cell, and the value hash.

- **A manual edit never clears a requirement.** Verification is bound to the value
  hash; change the value and the field is no longer verified.
- Restoring an old value is a manual edit for this purpose.
- `ADMIN_REVOKED` withdraws a mistaken verification without deleting history.
- Table cells: when a fee or vacancy comes from a table and no sentence matches,
  the claim stores `{page, table, row, column}` and the cell text as `quote`.
- Page numbers come from the PDF's text layer (per-page extraction). Scanned PDFs
  read by the AI have page numbers only if the reader reports them; otherwise
  `page` is null and the claim says so. Never guessed.

**The existing `status` field is untouched.** Imported values are still saved as
Pending; the new classes live beside it. A field can only become VERIFIED in
the old sense through the existing rules (evidence ids); nothing in the importer
sets it.

---

## 5. Conflicts

- One import with several sources: candidates are grouped per field. Different
  values from non-superseded sources → CONFLICTING. The preview shows each value
  with its source, kind and authenticity, ordered corrigendum > notification >
  official page > research, but **nothing is ticked for the admin**.
- Import into an existing job: a different current value is shown side by side;
  applying it is an explicit tick. A current VERIFIED value needs a second,
  separate tick ("replace a verified value").
- Resolving a conflict is a verification: the admin verifies one value against
  one source. The other claims stay in history.

---

## 6. Corrigenda and revised notices

- A corrigendum is a source with `declared_kind = OFFICIAL_CORRIGENDUM`,
  `supersedes_source_id` = the notice it amends, and its own `document_date`.
- Extraction from a corrigendum proposes only the fields it actually states.
  Fields it does not mention are not in the preview at all, so nothing
  unrelated is touched.
- For a field the corrigendum states, claims from the superseded notice stop
  counting as conflicts (latest document wins for that field only).
- A changed field that was verified becomes unverified (value hash changed) and
  is flagged "changed by Corrigendum 1 — verify again".
- The preview offers, unticked, an "Official update" entry for the public update
  history (the existing announcement feature), e.g. "Last date extended to 8 Nov".
- A full revised notification is handled the same way, field by field.

---

## 7. The publish gate for imported jobs

- Applies to a job that has at least one `APPLIED` import. Every other job
  publishes exactly as today.
- At publish, every critical field must be VERIFIED or NOT_APPLICABLE. Otherwise
  the publish route refuses with the list of fields and their class, and the
  checklist shows the same list with links to each field.
- The existing official-link gate still applies on top.
- The gate is in the publish route (server), not only the checklist.
- Republishing an imported job re-checks the gate (a later edit may have
  unverified a field).
- No automatic verification, approval or publishing anywhere.

---

## 8. Security and permissions

- Every importer route: `requireAdmin` + `validateOrigin` (as today) + the kill switch.
- **Kill switch:** Redis key `cms:importer:enabled` = `"1"`, read on every request.
  Missing, any other value, or Redis unreachable → off (routes answer 404; the
  page shows "The importer is switched off"). Toggled on an admin page with a
  confirmation; each toggle is written to the admin audit log.
- The publish gate does not depend on the switch: switching the importer off never
  lets an imported job skip verification.
- Inputs: PDF up to 4 MB (as AI Assist), text up to 200,000 characters; stored
  text capped at 1 MB per source.
- URL fetching keeps the existing fetcher; fetches are refused for non-http(s)
  schemes and for private, loopback and link-local addresses, including after redirects.
- Pasted text and research are stored and shown as plain text only, never as HTML.
- AI requests count toward the existing daily cap; when it is reached, the preview
  still shows what the non-AI parts found.
- No secrets in any stored text are expected; the source text is admin-only and
  never reaches public pages, snapshots, Telegram or the sitemap.

---

## 9. Migration and rollback

- One script, `scripts/cms-add-importer-tables.ts`, in the style of the existing
  ones: `--check` reports only; the run creates the three tables, indexes and the
  function with `IF NOT EXISTS` / `CREATE OR REPLACE`, then verifies every object
  (columns, types, nullability, constraints, the function signature) and fails
  loudly on any mismatch. No existing table, row or index is changed.
- Tested on PGlite (unit and route tests), PostgreSQL 17 (the two-connection
  concurrency test) and **PostgreSQL 18** (the migration and the function), the
  last matching Neon's 18.6, before asking for production approval.
- Order at deploy: confirm Neon's restore window → create a Neon branch as the
  recovery point and note the timestamp → run the migration (with your yes) →
  `--check` → deploy the code with the kill switch off → you switch it on.
- **Rollback, by severity:**
  1. Importer misbehaves: switch it off (instant). Old CMS unaffected.
  2. Code problem: redeploy the previous commit (`715e4e4` or later). The new
     tables stay, unused and harmless.
  3. Bad imported data on a job: the existing Restore in Change history, field by
     field; claims and import history stay for audit.
  4. Database-level problem caused by the migration itself (not expected; it only
     adds objects): restore the production branch to the recorded timestamp using
     Neon's point-in-time restore, then redeploy the previous commit. This loses
     writes made after the timestamp, so the steps, who does them and how long it
     takes will be written down and rehearsed on a throwaway Neon branch before
     the production migration is approved.
- Dropping the new tables is never part of a rollback and needs your separate approval.

---

## 10. Acceptance tests

**Database and atomicity**
- Migration: creates exactly the declared objects; idempotent; `--check` detects
  each missing or wrong column, constraint and the function (PGlite, PG17, PG18).
- Two simultaneous applies of one import on two PG17 connections: one applies,
  the other returns the same result; exactly one job, one set of revisions.
- Failure forced inside the function after the first write → no job, no field,
  no revision, no claim, import still `PREVIEWED`.
- Apply after someone edited the job → `STALE`, nothing written.
- Retry after a lost response → same result, nothing duplicated.
- New-job duplicate appearing between preview and apply → refused.

**Provenance and extraction**
- A blog URL given as "official" → origin untrusted, authenticity unconfirmed, cannot verify.
- Research text quoting an "official" date → RESEARCH_ONLY, never verifiable.
- A partner domain used for an out-of-scope fact (age from bfsissc.com) → cannot verify.
- Uploaded PDF identical to the fetched official file → CONFIRMED; altered by one byte → UNCONFIRMED.
- Blocked official site → ATTESTED with the admin recorded; shown as attested.
- Syllabus present in research, absent from the PDF → flagged unsupported.
- `utm_*` stripped from links; destination unchanged.
- PDF with a fee table → table-cell claims with page numbers.
- Scanned PDF → page null, stated as unknown.

**Conflicts and corrigenda**
- Research says 7 Nov, PDF says 8 Nov → CONFLICTING, nothing ticked.
- Corrigendum changing only the last date → preview contains only that field;
  every other field byte-identical after apply; verified last date becomes unverified.
- Re-importing the same PDF → recognised as the same document.

**Publish gate**
- Imported job with a research-only last date → publish refused, field listed.
- After verifying it against the official PDF → allowed.
- Verified, then edited by hand → refused again.
- Restored old value → refused until verified.
- Not-applicable recorded for the fee → allowed.
- Non-imported job → publishes exactly as today (existing tests unchanged).
- Importer switched off → imported jobs still gated.

**Switch and permissions**
- Switch off, missing, or Redis down → every importer route 404; old workflows all pass.
- No session → 401; foreign origin → 403, on every importer route.

**Real notices (acceptance on the local copy)**
- SSC CGL (multi-tier), LIC HFL Apprentice, a UPSC exam, a BPSC notice, an
  interview-only job, a revised notice. Every critical value compared with the
  PDF and with the rendered page. Any wrong date, fee, eligibility rule or apply
  link is a blocker.

**Regression**
- The Phase 0 baseline (31 CMS suites, 11 local-database suites, build, cache
  test 31/31, lint counts, known failures) re-run after every step; nothing may get worse.
