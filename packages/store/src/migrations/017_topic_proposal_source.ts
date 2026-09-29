// Who filed a topic proposal: the consolidation job (every row so far) or an
// outside agent through the MCP server's propose_topic_change, with the MCP
// client's name ("claude-code"). The Inbox card names the outside agent, and
// outside proposals get their own caps and expiry.

export const version = 17;

export const sql = `
ALTER TABLE topic_proposal ADD COLUMN source TEXT NOT NULL DEFAULT 'consolidation';
ALTER TABLE topic_proposal ADD COLUMN client TEXT;
`;
