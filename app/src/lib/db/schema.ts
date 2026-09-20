/**
 * The whole schema, applied on every open. Kept inline rather than read from a
 * .sql file so the standalone build cannot ship without it.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('markdown','react','svelte','html')),
  theme TEXT NOT NULL DEFAULT 'default',
  project TEXT,
  description TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  agent_name TEXT,
  terminal_handle TEXT,
  session_id TEXT,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('agent','human')),
  author_name TEXT NOT NULL,
  message TEXT,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  source TEXT,
  files_json TEXT,
  assets_json TEXT NOT NULL DEFAULT '[]',
  build_status TEXT NOT NULL DEFAULT 'none' CHECK (build_status IN ('none','ok','error')),
  build_log TEXT,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, number)
) STRICT;

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('agent','human')),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  anchor_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment.created','feedback.sent','version.created')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  delivery_note TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_versions_artifact ON versions (artifact_id, number DESC);
CREATE INDEX IF NOT EXISTS idx_comments_artifact ON comments (artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_open ON comments (artifact_id, status, sent_at);
CREATE INDEX IF NOT EXISTS idx_events_undelivered ON events (delivered_at, id);
`;
