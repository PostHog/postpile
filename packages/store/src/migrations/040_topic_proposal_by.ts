// Which session filed an outside topic proposal: the optional `by` an agent
// passes to propose_topic_change ("ph3 session"), like note_pr's `by`. The
// Suggestions card meta and the MCP topic tool show it next to the client.
// Self-reported, a label and never an identity.
//
// DDL only: a nullable `ADD COLUMN` is instant at any size. Rows filed
// before, and every consolidation proposal, stay NULL. "by" is an SQL
// keyword, so it is quoted (pr_note uses the same name).

export const version = 40;

export const sql = `
ALTER TABLE topic_proposal ADD COLUMN "by" TEXT;
`;
