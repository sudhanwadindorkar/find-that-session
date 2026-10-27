export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  project_slug TEXT NOT NULL,
  session_id TEXT NOT NULL,
  cwd TEXT,
  title TEXT,
  first_user_message TEXT,
  identifiers TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  last_active_at TEXT,
  source TEXT NOT NULL DEFAULT 'cli',
  transcript_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_mtime_ms INTEGER NOT NULL DEFAULT 0,
  indexable_hash TEXT,
  embedded_hash TEXT,
  indexed_at TEXT,
  index_error TEXT,
  display_title TEXT,
  summary_json TEXT,
  enriched_mtime_ms INTEGER,
  enriched_at TEXT,
  enrich_error TEXT,
  archived_at TEXT,
  title_is_custom INTEGER NOT NULL DEFAULT 0,
  schema_id TEXT,
  PRIMARY KEY (project_slug, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_slug);
CREATE INDEX IF NOT EXISTS idx_sessions_embedded ON sessions(embedded_hash);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_slug TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY (project_slug, session_id)
    REFERENCES sessions(project_slug, session_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(project_slug, session_id, ordinal);

CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  text,
  title,
  cwd,
  project_slug UNINDEXED,
  session_id UNINDEXED,
  turn_id UNINDEXED,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS favorites (
  project_slug TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_slug, session_id),
  FOREIGN KEY (project_slug, session_id)
    REFERENCES sessions(project_slug, session_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS index_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lexical_status TEXT NOT NULL DEFAULT 'idle',
  embedding_status TEXT NOT NULL DEFAULT 'idle',
  lexical_done INTEGER NOT NULL DEFAULT 0,
  lexical_total INTEGER NOT NULL DEFAULT 0,
  embed_done INTEGER NOT NULL DEFAULT 0,
  embed_total INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_scan_at TEXT,
  message TEXT
);

INSERT OR IGNORE INTO index_state (id) VALUES (1);

CREATE TABLE IF NOT EXISTS embed_queue (
  project_slug TEXT NOT NULL,
  session_id TEXT NOT NULL,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_slug, session_id)
);

CREATE TABLE IF NOT EXISTS schema_drift (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fingerprint TEXT,
  report_json TEXT,
  reported_at TEXT,
  dismissed_fingerprint TEXT
);

INSERT OR IGNORE INTO schema_drift (id) VALUES (1);
`;
