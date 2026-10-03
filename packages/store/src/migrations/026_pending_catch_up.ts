// The inbox catch-up dialog (2026-10-03) parks as one pending write while
// the writes lock is closed: its picks and the time the dialog counted, so
// sending it from the lock plans the same calls again. JSON in one column,
// null for mark-reads and the old mark_all_read_before rows.

export const version = 26;

export const sql = `
ALTER TABLE pending_write ADD COLUMN catch_up TEXT;
`;
