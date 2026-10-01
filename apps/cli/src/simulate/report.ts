// The simulate-start report as data: per round and arm, then across arms at
// the end. Pure: snapshots in, numbers and lists out.
import { glanceRiskLevel, type IsoTime, type PrKey, type TileKind } from '@postpile/core';
import type { ArmSnapshot, SnapshotCall, SnapshotDossier, SnapshotTile } from '@postpile/engine';
import type { ArmName } from './simulate-args.ts';

/** What one round revealed and what each arm held after it. */
export interface RoundRecord {
  /** 1, 2, 3, ... */
  index: number;
  startAt: IsoTime;
  prs: { pinged: number; found: number; pulledIn: number };
  arms: Partial<Record<ArmName, ArmSnapshot>>;
}

export interface ReportMeta {
  from: string;
  out: string;
  now: IsoTime;
  days: number;
  roundSize: number;
  arms: ArmName[];
  dryRun: boolean;
  plannedRounds: number;
  plannedPrs: { pinged: number; found: number; pulledIn: number };
}

export interface CallSummary {
  calls: number;
  failed: number;
  costUsd: number;
  durationMs: number;
  /** Calls by agent_call kind, failed ones included. */
  byKind: Record<string, number>;
}

export interface PrMove {
  prKey: PrKey;
  from: string;
  to: string;
  /** From pr_set_change, when the table exists. */
  reasons: string[];
}

export interface TileChurn {
  /** Tiles with the same id in the same topics in this round and the one before. */
  kept: number;
  added: number;
  gone: number;
  /** PRs that were in a tile before and are in another one, or in another topic, now. From and to read "<tile id> in <topic ids>". */
  moved: PrMove[];
}

export interface ArmRound {
  calls: CallSummary;
  topics: number;
  /** Each tile once, also a stack that shows in several topics. */
  tiles: number;
  /** Tiles with more than one PR, by kind. */
  multiPr: Partial<Record<TileKind, number>>;
  churn: TileChurn;
}

export interface RoundReport {
  index: number;
  startAt: IsoTime;
  prs: RoundRecord['prs'];
  arms: Partial<Record<ArmName, ArmRound>>;
}

export interface GlanceView {
  verdict: string;
  riskLevel: string;
}

export interface GlanceAgreement {
  /** PRs with a glance in every arm. */
  compared: number;
  verdictSame: number;
  riskSame: number;
  /** PRs where verdict or risk level differ. */
  differences: { prKey: PrKey; byArm: Partial<Record<ArmName, GlanceView>> }[];
}

export interface TopicSideBySide {
  topicId: string;
  name: string;
  byArm: Partial<Record<ArmName, { dossier: SnapshotDossier | null; tiles: SnapshotTile[] }>>;
}

export interface SimulationReport {
  meta: ReportMeta;
  rounds: RoundReport[];
  totals: Partial<Record<ArmName, CallSummary>>;
  /** After the last round that ran; empty when none did. */
  glances: GlanceAgreement;
  topics: TopicSideBySide[];
}

function emptyCalls(): CallSummary {
  return { calls: 0, failed: 0, costUsd: 0, durationMs: 0, byKind: {} };
}

export function summarizeCalls(calls: SnapshotCall[]): CallSummary {
  const summary = emptyCalls();
  for (const call of calls) {
    summary.calls += 1;
    summary.failed += call.ok ? 0 : 1;
    summary.costUsd += call.costUsd ?? 0;
    summary.durationMs += call.durationMs;
    summary.byKind[call.kind] = (summary.byKind[call.kind] ?? 0) + 1;
  }
  return summary;
}

function addCalls(total: CallSummary, more: CallSummary): CallSummary {
  const byKind = { ...total.byKind };
  for (const [kind, count] of Object.entries(more.byKind)) {
    byKind[kind] = (byKind[kind] ?? 0) + count;
  }
  return {
    calls: total.calls + more.calls,
    failed: total.failed + more.failed,
    costUsd: total.costUsd + more.costUsd,
    durationMs: total.durationMs + more.durationMs,
    byKind,
  };
}

/** A tile and the topics it shows in. */
interface PlacedTile {
  tile: SnapshotTile;
  topicIds: string[];
}

/** Every tile once, by id, with the topics it shows in: a stack can show in several topics under the same id. */
function uniqueTiles(snapshot: ArmSnapshot): Map<string, PlacedTile> {
  const result = new Map<string, PlacedTile>();
  for (const topic of snapshot.topics) {
    for (const tile of topic.tiles) {
      const placed = result.get(tile.id) ?? { tile, topicIds: [] };
      placed.topicIds.push(topic.id);
      result.set(tile.id, placed);
    }
  }
  return result;
}

/** Where a tile shows: "pr:acme/app#1 in ci". A tile that changed topic is somewhere else, even with the same id. */
function placement(placed: PlacedTile): string {
  return `${placed.tile.id} in ${[...placed.topicIds].sort().join(', ')}`;
}

function placementByPr(tiles: Map<string, PlacedTile>): Map<PrKey, string> {
  const result = new Map<PrKey, string>();
  for (const placed of tiles.values()) {
    for (const member of placed.tile.members) {
      result.set(member, placement(placed));
    }
  }
  return result;
}

