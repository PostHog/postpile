// Scouts (DESIGN.md "Scouts"): what each scout covered, judged and pulled in.
//
// scout_cursor: per scout and repo, the run-start boundary of the last run
// that listed its whole window and stored every candidate as judged or
// pending. Written in the same transaction as those judgements.
//
// scout_judgement: one scout's call on one PR. Pending rows (files not read
// in full, the model call capped or failed, an answer that left the PR out)
// are worked on every run whatever the cursor says. input_hash decides
// whether a judged PR is judged again. Skipped rows go 30 days after their
// observed update; pulled ones stay.
//
// pr_scouted: the PRs the Scouted section shows, one row per PR, the first
// scout to pull it wins. Followed, dismissed and expired rows stay as
// history; the scout's name and config version are snapshots, so the reason
// still reads after a rename or removal. seen_updated_at is the local seen
// state (never a GitHub read): seen through that PR updatedAt.

export const version = 44;

export const sql = `
CREATE TABLE scout_cursor (
  scout_id         TEXT NOT NULL,
  repo             TEXT NOT NULL,
  covered_through  TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (scout_id, repo)
);

CREATE TABLE scout_judgement (
  scout_id             TEXT NOT NULL,
  pr_key               TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('pending', 'judged')),
  verdict              TEXT CHECK (verdict IN ('pulled', 'skipped')),
  reason               TEXT,
  input_hash           TEXT,
  config_version       INTEGER NOT NULL,
  head_oid             TEXT,
  observed_updated_at  TEXT NOT NULL,
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  judged_at            TEXT,
  PRIMARY KEY (scout_id, pr_key),
  CHECK ((status = 'pending') = (verdict IS NULL))
);
CREATE INDEX scout_judgement_pending ON scout_judgement (scout_id) WHERE status = 'pending';
CREATE INDEX scout_judgement_skipped ON scout_judgement (observed_updated_at) WHERE verdict = 'skipped';

CREATE TABLE pr_scouted (
  pr_key           TEXT PRIMARY KEY,
  scout_id         TEXT NOT NULL,
  scout_name       TEXT NOT NULL,
  config_version   INTEGER NOT NULL,
  reason           TEXT NOT NULL,
  pulled_at        TEXT NOT NULL,
  seen_updated_at  TEXT,
  followed_at      TEXT,
  dismissed_at     TEXT,
  dismiss_reason   TEXT,
  expired_at       TEXT,
  expiry_reason    TEXT
);
CREATE INDEX pr_scouted_scout ON pr_scouted (scout_id);
`;
