// Set history (2026-10-01, DESIGN.md "Tiles hold still"). Tiles keep their
// members until the agent changes them with a reason, or the user corrects
// them. Every such change is a row here. No foreign key: the history of a set
// stays readable after the set ended.

export const version = 22;

export const sql = `
CREATE TABLE pr_set_change (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id  TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  pr_key  TEXT,
  change  TEXT NOT NULL,
  reason  TEXT NOT NULL,
  by      TEXT NOT NULL,
  at      TEXT NOT NULL
);
CREATE INDEX pr_set_change_topic ON pr_set_change (topic_id, id);
CREATE INDEX pr_set_change_set ON pr_set_change (set_id, id);
`;
