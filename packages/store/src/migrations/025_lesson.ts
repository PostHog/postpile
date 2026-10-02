// Lessons from the user's pushback (2026-10-02, DESIGN.md "Lessons from
// your reviews"). A change request on a PR the glance let through, or the
// user's own words from the detail pane, becomes a candidate line in the
// topic; only the user's click lets it shape later glances. The glance
// keeps the head commit it read, so a review on newer code is no miss, and
// an instructions version can name the lesson it came from.

export const version = 25;

export const sql = `
CREATE TABLE lesson (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    TEXT,
  pr_key      TEXT NOT NULL,
  source      TEXT NOT NULL,
  mismatch    TEXT,
  glance_json TEXT,
  review_id   TEXT UNIQUE,
  review_json TEXT,
  note        TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  why         TEXT NOT NULL DEFAULT '',
  joined_id   INTEGER,
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  decided_at  TEXT
);
CREATE INDEX lesson_topic_status ON lesson (topic_id, status);
CREATE INDEX lesson_pr ON lesson (pr_key);
ALTER TABLE pr_glance ADD COLUMN head_oid TEXT;
ALTER TABLE instructions_version ADD COLUMN source_lesson_id INTEGER;
`;
