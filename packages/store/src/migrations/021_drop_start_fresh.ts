// "Start fresh here" is gone (2026-09-30, DESIGN.md "GitHub unread is
// PostPile unread"): a local baseline hid things in PostPile that stayed
// unread on GitHub. Nothing reads the stored baseline any more; this drops
// it, so a store that had one shows everything GitHub has unread again.

export const version = 21;

export const sql = `DELETE FROM meta WHERE key = 'start_fresh_baseline';`;
