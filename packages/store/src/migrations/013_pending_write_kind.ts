// The inbox cleanup's "mark everything older than N days read" is one
// PUT /notifications with last_read_at, not a list of threads. While the
// writes lock is closed it waits in pending_write like a mark-read; kind
// tells the two apart and read_before holds the cutoff.

export const version = 13;

export const sql = `
ALTER TABLE pending_write ADD COLUMN kind TEXT NOT NULL DEFAULT 'mark_read';
ALTER TABLE pending_write ADD COLUMN read_before TEXT;
`;
