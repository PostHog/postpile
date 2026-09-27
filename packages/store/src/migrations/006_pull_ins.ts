// PRs fetched only to complete a stack of a pinged PR: which pinged PR they
// hang off (the anchor, whose topic they show in) and the reason the UI shows.

export const version = 6;

export const sql = `
CREATE TABLE pr_pull_in (
  pr_key         TEXT PRIMARY KEY,
  anchor_pr_key  TEXT NOT NULL,
  reason         TEXT NOT NULL,
  pulled_at      TEXT NOT NULL
);
`;
