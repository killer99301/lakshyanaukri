-- ═══════════════════════════════════════════════════════════
-- LakshyaNaukri Recruitment CMS Schema
-- Applied by: scripts/cms-setup.ts (idempotent)
-- See: docs/RECRUITMENT-CMS-ARCHITECTURE.md §17
-- ═══════════════════════════════════════════════════════════

-- ─── Recruitments ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recruitments (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     VARCHAR(255) UNIQUE NOT NULL,
  draft_state              VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                           CHECK (draft_state IN ('DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED')),
  record_revision          VARCHAR(64) NOT NULL DEFAULT '00000000',
  published_at             TIMESTAMPTZ,
  last_published_revision  VARCHAR(64),

  -- Domain blocks stored as JSONB
  -- Individual fields within each block carry their own ProvenanceField<T> wrapper
  identity                 JSONB       NOT NULL DEFAULT '{}',
  dates                    JSONB       NOT NULL DEFAULT '{}',
  vacancies                JSONB       NOT NULL DEFAULT '{}',
  eligibility              JSONB,             -- ProvenanceField<CmsRecruitmentPost[]>
  age                      JSONB,             -- ProvenanceField<AgeCriteria>
  financial                JSONB       NOT NULL DEFAULT '{}',
  selection                JSONB,             -- ProvenanceField<CmsSelectionInformation>
  how_to_apply             JSONB,             -- string[]
  links                    JSONB       NOT NULL DEFAULT '[]',
  documents                JSONB       NOT NULL DEFAULT '[]',
  lifecycle                JSONB       NOT NULL DEFAULT '{"status":"DRAFT","conflicts":[],"events":[]}',
  conditions               JSONB,
  provenance               JSONB       NOT NULL DEFAULT '{}',
  updates                  JSONB       NOT NULL DEFAULT '[]',

  -- Denormalized for filtering/search (extracted from identity JSONB)
  organization_id          VARCHAR(255) NOT NULL,
  organization_name        TEXT,
  title_text               TEXT,          -- identity.title.value for full-text search
  gov_type                 VARCHAR(20),

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by               UUID         REFERENCES admins(id),
  updated_by               UUID         REFERENCES admins(id)
);

CREATE INDEX IF NOT EXISTS idx_recruitments_org_id
  ON recruitments(organization_id);

CREATE INDEX IF NOT EXISTS idx_recruitments_draft_state
  ON recruitments(draft_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitments_slug
  ON recruitments(slug);

CREATE INDEX IF NOT EXISTS idx_recruitments_title_fts
  ON recruitments USING gin(to_tsvector('english', coalesce(title_text, '')));

-- ─── Evidence ────────────────────────────────────────────────
-- Answers: "where did this field value come from?"
-- Distinct from recruitment_documents which answers: "what should the candidate open?"

CREATE TABLE IF NOT EXISTS recruitment_evidence (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_id  UUID        NOT NULL REFERENCES recruitments(id) ON DELETE CASCADE,
  url             TEXT        NOT NULL,
  title           TEXT,
  source_type     VARCHAR(50) NOT NULL,
  authority_rank  SMALLINT    NOT NULL DEFAULT 5
                  CHECK (authority_rank BETWEEN 1 AND 10),
  fetched_at      TIMESTAMPTZ NOT NULL,
  excerpts        JSONB       NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_evidence_recruitment_id
  ON recruitment_evidence(recruitment_id);

-- ─── Field Revisions (append-only) ───────────────────────────
--
-- Every write through the writer creates a revision.
-- fieldPath uses dot-notation:
--   namespace fields:       "dates.applicationCloseDate"
--   ProvenanceField blocks: "eligibility", "age", "selection", "vacancies.breakdown"
--
-- Never UPDATE or DELETE rows in this table.

CREATE TABLE IF NOT EXISTS field_revisions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_id  UUID        NOT NULL REFERENCES recruitments(id) ON DELETE CASCADE,
  field_path      VARCHAR(255) NOT NULL,
  revised_by      UUID        NOT NULL REFERENCES admins(id),
  revised_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  old_value       JSONB,
  new_value       JSONB,
  reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_field_revisions_recruitment_id
  ON field_revisions(recruitment_id, revised_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_revisions_field_path
  ON field_revisions(recruitment_id, field_path, revised_at DESC);

-- ─── Lifecycle Events (append-only) ──────────────────────────
-- Factual records. Status is derived from them.
-- Never UPDATE or DELETE rows in this table.

CREATE TABLE IF NOT EXISTS recruitment_lifecycle_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_id  UUID        NOT NULL REFERENCES recruitments(id) ON DELETE CASCADE,
  event_type      VARCHAR(50) NOT NULL,
  certainty       VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED'
                  CHECK (certainty IN ('CONFIRMED', 'TENTATIVE', 'TBA', 'POSTPONED', 'CANCELLED')),
  official        BOOLEAN     NOT NULL DEFAULT false,
  evidence_id     UUID        REFERENCES recruitment_evidence(id),
  event_date      DATE,
  notes           TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by     UUID        REFERENCES admins(id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_recruitment_id
  ON recruitment_lifecycle_events(recruitment_id, recorded_at DESC);

-- ─── Published Recruitments ───────────────────────────────────
-- Stores the deterministic projection snapshot.
-- Never read from recruitments + project at serve time.
-- Serve this snapshot directly.

CREATE TABLE IF NOT EXISTS published_recruitments (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_id          UUID        NOT NULL REFERENCES recruitments(id),
  source_record_revision  VARCHAR(64) NOT NULL,
  projection_version      VARCHAR(20) NOT NULL DEFAULT '1.0',
  snapshot                JSONB       NOT NULL,
  published_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by            UUID        REFERENCES admins(id)
);

CREATE INDEX IF NOT EXISTS idx_published_recruitments_recruitment_id
  ON published_recruitments(recruitment_id, published_at DESC);

-- Fast lookup for most recent snapshot per recruitment
CREATE INDEX IF NOT EXISTS idx_published_recruitments_latest
  ON published_recruitments(recruitment_id, published_at DESC);

-- ─── Recruitment Audit Events ─────────────────────────────────
-- State transition audit trail (approved, published, archived, etc.)

CREATE TABLE IF NOT EXISTS recruitment_audit_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_id  UUID        NOT NULL REFERENCES recruitments(id),
  admin_id        UUID        REFERENCES admins(id),
  event_type      VARCHAR(64) NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_audit_events_recruitment_id
  ON recruitment_audit_events(recruitment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruitment_audit_events_event_type
  ON recruitment_audit_events(event_type, created_at DESC);
