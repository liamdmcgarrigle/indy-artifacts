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

/**
 * Changes after the first release, applied in order and recorded in
 * PRAGMA user_version. SQLite cannot alter a CHECK constraint, so the two
 * tables whose constraints widen are rebuilt and their rows copied across.
 */
export const MIGRATIONS: string[] = [
  // 1: Indy. Organisation, visitors, accounts, sharing, forms and search.
  `
  CREATE TABLE comments_new (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
    author_kind TEXT NOT NULL CHECK (author_kind IN ('agent','human','visitor')),
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    anchor_json TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    sent_at TEXT,
    visitor_email TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  INSERT INTO comments_new (id, artifact_id, version_number, parent_id, author_kind, author_name, body,
    anchor_json, status, sent_at, created_at, updated_at)
    SELECT id, artifact_id, version_number, parent_id, author_kind, author_name, body,
      anchor_json, status, sent_at, created_at, updated_at FROM comments;
  DROP TABLE comments;
  ALTER TABLE comments_new RENAME TO comments;
  CREATE INDEX idx_comments_artifact ON comments (artifact_id, created_at);
  CREATE INDEX idx_comments_open ON comments (artifact_id, status, sent_at);

  CREATE TABLE events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    delivery_note TEXT
  ) STRICT;
  INSERT INTO events_new SELECT * FROM events;
  DROP TABLE events;
  ALTER TABLE events_new RENAME TO events;
  CREATE INDEX idx_events_undelivered ON events (delivered_at, id);

  ALTER TABLE artifacts ADD COLUMN series TEXT;
  ALTER TABLE artifacts ADD COLUMN pinned_at TEXT;
  ALTER TABLE artifacts ADD COLUMN archived_at TEXT;
  ALTER TABLE artifacts ADD COLUMN seen_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE artifacts ADD COLUMN seen_at TEXT;
  ALTER TABLE artifacts ADD COLUMN live_by TEXT;
  ALTER TABLE artifacts ADD COLUMN live_at TEXT;
  UPDATE artifacts SET seen_version = current_version, seen_at = updated_at;
  CREATE INDEX idx_artifacts_updated ON artifacts (updated_at DESC);

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    two_step INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE email_codes (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('sign_in','visitor')),
    subject TEXT NOT NULL,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  ) STRICT;

  CREATE TABLE share_links (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL CHECK (mode IN ('link','email')),
    allow_comments INTEGER NOT NULL DEFAULT 0,
    pinned_version INTEGER,
    expires_at TEXT,
    revoked_at TEXT,
    opens INTEGER NOT NULL DEFAULT 0,
    last_opened_at TEXT,
    last_opened_by TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX idx_share_links_artifact ON share_links (artifact_id);

  CREATE TABLE visitor_sessions (
    id_hash TEXT PRIMARY KEY,
    link_id TEXT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    email TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE responses (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    respondent_kind TEXT NOT NULL CHECK (respondent_kind IN ('owner','visitor')),
    email TEXT,
    link_id TEXT,
    data_json TEXT NOT NULL,
    files_json TEXT NOT NULL DEFAULT '[]',
    approved_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX idx_responses_artifact ON responses (artifact_id, created_at DESC);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE VIRTUAL TABLE search USING fts5(
    artifact_id UNINDEXED, title, description, body,
    tokenize = 'porter unicode61'
  );
  INSERT INTO search (artifact_id, title, description, body)
    SELECT a.id, a.title, COALESCE(a.description, ''), COALESCE(v.source, '')
      FROM artifacts a LEFT JOIN versions v ON v.artifact_id = a.id AND v.number = a.current_version;
  `,
  // 2: the git branch a page was written on, so a project's pages can be told apart by branch.
  `
  ALTER TABLE artifacts ADD COLUMN branch TEXT;
  CREATE INDEX artifacts_project_branch ON artifacts (project, branch);
  `,
];
