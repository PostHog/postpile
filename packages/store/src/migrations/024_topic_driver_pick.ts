// The driver the user picks in the topic header (2026-10-02): a login, the
// home team (':team') or someone outside it (':outside'). Stored apart from
// topic.driver, which each sync refreshes from the dossier or the PR
// authors, so a sync never overwrites the pick. No row: automatic.

export const version = 24;

export const sql = `
CREATE TABLE topic_driver_pick (
  topic_id  TEXT PRIMARY KEY REFERENCES topic (id),
  driver    TEXT NOT NULL,
  picked_at TEXT NOT NULL
);
`;
