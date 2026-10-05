// A storage revision on the PR header (2026-10-05, DESIGN.md "Bot bodies
// are cut when saved"; checked with Codex GPT-6.1). Parse caches knew a
// snapshot changed only by its fetched_at, so a local rewrite that keeps
// the fetch time (the one-time bot body cut) left other processes' caches
// (the CLI's, the MCP reads) with the old copy. Every write of a PR's
// snapshot now gives its header a new snapshot_revision, in the same
// transaction, and the caches compare it instead. The value comes from one
// counter for the whole store (meta `snapshot_revision`, the last one
// handed out) that only goes up, so a PR deleted and stored again never
// gets a revision a cache already holds. Existing headers start at 0, below
// anything the counter hands out. fetched_at keeps meaning "what GitHub
// said when", and a local rewrite does not move it.

export const version = 29;

export const sql = `
ALTER TABLE pr ADD COLUMN snapshot_revision INTEGER NOT NULL DEFAULT 0;
`;
