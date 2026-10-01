// The agent-assisted offers against their spec oracle (spec-agent-actions.ts,
// DESIGN "Agent-assisted actions", 2026-09-30): the tile and topic ✨
// Approve and the topic's ✨ "Mark N read". Safety: nothing is approved or
// marked that the agent does not back. Liveness: what it backs is offered.
import type { AgentApproveOffer } from '../agent-actions.ts';
import { topicAgentOffers } from '../agent-actions.ts';
import type { PrKey } from '../types.ts';
import type { TileView } from '../views.ts';
import type { PropertyBoard } from './build-board.ts';
import { ensure, expectedUnreadRows, isTrackedHere, type Invariant } from './invariant.ts';
import {
  specApprovable,
  specApproveBlock,
  specAsksForYou,
  specGlance,
  specTileApprove,
  specTopicApprove,
  specTopicMarkRead,
  type SpecApprove,
} from './spec-agent-actions.ts';

/** The topic's offers as the read models build them, from the tile views. */
export function topicOffersOf(views: TileView[]) {
  return topicAgentOffers(views.map((view) => ({ tile: view.tile, state: view.state, agent: view.agent })));
}

function keysLine(keys: PrKey[]): string {
  return `[${keys.join(', ')}]`;
}

function sameSet(a: PrKey[], b: PrKey[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

/** No key twice. */
function distinct(keys: PrKey[]): boolean {
  return new Set(keys).size === keys.length;
}

/**
 * One Approve against the spec. `ordered`: the covered PRs keep member
 * order (a tile approves a stack base to head); the topic's lists are
 * compared as sets.
 */
function checkApprove(where: string, got: AgentApproveOffer | null, want: SpecApprove | null, ordered: boolean): void {
  ensure((got === null) === (want === null), `${where}: approve ${got ? got.state : 'absent'}, expected ${want ? want.state : 'absent'}`);
  if (got === null || want === null) {
    return;
  }
  const covered = got.covered.map((pr) => pr.prKey);
  const leftOut = got.leftOut.map((pr) => pr.prKey);
  ensure(distinct([...covered, ...leftOut]), `${where}: a PR named twice, covered ${keysLine(covered)}, left out ${keysLine(leftOut)}`);
  const coveredMatches = ordered ? covered.join() === want.covered.join() : sameSet(covered, want.covered);
  ensure(coveredMatches, `${where}: covers ${keysLine(covered)}, expected ${keysLine(want.covered)}`);
  ensure(sameSet(leftOut, want.leftOut.map((pr) => pr.key)), `${where}: leaves out ${keysLine(leftOut)}, expected ${keysLine(want.leftOut.map((pr) => pr.key))}`);
  for (const pr of got.leftOut) {
    const reason = want.leftOut.find((candidate) => candidate.key === pr.prKey)?.block;
    ensure(pr.reason === reason, `${where}: ${pr.prKey} left out for ${pr.reason}, expected ${reason}`);
  }
  ensure(got.state === want.state, `${where}: approve ${got.state}, expected ${want.state}`);
  ensure(got.reason === want.reason, `${where}: approve greyed for ${got.reason}, expected ${want.reason}`);
  ensure(got.coveredCount === covered.length && got.totalCount === covered.length + leftOut.length, `${where}: counts ${got.coveredCount} of ${got.totalCount}`);
}

/**
 * Approve covers only agent-safe, approvable PRs, and covered and left out
 * split the approvable PRs exactly, each once. Absent exactly when nothing
 * is approvable; a tile and a topic alike are active exactly when at least
 * one approvable PR is agent-safe (owner, 2026-10-01); greyed otherwise,
 * with the reason's precedence from the spec.
 */
export const agentApproveMatchesTheSpec: Invariant = {
  name: 'agent Approve covers exactly the agent-safe approvable PRs, and is active, greyed or absent as the spec says',
  check(board, views) {
    for (const view of views) {
      const offer = view.agent.approve;
      for (const pr of offer?.covered ?? []) {
        const row = view.prs.find((candidate) => candidate.key === pr.prKey);
        ensure(row !== undefined && specApprovable(board, view, row), `${view.tile.id}: covers ${pr.prKey}, which is not approvable`);
        ensure(specApproveBlock(board, pr.prKey) === null, `${view.tile.id}: covers ${pr.prKey}, which is not agent-safe (${specApproveBlock(board, pr.prKey)})`);
      }
      checkApprove(`tile ${view.tile.id}`, offer, specTileApprove(board, view), true);
    }
    checkApprove('topic', topicOffersOf(views).approve, specTopicApprove(board, views), false);
  },
};

/**
 * The topic's Approve is literally its tiles' Approves added up: it covers
 * exactly the union of what the unsnoozed tiles cover, so a PR a tile
 * offers is offered by the topic too, and nothing else. An active tile
 * always covers something, a greyed one nothing.
 */
export const topicApproveCoversTheTilesUnion: Invariant = {
  name: "topic Approve covers exactly the union of the unsnoozed tiles' covered PRs",
  check(_board, views) {
    for (const view of views) {
      const offer = view.agent.approve;
      if (offer !== null) {
        ensure((offer.state === 'active') === (offer.covered.length > 0), `tile ${view.tile.id}: approve ${offer.state} covering ${offer.covered.length}`);
      }
    }
    const fromTiles = [...new Set(views.filter((view) => view.state.kind !== 'snoozed').flatMap((view) => view.agent.approve?.covered.map((pr) => pr.prKey) ?? []))];
    const covered = topicOffersOf(views).approve?.covered.map((pr) => pr.prKey) ?? [];
    ensure(sameSet(covered, fromTiles), `topic covers ${keysLine(covered)}, unsnoozed tiles cover ${keysLine(fromTiles)}`);
  },
};

/** The pill's risk is the highest among the covered PRs; each covered PR carries its own glance and head. Null when greyed. */
export const agentApproveRiskIsTheHighestCovered: Invariant = {
  name: "agent Approve's risk is the highest among the covered PRs",
  check(board, views) {
    const offers = [...views.map((view) => ({ where: `tile ${view.tile.id}`, offer: view.agent.approve })), { where: 'topic', offer: topicOffersOf(views).approve }];
    for (const { where, offer } of offers) {
      if (offer === null) {
        continue;
      }
      for (const pr of offer.covered) {
        const glance = specGlance(board, pr.prKey);
        const headOid = board.prs.get(pr.prKey)?.headOid;
        ensure(pr.risk === glance.risk && pr.riskLine === glance.riskLine && pr.verdict === glance.verdict && pr.headOid === headOid, `${where}: ${pr.prKey} carries ${pr.verdict}/${pr.riskLine}/${pr.headOid}`);
      }
      const risks = offer.covered.map((pr) => specGlance(board, pr.prKey).risk);
      const want = offer.state === 'greyed' ? null : risks.includes('medium') ? 'medium' : 'low';
      ensure(offer.risk === want, `${where}: risk ${offer.risk}, covered ${risks.join(', ')}`);
    }
  },
};

/**
 * The topic's "Mark N read" covers exactly the unread tiles the agent backs:
 * never a tile whose unread PRs ask something of you, a snoozed tile or a
 * read one. Gone exactly when no tile is unread; the pill shows the
 * highest risk, or a reason one of the skipped tiles gives.
 */
export const topicMarkReadMatchesTheSpec: Invariant = {
  name: 'topic Mark N read covers exactly the backed unread tiles, never an ask, a snoozed or a read tile',
  check(board, views) {
    const got = topicOffersOf(views).markRead;
    const want = specTopicMarkRead(board, views);
    ensure((got === null) === (want === null), `mark read ${got ? got.state : 'absent'}, expected ${want ? want.state : 'absent'}`);
    ensure((got === null) === views.every((view) => view.state.kind !== 'unread'), `mark read ${got ? got.state : 'absent'} with tiles ${views.map((view) => view.state.kind).join(', ')}`);
    if (got === null || want === null) {
      return;
    }
    for (const tileId of got.coveredTileIds) {
      const view = views.find((candidate) => candidate.tile.id === tileId);
      ensure(view !== undefined && view.state.kind === 'unread', `covers ${tileId}, which is ${view?.state.kind ?? 'unknown'}`);
      const asks = expectedUnreadRows(board, view!).filter((key) => specAsksForYou(board, key));
      ensure(asks.length === 0, `covers ${tileId}, whose ${keysLine(asks)} ask for you`);
    }
    ensure(got.coveredTileIds.join() === want.coveredTileIds.join(), `covers ${got.coveredTileIds.join(', ')}, expected ${want.coveredTileIds.join(', ')}`);
    ensure(got.skipped.map((tile) => tile.tileId).join() === want.skipped.map((tile) => tile.tileId).join(), `skips ${got.skipped.map((tile) => tile.tileId).join(', ')}, expected ${want.skipped.map((tile) => tile.tileId).join(', ')}`);
    for (const tile of got.skipped) {
      const blocks = want.skipped.find((candidate) => candidate.tileId === tile.tileId)?.blocks ?? [];
      ensure(blocks.includes(tile.reason), `skips ${tile.tileId} for ${tile.reason}, which gives ${blocks.join(', ')}`);
    }
    ensure(got.state === want.state && got.risk === want.risk, `mark read ${got.state}/${got.risk}, expected ${want.state}/${want.risk}`);
    const reasons = want.skipped.flatMap((tile) => tile.blocks);
    ensure(got.state === 'active' ? got.reason === null : got.reason !== null && reasons.includes(got.reason), `mark read greyed for ${got.reason}, skipped tiles give ${reasons.join(', ')}`);
    ensure(got.coveredCount === got.coveredTileIds.length && got.totalCount === views.filter((view) => view.state.kind === 'unread').length, `counts ${got.coveredCount} of ${got.totalCount}`);
  },
};

/** No PR of the tile asks for you and each has a current glance that is not Look closer, at low or medium risk. */
function quietAndBacked(board: PropertyBoard, view: TileView): boolean {
  return view.prs.every((row) => {
    const glance = specGlance(board, row.key);
    return !specAsksForYou(board, row.key) && glance.current && glance.verdict !== 'LOOK_CLOSER' && (glance.risk === 'low' || glance.risk === 'medium');
  });
}

/** Liveness: an unread tile (never snoozed) with no ask whose PRs all have a current, backing glance is covered by "Mark N read". */
export const topicMarkReadCoversQuietBackedTiles: Invariant = {
  name: 'topic Mark N read covers every unread tile with no ask and a current low or medium glance on each PR',
  check(board, views) {
    const covered = topicOffersOf(views).markRead?.coveredTileIds ?? [];
    for (const view of views.filter((candidate) => candidate.state.kind === 'unread' && quietAndBacked(board, candidate))) {
      ensure(covered.includes(view.tile.id), `${view.tile.id}: unread, no ask, every glance current and backing, but not covered`);
    }
  },
};

function isTrackedIn(view: TileView, key: PrKey): boolean {
  return view.tile.members.some((member) => member.prKey === key && isTrackedHere(member.provenance));
}

/** A pulled-in layer is never approved by an agent Approve: a tile covers only its tracked members, the topic only PRs tracked on an unsnoozed tile. */
export const pulledInNeverCovered: Invariant = {
  name: 'agent Approve never covers a pulled-in PR',
  check(_board, views) {
    for (const view of views) {
      for (const pr of view.agent.approve?.covered ?? []) {
        ensure(isTrackedIn(view, pr.prKey), `tile ${view.tile.id}: covers pulled-in ${pr.prKey}`);
      }
    }
    const unsnoozed = views.filter((view) => view.state.kind !== 'snoozed');
    for (const pr of topicOffersOf(views).approve?.covered ?? []) {
      ensure(unsnoozed.some((view) => isTrackedIn(view, pr.prKey)), `topic: covers ${pr.prKey}, tracked on no unsnoozed tile`);
    }
  },
};

export const AGENT_ACTION_INVARIANTS: readonly Invariant[] = [
  agentApproveMatchesTheSpec,
  agentApproveRiskIsTheHighestCovered,
  topicApproveCoversTheTilesUnion,
  topicMarkReadMatchesTheSpec,
  topicMarkReadCoversQuietBackedTiles,
  pulledInNeverCovered,
];
