// Agent-assisted Approve and Mark read on a tile or a whole topic (DESIGN.md
// "Agent-assisted actions", 2026-09-30). An action carries a ✨ pill when the
// agent's current verdicts back it. Core decides every offer here, shipped as
// `TileView.agent` and `TopicDetail.agent`; the renderer only displays them.
//
// The rules reuse what exists: Approve's own rule (`paneOffers`, lead
// `approve`), the glance's stale flag, the "New moves only" asks
// (`isNewYourMove`), the snoozed tile state and provenance.
import { isTracked } from './provenance.ts';
import { isNewYourMove } from './quiet-reads.ts';
import type { IsoTime, Pr, PrEvent, PrKey, Tile, TileState, UserPrState, Verdict, Viewer } from './types.ts';
import type { TileView } from './views.ts';
import { prWhoseTurn } from './whose-turn.ts';

/** The first word of the glance's risk line. Anything unreadable counts as high. */
export type RiskLevel = 'low' | 'medium' | 'high';

/** A risk the agent can back an action at: the pill's `✨ low` / `✨ medium`. */
export type BackedRisk = 'low' | 'medium';

/** Whether a button is usable (active) or shown disabled with its reason in the pill (greyed). */
export type AgentOfferState = 'active' | 'greyed';

/**
 * Why the agent cannot back an action on a PR:
 * - rechecking: the glance is stale or missing ("✨ rechecking…")
 * - look_closer: the verdict is not Looks safe ("✨ look closer")
 * - high: Looks safe, but the risk is high or unreadable ("✨ high")
 */
export type AgentBlock = 'rechecking' | 'look_closer' | 'high';

/** Why the agent cannot back a Mark read: an agent block, or the unread news asks something of you ("✨ asks for you"). */
export type MarkReadBlock = AgentBlock | 'asks_for_you';

/** What the agent actions read of one PR besides its row: the glance and the head. Built from the row's own inputs (`agentPrFacts`). */
export interface AgentPrFacts {
  key: PrKey;
  /** A glance exists and is not stale. */
  current: boolean;
  /** The stored glance's verdict, stale or not; null without a glance. */
  verdict: Verdict | null;
  /** The glance's risk line as written ("medium - touches the worker loop"); null without a glance. */
  riskLine: string | null;
  /** The risk line's first word (`riskLevelOf`); null without a glance. */
  risk: RiskLevel | null;
  /** The head commit, for the approve's head guard. */
  headOid: string;
  /** Its news asks something of you: a move of yours that is new since your last read ("New moves only", `isNewYourMove`). */
  askForYou: boolean;
}

/** A PR an agent Approve covers, with what the confirm list shows and what the approve call needs. */
export interface AgentApprovePr {
  prKey: PrKey;
  title: string;
  headOid: string;
  verdict: Verdict;
  riskLine: string;
  risk: BackedRisk;
}

/** An approvable PR the agent does not back, named in the confirm list with its reason. */
export interface LeftOutPr {
  prKey: PrKey;
  title: string;
  reason: AgentBlock;
  /** The stored verdict and risk line, for the confirm list; null without a glance. */
  verdict: Verdict | null;
  riskLine: string | null;
}

/**
 * The ✨ Approve button, on a tile's footer or the topic header. Absent (null
 * on the view) when there is no approvable PR at all.
 * - active: approves `covered`, base to head on a stack; the pill shows `risk`.
 * - greyed: disabled, the pill shows `reason`.
 * A tile is active only when every approvable PR is covered; a topic is
 * active when at least one is ("Approve 3 of 5 PRs"). On a greyed tile
 * `covered` still lists the PRs that would qualify, but nothing is approved.
 */
export interface AgentApproveOffer {
  state: AgentOfferState;
  /** The highest risk among the covered PRs; null when greyed. */
  risk: BackedRisk | null;
  /** Why it is greyed; null when active. */
  reason: AgentBlock | null;
  covered: AgentApprovePr[];
  leftOut: LeftOutPr[];
  /** covered.length: the 3 in "Approve 3 of 5 PRs". */
  coveredCount: number;
  /** Every approvable PR: the 5 in "Approve 3 of 5 PRs". */
  totalCount: number;
}

/**
 * The ✨ pill on a tile's existing Mark read. Absent (null) when the tile is
 * not unread. active: the agent backs it, the pill shows `risk`. greyed: it
 * does not, and the tile shows a plain Mark read (no greyed ✨ on a normal
 * action); `reason` is there for the topic's "Mark N read".
 */
