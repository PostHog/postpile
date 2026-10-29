// Telemetry bookkeeping for scouted PRs (DESIGN.md "Usage analytics" ›
// Scouts): when scout_pr_closed was reported for the PR's first exit from
// the Scouted section. An analytics marker, not lifecycle state: set once,
// just before the event is captured, so each PR reports at most once, also
// across restarts.
//
// Every row that exists when this runs is marked reported, whatever its
// state: scouts only ever ran on dev databases before, so no historical
// exit should ever be sent.

export const version = 46;

export const sql = `
ALTER TABLE pr_scouted ADD COLUMN closure_reported_at TEXT;
UPDATE pr_scouted SET closure_reported_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
`;
