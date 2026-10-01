// The agent-assisted offers restated from the spec (DESIGN "Agent-assisted
// actions", 2026-09-30): agent-safe and approvable PRs, the tile and topic
// ✨ Approve, the tile's Mark read backing and the topic's "Mark N read".
// Read from the board (the stored glance, its risk line and stale flag,
// the snapshot and the events), never from `agent-actions.ts`. Approvable
// restates today's Approve rule the way `spec-offers.ts` does, done and
// ask-for-you come from the spec oracles. Type imports only from the rule
// modules.
import type { AgentBlock, AgentOfferState, BackedRisk, MarkReadBlock, RiskLevel } from '../agent-actions.ts';
import type { Pr, PrKey, Review, Verdict } from '../types.ts';
import type { PrSummary, TileView } from '../views.ts';
import type { PropertyBoard } from './build-board.ts';
import { eventsOf, expectedUnreadRows, isTrackedHere, prOf } from './invariant.ts';
import { viewerApproved, viewerOwns } from './spec-facts.ts';
import { expectedDone, expectedNewMove, expectedTurn, type TurnInput } from './spec-rules.ts';

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
  return { pr: prOf(board, key), events: eventsOf(board, key), viewer: board.viewer, userState: board.userStates.get(key) ?? null, notYours: board.notYours.has(key) };
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
  block: AgentBlock | null;
}

export interface SpecApprove {
  state: AgentOfferState;
  risk: BackedRisk | null;
  reason: AgentBlock | null;
  /** Covered PRs, in member order on a tile. */
  covered: PrKey[];
  leftOut: SpecApprovePr[];
}

function approvePrsOf(board: PropertyBoard, view: TileView): SpecApprovePr[] {
  return view.prs.filter((row) => specApprovable(board, view, row)).map((row) => ({ key: row.key, block: specApproveBlock(board, row.key) }));
}

function coveredRisks(board: PropertyBoard, covered: PrKey[]): BackedRisk[] {
  return covered.map((key) => specGlance(board, key).risk).filter(isBacked);
}

/**
 * The tile's ✨ Approve: gone without an approvable PR; active when every
 * approvable PR is agent-safe, with the highest risk; else greyed,
 * rechecking when any glance is stale or missing, else look closer, else
 * high.
 */
export function specTileApprove(board: PropertyBoard, view: TileView): SpecApprove | null {
  const prs = approvePrsOf(board, view);
  if (prs.length === 0) {
    return null;
  }
  const covered = prs.filter((pr) => pr.block === null).map((pr) => pr.key);
  const leftOut = prs.filter((pr) => pr.block !== null);
  if (leftOut.length === 0) {
    return { state: 'active', risk: specHighestRisk(coveredRisks(board, covered)), reason: null, covered, leftOut };
  }
  const blocks = leftOut.map((pr) => pr.block);
  const reason: AgentBlock = blocks.includes('rechecking') ? 'rechecking' : blocks.includes('look_closer') ? 'look_closer' : 'high';
  return { state: 'greyed', risk: null, reason, covered, leftOut };
}

/**
 * The topic's ✨ Approve: every approvable PR of its unsnoozed tiles, once.
 * Gone without one; active when at least one is agent-safe ("Approve 3 of
 * 5 PRs"); else greyed, rechecking if any is rechecking, else look closer.
 */
export function specTopicApprove(board: PropertyBoard, views: TileView[]): SpecApprove | null {
  const byKey = new Map<PrKey, SpecApprovePr>();
  for (const view of views.filter((candidate) => candidate.state.kind !== 'snoozed')) {
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
  if (covered.length > 0) {
    return { state: 'active', risk: specHighestRisk(coveredRisks(board, covered)), reason: null, covered, leftOut };
  }
  const reason: AgentBlock = leftOut.some((pr) => pr.block === 'rechecking') ? 'rechecking' : 'look_closer';
  return { state: 'greyed', risk: null, reason, covered, leftOut };
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
