// The glance's "look at first" files: up to 3 changed files as JSON
// [{ "path", "why" }]. Older glances read as none until they regenerate
// (the glance prompt version moved to g2).

export const version = 15;

export const sql = `
ALTER TABLE pr_glance ADD COLUMN key_files TEXT NOT NULL DEFAULT '[]';
`;
