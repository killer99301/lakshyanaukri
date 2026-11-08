-- ═══════════════════════════════════════════════════════════
-- Recruitment importer: imports, sources, retrievals, field claims,
-- claim supersessions; their triggers; the apply function.
-- ═══════════════════════════════════════════════════════════
--
-- Additive only: no existing table, row or index is changed.
-- Design: docs/importer-design.md (revision 4 and its final safeguards).
-- Applied to production by scripts/cms-add-importer-tables.ts, which runs
-- this whole file as one transaction. Safe to re-run: IF NOT EXISTS for
-- tables and indexes, CREATE OR REPLACE for functions, DROP TRIGGER IF EXISTS
-- before each CREATE TRIGGER.
--
-- The site connects as the database owner. The owner can disable triggers and
-- bypass checks; these rules guard against bugs in our own code, not against
-- misuse of the owner account (design §10).

-- ─── Imports ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recruitment_imports (
  import_id          UUID         PRIMARY KEY,
  mode               VARCHAR(10)  NOT NULL CHECK (mode IN ('NEW', 'EXISTING')),
  recruitment_id     UUID         REFERENCES recruitments(id),
  base_revision      VARCHAR(64),
  identity_key       TEXT,
  org_year_key       TEXT,
  status             VARCHAR(12)  NOT NULL DEFAULT 'PREVIEWED'
                     CHECK (status IN ('PREVIEWED', 'APPLIED', 'DISCARDED', 'EXPIRED')),
  proposal           JSONB        NOT NULL,
  selected_items     TEXT[],
  duplicate_override JSONB,
  result             JSONB,
  created_by         UUID         NOT NULL REFERENCES admins(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  applied_by         UUID         REFERENCES admins(id),
  applied_at         TIMESTAMPTZ,
  CHECK ((status = 'APPLIED') = (applied_at IS NOT NULL AND applied_by IS NOT NULL)),
  CHECK (mode = 'NEW' OR (recruitment_id IS NOT NULL AND base_revision IS NOT NULL)),
  CHECK (mode = 'EXISTING' OR (org_year_key IS NOT NULL AND length(org_year_key) > 0)),
  CHECK (identity_key IS NULL OR length(identity_key) > 0),
  CHECK (jsonb_typeof(proposal) = 'object' AND jsonb_typeof(proposal->'items') = 'array'),
  UNIQUE (import_id, recruitment_id)
);
CREATE INDEX IF NOT EXISTS idx_recruitment_imports_recruitment
  ON recruitment_imports(recruitment_id, created_at DESC);

-- ─── Sources: one row per distinct document or text ──────────

CREATE TABLE IF NOT EXISTS recruitment_sources (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  content_sha256  CHAR(64)     NOT NULL UNIQUE CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_kind    VARCHAR(8)   NOT NULL CHECK (content_kind IN ('PDF', 'HTML', 'TEXT', 'IMAGE')),
  byte_size       INTEGER      NOT NULL CHECK (byte_size > 0),
  page_count      INTEGER      CHECK (page_count IS NULL OR page_count > 0),
  text            TEXT         NOT NULL CHECK (length(text) <= 1048576),
  first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── Retrievals: each time a source was brought into an import ─

CREATE TABLE IF NOT EXISTS recruitment_source_retrievals (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id            UUID         NOT NULL REFERENCES recruitment_imports(import_id),
  source_id            UUID         NOT NULL REFERENCES recruitment_sources(id),
  declared_kind        VARCHAR(30)  NOT NULL CHECK (declared_kind IN
                         ('OFFICIAL_NOTIFICATION', 'OFFICIAL_CORRIGENDUM', 'OFFICIAL_PAGE', 'RESEARCH', 'OTHER')),
  version_label        TEXT,
  document_date        DATE,
  method               VARCHAR(10)  NOT NULL CHECK (method IN ('FETCHED', 'UPLOADED', 'PASTED')),
  origin_url           TEXT,
  origin_host          TEXT,
  origin_role          VARCHAR(10)  NOT NULL CHECK (origin_role IN ('AUTHORITY', 'PARTNER', 'UNLISTED', 'NONE')),
  origin_purposes      TEXT[]       NOT NULL DEFAULT '{}',
  authenticity         VARCHAR(14)  NOT NULL CHECK (authenticity IN
                         ('CONFIRMED', 'ATTESTED', 'UNCONFIRMED', 'NOT_APPLICABLE')),
  authenticity_method  VARCHAR(30)  CHECK (authenticity_method IN
                         ('FETCHED_BY_SERVER', 'HASH_MATCHES_SERVER_FETCH', 'ADMIN_ATTESTED')),
  matched_retrieval_id UUID         REFERENCES recruitment_source_retrievals(id),
  attested_by          UUID         REFERENCES admins(id),
  attested_at          TIMESTAMPTZ,
  attestation_note     TEXT,
  retrieved_by         UUID         NOT NULL REFERENCES admins(id),
  retrieved_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (id, import_id),
  -- Exactly one of five complete combinations. Every test is TRUE or FALSE, never NULL.
  CHECK (
    (authenticity = 'CONFIRMED' AND authenticity_method IS NOT NULL AND authenticity_method = 'FETCHED_BY_SERVER'
       AND method = 'FETCHED' AND origin_host IS NOT NULL
       AND matched_retrieval_id IS NULL
       AND attested_by IS NULL AND attested_at IS NULL AND attestation_note IS NULL
       AND declared_kind <> 'RESEARCH')
    OR
    (authenticity = 'CONFIRMED' AND authenticity_method IS NOT NULL AND authenticity_method = 'HASH_MATCHES_SERVER_FETCH'
       AND method = 'UPLOADED' AND origin_host IS NOT NULL
       AND matched_retrieval_id IS NOT NULL
       AND attested_by IS NULL AND attested_at IS NULL AND attestation_note IS NULL
       AND declared_kind <> 'RESEARCH')
    OR
    (authenticity = 'ATTESTED' AND authenticity_method IS NOT NULL AND authenticity_method = 'ADMIN_ATTESTED'
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
CREATE INDEX IF NOT EXISTS idx_source_retrievals_source ON recruitment_source_retrievals(source_id);
CREATE INDEX IF NOT EXISTS idx_source_retrievals_import ON recruitment_source_retrievals(import_id);

-- ─── Claims: append-only statements about one field ──────────

CREATE TABLE IF NOT EXISTS recruitment_field_claims (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 BIGINT       GENERATED ALWAYS AS IDENTITY UNIQUE,
  recruitment_id      UUID         NOT NULL REFERENCES recruitments(id),
  field_path          VARCHAR(255) NOT NULL CHECK (length(field_path) > 0),
  kind                VARCHAR(20)  NOT NULL CHECK (kind IN
                        ('EXTRACTED', 'ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_NOT_STATED', 'ADMIN_REVOKED')),
  value               JSONB,
  value_hash          CHAR(64)     CHECK (value_hash IS NULL OR value_hash ~ '^[0-9a-f]{64}$'),
  retrieval_id        UUID         REFERENCES recruitment_source_retrievals(id),
  page                INTEGER      CHECK (page IS NULL OR page > 0),
  quote               TEXT,
  table_cell          JSONB,
  review_scope        JSONB,
  field_revision_id   UUID         REFERENCES field_revisions(id),
  revokes_claim_id    UUID         REFERENCES recruitment_field_claims(id),
  justification       TEXT,
  public_note         TEXT,
  import_id           UUID         REFERENCES recruitment_imports(import_id),
  claimed_by          UUID         REFERENCES admins(id),
  claimed_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK ((kind = 'EXTRACTED') = (import_id IS NOT NULL)),
  CHECK (kind <> 'EXTRACTED' OR (retrieval_id IS NOT NULL AND value IS NOT NULL)),
  CHECK (kind = 'EXTRACTED' OR claimed_by IS NOT NULL),
  CHECK (kind <> 'ADMIN_VERIFIED' OR (retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL
                                      AND value IS NOT NULL
                                      AND (quote IS NOT NULL OR table_cell IS NOT NULL))),
  CHECK (kind <> 'ADMIN_NOT_APPLICABLE' OR (retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL
                                            AND (quote IS NOT NULL OR table_cell IS NOT NULL)
                                            AND length(trim(coalesce(justification, ''))) >= 10)),
  CHECK (kind <> 'ADMIN_NOT_STATED' OR (retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL
                                        AND review_scope IS NOT NULL
                                        AND (coalesce(review_scope->'whole_document' = 'true'::jsonb, false)
                                             OR coalesce(jsonb_typeof(review_scope->'pages') = 'array'
                                                         AND jsonb_array_length(review_scope->'pages') > 0, false)
                                             OR coalesce(jsonb_typeof(review_scope->'sections') = 'array'
                                                         AND jsonb_array_length(review_scope->'sections') > 0, false))
                                        AND length(trim(coalesce(justification, ''))) >= 10)),
  CHECK (public_note IS NULL OR (kind IN ('ADMIN_NOT_STATED', 'ADMIN_NOT_APPLICABLE') AND length(public_note) <= 160)),
  CHECK ((kind = 'ADMIN_REVOKED') = (revokes_claim_id IS NOT NULL)),
  FOREIGN KEY (retrieval_id, import_id)   REFERENCES recruitment_source_retrievals(id, import_id),
  FOREIGN KEY (import_id, recruitment_id) REFERENCES recruitment_imports(import_id, recruitment_id)
);
CREATE INDEX IF NOT EXISTS idx_field_claims_lookup
  ON recruitment_field_claims(recruitment_id, field_path, seq DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_claims_revoked_once
  ON recruitment_field_claims(revokes_claim_id) WHERE kind = 'ADMIN_REVOKED';

-- ─── Supersession: a claim for one field replaces claims for the same field ─

CREATE TABLE IF NOT EXISTS recruitment_claim_supersessions (
  superseding_claim_id UUID        NOT NULL REFERENCES recruitment_field_claims(id),
  superseded_claim_id  UUID        NOT NULL REFERENCES recruitment_field_claims(id),
  decided_by           UUID        NOT NULL REFERENCES admins(id),
  decided_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (superseding_claim_id, superseded_claim_id),
  CHECK (superseding_claim_id <> superseded_claim_id)
);

-- ─── Triggers ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cms_importer_refuse_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END
$fn$;

DROP TRIGGER IF EXISTS trg_field_claims_append_only ON recruitment_field_claims;
CREATE TRIGGER trg_field_claims_append_only BEFORE UPDATE OR DELETE ON recruitment_field_claims
  FOR EACH ROW EXECUTE FUNCTION public.cms_importer_refuse_change();
DROP TRIGGER IF EXISTS trg_supersessions_append_only ON recruitment_claim_supersessions;
CREATE TRIGGER trg_supersessions_append_only BEFORE UPDATE OR DELETE ON recruitment_claim_supersessions
  FOR EACH ROW EXECUTE FUNCTION public.cms_importer_refuse_change();
DROP TRIGGER IF EXISTS trg_sources_append_only ON recruitment_sources;
CREATE TRIGGER trg_sources_append_only BEFORE UPDATE OR DELETE ON recruitment_sources
  FOR EACH ROW EXECUTE FUNCTION public.cms_importer_refuse_change();
DROP TRIGGER IF EXISTS trg_retrievals_append_only ON recruitment_source_retrievals;
CREATE TRIGGER trg_retrievals_append_only BEFORE UPDATE OR DELETE ON recruitment_source_retrievals
  FOR EACH ROW EXECUTE FUNCTION public.cms_importer_refuse_change();

-- A hash match must point at a server fetch of the same document from the same host.
CREATE OR REPLACE FUNCTION public.cms_importer_check_retrieval() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE m public.recruitment_source_retrievals%ROWTYPE;
BEGIN
  IF NEW.authenticity_method = 'HASH_MATCHES_SERVER_FETCH' THEN
    SELECT * INTO m FROM public.recruitment_source_retrievals WHERE id = NEW.matched_retrieval_id;
    IF NOT FOUND
       OR m.source_id <> NEW.source_id
       OR m.method <> 'FETCHED'
       OR m.authenticity_method IS DISTINCT FROM 'FETCHED_BY_SERVER'
       OR m.origin_host IS DISTINCT FROM NEW.origin_host THEN
      RAISE EXCEPTION 'A hash match must refer to a server fetch of the same document from the same host'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_retrievals_check ON recruitment_source_retrievals;
CREATE TRIGGER trg_retrievals_check BEFORE INSERT ON recruitment_source_retrievals
  FOR EACH ROW EXECUTE FUNCTION public.cms_importer_check_retrieval();

-- Supersession pairs: both EXTRACTED, same job, same field.
CREATE OR REPLACE FUNCTION public.cms_importer_check_supersession() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE a public.recruitment_field_claims%ROWTYPE; b public.recruitment_field_claims%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.recruitment_field_claims WHERE id = NEW.superseding_claim_id;
  SELECT * INTO b FROM public.recruitment_field_claims WHERE id = NEW.superseded_claim_id;
  IF a.kind <> 'EXTRACTED' OR b.kind <> 'EXTRACTED'
     OR a.recruitment_id <> b.recruitment_id OR a.field_path <> b.field_path THEN
    RAISE EXCEPTION 'A supersession must pair two extracted claims for the same field of the same job'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_supersessions_check ON recruitment_claim_supersessions;
CREATE TRIGGER trg_supersessions_check BEFORE INSERT ON recruitment_claim_supersessions
  FOR EACH ROW EXECUTE FUNCTION public.cms_importer_check_supersession();

-- Decisions: same job as their evidence and revision; eligible evidence;
-- page for PDFs; revocations of an admin decision of the same field.
CREATE OR REPLACE FUNCTION public.cms_importer_check_claim() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE r public.recruitment_source_retrievals%ROWTYPE;
        imp_job UUID;
        kind_src TEXT;
        fr public.field_revisions%ROWTYPE;
        rev public.recruitment_field_claims%ROWTYPE;
BEGIN
  IF NEW.kind = 'EXTRACTED' THEN
    RETURN NEW;  -- covered by the composite foreign keys
  END IF;

  IF NEW.kind = 'ADMIN_REVOKED' THEN
    SELECT * INTO rev FROM public.recruitment_field_claims WHERE id = NEW.revokes_claim_id;
    IF NOT FOUND OR rev.kind NOT IN ('ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_NOT_STATED', 'ADMIN_NOT_YET_OPEN')
       OR rev.recruitment_id <> NEW.recruitment_id OR rev.field_path <> NEW.field_path THEN
      RAISE EXCEPTION 'Only an admin decision on the same field of the same job can be revoked'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- ADMIN_VERIFIED / ADMIN_NOT_APPLICABLE / ADMIN_NOT_STATED / ADMIN_NOT_YET_OPEN
  IF NEW.kind = 'ADMIN_NOT_YET_OPEN' AND NEW.field_path <> 'links#APPLY_ONLINE' THEN
    RAISE EXCEPTION 'Link not released yet is recorded on the Apply Online link only' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO fr FROM public.field_revisions WHERE id = NEW.field_revision_id;
  -- A link decision may cite a revision of the whole list ("links") or its own ("links#APPLY_ONLINE").
  IF NOT FOUND OR fr.recruitment_id <> NEW.recruitment_id
     OR fr.field_path NOT IN (NEW.field_path, split_part(NEW.field_path, '#', 1)) THEN
    RAISE EXCEPTION 'The decision must refer to a revision of the same field of the same job'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO r FROM public.recruitment_source_retrievals WHERE id = NEW.retrieval_id;
  SELECT recruitment_id INTO imp_job FROM public.recruitment_imports WHERE import_id = r.import_id;
  IF imp_job IS DISTINCT FROM NEW.recruitment_id THEN
    RAISE EXCEPTION 'The cited document was not brought in for this job' USING ERRCODE = 'P0001';
  END IF;
  IF r.authenticity NOT IN ('CONFIRMED', 'ATTESTED') OR r.origin_role NOT IN ('AUTHORITY', 'PARTNER') THEN
    RAISE EXCEPTION 'Only a confirmed or attested document from a listed host can support a decision'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind IN ('ADMIN_NOT_STATED', 'ADMIN_NOT_YET_OPEN') AND r.origin_role <> 'AUTHORITY' THEN
    RAISE EXCEPTION 'Not stated must be checked against the recruiting body''s own document'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT s.content_kind INTO kind_src FROM public.recruitment_sources s WHERE s.id = r.source_id;
  IF kind_src = 'PDF' AND NEW.kind IN ('ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_NOT_YET_OPEN') AND NEW.page IS NULL THEN
    RAISE EXCEPTION 'A page number is required when the document is a PDF' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_field_claims_check ON recruitment_field_claims;
CREATE TRIGGER trg_field_claims_check BEFORE INSERT ON recruitment_field_claims
  FOR EACH ROW EXECUTE FUNCTION public.cms_importer_check_claim();

-- Imports: keys and proposal immutable; status only moves forward from PREVIEWED.
CREATE OR REPLACE FUNCTION public.cms_importer_guard_import() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Imports are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.import_id <> OLD.import_id OR NEW.proposal <> OLD.proposal OR NEW.mode <> OLD.mode
     OR NEW.identity_key IS DISTINCT FROM OLD.identity_key
     OR NEW.org_year_key IS DISTINCT FROM OLD.org_year_key
     OR NEW.base_revision IS DISTINCT FROM OLD.base_revision
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'An import''s keys and proposal cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.recruitment_id IS DISTINCT FROM OLD.recruitment_id
     AND NOT (OLD.recruitment_id IS NULL AND OLD.mode = 'NEW' AND OLD.status = 'PREVIEWED') THEN
    RAISE EXCEPTION 'An import''s job can only be set once, for a new job' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'PREVIEWED' AND NEW.status IN ('APPLIED', 'DISCARDED', 'EXPIRED')) THEN
    RAISE EXCEPTION 'Import status cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.selected_items IS DISTINCT FROM OLD.selected_items
      OR NEW.duplicate_override IS DISTINCT FROM OLD.duplicate_override
      OR NEW.result IS DISTINCT FROM OLD.result
      OR NEW.applied_by IS DISTINCT FROM OLD.applied_by
      OR NEW.applied_at IS DISTINCT FROM OLD.applied_at)
     AND NOT (OLD.status = 'PREVIEWED' AND NEW.status = 'APPLIED') THEN
    RAISE EXCEPTION 'Selection and result are recorded only when the import is applied' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_imports_guard ON recruitment_imports;
CREATE TRIGGER trg_imports_guard BEFORE UPDATE OR DELETE ON recruitment_imports
  FOR EACH ROW EXECUTE FUNCTION public.cms_importer_guard_import();

-- ─── Duplicate check, shared by the importer and the manual "New job" route ─

-- Same rules as src/lib/cms/duplicate-detector.ts: a matching notification
-- number; or the same organisation and year where either side has no number.
CREATE OR REPLACE FUNCTION public.cms_job_duplicates(p_identity_key TEXT, p_org_id TEXT, p_year INTEGER)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'slug', r.slug, 'draftState', r.draft_state,
           'title', coalesce(r.title_text, ''),
           'reason', CASE WHEN p_identity_key IS NOT NULL
                          AND upper(regexp_replace(trim(coalesce(r.identity->'notificationNumber'->>'value', '')), '\s+', ' ', 'g')) = p_identity_key
                          THEN 'notification_number' ELSE 'org_year' END)
         ORDER BY r.updated_at DESC), '[]'::jsonb)
  FROM public.recruitments r
  WHERE r.draft_state <> 'ARCHIVED'
    AND (
      (p_identity_key IS NOT NULL
        AND upper(regexp_replace(trim(coalesce(r.identity->'notificationNumber'->>'value', '')), '\s+', ' ', 'g')) = p_identity_key)
      OR
      (r.organization_id = p_org_id
        AND (r.identity->>'recruitmentYear') = p_year::text
        AND (p_identity_key IS NULL
             OR trim(coalesce(r.identity->'notificationNumber'->>'value', '')) = ''))
    )
$fn$;

-- ─── Manual "New job": lock, check and insert in one call ─────
--
-- Used by the existing create route instead of its separate check and
-- insert, so two simultaneous creates (or a create racing an import) of the
-- same organisation and year cannot both pass the duplicate check. Returns
-- {"duplicates": [...]} without inserting when there are matches and p_force
-- is false; otherwise {"id": …}. The manual form has no notification number,
-- so only the organisation + year lock and rule apply, exactly as before.

CREATE OR REPLACE FUNCTION public.cms_create_job_checked(
  p_job JSONB, p_org_id TEXT, p_year INTEGER, p_force BOOLEAN, p_admin_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE dups JSONB; rid UUID;
BEGIN
  IF p_org_id IS NULL OR p_org_id = '' OR p_year IS NULL THEN
    RAISE EXCEPTION 'ORG_AND_YEAR_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('job-org-year:' || p_org_id || ':' || p_year::text, 0));
  dups := public.cms_job_duplicates(NULL, p_org_id, p_year);
  IF jsonb_array_length(dups) > 0 AND NOT coalesce(p_force, false) THEN
    RETURN jsonb_build_object('duplicates', dups);
  END IF;
  INSERT INTO public.recruitments (
    slug, identity, dates, vacancies, financial, eligibility, age, selection,
    exam_stages, how_to_apply, lifecycle, provenance, links, documents, updates,
    classification, organization_id, organization_name, title_text, gov_type,
    created_by, updated_by
  ) VALUES (
    p_job->>'slug', p_job->'identity', p_job->'dates', p_job->'vacancies', p_job->'financial',
    p_job->'eligibility', p_job->'age', p_job->'selection', p_job->'exam_stages', p_job->'how_to_apply',
    p_job->'lifecycle', p_job->'provenance', coalesce(p_job->'links', '[]'::jsonb),
    coalesce(p_job->'documents', '[]'::jsonb), coalesce(p_job->'updates', '[]'::jsonb),
    p_job->'classification', p_org_id, p_job->>'organization_name', p_job->>'title_text',
    p_job->>'gov_type', p_admin_id, p_admin_id
  ) RETURNING id INTO rid;
  IF jsonb_array_length(dups) > 0 THEN
    INSERT INTO public.recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
    VALUES (rid, p_admin_id, 'DUPLICATE_OVERRIDE', jsonb_build_object('via', 'manual', 'matches', dups));
  END IF;
  RETURN jsonb_build_object('id', rid);
END
$fn$;

-- ─── Job from an intelligence draft: lock, check and insert in one call ─
--
-- Used by the from-draft route instead of its separate checks and insert.
-- It locks the draft (promoting one draft twice at once makes one job), then
-- the organisation + year and, when the draft has one, the notification
-- number: the same locks, in the same order, as an import takes. Returns
-- {"existing": {id, slug}} when the draft was already promoted;
-- {"duplicates": [...]} without inserting when there are matches and p_force
-- is false; otherwise {"id": …}. The match rule is cms_job_duplicates, the
-- rule duplicate-detector.ts already used. p_org_id and p_year are the
-- draft's own values and may be NULL; the job's organisation comes from p_job.

CREATE OR REPLACE FUNCTION public.cms_create_job_from_draft(
  p_job JSONB, p_draft_id TEXT, p_org_id TEXT, p_year INTEGER, p_identity_key TEXT, p_force BOOLEAN, p_admin_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE dups JSONB; rid UUID; ex_id UUID; ex_slug TEXT;
BEGIN
  IF p_draft_id IS NULL OR p_draft_id = '' THEN
    RAISE EXCEPTION 'DRAFT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('job-draft:' || p_draft_id, 0));
  SELECT id, slug INTO ex_id, ex_slug FROM public.recruitments
    WHERE provenance->>'sourceDraftId' = p_draft_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('existing', jsonb_build_object('id', ex_id, 'slug', ex_slug));
  END IF;
  IF coalesce(p_org_id, '') <> '' AND p_year IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('job-org-year:' || p_org_id || ':' || p_year::text, 0));
  END IF;
  IF p_identity_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('job-id:' || p_identity_key, 0));
  END IF;
  dups := public.cms_job_duplicates(p_identity_key, nullif(p_org_id, ''), p_year);
  IF jsonb_array_length(dups) > 0 AND NOT coalesce(p_force, false) THEN
    RETURN jsonb_build_object('duplicates', dups);
  END IF;
  INSERT INTO public.recruitments (
    slug, identity, dates, vacancies, financial, eligibility, age, selection,
    exam_stages, how_to_apply, lifecycle, provenance, links, documents, updates,
    classification, organization_id, organization_name, title_text, gov_type,
    created_by, updated_by
  ) VALUES (
    p_job->>'slug', p_job->'identity', p_job->'dates', p_job->'vacancies', p_job->'financial',
    p_job->'eligibility', p_job->'age', p_job->'selection', p_job->'exam_stages', p_job->'how_to_apply',
    p_job->'lifecycle', p_job->'provenance', coalesce(p_job->'links', '[]'::jsonb),
    coalesce(p_job->'documents', '[]'::jsonb), coalesce(p_job->'updates', '[]'::jsonb),
    p_job->'classification', p_job->'identity'->>'organizationId', p_job->>'organization_name',
    p_job->>'title_text', p_job->>'gov_type', p_admin_id, p_admin_id
  ) RETURNING id INTO rid;
  IF jsonb_array_length(dups) > 0 THEN
    INSERT INTO public.recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
    VALUES (rid, p_admin_id, 'DUPLICATE_OVERRIDE',
            jsonb_build_object('via', 'from-draft', 'draftId', p_draft_id, 'matches', dups));
  END IF;
  RETURN jsonb_build_object('id', rid);
END
$fn$;

-- ─── Whether the new record holds a proposal item's value ─────

CREATE OR REPLACE FUNCTION public.cms_import_item_holds(p_record JSONB, p_item JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE path TEXT := p_item->>'fieldPath';
        ns TEXT := split_part(path, '.', 1);
        key TEXT := split_part(path, '.', 2);
        v JSONB := p_item->'value';
BEGIN
  IF p_item->>'kind' = 'LINK' THEN
    RETURN coalesce(p_record->'links' @> jsonb_build_array(jsonb_build_object('url', v->>'url', 'type', v->>'type')), false);
  END IF;
  RETURN coalesce(CASE
    WHEN ns IN ('identity', 'dates', 'financial') AND key <> '' THEN p_record->ns->key->'value' = v
    WHEN path IN ('vacancies.total', 'vacancies.breakdown', 'vacancies.table') THEN p_record->'vacancies'->key->'value' = v
    WHEN path IN ('eligibility', 'age', 'selection') THEN p_record->path->'value' = v
    WHEN path = 'examPattern' THEN p_record->'exam_pattern'->'value' = v
    WHEN path = 'syllabus' THEN p_record->'syllabus'->'value' = v
    WHEN path = 'howToApply' THEN p_record->'how_to_apply' = v
    WHEN path = 'examStages' THEN p_record->'exam_stages' = v
    WHEN path = 'conditions' THEN p_record->'conditions'->'items' = v
    WHEN path = 'classification' THEN p_record->'classification' @> v
    ELSE false
  END, false);
END
$fn$;

-- ─── Apply an import: one transaction ────────────────────────
--
-- The browser sends only the ids of the ticked proposal items. The server
-- builds the new record from the stored proposal and passes it as p_record
-- (column name → value); this function checks that every ticked item's value
-- is what the record will hold, then writes everything or nothing.

CREATE OR REPLACE FUNCTION public.cms_apply_import(
  p_import_id UUID, p_admin_id UUID, p_selected TEXT[], p_override JSONB, p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  imp        public.recruitment_imports%ROWTYPE;
  rec        JSONB := p_payload->'record';
  sel        TEXT;
  item       JSONB;
  rid        UUID;
  cur_rev    TEXT;
  dups       JSONB;
  org_id     TEXT;
  yr         INTEGER;
  rv         JSONB;
  cl         JSONB;
  sp         JSONB;
  rev_ids    JSONB := '[]'::jsonb;
  claim_ids  JSONB := '[]'::jsonb;
  out        JSONB;
BEGIN
  SELECT * INTO imp FROM public.recruitment_imports WHERE import_id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMPORT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF imp.status = 'APPLIED' THEN
    RETURN imp.result || jsonb_build_object('replayed', true);
  END IF;
  IF imp.status <> 'PREVIEWED' THEN
    RAISE EXCEPTION 'IMPORT_NOT_PREVIEWED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.admins WHERE id = p_admin_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  -- Nothing ticked is refused, unless the preview holds vacancy figures (counted by the server when it stored the
  -- preview, G1): saving keeps the sources and those figures with the job, to be added from its vacancy editor.
  IF (p_selected IS NULL OR cardinality(p_selected) = 0)
     AND coalesce(nullif(imp.proposal->'meta'->>'heldTables', '')::int, 0) = 0 THEN
    RAISE EXCEPTION 'NOTHING_SELECTED' USING ERRCODE = 'P0001';
  END IF;
  IF rec IS NULL OR jsonb_typeof(rec) <> 'object' THEN
    RAISE EXCEPTION 'NO_RECORD' USING ERRCODE = 'P0001';
  END IF;

  FOREACH sel IN ARRAY coalesce(p_selected, ARRAY[]::TEXT[]) LOOP
    item := NULL;
    SELECT i INTO item FROM jsonb_array_elements(imp.proposal->'items') AS i WHERE i->>'id' = sel;
    IF item IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_ITEM %', sel USING ERRCODE = 'P0001';
    END IF;
    IF NOT public.cms_import_item_holds(rec, item) THEN
      RAISE EXCEPTION 'ITEM_VALUE_MISMATCH %', sel USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF imp.mode = 'EXISTING' THEN
    SELECT record_revision INTO cur_rev FROM public.recruitments WHERE id = imp.recruitment_id FOR UPDATE;
    IF cur_rev IS DISTINCT FROM imp.base_revision THEN
      RAISE EXCEPTION 'STALE' USING ERRCODE = 'P0001';
    END IF;
    rid := imp.recruitment_id;
    UPDATE public.recruitments SET
      identity          = rec->'identity',
      dates             = rec->'dates',
      vacancies         = rec->'vacancies',
      eligibility       = rec->'eligibility',
      age               = rec->'age',
      financial         = rec->'financial',
      selection         = rec->'selection',
      exam_pattern      = rec->'exam_pattern',
      syllabus          = rec->'syllabus',
      how_to_apply      = rec->'how_to_apply',
      links             = rec->'links',
      exam_stages       = rec->'exam_stages',
      conditions        = rec->'conditions',
      classification    = rec->'classification',
      record_revision   = rec->>'record_revision',
      organization_name = rec->>'organization_name',
      title_text        = rec->>'title_text',
      gov_type          = rec->>'gov_type',
      updated_at        = now(),
      updated_by        = p_admin_id
    WHERE id = rid;
  ELSE
    org_id := split_part(imp.org_year_key, ':', 1);
    yr     := split_part(imp.org_year_key, ':', 2)::INTEGER;
    PERFORM pg_advisory_xact_lock(hashtextextended('job-org-year:' || imp.org_year_key, 0));
    IF imp.identity_key IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('job-id:' || imp.identity_key, 0));
    END IF;
    dups := public.cms_job_duplicates(imp.identity_key, org_id, yr);
    IF jsonb_array_length(dups) > 0
       AND (p_override IS NULL OR length(trim(coalesce(p_override->>'reason', ''))) < 10) THEN
      RAISE EXCEPTION 'DUPLICATE' USING ERRCODE = 'P0001', DETAIL = dups::text;
    END IF;
    INSERT INTO public.recruitments (
      slug, identity, dates, vacancies, financial, eligibility, age, selection,
      exam_pattern, syllabus, exam_stages, how_to_apply, lifecycle, provenance,
      links, documents, updates, classification, conditions, record_revision,
      organization_id, organization_name, title_text, gov_type, created_by, updated_by
    ) VALUES (
      rec->>'slug', rec->'identity', rec->'dates', rec->'vacancies', rec->'financial',
      rec->'eligibility', rec->'age', rec->'selection', rec->'exam_pattern', rec->'syllabus',
      rec->'exam_stages', rec->'how_to_apply', rec->'lifecycle', rec->'provenance',
      coalesce(rec->'links', '[]'::jsonb), coalesce(rec->'documents', '[]'::jsonb),
      coalesce(rec->'updates', '[]'::jsonb), rec->'classification', rec->'conditions', rec->>'record_revision',
      org_id, rec->>'organization_name', rec->>'title_text', rec->>'gov_type', p_admin_id, p_admin_id
    ) RETURNING id INTO rid;
    UPDATE public.recruitment_imports SET recruitment_id = rid WHERE import_id = p_import_id;
    IF jsonb_array_length(dups) > 0 THEN
      INSERT INTO public.recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
      VALUES (rid, p_admin_id, 'DUPLICATE_OVERRIDE',
              jsonb_build_object('via', 'import', 'importId', p_import_id, 'reason', p_override->>'reason', 'matches', dups));
    END IF;
  END IF;

  FOR rv IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'revisions', '[]'::jsonb)) LOOP
    INSERT INTO public.field_revisions (id, recruitment_id, field_path, revised_by, revised_at, old_value, new_value, reason)
    VALUES ((rv->>'id')::uuid, rid, rv->>'fieldPath', p_admin_id, now(), rv->'oldValue', rv->'newValue', rv->>'reason');
    rev_ids := rev_ids || to_jsonb(rv->>'id');
  END LOOP;

  FOR cl IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'claims', '[]'::jsonb)) LOOP
    INSERT INTO public.recruitment_field_claims
      (id, recruitment_id, field_path, kind, value, value_hash, retrieval_id, page, quote, table_cell, import_id)
    VALUES ((cl->>'id')::uuid, rid, cl->>'fieldPath', 'EXTRACTED', cl->'value', cl->>'valueHash',
            (cl->>'retrievalId')::uuid, (cl->>'page')::integer, cl->>'quote', cl->'tableCell', p_import_id);
    claim_ids := claim_ids || to_jsonb(cl->>'id');
  END LOOP;

  FOR sp IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'supersessions', '[]'::jsonb)) LOOP
    INSERT INTO public.recruitment_claim_supersessions (superseding_claim_id, superseded_claim_id, decided_by)
    VALUES ((sp->>'superseding')::uuid, (sp->>'superseded')::uuid, p_admin_id);
  END LOOP;

  out := jsonb_build_object('recruitmentId', rid, 'revisionIds', rev_ids, 'claimIds', claim_ids,
                            'selected', to_jsonb(p_selected));
  INSERT INTO public.recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
  VALUES (rid, p_admin_id, 'IMPORT_APPLIED', jsonb_build_object('importId', p_import_id) || out);

  UPDATE public.recruitment_imports SET
    status = 'APPLIED', selected_items = p_selected, duplicate_override = p_override,
    result = out, applied_by = p_admin_id, applied_at = now()
  WHERE import_id = p_import_id;

  RETURN out;
