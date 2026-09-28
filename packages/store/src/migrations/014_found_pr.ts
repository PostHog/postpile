// PRs the full sync found outside the inbox: the user's own open PRs,
// review requests (theirs or a team's) and recently merged PRs involving
// them. One row per PR, replaced as a whole on every full sync. Provenance
// stays derived: a PR with a notification thread counts as pinged.

export const version = 14;

export const sql = `
CREATE TABLE pr_found (
  pr_key    TEXT PRIMARY KEY,
  via       TEXT NOT NULL,
  reason    TEXT NOT NULL,
  found_at  TEXT NOT NULL
);
`;