/**
 * Tiles kept, added and gone since the previous round, and the PRs that
 * changed tile or topic, with set change reasons. A tile counts as kept
 * only with the same id in the same topics; one that moved topic counts as
 * gone and added.
 */
export function tileChurn(previous: ArmSnapshot | null, current: ArmSnapshot): TileChurn {
  const beforeTiles = previous ? uniqueTiles(previous) : new Map<string, PlacedTile>();
  const nowTiles = uniqueTiles(current);
  const before = new Set([...beforeTiles.values()].map(placement));
  const now = new Set([...nowTiles.values()].map(placement));
  const kept = [...now].filter((where) => before.has(where)).length;
  const oldPlaces = placementByPr(beforeTiles);
  const moved: PrMove[] = [];
  for (const [prKey, to] of placementByPr(nowTiles)) {
    const from = oldPlaces.get(prKey);
    if (from === undefined || from === to) {
      continue;
    }
    const reasons = (current.setChanges ?? [])
      .filter((change) => change.prKey === prKey)
      .map((change) => `${change.change} ${change.setId} by ${change.by}: ${change.reason}`);
    moved.push({ prKey, from, to, reasons });
  }
  return { kept, added: now.size - kept, gone: before.size - kept, moved };
}

/** Tiles with more than one PR, by kind, each tile once. */
export function multiPrTiles(snapshot: ArmSnapshot): Partial<Record<TileKind, number>> {
  const result: Partial<Record<TileKind, number>> = {};
  for (const { tile } of uniqueTiles(snapshot).values()) {
    if (tile.members.length > 1) {
      result[tile.kind] = (result[tile.kind] ?? 0) + 1;
    }
  }
  return result;
}

function armRound(previous: ArmSnapshot | null, current: ArmSnapshot): ArmRound {
  return {
    calls: summarizeCalls(current.calls),
    topics: current.topics.length,
    tiles: uniqueTiles(current).size,
    multiPr: multiPrTiles(current),
    churn: tileChurn(previous, current),
  };
}

/** Verdict and risk level per PR that has a glance in every arm. */
export function glanceAgreement(snapshots: Partial<Record<ArmName, ArmSnapshot>>): GlanceAgreement {
  const arms = Object.keys(snapshots) as ArmName[];
  const result: GlanceAgreement = { compared: 0, verdictSame: 0, riskSame: 0, differences: [] };
  if (arms.length === 0) {
    return result;
  }
  const keys = Object.keys(snapshots[arms[0]!]!.glances).filter((key) => arms.every((arm) => snapshots[arm]!.glances[key] !== undefined));
  for (const prKey of keys.sort()) {
    const byArm: Partial<Record<ArmName, GlanceView>> = {};
    for (const arm of arms) {
      const glance = snapshots[arm]!.glances[prKey]!;
      byArm[arm] = { verdict: glance.verdict, riskLevel: glanceRiskLevel(glance.risk) };
    }
    const views = Object.values(byArm);
    const verdictSame = views.every((view) => view.verdict === views[0]!.verdict);
    const riskSame = views.every((view) => view.riskLevel === views[0]!.riskLevel);
    result.compared += 1;
    result.verdictSame += verdictSame ? 1 : 0;
    result.riskSame += riskSame ? 1 : 0;
    if (!verdictSame || !riskSame) {
      result.differences.push({ prKey, byArm });
    }
  }
  return result;
}

/** Every topic any arm shows, with each arm's dossier and tiles. */
export function topicsSideBySide(snapshots: Partial<Record<ArmName, ArmSnapshot>>): TopicSideBySide[] {
  const byId = new Map<string, TopicSideBySide>();
  for (const [arm, snapshot] of Object.entries(snapshots) as [ArmName, ArmSnapshot][]) {
    for (const topic of snapshot.topics) {
      const entry = byId.get(topic.id) ?? { topicId: topic.id, name: topic.name, byArm: {} };
      entry.byArm[arm] = { dossier: snapshot.dossiers[topic.id] ?? null, tiles: topic.tiles };
      byId.set(topic.id, entry);
    }
  }
  return [...byId.values()];
}

export function buildReport(meta: ReportMeta, records: RoundRecord[]): SimulationReport {
  const rounds: RoundReport[] = [];
  const totals: Partial<Record<ArmName, CallSummary>> = {};
  for (const [i, record] of records.entries()) {
    const previous = i > 0 ? records[i - 1]! : null;
    const arms: Partial<Record<ArmName, ArmRound>> = {};
    for (const arm of meta.arms) {
      const snapshot = record.arms[arm];
      if (!snapshot) {
        continue;
      }
      const round = armRound(previous?.arms[arm] ?? null, snapshot);
      arms[arm] = round;
      totals[arm] = addCalls(totals[arm] ?? emptyCalls(), round.calls);
    }
    rounds.push({ index: record.index, startAt: record.startAt, prs: record.prs, arms });
  }
  const last = records.at(-1)?.arms ?? {};
  return { meta, rounds, totals, glances: glanceAgreement(last), topics: topicsSideBySide(last) };
}
