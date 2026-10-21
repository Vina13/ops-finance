-- Skema awal aplikasi klaim biaya Ops Sales.
-- Semua waktu disimpan sebagai ISO-8601 UTC (TEXT).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'sales')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- id = SHA-256 hex dari token di cookie; token mentahnya tidak pernah disimpan.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL,
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_api_tokens_user ON api_tokens (user_id);

CREATE TABLE claims (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id),
  title         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('transport', 'meal', 'lodging', 'entertainment', 'other')),
  expense_date  TEXT NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  currency      TEXT NOT NULL DEFAULT 'IDR',
  description   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'paid')),
  submitted_at  TEXT,
  decided_by    TEXT REFERENCES users (id),
  decided_at    TEXT,
  decision_note TEXT,
  paid_at       TEXT,
  created_by    TEXT NOT NULL REFERENCES users (id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_claims_user_status ON claims (user_id, status);
CREATE INDEX idx_claims_status_submitted ON claims (status, submitted_at);

CREATE TABLE claim_attachments (
  id           TEXT PRIMARY KEY,
  claim_id     TEXT NOT NULL REFERENCES claims (id),
  r2_key       TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  uploaded_by  TEXT NOT NULL REFERENCES users (id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_claim_attachments_claim ON claim_attachments (claim_id);

CREATE TABLE claim_events (
  id          TEXT PRIMARY KEY,
  claim_id    TEXT NOT NULL REFERENCES claims (id),
  actor_id    TEXT NOT NULL REFERENCES users (id),
  action      TEXT NOT NULL CHECK (action IN
                ('created', 'updated', 'submitted', 'approved', 'rejected', 'paid', 'deleted', 'attachment_added')),
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_claim_events_claim ON claim_events (claim_id, created_at);

-- Counter sederhana untuk membatasi percobaan login per email per jendela 15 menit.
CREATE TABLE login_attempts (
  email        TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (email, window_start)
);
