// Split the pr row (2026-10-05, DESIGN.md "Big inboxes: what PostPile loads
// and works on"; checked with Codex GPT-6.1). Picking the hot PRs, keeping
// stacks whole and searching must not parse snapshots: on a heavy install
// the json column holds about 1 GB for 11k PRs, and a column after the json
// is only reached through its overflow pages.
//
// `pr` is now the PR header: short columns only, one row per stored PR, and
// the parent the normalized model hangs off later (NEXT.md "Normalize the PR
// snapshot"). It is the existence authority: a PR is stored if and only if
// it has a header, and header and snapshot keys stay equal. `pr_snapshot` is
// the old table renamed (no copy of the blobs), the json being phased out.
// Its legacy short columns are still written, to satisfy NOT NULL, but never
// read; they go away when the snapshot is rebuilt or normalized.
//
// The header is filled from the json once here, then on every upsert.
// Arrays are JSON text and fall back to '[]' unless the json holds an array;
// a missing created_at falls back to updated_at (the closest time known),
// a missing head oid or title to ''. Malformed json fails the migration,
// which then rolls back whole.
//
// The partial index holds the events aimed at the viewer in person (the hot
// tier "you"); the same question as a scan of pr_event took 1.5 s on a copy
// with 485k events.
import type { DatabaseSync } from 'node:sqlite';

export const version = 28;

export const sql = `
ALTER TABLE pr RENAME TO pr_snapshot;
DROP INDEX pr_repo;
CREATE TABLE pr (
  key                TEXT PRIMARY KEY NOT NULL,
  repo               TEXT NOT NULL,
  number             INTEGER NOT NULL,
  state              TEXT NOT NULL,
  is_draft           INTEGER NOT NULL,
  title              TEXT NOT NULL,
  author             TEXT NOT NULL,
  assignees          TEXT NOT NULL,
  reviewer_users     TEXT NOT NULL,
  reviewer_teams     TEXT NOT NULL,
  base_ref           TEXT NOT NULL,
  head_ref           TEXT NOT NULL,
  head_oid           TEXT NOT NULL,
  previous_base_refs TEXT NOT NULL,
  cross_repository   INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  merged_at          TEXT,
  fetched_at         TEXT NOT NULL
);
INSERT INTO pr (
  key, repo, number, state, is_draft, title, author, assignees, reviewer_users, reviewer_teams,
  base_ref, head_ref, head_oid, previous_base_refs, cross_repository, created_at, updated_at, merged_at, fetched_at
)
SELECT
  key,
  repo,
  number,
  state,
  CASE WHEN json_type(json, '$.isDraft') = 'true' THEN 1 ELSE 0 END,
  CASE WHEN json_type(json, '$.title') = 'text' THEN json_extract(json, '$.title') ELSE '' END,
  CASE WHEN json_type(json, '$.author') = 'text' THEN json_extract(json, '$.author') ELSE '' END,
  CASE WHEN json_type(json, '$.assignees') = 'array' THEN json_extract(json, '$.assignees') ELSE '[]' END,
  CASE WHEN json_type(json, '$.reviewerUsers') = 'array' THEN json_extract(json, '$.reviewerUsers') ELSE '[]' END,
  CASE WHEN json_type(json, '$.reviewerTeams') = 'array' THEN json_extract(json, '$.reviewerTeams') ELSE '[]' END,
  base_ref,
  head_ref,
  CASE WHEN json_type(json, '$.headOid') = 'text' THEN json_extract(json, '$.headOid') ELSE '' END,
  CASE WHEN json_type(json, '$.previousBaseRefs') = 'array' THEN json_extract(json, '$.previousBaseRefs') ELSE '[]' END,
  CASE WHEN json_type(json, '$.isCrossRepository') = 'true' THEN 1 ELSE 0 END,
  CASE WHEN json_type(json, '$.createdAt') = 'text' THEN json_extract(json, '$.createdAt') ELSE updated_at END,
  updated_at,
  CASE WHEN json_type(json, '$.mergedAt') = 'text' THEN json_extract(json, '$.mergedAt') ELSE NULL END,
  fetched_at
FROM pr_snapshot;
CREATE INDEX pr_repo ON pr (repo);
CREATE INDEX pr_event_personal_ask ON pr_event (pr_key)
  WHERE kind IN ('mention', 'reply_to_user', 'question_to_user')
     OR rule_reason IN ('review requested from you', 'review request already answered or removed', 'addressed your changes');
`;

/** Header and snapshot keys must be equal before the migration commits; the runner rolls back on the throw. */
export function run(db: DatabaseSync): void {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM pr WHERE key NOT IN (SELECT key FROM pr_snapshot)) AS headers_alone,
         (SELECT COUNT(*) FROM pr_snapshot WHERE key NOT IN (SELECT key FROM pr)) AS snapshots_alone`,
    )
    .get() as { headers_alone: number; snapshots_alone: number };
  if (row.headers_alone !== 0 || row.snapshots_alone !== 0) {
    throw new Error(`028: pr and pr_snapshot keys differ (${row.headers_alone} headers, ${row.snapshots_alone} snapshots alone)`);
  }
}
