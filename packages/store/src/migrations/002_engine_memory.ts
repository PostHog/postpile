// Engine memory v2: event log with cursors, topic dossiers, facts with
// provenance, standing-rule proposals and agent call accounting.
// DESIGN.md "Engine memory (v2)" describes every table.

export const version = 2;

export const sql = `
-- Append-only log of first sightings. seq is the unit every cursor counts in.
-- AUTOINCREMENT so a seq is never reused, even after the last rows go away;
-- rows stay when the pr_event row is later dropped by a new snapshot.
CREATE TABLE event_log (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id  TEXT NOT NULL UNIQUE,
  pr_key    TEXT NOT NULL,
  logged_at TEXT NOT NULL
);
CREATE INDEX event_log_pr_key ON event_log (pr_key, seq);

-- Events that exist before this migration get seqs in time order.
INSERT INTO event_log (event_id, pr_key, logged_at)
  SELECT id, pr_key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM pr_event ORDER BY at, id;

-- digest:<topic> (what the dossier has read), seen:<topic> (what the user has
-- seen), consolidate:global (last consolidation run).
CREATE TABLE cursor (
  kind            TEXT NOT NULL,
  scope           TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  dossier_version INTEGER,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (kind, scope)
);

-- Every dossier version is kept, newest = highest version.
CREATE TABLE topic_dossier (
  topic_id    TEXT NOT NULL REFERENCES topic (id),
  version     INTEGER NOT NULL,
  json        TEXT NOT NULL,
  flags_json  TEXT NOT NULL DEFAULT '[]',
  input_hash  TEXT NOT NULL,
  through_seq INTEGER NOT NULL,
  model       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (topic_id, version)
);

-- Facts are never deleted. invalid_at / expired_at close them out;
-- stale_* is set by verify-before-use and cleared by a refresh.
CREATE TABLE fact (
  id             TEXT PRIMARY KEY,
  subject_kind   TEXT NOT NULL,
  subject_key    TEXT NOT NULL,
  predicate      TEXT NOT NULL,
  object_kind    TEXT,
  object_key     TEXT,
  text           TEXT NOT NULL,
  topic_id       TEXT,
  source         TEXT NOT NULL,
  valid_from     TEXT NOT NULL,
  invalid_at     TEXT,
  invalid_reason TEXT,
  superseded_by  TEXT,
  recorded_at    TEXT NOT NULL,
  expired_at     TEXT,
  stale_at       TEXT,
  stale_reason   TEXT,
  verified_at    TEXT
);
CREATE INDEX fact_subject ON fact (subject_kind, subject_key);
CREATE INDEX fact_object ON fact (object_kind, object_key);
CREATE INDEX fact_topic ON fact (topic_id);
CREATE INDEX fact_recorded_at ON fact (recorded_at);
CREATE INDEX fact_expired_at ON fact (expired_at);

-- Provenance. source_id is '' for kind pr so the primary key dedupes refs
-- when the same fact is confirmed again (NOOP).
CREATE TABLE fact_ref (
  fact_id   TEXT NOT NULL REFERENCES fact (id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  pr_key    TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  url       TEXT,
  at        TEXT NOT NULL,
  head_oid  TEXT,
  PRIMARY KEY (fact_id, kind, pr_key, source_id)
);
CREATE INDEX fact_ref_pr_key ON fact_ref (pr_key);

-- Standing rules distilled from repeated feedback. Accepted global rules go
-- into every prompt; accepted topic rules are appended to the tailoring.
CREATE TABLE rule_proposal (
  id            TEXT PRIMARY KEY,
  text          TEXT NOT NULL,
  topic_id      TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL,
  decided_at    TEXT
);

-- One row per runner call, for the sync report and cost over time.
CREATE TABLE agent_call (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  topic_id    TEXT,
  model       TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  attempt     INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL,
  cost_usd    REAL,
  at          TEXT NOT NULL
);
CREATE INDEX agent_call_run ON agent_call (run_id);
CREATE INDEX agent_call_kind_at ON agent_call (kind, at);

ALTER TABLE pr_glance ADD COLUMN dossier_version INTEGER;
`;
