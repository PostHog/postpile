// Which glance claims the agent checked (2026-10-08, DESIGN.md "Glance
// claim basis"): JSON of { risk, verdict }, each { checked, note } or null.
//
// DDL only: a nullable `ADD COLUMN` is instant at any size. Glances stored
// before stay NULL and show no basis; the g3 prompt version rewrites them
// on the next sync anyway.

export const version = 38;

export const sql = `
ALTER TABLE pr_glance ADD COLUMN basis TEXT;
`;
