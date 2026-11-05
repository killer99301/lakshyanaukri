-- ═══════════════════════════════════════════════════════════
-- CMS discovery leads: what the portal readers found (N1)
-- ═══════════════════════════════════════════════════════════
--
-- Research leads only. A lead is never a recruitment, never verified, never
-- published; nothing here changes a recruitments row. The collector
-- (collector.ts) writes leads and their sources; the admin's review status,
-- reason and notes are only ever written by the admin and are never changed
-- by a later collector run.
--
-- Two tables: one row per lead (one recruitment announcement, or one update
-- of a recruitment), and one row per place it was seen (portal, listing page,
-- link), so the same lead found again, or found on another portal, adds a
-- source and is not made again.
--
-- Additive only. Applied by scripts/cms-add-discovery-leads.ts, which runs
-- this file whole in one transaction; safe to re-run.

CREATE TABLE IF NOT EXISTS discovery_leads (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- kind : organisation (or "?") : "n:" notice number, or "u:" the first link's address.
  lead_key             TEXT         NOT NULL UNIQUE,
  kind                 VARCHAR(10)  NOT NULL CHECK (kind IN ('NEW', 'UPDATE')),
  title                TEXT         NOT NULL,
  -- NULL: the organisation was not recognised. Never guessed.
  organization_id      VARCHAR(255),
  organization_name    TEXT,
  notification_number  TEXT,
  status               VARCHAR(20)  NOT NULL DEFAULT 'NEW' CHECK (status IN
                         ('NEW', 'PROCESSING', 'READY_FOR_REVIEW', 'NEEDS_SOURCE', 'NEEDS_CORRECTION', 'DUPLICATE', 'DISMISSED')),
  status_reason        TEXT,
  notes                TEXT,
  status_changed_at    TIMESTAMPTZ,
  status_changed_by    UUID         REFERENCES admins(id),
  -- What the lead is to the CMS's jobs, worked out again on every run:
  --   DUPLICATE  same notice number as a job of the same organisation
  --   STRONG     same organisation and year, and the titles agree
  --   POSSIBLE   the titles agree, the organisation does not confirm it (review)
  --   NONE       no job like it
  --   UNRESOLVED organisation not recognised and no job like it
  match_kind           VARCHAR(10)  NOT NULL CHECK (match_kind IN ('DUPLICATE', 'STRONG', 'POSSIBLE', 'NONE', 'UNRESOLVED')),
  match_recruitment_id UUID         REFERENCES recruitments(id) ON DELETE SET NULL,
  match_reason         TEXT,
  match_confidence     NUMERIC(3, 2),
  -- Every job it may be: [{ id, title, kind, reason }].
  match_candidates     JSONB        NOT NULL DEFAULT '[]'::jsonb,
  -- Other leads it may be the same recruitment as, by title only, never merged: [{ leadId, reason }].
  related_leads        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  seen_runs            INTEGER      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_discovery_leads_status ON discovery_leads(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_leads_match ON discovery_leads(match_recruitment_id);

CREATE TABLE IF NOT EXISTS discovery_lead_sources (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id              UUID         NOT NULL REFERENCES discovery_leads(id) ON DELETE CASCADE,
  source_id            TEXT         NOT NULL,
  source_name          TEXT         NOT NULL,
  source_tier          SMALLINT     NOT NULL,
  -- The listing page or feed it was on, and the link itself.
  listing_url          TEXT         NOT NULL,
  item_url             TEXT         NOT NULL,
  item_fingerprint     TEXT         NOT NULL,
  pdf_url              TEXT,
  title_seen           TEXT         NOT NULL,
  nearby_date          TEXT,
  -- The link is on the recruiting body's own site (a listed host or a .gov.in site).
  official             BOOLEAN      NOT NULL DEFAULT false,
  first_seen_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  seen_runs            INTEGER      NOT NULL DEFAULT 1,
  UNIQUE (lead_id, item_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_discovery_lead_sources_fingerprint ON discovery_lead_sources(item_fingerprint);