export interface TileMarkReadBacking {
  state: AgentOfferState;
  /** The highest risk among the tile's unread PRs; null when greyed. */
  risk: BackedRisk | null;
  /** Why the agent does not back it; null when active. */
  reason: MarkReadBlock | null;
}

/** The agent actions of one tile. */
export interface TileAgentOffers {
  approve: AgentApproveOffer | null;
  markRead: TileMarkReadBacking | null;
}

/** An unread tile the topic's "Mark N read" leaves unread, with why. */
export interface SkippedTile {
  tileId: string;
  reason: MarkReadBlock;
}

/**
 * The topic header's ✨ "Mark N read". Absent (null) when no unsnoozed tile
 * is unread. active: marks `coveredTileIds` read as one batch with one Undo;
 * the pill shows `risk`. greyed: tiles are unread but none qualifies, the
 * pill shows `reason`.
 */
export interface TopicMarkReadOffer {
  state: AgentOfferState;
  /** The highest risk among the covered tiles; null when greyed. */
  risk: BackedRisk | null;
  /** Why it is greyed; null when active. */
  reason: MarkReadBlock | null;
  coveredTileIds: string[];
  skipped: SkippedTile[];
  /** coveredTileIds.length: the N in "Mark N read". */
  coveredCount: number;
  /** Every unread, unsnoozed tile. */
  totalCount: number;
}

/** The agent actions of a topic's header. */
export interface TopicAgentOffers {
  approve: AgentApproveOffer | null;
  markRead: TopicMarkReadOffer | null;
}

export const NO_TOPIC_AGENT_OFFERS: TopicAgentOffers = { approve: null, markRead: null };

/** "medium - touches the worker loop" is medium; anything but low or medium as the first word is high. */
export function riskLevelOf(riskLine: string): RiskLevel {
  const word = /^[a-z]+/i.exec(riskLine.trim())?.[0]?.toLowerCase();
  return word === 'low' || word === 'medium' ? word : 'high';
}

export interface AgentPrFactsInput {
  pr: Pr;
  viewer: Viewer | null;
  userState: UserPrState | null;
  events: PrEvent[];
  glance: { verdict: Verdict; risk: string } | null;
  glanceStale: boolean;
  /** GitHub's read time of the PR's thread: the "New moves only" boundary. Null when never read. */
  lastReadAt: IsoTime | null;
}

/** Your move asks something (not merging your approved PR) and is new since the last read; never read, any such move is new. */
function asksForYou(input: AgentPrFactsInput): boolean {
  const { pr, events, userState, viewer } = input;
  if (!viewer) {
    return false;
  }
  const notYours = input.glance?.verdict === 'NOT_YOURS';
  if (input.lastReadAt === null) {
    const turn = prWhoseTurn({ pr, events, userState, viewer, notYours });
    return turn.kind === 'you' && turn.move !== 'merge';
  }
  return isNewYourMove({ pr, events, userState, viewer, notYours }, input.lastReadAt);
}

/** One PR's agent facts, from the same inputs as its row (`PrSummaryInput` fits). */
export function agentPrFacts(input: AgentPrFactsInput): AgentPrFacts {
  const glance = input.glance;
  return {
    key: input.pr.key,
    current: glance !== null && !input.glanceStale,
    verdict: glance?.verdict ?? null,
    riskLine: glance?.risk ?? null,
    risk: glance ? riskLevelOf(glance.risk) : null,
    headOid: input.pr.headOid,
    askForYou: asksForYou(input),
  };
}

/** Low and medium are risks the agent can back; high and no glance are not. */
function backedRisk(risk: RiskLevel | null): BackedRisk | null {
  return risk === 'low' || risk === 'medium' ? risk : null;
}

/** Why the agent does not back approving this PR, or null when it is agent-safe: current glance, Looks safe, low or medium risk. */
function approveBlock(facts: AgentPrFacts): AgentBlock | null {
  if (!facts.current) {
    return 'rechecking';
  }
  if (facts.verdict !== 'LOOKS_SAFE') {
    return 'look_closer';
  }
  return backedRisk(facts.risk) === null ? 'high' : null;
}

/** Why the agent does not back marking this unread PR read, or null: no ask for you, a current glance that is not Look closer, low or medium risk. */
function markReadBlock(facts: AgentPrFacts): MarkReadBlock | null {
  if (facts.askForYou) {
    return 'asks_for_you';
  }
  if (!facts.current) {
    return 'rechecking';
  }
  if (facts.verdict === 'LOOK_CLOSER') {
    return 'look_closer';
  }
  return backedRisk(facts.risk) === null ? 'high' : null;
}

