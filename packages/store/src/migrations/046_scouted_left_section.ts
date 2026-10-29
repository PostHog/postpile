// When a scouted PR left the Scouted section (DESIGN.md "Scouts" and
// "Usage analytics"): followed, dismissed, expired, or it reached the
// user's inbox by itself. Set once, when telemetry's scout_pr_closed is
// sent, so each PR reports how it left exactly once, also across restarts.
// Rows that had already left before this column existed are backfilled,
// so an upgrade does not report old history.

export const version = 46;

export const sql = `
ALTER TABLE pr_scouted ADD COLUMN left_section_at TEXT;
UPDATE pr_scouted SET left_section_at = COALESCE(followed_at, dismissed_at, expired_at)
WHERE followed_at IS NOT NULL OR dismissed_at IS NOT NULL OR expired_at IS NOT NULL;
`;
