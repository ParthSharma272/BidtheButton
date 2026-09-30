-- THE BUTTON — schema (SQLite)
-- Money is ALWAYS stored as integer minor units (paise). Never floats.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------- identity

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  -- `verified` is only ever set by an administrator after real verification.
  verified      INTEGER NOT NULL DEFAULT 0,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------- campaigns

-- `config_json`  = last APPROVED config. This is what the public page renders.
-- `draft_json`   = working copy in the studio. Never rendered publicly.
CREATE TABLE IF NOT EXISTS campaigns (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','pending_review','approved','rejected','suspended')),
  config_json     TEXT,
  draft_json      TEXT NOT NULL,
  review_note     TEXT,
  submitted_at    INTEGER,
  approved_at     INTEGER,
  approved_by     TEXT REFERENCES users(id),
  suspended_at    INTEGER,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- ---------------------------------------------------------------- ownership

-- Single-row table. `version` is the server-authoritative ownership version;
-- every quote records it and every activation re-checks it.
CREATE TABLE IF NOT EXISTS ownership_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  version            INTEGER NOT NULL,
  current_reign_id   TEXT REFERENCES reigns(id),
  last_amount_paise  INTEGER NOT NULL DEFAULT 0,
  takeover_count     INTEGER NOT NULL DEFAULT 0,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reigns (
  id                   TEXT PRIMARY KEY,
  ordinal              INTEGER NOT NULL,
  user_id              TEXT NOT NULL REFERENCES users(id),
  campaign_id          TEXT NOT NULL REFERENCES campaigns(id),
  -- Immutable snapshot of the approved config at activation time, so history and
  -- archived permalinks always show what visitors actually saw.
  config_snapshot_json TEXT NOT NULL,
  amount_paise         INTEGER NOT NULL,
  payment_id           TEXT,
  started_at           INTEGER NOT NULL,
  ended_at             INTEGER,
  ended_reason         TEXT,
  -- Set when an admin suspends the campaign; the public page falls back to a
  -- neutral platform screen but ownership and payment records are preserved.
  suspended            INTEGER NOT NULL DEFAULT 0,
  is_demo              INTEGER NOT NULL DEFAULT 0
);
-- At most one reign may be open at a time. `ended_at IS NULL` evaluates to 1 for
-- every open reign, so the unique index permits exactly one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_reign
  ON reigns((ended_at IS NULL)) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reigns_user ON reigns(user_id);
CREATE INDEX IF NOT EXISTS idx_reigns_started ON reigns(started_at DESC);

-- ---------------------------------------------------------------- purchasing

CREATE TABLE IF NOT EXISTS quotes (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id       TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  ownership_version INTEGER NOT NULL,
  min_amount_paise  INTEGER NOT NULL,
  amount_paise      INTEGER NOT NULL,
  fee_paise         INTEGER NOT NULL,
  tax_paise         INTEGER NOT NULL,
  total_paise       INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'INR',
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','consumed','stale','expired','cancelled')),
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);

-- Payment state machine. See src/server/payments/machine.ts for legal transitions.
CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  quote_id        TEXT NOT NULL REFERENCES quotes(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  campaign_id     TEXT NOT NULL REFERENCES campaigns(id),
  provider        TEXT NOT NULL,
  -- Provider's order id (what we create). provider_payment_ref is the provider's
  -- id for the actual charge, needed to refund it.
  provider_ref    TEXT,
  provider_payment_ref TEXT,
  amount_paise    INTEGER NOT NULL,
  total_paise     INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'INR',
  refund_attempts INTEGER NOT NULL DEFAULT 0,
  state           TEXT NOT NULL CHECK (state IN (
                    'created','processing','captured','settled',
                    'failed','voided','refund_pending','refunded'
                  )),
  failure_reason  TEXT,
  reign_id        TEXT REFERENCES reigns(id),
  is_demo         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  captured_at     INTEGER,
  settled_at      INTEGER,
  resolved_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_state ON payments(state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref
  ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- Webhook / provider callback log. `provider_event_id` is UNIQUE: that single
-- constraint is what makes webhook processing idempotent.
CREATE TABLE IF NOT EXISTS payment_events (
  id                TEXT PRIMARY KEY,
  payment_id        TEXT REFERENCES payments(id),
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  type              TEXT NOT NULL,
  payload_json      TEXT NOT NULL,
  outcome           TEXT NOT NULL,
  received_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_dedupe
  ON payment_events(provider, provider_event_id);

-- ---------------------------------------------------------------- analytics

-- Every event carries the reign_id the visitor ACTUALLY saw, so metrics stay
-- attributed to the campaign that was on screen even after a takeover.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN (
                'campaign_view','button_press','experience_view',
                'experience_time','outbound_click','video_start','video_complete'
              )),
  reign_id    TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  value       INTEGER,
  device      TEXT,
  referrer    TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_reign_type ON events(reign_id, type);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
-- Deduplication key: one row per (reign, client, type) inside a time bucket.
CREATE TABLE IF NOT EXISTS event_dedupe (
  key        TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Presence heartbeats. "Watching now" = distinct client_id with a recent
-- heartbeat and the page visible. client_id is shared across a browser's tabs.
CREATE TABLE IF NOT EXISTS presence (
  client_id  TEXT PRIMARY KEY,
  last_seen  INTEGER NOT NULL,
  visible    INTEGER NOT NULL DEFAULT 1,
  reign_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen);

-- Peak concurrent audience, sampled per reign.
CREATE TABLE IF NOT EXISTS presence_peaks (
  reign_id TEXT PRIMARY KEY,
  peak     INTEGER NOT NULL,
  peak_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------- trust

CREATE TABLE IF NOT EXISTS reports (
  id               TEXT PRIMARY KEY,
  reign_id         TEXT,
  campaign_id      TEXT NOT NULL REFERENCES campaigns(id),
  reporter_user_id TEXT REFERENCES users(id),
  reporter_client  TEXT,
  reason           TEXT NOT NULL,
  detail           TEXT,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','reviewing','actioned','dismissed')),
  resolution       TEXT,
  created_at       INTEGER NOT NULL,
  resolved_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  actor_user_id TEXT,
  action       TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  detail_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_log(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS uploads (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  rights_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Opt-in takeover notifications (optional feature A).
CREATE TABLE IF NOT EXISTS notification_subs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('lost_control','any_takeover')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
