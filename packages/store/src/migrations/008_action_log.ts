// Every action that could reach GitHub (mark read, approve, comment), plus
// local mark-reads, undos, bring-backs and flips of the writes lock: who
// decided it (origin), and whether it reached GitHub or stayed local. The
// debug view reads it to say what led to a thread being read.
//
// user_pr_state.brought_back_at: "bring back" in the debug view makes the
// PR's tile unread again until the next mark-read. GitHub has no mark-unread,
// so this is app state only.

export const version = 8;

export const sql = `
CREATE TABLE action_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  action     TEXT NOT NULL,
  origin     TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  thread_id  TEXT,
  pr_key     TEXT,
  tile_id    TEXT,
  batch      TEXT,
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX action_log_thread ON action_log (thread_id);
CREATE INDEX action_log_pr ON action_log (pr_key);
CREATE INDEX action_log_batch ON action_log (batch);
ALTER TABLE user_pr_state ADD COLUMN brought_back_at TEXT;
`;
