// A PR's activity lists as rows (2026-10-06, DESIGN.md "PR storage"; the
// tables checked with Codex GPT-6.1): a `pr_commit` row per commit, a
// `pr_timeline` row per timeline item and a `pr_file` row per changed file,
// children of the `pr` header like the discussion rows (migration 031).
//
// DDL only: `CREATE TABLE` is instant at any size. The rows are filled in
// the background by the storage job activity_rows, from the json, and by
// every upsert from this build on (rows_version 2). Reads keep using the
// json until the job is complete (meta `rows_ready:activity`); then the job
// snapshot_strip_2 removes the three lists from the json.
//
// - `ord` is the index in the PR's list. Commits are not in time order:
//   older pages paged in go first, so the order is stored, never derived.
// - `pr_commit.committer` NULL means not recorded (snapshots stored before
//   it was fetched); it reads back as missing, which rules take as no
//   evidence. Commits stay per PR: a commit in two stacked PRs has a row in
//   each, so no PR's rows depend on another's.
// - `pr_timeline.subject` is the requested reviewer of a review request
//   (login or "org/slug"), NULL when GitHub gave none. No CHECK on `kind`:
//   the list of kinds grows, and a CHECK would need a table rebuild.
// - `pr_file` is keyed by path, GitHub's identity for a changed file: a
//   path twice is refused, never one copy kept. `ord` keeps GitHub's order,
//   which prompts read (the first N files).
// - All three are small rows, WITHOUT ROWID, keyed by `pr_key` first.

export const version = 33;

export const sql = `
CREATE TABLE pr_commit (
  pr_key       TEXT    NOT NULL REFERENCES pr (key) ON DELETE CASCADE,
  oid          TEXT    NOT NULL,
  ord          INTEGER NOT NULL CHECK (ord >= 0),
  headline     TEXT    NOT NULL,
  author       TEXT    NOT NULL,
  committer    TEXT,
  committed_at TEXT    NOT NULL,
  PRIMARY KEY (pr_key, oid)
) WITHOUT ROWID;

CREATE TABLE pr_timeline (
  pr_key  TEXT    NOT NULL REFERENCES pr (key) ON DELETE CASCADE,
  id      TEXT    NOT NULL,
  ord     INTEGER NOT NULL CHECK (ord >= 0),
  kind    TEXT    NOT NULL,
  actor   TEXT    NOT NULL,
  at      TEXT    NOT NULL,
  subject TEXT,
  PRIMARY KEY (pr_key, id)
) WITHOUT ROWID;

CREATE TABLE pr_file (
  pr_key    TEXT    NOT NULL REFERENCES pr (key) ON DELETE CASCADE,
  path      TEXT    NOT NULL,
  ord       INTEGER NOT NULL CHECK (ord >= 0),
  additions INTEGER NOT NULL,
  deletions INTEGER NOT NULL,
  PRIMARY KEY (pr_key, path)
) WITHOUT ROWID;
`;
