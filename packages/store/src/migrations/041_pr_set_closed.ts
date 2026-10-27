// When a finished set closed (2026-10-27, DESIGN.md "Tiles hold still"): two
// days after every member merged or closed, a set takes no joins, merges or
// new members, and a regroup no longer sees it. A column next to status, not
// a third status value: a closed set still shows as its tile, and every
// reader of status = 'active' (the board's tiles, snooze, "which tiles is
// this PR in") keeps it as it is.
//
// DDL only: a nullable `ADD COLUMN` is instant at any size. Existing sets
// start open; the next set pass closes the finished ones.

export const version = 41;

export const sql = `
ALTER TABLE pr_set ADD COLUMN closed_at TEXT;
`;
