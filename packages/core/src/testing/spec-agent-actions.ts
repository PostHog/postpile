// The agent-assisted offers restated from the spec (DESIGN "Agent-assisted
// actions", 2026-09-30): agent-safe and approvable PRs, the tile and topic
// ✨ Approve (base up on a stack, 2026-10-01), the tile's Mark read backing
// and the topic's "Mark N read".
// Read from the board (the stored glance, its risk line and stale flag,
// the snapshot and the events), never from `agent-actions.ts`. Approvable
// restates today's Approve rule the way `spec-offers.ts` does, done and
// ask-for-you come from the spec oracles. Type imports only from the rule
// modules.
import type { AgentBlock, AgentOfferState, ApproveNaming, BackedRisk, LeftOutReason, MarkReadBlock, RiskLevel } from '../agent-actions.ts';
// The oracles read the raw snapshot, every stored body (`FullPr`); the rules under test read the board shape.
import type { FullPr as Pr, PrKey, FullReview as Review, Verdict } from '../types.ts';
import type { PrSummary, TileView } from '../views.ts';
import type { PropertyBoard } from './build-board.ts';
import { eventsOf, expectedUnreadRows, isTrackedHere, fullPrOf } from './invariant.ts';
import { viewerApproved, viewerOwns } from './spec-facts.ts';
import { expectedDone, expectedNewMove, expectedTurn, isUnseenMergeWithoutViewer, type TurnInput } from './spec-rules.ts';

/** The stored glance as the agent actions read it. */
export interface SpecGlance {
  /** A glance exists and is not stale. */
  current: boolean;
  verdict: Verdict | null;
  riskLine: string | null;
  risk: RiskLevel | null;
}

/** "medium - touches the worker loop" is medium: the first word, low or medium; any other word counts as high. */
export function specRiskLevel(riskLine: string): RiskLevel {
  const word = riskLine.trim().split(/\s+/)[0] ?? '';
  return word === 'low' || word === 'medium' ? word : 'high';
}

export function specGlance(board: PropertyBoard, key: PrKey): SpecGlance {
  const verdict = board.glances.get(key) ?? null;
  const riskLine = verdict === null ? null : (board.glanceRisks.get(key) ?? null);
  return {
    current: verdict !== null && !board.staleGlances.has(key),
    verdict,
    riskLine,
    risk: riskLine === null ? null : specRiskLevel(riskLine),
  };
}

function isBacked(risk: RiskLevel | null): risk is BackedRisk {
  return risk === 'low' || risk === 'medium';
}

/** Medium when any is medium, else low. */
export function specHighestRisk(risks: BackedRisk[]): BackedRisk {
  return risks.includes('medium') ? 'medium' : 'low';
}

/** A glance is wanted on an open PR, and on a merged one while a merge without the viewer's review is unseen (event not seen, not muted). */
function specGlanceWanted(board: PropertyBoard, key: PrKey): boolean {
  const state = fullPrOf(board, key).state;
  return state === 'OPEN' || (state === 'MERGED' && eventsOf(board, key).some(isUnseenMergeWithoutViewer));
}

/** Why a PR is not agent-safe, or null when it is: a current glance, Looks safe, risk low or medium. */
export function specApproveBlock(board: PropertyBoard, key: PrKey): AgentBlock | null {
  const glance = specGlance(board, key);
  if (!glance.current) {
    return 'rechecking';
  }
  if (glance.verdict !== 'LOOKS_SAFE') {
    return 'look_closer';
  }
  return isBacked(glance.risk) ? null : 'high';
}

function turnInput(board: PropertyBoard, key: PrKey): TurnInput {
  return { pr: fullPrOf(board, key), events: eventsOf(board, key), viewer: board.viewer, userState: board.userStates.get(key) ?? null, notYours: board.notYours.has(key) };
}

/** Someone approved on GitHub: GitHub's decision says approved, or a reviewer's newest approve, changes or dismissed review is an approval. */
export function specApprovedOnGitHub(pr: Pr): boolean {
  const newestByReviewer = new Map<string, Review>();
  for (const review of pr.reviews.filter((candidate) => ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(candidate.state))) {
    const seen = newestByReviewer.get(review.author);
    if (!seen || review.submittedAt >= seen.submittedAt) {
      newestByReviewer.set(review.author, review);
    }
  }
  return pr.reviewDecision === 'APPROVED' || [...newestByReviewer.values()].some((review) => review.state === 'APPROVED');
}

/**
 * Approvable: today's Approve rule, where the pane leads with Approve.
 * Someone else's open, non-draft PR the viewer has not approved, on a tile
 * that is not done and not done itself, tracked (not a pulled-in layer),
 * and nobody approved it on GitHub yet (owner, 2026-09-30).
 */
export function specApprovable(board: PropertyBoard, view: TileView, row: PrSummary): boolean {
  if (!isTrackedHere(row.provenance) || view.state.kind === 'done') {
    return false;
  }
  const input = turnInput(board, row.key);
  const { pr, userState } = input;
  if (pr.state !== 'OPEN' || pr.isDraft || viewerOwns(pr, board.viewer) || viewerApproved(pr, board.viewer, userState) || specApprovedOnGitHub(pr)) {
    return false;
  }
  return !expectedDone({ ...input, lastReadAt: board.threads.get(row.key)?.lastReadAt ?? null });
}

