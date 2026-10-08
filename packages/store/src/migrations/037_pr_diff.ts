// Which lines a PR edits (2026-10-08, DESIGN.md "Overlapping edits"): two open
// PRs can change the same block of one file without a git conflict, and
// merging both silently drops one side's lines. GitHub's GraphQL API gives
// file names and counts but no patch, so a background pass reads the REST
// file list and keeps only line ranges.
//
// - `pr_diff` is one row per PR the pass has read: the head and base it read,
//   and whether the diff came out cut short (many files, or GitHub left a
//   patch out). A row whose head or base differs from the PR's is stale and
//   not used.
// - `pr_hunk` is one row per changed file with its base-side ranges as json
//   ([[start, end], ...]). Patch text is never stored.
//
// Both are derived from GitHub and can be dropped at any time; a PR without
// a row is simply read again.

export const version = 37;

export const sql = `
CREATE TABLE pr_diff (
  pr_key     TEXT    PRIMARY KEY REFERENCES pr (key) ON DELETE CASCADE,
  head_oid   TEXT    NOT NULL,
  base_ref   TEXT    NOT NULL,
  capped     INTEGER NOT NULL CHECK (capped IN (0, 1)),
  fetched_at TEXT    NOT NULL
) WITHOUT ROWID;

CREATE TABLE pr_hunk (
  pr_key TEXT NOT NULL REFERENCES pr_diff (pr_key) ON DELETE CASCADE,
  path   TEXT NOT NULL,
  ranges TEXT NOT NULL,
  PRIMARY KEY (pr_key, path)
) WITHOUT ROWID;
`;
