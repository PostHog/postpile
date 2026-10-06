// The version barrier before `pr_snapshot` goes (2026-10-06, DESIGN.md
// "PR storage"; asked for by Codex GPT-6.1's review of the design). It
// changes nothing in the schema: what matters is the version it records.
//
// From this version on, a build stops writing `pr_snapshot` once every
// collection reads from rows (meta `rows_ready:text`), and the storage job
// snapshot_retire empties the table in small slices and then drops it.
// A build that knows only up to 034 still reads and writes the table, so
// it must never open such a database. Recording 035 makes the newer-schema
// guard (`openDatabase`, since 0.20.0) refuse it instead of letting it
// query a table that is gone. The heavy work stays in the job: no
// migration deletes or drops anything at startup.

export const version = 35;

export const sql = '';
