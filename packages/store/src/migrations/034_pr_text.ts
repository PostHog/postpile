// A PR's text and short fields as columns and a body row (2026-10-06,
// DESIGN.md "PR storage"; checked with Codex GPT-6.1): the last part of a
// PR the snapshot json held. After this collection switches, no read
// takes anything from `pr_snapshot`.
//
// DDL only: `ADD COLUMN` with a constant default and `CREATE TABLE` are
// instant at any size. The columns and rows are filled in the background
// by the storage job text_rows, from the json, and by every upsert from
// this build on (rows_version 3). Reads keep using the json until the job
// is complete (meta `rows_ready:text`).
//
// - Header columns: `url`, `additions`, `deletions`, `changed_files`,
//   `labels` (JSON text, in GitHub's order), `review_decision`,
//   `merged_by`. The defaults are never read: a PR's columns are read only
//   once the switch is set, and every PR then has them written.
// - `truncated` and `cap_hits` are NULL when the snapshot did not record
//   them. Missing is not the same as false or `[]`: a cut snapshot whose
//   cap hits were never recorded never vouches for a quiet read.
// - `absent_fields`: the optional header fields the snapshot lacked
//   (`assignees`, `previousBaseRefs`, `isCrossRepository`), JSON text.
//   Their header columns hold `[]` / 0 for those, so a read needs this to
//   give them back missing (the sync refetches a PR without assignees).
// - `pr_body`: the PR description, a rowid table of its own: up to several
//   KB a PR that the hot-set scan over `pr` must not walk past.

export const version = 34;

export const sql = `
ALTER TABLE pr ADD COLUMN url TEXT NOT NULL DEFAULT '';
ALTER TABLE pr ADD COLUMN additions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pr ADD COLUMN deletions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pr ADD COLUMN changed_files INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pr ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pr ADD COLUMN review_decision TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE pr ADD COLUMN merged_by TEXT;
ALTER TABLE pr ADD COLUMN truncated INTEGER CHECK (truncated IN (0, 1));
ALTER TABLE pr ADD COLUMN cap_hits TEXT;
ALTER TABLE pr ADD COLUMN absent_fields TEXT NOT NULL DEFAULT '[]';

CREATE TABLE pr_body (
  pr_key TEXT NOT NULL PRIMARY KEY REFERENCES pr (key) ON DELETE CASCADE,
  body   TEXT NOT NULL
);
`;
