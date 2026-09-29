// Topic assignment no longer parks PRs in Unsorted until the next
// consolidation: every PR without a topic is asked about on every sync. The
// old "topic_deferred:<prKey>" meta rows would only mislead, so they go.

export const version = 15;

export const sql = `
DELETE FROM meta WHERE key LIKE 'topic_deferred:%';
`;
