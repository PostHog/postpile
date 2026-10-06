// PostPile no longer tracks CI (2026-10-05, DESIGN.md "CI is not tracked").
// Checks were the costliest part of a PR fetch, usually stale by the time
// anyone looked, and nothing but a quiet event and a pane fact read them.
//
// The CI events go: no build derives them any more, so a stored one would
// only sit there, folded into the activity list's bot line. Their event log
// rows go with them, matched by id (`<pr key>:ci:<head oid>:<rollup>`), also
// the ones whose event a newer head commit already dropped. Every reader of
// the log joins pr_event, so this removes nothing a reader still shows, and
// it can make no row unseen: rows only leave.
//
// The snapshot json's `checks` is removed in the background by the storage
// job checks_strip, and reads drop it until then. This migration is also
// what keeps 0.20.0 away from the stripped json: it refuses a database with
// a schema newer than its own.

export const version = 30;

export const sql = `
DELETE FROM event_log WHERE substr(event_id, 1, length(pr_key) + 4) = pr_key || ':ci:';
DELETE FROM pr_event WHERE kind = 'ci';
`;
