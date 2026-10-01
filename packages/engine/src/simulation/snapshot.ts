// Dev only (`pnpm cli simulate-start`): what one arm's database holds after
// a round, as plain data for the report. Tiles come from the same Board the
// app reads, so they are the tiles the user would see.
import type { IsoTime, PrKey, TileKind } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import { tableExists } from './fresh-start.ts';

export interface SnapshotTile {
  id: string;
  kind: TileKind;
  members: PrKey[];
}

export interface SnapshotTopic {
  id: string;
  name: string;
  tiles: SnapshotTile[];
}

export interface SnapshotGlance {
  verdict: string;
  risk: string;
}

export interface SnapshotDossier {
  status: string;
  statusNote: string;
  goal: string;
}

export interface SnapshotCall {
  kind: string;
  ok: boolean;
  durationMs: number;
  costUsd: number | null;
}

/** A pr_set_change row (set membership history), when the table exists. */
export interface SnapshotSetChange {
  setId: string;
  topicId: string;
  prKey: PrKey;
  change: string;
  reason: string;
  by: string;
  at: IsoTime;
}

export interface ArmSnapshot {
  /** Active topics plus Unsorted when anything waits for a topic. */
  topics: SnapshotTopic[];
  glances: Record<PrKey, SnapshotGlance>;
  dossiers: Record<string, SnapshotDossier>;
  /** Agent calls logged at or after `since`. */
  calls: SnapshotCall[];
  /** Set changes at or after `since`; null when the table does not exist. */
  setChanges: SnapshotSetChange[] | null;
}

interface CallRow {
  kind: string;
  ok: number;
  duration_ms: number;
  cost_usd: number | null;
}

interface SetChangeRow {
  set_id: string;
  topic_id: string;
  pr_key: string;
  change: string;
  reason: string;
  by: string;
  at: string;
}

function readTopics(store: Store, now: IsoTime): SnapshotTopic[] {
  const board = Board.load(store, now);
  return board.topics().map((topic) => ({
    id: topic.id,
    name: topic.name,
    tiles: board.tilesForTopic(topic.id).map((tile) => ({ id: tile.id, kind: tile.kind, members: tile.members.map((member) => member.prKey) })),
  }));
}

function readGlances(store: Store): Record<PrKey, SnapshotGlance> {
  const keys = store.prs.listAll().map((pr) => pr.key).sort();
  const glances = store.glances.getMany(keys);
  const result: Record<PrKey, SnapshotGlance> = {};
  for (const key of keys) {
    const glance = glances.get(key);
    if (glance) {
      result[key] = { verdict: glance.verdict, risk: glance.risk };
    }
  }
  return result;
}

function readDossiers(store: Store): Record<string, SnapshotDossier> {
  const ids = store.topics.list().map((topic) => topic.id);
  const result: Record<string, SnapshotDossier> = {};
  for (const [topicId, version] of store.dossiers.latestMany(ids)) {
    result[topicId] = { status: version.dossier.status, statusNote: version.dossier.statusNote, goal: version.dossier.goal };
  }
  return result;
}

function readCalls(store: Store, since: IsoTime): SnapshotCall[] {
  // Raw SQL: the agent call repo has no list of rows, only counts and stats.
  const rows = store.db.prepare('SELECT kind, ok, duration_ms, cost_usd FROM agent_call WHERE at >= ? ORDER BY id').all(since) as unknown as CallRow[];
  return rows.map((row) => ({ kind: row.kind, ok: row.ok !== 0, durationMs: row.duration_ms, costUsd: row.cost_usd }));
}

function readSetChanges(store: Store, since: IsoTime): SnapshotSetChange[] | null {
  if (!tableExists(store, 'pr_set_change')) {
    return null;
  }
  // Raw SQL: the set repo lists changes per topic only, not across topics by time.
  const rows = store.db.prepare('SELECT set_id, topic_id, pr_key, change, reason, "by", at FROM pr_set_change WHERE at >= ? ORDER BY at').all(since) as unknown as SetChangeRow[];
  return rows.map((row) => ({ setId: row.set_id, topicId: row.topic_id, prKey: row.pr_key, change: row.change, reason: row.reason, by: row.by, at: row.at }));
}

/** The arm's board at `now`, plus calls and set changes since `since` (the round's start). */
export function readArmSnapshot(store: Store, now: IsoTime, since: IsoTime): ArmSnapshot {
  return {
    topics: readTopics(store, now),
    glances: readGlances(store),
    dossiers: readDossiers(store),
    calls: readCalls(store, since),
    setChanges: readSetChanges(store, since),
  };
}