/** A PR an Approve names, with why it is left out (null when covered). */
export interface SpecApprovePr {
  key: PrKey;
  block: LeftOutReason | null;
  /** On `layer_below`: the lowest layer below it that blocks it. */
  waitsOn: PrKey | null;
}

export interface SpecApprove {
  state: AgentOfferState;
  risk: BackedRisk | null;
  reason: AgentBlock | null;
  /** Covered PRs, in member order on a tile. */
  covered: PrKey[];
  leftOut: SpecApprovePr[];
  /** Every PR the button stands for: the tile's rows, or each PR of the unsnoozed tiles once. */
  prCount: number;
  naming: ApproveNaming;
}

/** The layers below `key` in its stack on the tile, base first; empty outside a stack. */
export function specLayersBelow(view: TileView, key: PrKey): PrKey[] {
  const stack = view.tile.stacks.find((candidate) => candidate.prKeys.includes(key));
  return stack ? stack.prKeys.slice(0, stack.prKeys.indexOf(key)) : [];
}

/**
 * The lowest layer below `key` that blocks it (owner, 2026-10-01, base up):
 * approvable on this tile but not agent-safe. Layers that are not
 * approvable (merged, draft, the viewer's own, approved already, dealt
 * with, pulled in) never block. Null outside a stack or with no such layer.
 */
export function specBlockingLayerBelow(board: PropertyBoard, view: TileView, key: PrKey): PrKey | null {
  const approvableBelow = specLayersBelow(view, key).filter((layer) => {
    const row = view.prs.find((candidate) => candidate.key === layer);
    return row !== undefined && specApprovable(board, view, row);
  });
  return approvableBelow.find((layer) => specApproveBlock(board, layer) !== null) ?? null;
}

/** The tile's approvable PRs: an agent-safe one is covered unless a layer below blocks it; a layer below that blocks wins over its own block. */
function approvePrsOf(board: PropertyBoard, view: TileView): SpecApprovePr[] {
  return view.prs
    .filter((row) => specApprovable(board, view, row))
    .map((row) => {
      const waitsOn = specBlockingLayerBelow(board, view, row.key);
      if (waitsOn !== null) {
        return { key: row.key, block: 'layer_below', waitsOn };
      }
      return { key: row.key, block: specApproveBlock(board, row.key), waitsOn: null };
    });
}

/** The PRs' own agent blocks, without `layer_below`: what a greyed pill can say. */
function ownBlocksOf(prs: SpecApprovePr[]): AgentBlock[] {
  return prs.flatMap((pr) => (pr.block === null || pr.block === 'layer_below' ? [] : [pr.block]));
}

/** Greyed names nothing; exactly one covered out of several PRs is named; covering every PR says so; else some. */
export function specApproveNaming(state: AgentOfferState, covered: number, prCount: number): ApproveNaming {
  if (state === 'greyed') {
    return 'none';
  }
  if (covered === 1 && prCount > 1) {
    return 'one';
  }
  return covered === prCount ? 'every' : 'some';
}

function coveredRisks(board: PropertyBoard, covered: PrKey[]): BackedRisk[] {
  return covered.map((key) => specGlance(board, key).risk).filter(isBacked);
}

/**
 * The tile's ✨ Approve: gone without an approvable PR; active when at least
 * one approvable PR is covered (agent-safe, nothing below it in its stack
 * blocks it), covering only those, with the highest risk among them
 * (owner, 2026-10-01: like the topic's); else greyed. The reason is an own
 * block, never `layer_below`: rechecking when any is stale or missing, else
 * look closer, else high. On a stack only the lowest blocking layer keeps
 * its own block, so that one names the reason.
 */
export function specTileApprove(board: PropertyBoard, view: TileView): SpecApprove | null {
  const prs = approvePrsOf(board, view);
  if (prs.length === 0) {
    return null;
  }
  const covered = prs.filter((pr) => pr.block === null).map((pr) => pr.key);
  const leftOut = prs.filter((pr) => pr.block !== null);
  const prCount = view.prs.length;
  if (covered.length > 0) {
    return { state: 'active', risk: specHighestRisk(coveredRisks(board, covered)), reason: null, covered, leftOut, prCount, naming: specApproveNaming('active', covered.length, prCount) };
  }
  const blocks = ownBlocksOf(leftOut);
  const reason: AgentBlock = blocks.includes('rechecking') ? 'rechecking' : blocks.includes('look_closer') ? 'look_closer' : 'high';
  return { state: 'greyed', risk: null, reason, covered, leftOut, prCount, naming: 'none' };
}

/**
 * The topic's ✨ Approve: every approvable PR of its unsnoozed tiles, once,
 * with the tile's verdict on it (so base up on stacks too). Gone without
 * one; active when at least one is covered ("Approve 3 of 5 PRs"); else
 * greyed, rechecking if any is rechecking, else look closer.
 */
