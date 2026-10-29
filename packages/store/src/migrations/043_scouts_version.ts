// Versions of the user's scouts file (scouts.md, DESIGN.md "Scouts"),
// mirroring instructions_version: the file stays the user's own and the
// source of truth; this is its history. Every change found on disk is
// stored, so an invalid edit can fall back to the last version that parsed
// and nothing is lost to a later save. Proposal source columns come with
// the proposal flow, which v1 does not have.

export const version = 43;

export const sql = `
CREATE TABLE scouts_version (
  version     INTEGER PRIMARY KEY,
  text        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  origin      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
`;
