// A scouted PR's Follow (DESIGN.md "Scouts") waits for the writes lock like
// a mark-read: one pending_write row of kind 'follow'. It subscribes the
// viewer to the PR itself (GraphQL updateSubscription), not to a
// notification thread, so it carries the PR key and node id instead of
// threads: JSON in one column, null for every other kind.

export const version = 45;

export const sql = `
ALTER TABLE pending_write ADD COLUMN follow TEXT;
`;
