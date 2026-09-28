// Mark-reads made while GitHub writes are locked. GitHub is the source of
// truth for read and unread, so a locked mark-read changes nothing in the
// app: it waits here, one row per click, until the user unlocks and sends
// it (or discards it). pr_keys, handle_keys and threads are JSON arrays;
// threads shrink as they reach GitHub, error keeps the last failure.

export const version = 11;

export const sql = `
CREATE TABLE pending_write (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL,
  origin       TEXT NOT NULL,
  tile_id      TEXT,
  batch        TEXT NOT NULL,
  pr_keys      TEXT NOT NULL,
  handle_keys  TEXT NOT NULL,
  threads      TEXT NOT NULL,
  error        TEXT,
  tried_at     TEXT
);
`;