export function specTopicApprove(board: PropertyBoard, views: TileView[]): SpecApprove | null {
  const unsnoozed = views.filter((candidate) => candidate.state.kind !== 'snoozed');
  const byKey = new Map<PrKey, SpecApprovePr>();
  for (const view of unsnoozed) {
    for (const pr of approvePrsOf(board, view)) {
      byKey.set(pr.key, pr);
    }
  }
  const prs = [...byKey.values()];
  if (prs.length === 0) {
    return null;
  }
  const covered = prs.filter((pr) => pr.block === null).map((pr) => pr.key);
  const leftOut = prs.filter((pr) => pr.block !== null);
  const prCount = new Set(unsnoozed.flatMap((view) => view.prs.map((row) => row.key))).size;
  if (covered.length > 0) {
    return { state: 'active', risk: specHighestRisk(coveredRisks(board, covered)), reason: null, covered, leftOut, prCount, naming: specApproveNaming('active', covered.length, prCount) };
  }
  const reason: AgentBlock = leftOut.some((pr) => pr.block === 'rechecking') ? 'rechecking' : 'look_closer';
  return { state: 'greyed', risk: null, reason, covered, leftOut, prCount, naming: 'none' };
}

/**
 * The PR's news asks something of the viewer: a move of theirs (not merging
 * their approved PR) that is new since GitHub's read of the thread; never
 * read, any such move.
 */
export function specAsksForYou(board: PropertyBoard, key: PrKey): boolean {
  const input = turnInput(board, key);
  const lastReadAt = board.threads.get(key)?.lastReadAt ?? null;
  if (lastReadAt === null) {
    const turn = expectedTurn(input);
    return turn.kind === 'you' && turn.move !== 'merge';
  }
  return expectedNewMove(input, lastReadAt);
}

/** Every reason the agent does not back marking this PR read: an ask for you, no current glance, Look closer, high risk. Empty when it does. */
export function specMarkReadBlocks(board: PropertyBoard, key: PrKey): MarkReadBlock[] {
  const glance = specGlance(board, key);
  const blocks: MarkReadBlock[] = [];
  if (specAsksForYou(board, key)) {
    blocks.push('asks_for_you');
  }
  if (!specGlanceWanted(board, key)) {
    return blocks;
  }
  if (!glance.current) {
    return [...blocks, 'rechecking'];
  }
  if (glance.verdict === 'LOOK_CLOSER') {
    blocks.push('look_closer');
  }
  if (!isBacked(glance.risk)) {
    blocks.push('high');
  }
  return blocks;
}

export interface SpecTileMarkRead {
  state: AgentOfferState;
  risk: BackedRisk | null;
  /** Every reason some unread PR gives; the offer names one of them. */
  blocks: MarkReadBlock[];
}

/**
 * The backing of an unread tile's Mark read (null on any other tile): the
 * unread news holds no ask for you and every unread PR has a current glance
 * that is not Look closer, at low or medium risk.
 */
export function specTileMarkRead(board: PropertyBoard, view: TileView): SpecTileMarkRead | null {
  if (view.state.kind !== 'unread') {
    return null;
  }
  const unread = expectedUnreadRows(board, view);
  const blocks = [...new Set(unread.flatMap((key) => specMarkReadBlocks(board, key)))];
  if (blocks.length > 0) {
    return { state: 'greyed', risk: null, blocks };
  }
  const risks = unread.map((key) => specGlance(board, key).risk).filter(isBacked);
  return { state: 'active', risk: specHighestRisk(risks), blocks };
}

export interface SpecTopicMarkRead {
  state: AgentOfferState;
  risk: BackedRisk | null;
  coveredTileIds: string[];
  /** The unread tiles left unread, with every reason each gives. */
  skipped: { tileId: string; blocks: MarkReadBlock[] }[];
}

/**
 * The topic's ✨ "Mark N read": the unread tiles (snoozed and read tiles are
 * never unread) whose Mark read the agent backs; the rest are skipped. Gone
 * when no tile is unread, greyed when none qualifies.
 */
export function specTopicMarkRead(board: PropertyBoard, views: TileView[]): SpecTopicMarkRead | null {
  const backings = views.flatMap((view) => {
    const backing = specTileMarkRead(board, view);
    return backing ? [{ tileId: view.tile.id, backing }] : [];
  });
  if (backings.length === 0) {
    return null;
  }
  const covered = backings.filter((tile) => tile.backing.state === 'active');
  const skipped = backings.filter((tile) => tile.backing.state === 'greyed').map((tile) => ({ tileId: tile.tileId, blocks: tile.backing.blocks }));
  const risks = covered.map((tile) => tile.backing.risk).filter(isBacked);
  return {
    state: covered.length > 0 ? 'active' : 'greyed',
    risk: covered.length > 0 ? specHighestRisk(risks) : null,
    coveredTileIds: covered.map((tile) => tile.tileId),
    skipped,
  };
}