function highestRisk(risks: BackedRisk[]): BackedRisk {
  return risks.includes('medium') ? 'medium' : 'low';
}

/** The first reason in `order` that any of `reasons` holds. */
function firstReason<T extends string>(reasons: T[], order: T[]): T | null {
  return order.find((reason) => reasons.includes(reason)) ?? null;
}

const TILE_APPROVE_ORDER: AgentBlock[] = ['rechecking', 'look_closer', 'high'];
const TILE_MARK_READ_ORDER: MarkReadBlock[] = ['asks_for_you', 'rechecking', 'look_closer', 'high'];
// Rechecking first: waiting helps there, an ask for you or a verdict does not go away by itself.
const TOPIC_MARK_READ_ORDER: MarkReadBlock[] = ['rechecking', 'asks_for_you', 'look_closer', 'high'];

/** What the agent offers read of the tile view: the rows, Approve's own rule (`offers.pane`), the state and the unread PRs. */
export type AgentOfferView = Pick<TileView, 'prs' | 'offers' | 'state' | 'unreadPrKeys'>;

/** Approvable: exactly today's Approve rule (the pane leads with `approve`), and tracked, not a pulled-in layer. */
function approvablePrs(view: AgentOfferView): AgentOfferView['prs'] {
  return view.prs.filter((pr) => view.offers.pane[pr.key]?.lead === 'approve' && isTracked(pr.provenance));
}

/** The covered entry of an agent-safe PR (`approveBlock` says null), else null. */
function coveredPr(pr: AgentOfferView['prs'][number], fact: AgentPrFacts): AgentApprovePr | null {
  const risk = backedRisk(fact.risk);
  if (approveBlock(fact) !== null || fact.verdict === null || fact.riskLine === null || risk === null) {
    return null;
  }
  return { prKey: pr.key, title: pr.title, headOid: fact.headOid, verdict: fact.verdict, riskLine: fact.riskLine, risk };
}

/** The tile's approvable PRs in member order (base to head on a stack), split into agent-safe and left out. */
function splitApprovable(view: AgentOfferView, facts: Map<PrKey, AgentPrFacts>): { covered: AgentApprovePr[]; leftOut: LeftOutPr[] } {
  const covered: AgentApprovePr[] = [];
  const leftOut: LeftOutPr[] = [];
  for (const pr of approvablePrs(view)) {
    const fact = facts.get(pr.key);
    const safe = fact ? coveredPr(pr, fact) : null;
    if (safe) {
      covered.push(safe);
    } else {
      leftOut.push({ prKey: pr.key, title: pr.title, reason: (fact && approveBlock(fact)) ?? 'rechecking', verdict: fact?.verdict ?? null, riskLine: fact?.riskLine ?? null });
    }
  }
  return { covered, leftOut };
}

/** The tile's ✨ Approve: gone without an approvable PR, active when every one is agent-safe, else greyed. */
export function tileApproveOffer(view: AgentOfferView, facts: Map<PrKey, AgentPrFacts>): AgentApproveOffer | null {
  const { covered, leftOut } = splitApprovable(view, facts);
  const totalCount = covered.length + leftOut.length;
  if (totalCount === 0) {
    return null;
  }
  const active = leftOut.length === 0;
  return {
    state: active ? 'active' : 'greyed',
    risk: active ? highestRisk(covered.map((pr) => pr.risk)) : null,
    reason: active ? null : firstReason(leftOut.map((pr) => pr.reason), TILE_APPROVE_ORDER),
    covered,
    leftOut,
    coveredCount: covered.length,
    totalCount,
  };
}

/** The ✨ pill on the tile's Mark read: only on an unread tile; active when no unread PR asks for you and each has a current, backing glance. */
export function tileMarkReadBacking(view: AgentOfferView, facts: Map<PrKey, AgentPrFacts>): TileMarkReadBacking | null {
  if (view.state.kind !== 'unread') {
    return null;
  }
  const unread = view.unreadPrKeys.map((key) => facts.get(key));
  const blocks = unread.flatMap((fact) => {
    const block = fact ? markReadBlock(fact) : 'rechecking';
    return block === null ? [] : [block];
  });
  const risks = unread.flatMap((fact) => backedRisk(fact?.risk ?? null) ?? []);
  if (unread.length === 0 || blocks.length > 0) {
    return { state: 'greyed', risk: null, reason: firstReason(blocks, TILE_MARK_READ_ORDER) ?? 'rechecking' };
  }
  return { state: 'active', risk: highestRisk(risks), reason: null };
}

