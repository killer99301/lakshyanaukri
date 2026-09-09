-- ═══════════════════════════════════════════════════════════
-- LakshyaNaukri Admin Auth Schema
-- Run with: scripts/admin-setup.ts (safe to run repeatedly)
-- ═══════════════════════════════════════════════════════════

-- Admin accounts (expandable to multiple admins)
CREATE TABLE IF NOT EXISTS admins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     VARCHAR(64)  UNIQUE NOT NULL,
  email        VARCHAR(255) UNIQUE NOT NULL,
  phone        VARCHAR(32),
  password_hash TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Active and revoked sessions
CREATE TABLE IF NOT EXISTS admin_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID        NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash   TEXT        UNIQUE NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash
  ON admin_sessions(token_hash)
  WHERE revoked_at IS NULL;

-- OTP recovery transactions
CREATE TABLE IF NOT EXISTS recovery_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID         NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  otp_hash       TEXT         NOT NULL,
  channel        VARCHAR(10)  NOT NULL CHECK (channel IN ('email', 'sms')),
  attempts       SMALLINT     NOT NULL DEFAULT 0,
  resend_count   SMALLINT     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ  NOT NULL,
  used_at        TIMESTAMPTZ,
  superseded_at  TIMESTAMPTZ,
  ip             TEXT
);

-- Short-lived password reset tokens (issued after OTP verified)
CREATE TABLE IF NOT EXISTS recovery_reset_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID        NOT NULL REFERENCES recovery_transactions(id) ON DELETE CASCADE,
  admin_id       UUID        NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash     TEXT        UNIQUE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);

-- Emergency single-use recovery codes (10 generated at setup)
CREATE TABLE IF NOT EXISTS recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID        NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash  TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at    TIMESTAMPTZ
);

-- Audit log for all auth events
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID,
  event_type  VARCHAR(64) NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_created
  ON admin_audit_log(admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_event_created
  ON admin_audit_log(event_type, created_at DESC);
