// When a stale fact was last handed to a dossier update for a recheck. A
// fact is offered once per time it goes stale; without this, one the model
// leaves alone was offered, and paid for, on every sync.

export const version = 3;

export const sql = `
ALTER TABLE fact ADD COLUMN rechecked_at TEXT;
`;
