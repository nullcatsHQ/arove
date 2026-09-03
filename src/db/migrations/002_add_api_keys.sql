CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash
  ON api_keys (key_hash);
