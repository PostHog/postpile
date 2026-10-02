// A topic is a project or a standing topic (2026-10-01). Projects have a
// finish line; standing topics keep a standard up for months and only drop
// off the agent's list after half a year without a new PR. Every topic so far
// was cut as a project; the next topic tidy sorts them.

export const version = 23;

export const sql = `
ALTER TABLE topic ADD COLUMN kind TEXT NOT NULL DEFAULT 'project';
`;
