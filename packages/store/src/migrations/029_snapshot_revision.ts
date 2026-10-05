// A storage revision on the PR header (2026-10-05, DESIGN.md "Bot bodies
// are cut when saved"; checked with Codex GPT-6.1). Parse caches knew a
// snapshot changed only by its fetched_at, so a local rewrite that keeps
// the fetch time (the one-time bot body cut) left other processes' caches
// (the CLI's, the MCP reads) with the old copy. snapshot_revision moves on
// every write of the PR's snapshot, in the same transaction as it, and the
// caches compare it instead. fetched_at keeps meaning "what GitHub said
// when", and a local rewrite does not move it.

export const version = 29;

export const sql = `
ALTER TABLE pr ADD COLUMN snapshot_revision INTEGER NOT NULL DEFAULT 0;
`;
