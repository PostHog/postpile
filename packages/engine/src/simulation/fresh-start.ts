// Dev only (`pnpm cli simulate-start`): turns a copy of a real database into
// what a brand-new user would have after the fetch of their first sync.
// GitHub data and the user's own state stay; everything the agent wrote, and
// everything tied to the old topics and tiles, goes.
import type { Store } from '@postpile/store';
import { GITHUB_WRITES_META_KEY } from '../writes/write-switch.ts';

/** Kept as they are, with why. */
export const KEPT_TABLES: Record<string, string> = {
  schema_migrations: 'schema bookkeeping',
  meta: 'GitHub and app settings stay (viewer, teams, ETags, setup); agent keys are removed, see AGENT_META_PREFIXES',
  notification_thread: 'GitHub data: every notification is stored on the first sync, read state included',
  pr: 'GitHub data: PR snapshots',
  pr_event: 'GitHub data plus seen state; agent loudness overrides are cleared, user ones stay',
  event_log: 'first sightings of events; the simulation hides and re-logs them per round',
  user_pr_state: "the user's own approvals and handled marks (seen state)",
  pr_pull_in: 'GitHub data: stack layers the sync fetched',
  pr_found: 'GitHub data: PRs the sync found outside the inbox',
  instructions_version: "the user's instructions history",
  work_context_version: "the user's work context digest, an input every prompt reads",
  action_log: 'history of GitHub writes; no agent output, nothing in the digest reads it',
  pending_write: 'unsent mark-reads; nothing in the digest reads them',
  feedback: 'only rows tied to no topic, set or tile stay (see startFresh)',
};

/** Removed completely, with why. Tables missing in the schema (pr_set_change before it exists) are skipped. */
export const WIPED_TABLES: Record<string, string> = {
  chat_message: 'chats on old tiles',
  topic_proposal: 'proposals about old topics',
  rule_proposal: 'rules distilled from old feedback',
  lesson: 'lessons about old glances and topics',
  pr_set_change: 'set membership history of old sets',
  pr_set_member: 'agent-grouped sets',
  pr_set: 'agent-grouped sets',
  fact_ref: 'agent facts (sources)',
  fact: 'agent facts',
  topic_dossier: 'agent dossiers',
  cursor: 'digest, classify, seen and consolidate cursors: all counted against old topics',
  topic_membership: 'agent topic assignment',
  topic_driver_pick: 'drivers the user picked on old topics',
  topic: 'agent topics',
  pr_glance: 'agent glances',
  ping_decision: 'live poll ping decisions (agent and rules)',
  agent_call: 'agent call accounting; the report counts only the simulated calls',
  snooze: 'old tile snoozes (unused since migration 19)',
  pr_snooze: 'snoozes the user set on old tiles; a new user has none',
};

/**
 * Meta keys that hold agent input hashes, gaps or state tied to old topics,
 * by prefix (an exact key is its own prefix). Each one names where it is written.
 */
export const AGENT_META_PREFIXES: Record<string, string> = {
  'dossier_context_hash:': 'digest/dossiers.ts contextHashKey: instructions and context a dossier was written with',
  'set_grouping_hash:': 'digest/set-grouping.ts before 2026-10-01: input hash of the last set grouping per topic',
  'set_grouping_seen:': 'digest/set-grouping.ts setTriggersKey: the triggers the last regroup of a topic saw',
  'glance_gap:': 'digest/glance-batches.ts glanceGapKey: why a PR has no glance yet',
  events_rejudge_asks_v1: 'digest/event-batches.ts REJUDGE_ASKS_KEY (and its per-group keys): the one-time re-judge of stuck asks',
  'relation_override:': 'memory/placement.ts relationOverrideKey: user corrections of an old topic relation',
  'look_closer_ping:': 'live/glance-pings.ts lookCloserMetaKey: Look closer pings sent for old glances',
  last_sync_report: 'last-sync-report.ts: the source sync report and its agent stats',
  topic_tidy_result: 'digest/topic-tidy.ts TOPIC_TIDY_RESULT_KEY: what the topic tidy after an upgrade changed',
};

export function tableExists(store: Store, name: string): boolean {
  const row = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return row !== undefined;
}

function deleteMetaByPrefix(store: Store, prefix: string): void {
  store.db.prepare('DELETE FROM meta WHERE substr(key, 1, ?) = ?').run(prefix.length, prefix);
}

/**
 * Wipes the agent's memory from a copy of a database, inside one
 * transaction. Feedback tied to a topic, set or tile goes; agent overrides
 * on events go, user overrides stay. GitHub writes end up locked, as for a
 * new user.
 */
export function startFresh(store: Store): void {
  store.transaction(() => {
    // In this order: children before the topics and sets they reference.
    for (const table of Object.keys(WIPED_TABLES)) {
      if (tableExists(store, table)) {
        store.db.exec(`DELETE FROM ${table}`);
      }
    }
    store.db.exec('DELETE FROM feedback WHERE topic_id IS NOT NULL OR set_id IS NOT NULL OR tile_id IS NOT NULL');
    store.db.exec("UPDATE pr_event SET override_loudness = NULL, override_reason = NULL, override_by = NULL WHERE override_by IS NOT NULL AND override_by != 'user'");
    for (const prefix of Object.keys(AGENT_META_PREFIXES)) {
      deleteMetaByPrefix(store, prefix);
    }
    store.meta.set(GITHUB_WRITES_META_KEY, 'off');
  });
}
