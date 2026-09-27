// Versions of the user's general instructions (instructions.md). The file
// stays the user's own and the source of truth; this is its history: every
// accepted chat proposal, and every change found on disk (a hand edit, or
// the text the app found the first time), so nothing is ever overwritten
// without a trace.

export const version = 4;

export const sql = `
CREATE TABLE instructions_version (
  version                 INTEGER PRIMARY KEY,
  text                    TEXT NOT NULL,
  summary                 TEXT NOT NULL,
  origin                  TEXT NOT NULL,
  source_chat_message_id  INTEGER,
  created_at              TEXT NOT NULL
);
`;
