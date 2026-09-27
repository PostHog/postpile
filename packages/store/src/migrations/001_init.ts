// Migrations are TS modules holding SQL strings rather than .sql files, so the
// Electron bundle carries them without any file copying.

export const version = 1;

export const sql = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- GitHub notification threads. One per PR.
CREATE TABLE notification_thread (
  id           TEXT PRIMARY KEY,
  pr_key       TEXT,
  reason       TEXT NOT NULL,
  unread       INTEGER NOT NULL,
  updated_at   TEXT NOT NULL,
  last_read_at TEXT,
  subject_type TEXT NOT NULL,
  repo         TEXT NOT NULL,
  number       INTEGER,
  title        TEXT NOT NULL
);
CREATE INDEX notification_thread_pr_key ON notification_thread (pr_key);

-- Latest PR snapshot. The full normalized Pr lives in json; a few columns are
-- pulled out for queries (stacks by repo/refs, staleness by updated_at).
CREATE TABLE pr (
  key         TEXT PRIMARY KEY,
  repo        TEXT NOT NULL,
  number      INTEGER NOT NULL,
  state       TEXT NOT NULL,
  base_ref    TEXT NOT NULL,
  head_ref    TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  fetched_at  TEXT NOT NULL,
  json        TEXT NOT NULL
);
CREATE INDEX pr_repo ON pr (repo);

-- Event lines. seen_at and override_* are user/agent state that must survive
-- re-deriving events from a new snapshot, so upserts never touch them.
CREATE TABLE pr_event (
  id                TEXT PRIMARY KEY,
  pr_key            TEXT NOT NULL,
  kind              TEXT NOT NULL,
  actor             TEXT NOT NULL,
  is_bot            INTEGER NOT NULL,
  at                TEXT NOT NULL,
  summary           TEXT NOT NULL,
  url               TEXT,
  source_id         TEXT NOT NULL,
  rule_loudness     TEXT NOT NULL,
  rule_reason       TEXT NOT NULL,
  override_loudness TEXT,
  override_reason   TEXT,
  override_by       TEXT,
  seen_at           TEXT
);
CREATE INDEX pr_event_pr_key ON pr_event (pr_key, at);

CREATE TABLE user_pr_state (
  pr_key              TEXT PRIMARY KEY,
  approved_at         TEXT,
  approved_commit_oid TEXT,
  handled_at          TEXT
);

CREATE TABLE topic (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  summary            TEXT NOT NULL DEFAULT '',
  summary_input_hash TEXT,
  tailoring          TEXT NOT NULL DEFAULT '',
  driver             TEXT,
  user_role          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- A PR belongs to exactly one topic. It can still show up pulled in to tiles
-- elsewhere through sets.
CREATE TABLE topic_membership (
  pr_key      TEXT PRIMARY KEY,
  topic_id    TEXT NOT NULL REFERENCES topic (id),
  assigned_by TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX topic_membership_topic ON topic_membership (topic_id);

CREATE TABLE topic_proposal (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  topic_id      TEXT,
  name          TEXT,
  into_topic_id TEXT,
  pr_keys_json  TEXT NOT NULL DEFAULT '[]',
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL,
  decided_at    TEXT
);

CREATE TABLE pr_set (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL REFERENCES topic (id),
  title      TEXT NOT NULL,
  take       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  input_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX pr_set_topic ON pr_set (topic_id);

-- removed_at is set when the user said "not related"; the row stays as memory.
CREATE TABLE pr_set_member (
  set_id     TEXT NOT NULL REFERENCES pr_set (id) ON DELETE CASCADE,
  pr_key     TEXT NOT NULL,
  reason     TEXT NOT NULL,
  position   INTEGER NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (set_id, pr_key)
);

-- Latest glance per PR. Regenerated only when input_hash changes.
CREATE TABLE pr_glance (
  pr_key         TEXT PRIMARY KEY,
  verdict        TEXT NOT NULL,
  for_you        TEXT NOT NULL,
  does           TEXT NOT NULL,
  risk           TEXT NOT NULL,
  others_said    TEXT NOT NULL,
  pull_in_reason TEXT,
  input_hash     TEXT NOT NULL,
  model          TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE snooze (
  tile_id        TEXT PRIMARY KEY,
  condition_json TEXT NOT NULL,
  since          TEXT NOT NULL
);

CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  topic_id   TEXT,
  tile_id    TEXT,
  pr_key     TEXT,
  set_id     TEXT,
  event_id   TEXT,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX feedback_topic ON feedback (topic_id, created_at);

CREATE TABLE chat_message (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tile_id    TEXT NOT NULL,
  topic_id   TEXT NOT NULL,
  role       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX chat_message_tile ON chat_message (tile_id, id);
`;
