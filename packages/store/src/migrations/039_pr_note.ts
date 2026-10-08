// Agent notes on PRs (DESIGN.md "Agent notes on PRs"): short notes outside
// agents leave through note_pr, like "covered by the review on the parent
// PR" or "a session is on it". Advisory only: no rule reads them for whose
// move, unread or counts. Each row keeps the fingerprint of the PR state it
// was written against (anchor), so staleness is derived at read time.
//
// Two slots per PR: durable (covered, no_action) and lease (in_progress).
// A new note in a slot sets superseded_by on the old one; seq (not
// created_at) orders them. idempotency_key lets a retried request find the
// note it wrote; it is released (NULL) once that note is no longer current.

export const version = 39;

export const sql = `
CREATE TABLE pr_note (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  pr_key TEXT NOT NULL,
  slot TEXT NOT NULL,
  kind TEXT NOT NULL,
  by TEXT NOT NULL,
  client TEXT NOT NULL,
  note TEXT NOT NULL,
  covered_by_pr_key TEXT,
  anchor TEXT NOT NULL,
  cover_anchor TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  cleared_at TEXT,
  cleared_by TEXT,
  superseded_by TEXT,
  idempotency_key TEXT UNIQUE
);
CREATE INDEX pr_note_pr ON pr_note (pr_key, seq);
`;
