// A PR's discussion as rows (2026-10-06, DESIGN.md "PR storage"; schema
// checked with Codex GPT-6.1): one `pr_comment` row per GitHub comment
// (issue comment, review body, inline comment), a `pr_thread` row per
// review thread and a `pr_review` row per review, children of the `pr`
// header. The snapshot json held every inline comment twice (in the flat
// list and in its thread) and every review body twice (on the review and as
// a comment); a row holds it once.
//
// DDL only: `ADD COLUMN` with a constant default and `CREATE TABLE` are
// instant at any size. The rows are filled in the background by the
// storage job discussion_rows, from the json, and by every upsert from
// this build on. Reads keep using the json until the job is complete
// (meta `rows_ready:discussion`); then the job snapshot_strip removes the
// three lists from the json.
//
// - `pr.rows_version`: which row model a PR's rows were written with,
//   cumulative (1: the discussion). Existing PRs start at 0.
// - `pr.mentioned_teams`: every "org/slug" the PR body or a comment
//   mentions (core `teamMentions`), JSON text, from the bodies as stored.
// - `pr_comment.ord` is the index in `Pr.comments`, NULL for an inline
//   comment only its thread holds; `thread_ord` the index in its thread.
//   The unique index keeps flat positions distinct (NULLs aside) and serves
//   the ordered read. `review_id` is the review an inline comment was
//   submitted with, NULL when not fetched (rows filled from older json).
// - `pr_review.own_body` NULL means the body is the kind 'review' comment
//   with the same id, identical text; any other body is stored here, ''
//   included.
// - `pr_comment` keeps rowids (bodies are large; body is the last column),
//   threads and reviews are small and WITHOUT ROWID.

export const version = 31;

export const sql = `
ALTER TABLE pr ADD COLUMN rows_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pr ADD COLUMN mentioned_teams TEXT NOT NULL DEFAULT '[]';

CREATE TABLE pr_comment (
  pr_key         TEXT    NOT NULL REFERENCES pr (key) ON DELETE CASCADE,
  id             TEXT    NOT NULL,
  kind           TEXT    NOT NULL CHECK (kind IN ('comment', 'review', 'review_comment')),
  ord            INTEGER CHECK (ord >= 0),
  author         TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  path           TEXT,
  thread_id      TEXT,
  thread_ord     INTEGER CHECK (thread_ord >= 0),
  review_id      TEXT,
  last_edited_at TEXT,
  editor         TEXT,
  updated_at     TEXT,
  viewer_reacted INTEGER CHECK (viewer_reacted IN (0, 1)),
  body           TEXT    NOT NULL,
  PRIMARY KEY (pr_key, id),
  CHECK (kind = 'review_comment' OR (path IS NULL AND thread_id IS NULL AND thread_ord IS NULL AND review_id IS NULL)),
  CHECK (thread_ord IS NULL OR thread_id IS NOT NULL),
  CHECK (ord IS NOT NULL OR thread_ord IS NOT NULL)
);
CREATE UNIQUE INDEX pr_comment_order ON pr_comment (pr_key, ord);

CREATE TABLE pr_thread (
  pr_key      TEXT    NOT NULL REFERENCES pr (key) ON DELETE CASCADE,
  id          TEXT    NOT NULL,
  ord         INTEGER NOT NULL CHECK (ord >= 0),
  path        TEXT    NOT NULL,
  is_resolved INTEGER NOT NULL CHECK (is_resolved IN (0, 1)),
  PRIMARY KEY (pr_key, id)
) WITHOUT ROWID;

CREATE TABLE pr_review (
  pr_key         TEXT    NOT NULL REFERENCES pr (key) ON DELETE CASCADE,
  id             TEXT    NOT NULL,
  ord            INTEGER NOT NULL CHECK (ord >= 0),
  author         TEXT    NOT NULL,
  state          TEXT    NOT NULL,
  submitted_at   TEXT    NOT NULL,
  commit_oid     TEXT,
  viewer_reacted INTEGER CHECK (viewer_reacted IN (0, 1)),
  own_body       TEXT,
  PRIMARY KEY (pr_key, id)
) WITHOUT ROWID;
`;
