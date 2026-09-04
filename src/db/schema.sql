CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT,
  webhook_secret TEXT,
  last_webhook_at TEXT,
  UNIQUE (owner, name)
);

CREATE TABLE IF NOT EXISTS repo_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL DEFAULT 0,
  forks INTEGER NOT NULL DEFAULT 0,
  watchers INTEGER NOT NULL DEFAULT 0,
  open_issues INTEGER NOT NULL DEFAULT 0,
  open_pull_requests INTEGER NOT NULL DEFAULT 0,
  language_breakdown TEXT NOT NULL DEFAULT '{}',
  size_kb INTEGER NOT NULL DEFAULT 0,
  default_branch TEXT NOT NULL DEFAULT 'main',
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_repo_snapshots_repo_id_captured_at
  ON repo_snapshots (repo_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  author_login TEXT,
  author_name TEXT,
  message TEXT,
  additions INTEGER,
  deletions INTEGER,
  committed_at TEXT,
  UNIQUE (repo_id, sha)
);

CREATE INDEX IF NOT EXISTS idx_commits_repo_id_committed_at
  ON commits (repo_id, committed_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_repo_id_detected_at
  ON events (repo_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS contributors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  login TEXT NOT NULL,
  avatar_url TEXT,
  contributions INTEGER NOT NULL DEFAULT 0,
  last_active_at TEXT,
  UNIQUE (repo_id, login)
);

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

CREATE TABLE IF NOT EXISTS github_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypted_token TEXT NOT NULL,
  iv TEXT NOT NULL,
  label TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  rate_limited_until TEXT
);
