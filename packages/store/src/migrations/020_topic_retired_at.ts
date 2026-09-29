// A topic records when it retired (2026-09-29). The Finished drawer and the
// topic offer read "retired at" from updated_at before, and any rename or
// summary edit moved it. Topics retired before this get their updated_at as
// the best guess.

export const version = 20;

export const sql = `
ALTER TABLE topic ADD COLUMN retired_at TEXT;
UPDATE topic SET retired_at = updated_at WHERE status = 'retired';
`;
