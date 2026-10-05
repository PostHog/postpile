// The hot board (2026-10-05, DESIGN.md "Big inboxes: what PostPile loads
// and works on"). Picking the hot PRs, keeping stacks whole and searching
// must not parse the snapshots: on a heavy install the json column holds
// about 1 GB for 11k PRs. pr_light keeps what those reads need beside the
// pr row, one short row per PR, filled from the json once here and then on
// every upsert. A table of its own, not columns on pr: a column after the
// json is only reached through the json's overflow pages, so adding them
// took 10 s on that install and reading them 300 ms. Arrays are JSON text.
//
// The partial index holds the events aimed at the viewer in person (the
// hot tier "you"); the same question as a scan of pr_event took 1.5 s on a
// copy with 485k events.

export const version = 28;

export const sql = `
CREATE TABLE pr_light (
  key                TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  author             TEXT NOT NULL,
  assignees          TEXT NOT NULL,
  reviewer_users     TEXT NOT NULL,
  reviewer_teams     TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  merged_at          TEXT,
  previous_base_refs TEXT NOT NULL,
  cross_repository   INTEGER NOT NULL
);
INSERT INTO pr_light
  SELECT
    key,
    coalesce(json_extract(json, '$.title'), ''),
    coalesce(json_extract(json, '$.author'), ''),
    coalesce(json_extract(json, '$.assignees'), '[]'),
    coalesce(json_extract(json, '$.reviewerUsers'), '[]'),
    coalesce(json_extract(json, '$.reviewerTeams'), '[]'),
    coalesce(json_extract(json, '$.createdAt'), ''),
    json_extract(json, '$.mergedAt'),
    coalesce(json_extract(json, '$.previousBaseRefs'), '[]'),
    coalesce(json_extract(json, '$.isCrossRepository'), 0)
  FROM pr;
CREATE INDEX pr_event_personal_ask ON pr_event (pr_key)
  WHERE kind IN ('mention', 'reply_to_user', 'question_to_user')
     OR rule_reason IN ('review requested from you', 'review request already answered or removed', 'addressed your changes');
`;