END
$fn$;

REVOKE ALL ON FUNCTION public.cms_apply_import(UUID, UUID, TEXT[], JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cms_create_job_checked(JSONB, TEXT, INTEGER, BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cms_create_job_from_draft(JSONB, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, UUID) FROM PUBLIC;

-- ─── Reading jobs (stage B2.3) ──────────────────────────────
-- A long document is read in steps of well under a minute, driven by the
-- importer page while it is open. Everything a step finishes is written
-- here before the step returns, so a closed tab, a refresh or a dropped
-- connection loses nothing. A task is taken with a lease; its result is
-- saved only by the step that still holds that lease.

CREATE TABLE IF NOT EXISTS recruitment_import_jobs (
  job_id      UUID         PRIMARY KEY,
  created_by  UUID         NOT NULL REFERENCES admins(id),
  mode        VARCHAR(10)  NOT NULL CHECK (mode IN ('NEW', 'EXISTING')),
  recruitment_id UUID      REFERENCES recruitments(id),
  new_job     JSONB,
  -- UPLOADING: pieces arriving; READING: steps take tasks; PAUSED: waits for the
  -- admin (paused, allowance used up, or failed tasks to retry or accept);
  -- FINISHING: one step builds the preview; DONE: preview stored.
  state       VARCHAR(10)  NOT NULL DEFAULT 'UPLOADING'
              CHECK (state IN ('UPLOADING', 'READING', 'PAUSED', 'FINISHING', 'DONE', 'CANCELLED', 'FAILED')),
  state_note  TEXT,
  sources     JSONB        NOT NULL,
  estimate    INTEGER,
  ai_sent     INTEGER      NOT NULL DEFAULT 0,
  ai_retried  INTEGER      NOT NULL DEFAULT 0,
  ai_failed   INTEGER      NOT NULL DEFAULT 0,
  -- Scanned pages written out (stage B2.4): the reading of their text is added once, after them.
  scan_reading_added BOOLEAN NOT NULL DEFAULT false,
  import_id   UUID         REFERENCES recruitment_imports(import_id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(sources) = 'array'),
  CHECK (mode = 'NEW' OR recruitment_id IS NOT NULL),
  CHECK ((state = 'DONE') = (import_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_owner ON recruitment_import_jobs(created_by, updated_at DESC);

-- One uploaded piece of a PDF: whole pages, numbered as in the original.
-- The server reads its text on arrival. The piece itself is kept only while
-- a page of it has no text (a scanned page still to be read from the image),
-- and dropped when the job ends, is cancelled or is abandoned.
CREATE TABLE IF NOT EXISTS recruitment_import_job_parts (
  job_id      UUID         NOT NULL REFERENCES recruitment_import_jobs(job_id) ON DELETE CASCADE,
  source_no   SMALLINT     NOT NULL,
  first_page  INTEGER      NOT NULL,
  last_page   INTEGER      NOT NULL,
  status      VARCHAR(8)   NOT NULL CHECK (status IN ('READ', 'FAILED')),
  reason      TEXT,
  sha256      CHAR(64),
  byte_size   INTEGER      NOT NULL DEFAULT 0,
  pdf_base64  TEXT,
  text        TEXT,
  no_text_pages INTEGER[]  NOT NULL DEFAULT '{}',
  uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, source_no, first_page),
  CHECK (first_page >= 1 AND last_page >= first_page),
  CHECK ((status = 'READ') = (text IS NOT NULL)),
  CHECK (status = 'READ' OR reason IS NOT NULL)
);

-- One unit of reading, well under a minute: a page batch, or one section reader.
CREATE TABLE IF NOT EXISTS recruitment_import_job_tasks (
  job_id      UUID         NOT NULL REFERENCES recruitment_import_jobs(job_id) ON DELETE CASCADE,
  task_no     INTEGER      NOT NULL,
  source_no   SMALLINT     NOT NULL,
  kind        VARCHAR(16)  NOT NULL CHECK (kind IN ('TEXT_BATCH', 'SECTION_AI', 'SECTION_DETAILS', 'SECTION_PATTERN', 'SCAN_PAGE')),
  first_page  INTEGER,
  last_page   INTEGER,
  -- SPLIT: an incomplete answer; its pages are read again in halves, as new tasks (B2.5).
  status      VARCHAR(8)   NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SPLIT')),
  attempts    INTEGER      NOT NULL DEFAULT 0,
  lease_owner UUID,
  lease_until TIMESTAMPTZ,
  result      JSONB,
  reason      TEXT,
  ai_requests INTEGER      NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, task_no),
  CHECK ((status = 'RUNNING') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (status <> 'DONE' OR result IS NOT NULL),
  CHECK (status <> 'FAILED' OR reason IS NOT NULL)
);

-- One scanned page (no text) as its own one-page PDF, split in the browser
-- (stage B2.4). The AI reads it as an image; the review shows it beside the
-- table read from it. Kept until the preview is saved or discarded (or 7
-- days), then dropped; dropped at once when the reading is cancelled.
CREATE TABLE IF NOT EXISTS recruitment_import_job_pages (
  job_id      UUID         NOT NULL REFERENCES recruitment_import_jobs(job_id) ON DELETE CASCADE,
  source_no   SMALLINT     NOT NULL,
  page        INTEGER      NOT NULL,
  status      VARCHAR(8)   NOT NULL CHECK (status IN ('UPLOADED', 'FAILED')),
  reason      TEXT,
  sha256      CHAR(64),
  byte_size   INTEGER      NOT NULL DEFAULT 0,
  pdf_base64  TEXT,
  uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, source_no, page),
  CHECK (page >= 1),
  CHECK (status = 'UPLOADED' OR reason IS NOT NULL)
);

-- "Link not released yet" (ADMIN_NOT_YET_OPEN, docs/apply-link-not-yet-open-design.md, revision 3).
-- Additive and re-runnable: the claim kind check and the public-note check (first created unnamed, inline)
-- are replaced by named ones that also allow the new kind, and the new kind's own rule is added. No row is
-- changed; every existing row passes the new checks (they only widen the old ones).
DO $mig$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'public.recruitment_field_claims'::regclass AND con.contype = 'c'
      -- the kind list (the only check naming both ADMIN_REVOKED and ADMIN_NOT_STATED), the public-note check, and this rule
      AND ((pg_get_constraintdef(con.oid) LIKE '%ADMIN_REVOKED%' AND pg_get_constraintdef(con.oid) LIKE '%ADMIN_NOT_STATED%'
            AND pg_get_constraintdef(con.oid) NOT LIKE '%revokes_claim_id%')
           OR pg_get_constraintdef(con.oid) LIKE '%public_note IS NULL%'
           OR con.conname = 'recruitment_field_claims_not_yet_open')
  LOOP
    EXECUTE format('ALTER TABLE public.recruitment_field_claims DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.recruitment_field_claims ADD CONSTRAINT recruitment_field_claims_kind_v2 CHECK (kind IN
    ('EXTRACTED', 'ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_NOT_STATED', 'ADMIN_NOT_YET_OPEN', 'ADMIN_REVOKED'));
  ALTER TABLE public.recruitment_field_claims ADD CONSTRAINT recruitment_field_claims_public_note_v2
    CHECK (public_note IS NULL OR (kind IN ('ADMIN_NOT_STATED', 'ADMIN_NOT_APPLICABLE') AND length(public_note) <= 160));
  ALTER TABLE public.recruitment_field_claims ADD CONSTRAINT recruitment_field_claims_not_yet_open CHECK (
    kind <> 'ADMIN_NOT_YET_OPEN' OR (
      field_path = 'links#APPLY_ONLINE' AND retrieval_id IS NOT NULL AND field_revision_id IS NOT NULL
      AND length(trim(coalesce(quote, ''))) > 0 AND value_hash IS NULL AND public_note IS NULL
      AND jsonb_typeof(value) = 'object' AND value->>'linkNotReleased' = 'true' AND value->>'reviewerConfirmed' = 'true'
      AND (coalesce(value->>'linkReleaseOn', '') <> '' OR coalesce(value->>'where', '') <> '')
      AND length(trim(coalesce(justification, ''))) >= 10));
END
$mig$;