/** Both agent offers of a tile. `facts` holds the tile's PRs (`agentPrFacts`). */
export function tileAgentOffers(view: AgentOfferView, facts: AgentPrFacts[]): TileAgentOffers {
  const byKey = new Map(facts.map((fact) => [fact.key, fact]));
  return { approve: tileApproveOffer(view, byKey), markRead: tileMarkReadBacking(view, byKey) };
}

/** What the topic offers read of each tile view. */
export type TopicAgentTile = { tile: Pick<Tile, 'id'>; state: Pick<TileState, 'kind'>; agent: TileAgentOffers };

/**
 * The topic's ✨ Approve: the approvable PRs of its unsnoozed tiles (each PR
 * once). It approves the agent-safe ones and names the rest. Gone without an
 * approvable PR; greyed when none is agent-safe, `rechecking` if any is
 * rechecking, else `look_closer`.
 */
export function topicApproveOffer(tiles: TopicAgentTile[]): AgentApproveOffer | null {
  const seen = new Set<PrKey>();
  const covered: AgentApprovePr[] = [];
  const leftOut: LeftOutPr[] = [];
  for (const view of tiles.filter((candidate) => candidate.state.kind !== 'snoozed')) {
    for (const pr of view.agent.approve?.covered ?? []) {
      if (!seen.has(pr.prKey)) {
        seen.add(pr.prKey);
        covered.push(pr);
      }
    }
    for (const pr of view.agent.approve?.leftOut ?? []) {
      if (!seen.has(pr.prKey)) {
        seen.add(pr.prKey);
        leftOut.push(pr);
      }
    }
  }
  const totalCount = covered.length + leftOut.length;
  if (totalCount === 0) {
    return null;
  }
  const active = covered.length > 0;
  return {
    state: active ? 'active' : 'greyed',
    risk: active ? highestRisk(covered.map((pr) => pr.risk)) : null,
    reason: active ? null : leftOut.some((pr) => pr.reason === 'rechecking') ? 'rechecking' : 'look_closer',
    covered,
    leftOut,
    coveredCount: covered.length,
    totalCount,
  };
}

/**
 * The topic's ✨ "Mark N read": the unread, unsnoozed tiles whose Mark read
 * the agent backs. The others are skipped and stay unread. Gone when no such
 * tile is unread; greyed when none qualifies.
 */
export function topicMarkReadOffer(tiles: TopicAgentTile[]): TopicMarkReadOffer | null {
  const unread = tiles.filter((view) => view.state.kind === 'unread' && view.agent.markRead !== null);
  if (unread.length === 0) {
    return null;
  }
  const covered = unread.filter((view) => view.agent.markRead?.state === 'active');
  const skipped = unread.flatMap((view) => {
    const backing = view.agent.markRead;
    return backing && backing.state === 'greyed' ? [{ tileId: view.tile.id, reason: backing.reason ?? 'rechecking' }] : [];
  });
  const risks = covered.flatMap((view) => (view.agent.markRead?.risk ? [view.agent.markRead.risk] : []));
  const active = covered.length > 0;
  return {
    state: active ? 'active' : 'greyed',
    risk: active ? highestRisk(risks) : null,
    reason: active ? null : firstReason(skipped.map((tile) => tile.reason), TOPIC_MARK_READ_ORDER),
    coveredTileIds: covered.map((view) => view.tile.id),
    skipped,
    coveredCount: covered.length,
    totalCount: unread.length,
  };
}

/** "Approved 3 PRs", or "Approved 2 of 3 PRs" with the first failure's reason; ok only when every PR was approved. */
export function approvalsSummary(results: { prKey: PrKey; ok: boolean; message: string }[]): { ok: boolean; message: string } {
  const approved = results.filter((result) => result.ok).length;
  const failure = results.find((result) => !result.ok);
  if (!failure) {
    return { ok: results.length > 0, message: results.length === 1 ? 'Approved' : `Approved ${approved} PRs` };
  }
  return { ok: false, message: `Approved ${approved} of ${results.length} PRs; ${failure.prKey}: ${failure.message}` };
}

/** Both agent offers of a topic's header, from its tile views. */
export function topicAgentOffers(tiles: TopicAgentTile[]): TopicAgentOffers {
  return { approve: topicApproveOffer(tiles), markRead: topicMarkReadOffer(tiles) };
}
