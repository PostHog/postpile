// Interruptions (2026-10-05): the pings PostPile holds on to, one per PR.
// A queued one waits for the next roundup (shown_at NULL); a shown one is
// what the Dock badge counts until its tile is opened or the PR is read.
// ping_json is the core Ping (title, body, target, personal).

export const version = 27;

export const sql = `
CREATE TABLE mac_ping (
  pr_key    TEXT PRIMARY KEY,
  ping_json TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  shown_at  TEXT
);
`;
