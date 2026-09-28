// One row per ping decision of the fast notification poll: did new activity
// on a PR thread ping the Mac, who decided (rules, agent, fallback) and why.
// Only for debugging "why did / didn't this ping"; nothing reads it back
// into a decision.

export const version = 7;

export const sql = `
CREATE TABLE ping_decision (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  TEXT NOT NULL,
  pr_key     TEXT NOT NULL,
  ping       INTEGER NOT NULL,
  source     TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  reason     TEXT NOT NULL,
  at         TEXT NOT NULL
);
CREATE INDEX ping_decision_at ON ping_decision (at);
`;
