// "Bring back" is gone. GitHub has no API to mark a thread unread, so an
// app-only bring back split the read state between the app and GitHub.
// 008 stays as it shipped; this drops the column it added. Old action_log
// rows with action 'bring_back' are kept as history.

export const version = 10;

export const sql = `
ALTER TABLE user_pr_state DROP COLUMN brought_back_at;
`;
