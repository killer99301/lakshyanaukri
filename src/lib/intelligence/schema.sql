-- ═══════════════════════════════════════════════════════════
-- LakshyaNaukri Intelligence Draft Schema
-- Applied by: scripts/intelligence-setup.ts (idempotent)
-- ═══════════════════════════════════════════════════════════

-- Latest live state of each intelligence draft.
-- snapshot contains the full RecruitmentIntelligenceDraft JSON.
CREATE TABLE IF NOT EXISTS intelligence_drafts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by       UUID        NOT NULL REFERENCES admins(id),
  updated_by       UUID        NOT NULL REFERENCES admins(id),
  status           VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('DRAFT', 'IN_REVIEW')),
  current_revision INT         NOT NULL DEFAULT 1,
  snapshot         JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intelligence_drafts_updated
  ON intelligence_drafts(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_drafts_status
  ON intelligence_drafts(status, updated_at DESC);

-- Immutable revision log.
-- Revision 1 = machine output (created at analysis time).
-- Revisions 2+ are created by explicit Save Review operations.
-- The UNIQUE constraint prevents duplicate revision numbers per draft.
CREATE TABLE IF NOT EXISTS intelligence_draft_revisions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id     UUID        NOT NULL REFERENCES intelligence_drafts(id) ON DELETE CASCADE,
  revision     INT         NOT NULL,
  saved_by     UUID        NOT NULL REFERENCES admins(id),
  snapshot     JSONB       NOT NULL,
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_intel_draft_revisions_draft_id
  ON intelligence_draft_revisions(draft_id, revision DESC);
