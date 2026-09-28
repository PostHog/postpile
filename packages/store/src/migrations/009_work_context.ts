// "What you're working on": one row per successful context sweep, newest
// kept (the repo prunes to the last 30). digest is the agent's answer as JSON
// ({summary, threads, lastSeenAt}); input_sources lists every file and
// session that went into the prompt; input_stats has sizes and what the
// budget dropped. Failures are not stored here; the last error sits in meta.
//
// 008 is taken by the action log on the writes branch; renumber at merge if
// needed.

export const version = 9;

export const sql = `
CREATE TABLE work_context_version (
  version        INTEGER PRIMARY KEY,
  digest         TEXT NOT NULL,
  input_sources  TEXT NOT NULL,
  input_stats    TEXT NOT NULL,
  model          TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
`;
