// Agent-assisted Approve and Mark read on a tile or a whole topic (DESIGN.md
// "Agent-assisted actions", 2026-09-30). An action carries a ✨ pill when the
// agent's current verdicts back it. Core decides every offer here, shipped as
// `TileView.agent` and `TopicDetail.agent`; the renderer only displays them.
//
// The rules reuse what exists: Approve's own rule (`paneOffers`, lead
// `approve`), who approved (`standingApprovals`), the glance's stale flag, the "New moves only" asks
// (`isNewYourMove`), the snoozed tile state and provenance.
import { standingApprovals } from './approvals.ts';
import { isTracked } from './provenance.ts';
import { prWantsGlance } from './loudness.ts';
import { isNewYourMove } from './quiet-reads.ts';
import type { IsoTime, Pr, PrEvent, PrKey, Tile, TileStack, TileState, UserPrState, Verdict, Viewer } from './types.ts';
import type { PrApproveResult, TileView } from './views.ts';
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

/**
 * Why an approvable PR is left out of an agent Approve: its own agent block,
 * or `layer_below`: a lower layer of its stack is approvable but not
 * agent-safe, so approving this one waits for that one (owner, 2026-10-01).
 * `layer_below` only names a left-out PR; it is never a greyed pill's reason.
 */
export type LeftOutReason = AgentBlock | 'layer_below';

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
  /** The PR gets a glance (`prWantsGlance`). Without one wanted there is nothing to wait for or judge; an older glance is history. */
  glanceWanted: boolean;
  /** Its news asks something of you: a move of yours that is new since your last read ("New moves only", `isNewYourMove`). */
  askForYou: boolean;
  /** Someone approved it on GitHub already: a standing approval, or the review decision says approved. An agent Approve there is noise. */
  approvedOnGitHub: boolean;
}

/** A PR an agent Approve covers, with what the confirm list shows and what the approve call needs. */
export interface AgentApprovePr {
  prKey: PrKey;
  title: string;
  headOid: string;
  verdict: Verdict;
  riskLine: string;
  risk: BackedRisk;
  /**
   * The covered layers below it in its stack, base first: approving it waits
   * until these went through in the same batch (base up; empty for a single
   * or a set's PR outside a stack).
   */
  dependsOn: PrKey[];
}

/** An approvable PR the agent does not back, named in the confirm list with its reason. */
export interface LeftOutPr {
  prKey: PrKey;
  title: string;
  reason: LeftOutReason;
  /** On `layer_below`: the lowest layer below that blocks it ("waits on #12"); null for any other reason. */
  waitsOn: PrKey | null;
  /** The stored verdict and risk line, for the confirm list; null without a glance. */
  verdict: Verdict | null;
  riskLine: string | null;
}

/**
 * What the Approve label names, so the renderer only spells it out:
 * - none: greyed, a plain "Approve"
 * - one: exactly one PR covered out of several: "Approve #12"
 * - every: every PR the button stands for is covered: "Approve", "Approve
 *   stack", "Approve 3 PRs" on a set or the topic
 * - some: anything else: "Approve 2 of 3 PRs", or "Approve 2 PRs" when it
 *   covers every approvable PR but the tile shows more (a draft layer)
 */
export type ApproveNaming = 'none' | 'one' | 'every' | 'some';

/**
 * The ✨ Approve button, on a tile's footer or the topic header. Absent (null
 * on the view) when there is no approvable PR at all.
 * - active: approves `covered`, base to head on a stack; the pill shows `risk`.
 * - greyed: disabled, the pill shows `reason`; `covered` is empty.
 * A tile and a topic alike are active when at least one approvable PR is
 * covered; the rest are named in `leftOut` (owner, 2026-10-01).
 * On a stack, coverage goes base up (owner, 2026-10-01): a layer is covered
 * only when it is agent-safe and no approvable layer below it is left out.
 * The lowest approvable layer the agent does not back blocks every
 * approvable layer above it (`layer_below`). Layers below that are not
 * approvable (merged, a draft, your own, approved already, dealt with,
 * pulled in) do not block. Singles and a set's PRs outside a stack keep
 * their own verdict. The label follows `naming`.
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
  /**
   * Every PR the button stands for, approvable or not (drafts, pulled-in
   * layers, your own): the tile's rows, or each PR of the topic's unsnoozed
   * tiles once. "Approve stack" only when `coveredCount` equals it.
   */
  prCount: number;
  /** What the label names (`approveNaming`). */
  naming: ApproveNaming;
}

/** One covered out of several PRs is named; covering every PR says so; greyed names nothing. */
function approveNaming(active: boolean, coveredCount: number, prCount: number): ApproveNaming {
  if (!active) {
    return 'none';
  }
  if (coveredCount === 1 && prCount > 1) {
    return 'one';
  }
  return coveredCount === prCount ? 'every' : 'some';
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

/** Anyone's approval stands on GitHub (a person's or a bot's, any commit), or the review decision says approved. */
function approvedByAnyone(pr: Pr): boolean {
  const approvals = standingApprovals(pr);
  return pr.reviewDecision === 'APPROVED' || approvals.people.length > 0 || approvals.agents.length > 0;
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
    glanceWanted: prWantsGlance(input.pr, input.events),
    askForYou: asksForYou(input),
    approvedOnGitHub: approvedByAnyone(input.pr),
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

/** Why the agent does not back marking this unread PR read, or null: no ask for you, and, when a glance is wanted, a current glance that is not Look closer, low or medium risk. */
function markReadBlock(facts: AgentPrFacts): MarkReadBlock | null {
  if (facts.askForYou) {
    return 'asks_for_you';
  }
  // No glance wanted (closed, or merged with the merge seen or reviewed): nothing to wait for, and any older glance is history.
  if (!facts.glanceWanted) {
    return null;
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

/** What the agent offers read of the tile view: its stacks, the rows, Approve's own rule (`offers.pane`), the state and the unread PRs. */
export type AgentOfferView = Pick<TileView, 'prs' | 'offers' | 'state' | 'unreadPrKeys'> & { tile: Pick<Tile, 'stacks'> };

/**
 * Approvable: exactly today's Approve rule (the pane leads with `approve`),
 * tracked (not a pulled-in layer), and nobody approved it on GitHub yet
 * (owner, 2026-09-30: an agent Approve there is redundant noise).
 */
function approvablePrs(view: AgentOfferView, facts: Map<PrKey, AgentPrFacts>): AgentOfferView['prs'] {
  return view.prs.filter((pr) => view.offers.pane[pr.key]?.lead === 'approve' && isTracked(pr.provenance) && facts.get(pr.key)?.approvedOnGitHub !== true);
}

/** The covered entry of an agent-safe PR (`approveBlock` says null) without its `dependsOn`, else null; null without facts too. */
function coveredPr(pr: AgentOfferView['prs'][number], fact: AgentPrFacts | undefined): Omit<AgentApprovePr, 'dependsOn'> | null {
  if (!fact) {
    return null;
  }
  const risk = backedRisk(fact.risk);
  if (approveBlock(fact) !== null || fact.verdict === null || fact.riskLine === null || risk === null) {
    return null;
  }
  return { prKey: pr.key, title: pr.title, headOid: fact.headOid, verdict: fact.verdict, riskLine: fact.riskLine, risk };
}

/** The layers below `key` in its stack, base first; empty when `key` is in no stack. */
function layersBelow(key: PrKey, stacks: TileStack[]): PrKey[] {
  const stack = stacks.find((candidate) => candidate.prKeys.includes(key));
  return stack ? stack.prKeys.slice(0, stack.prKeys.indexOf(key)) : [];
}

/**
 * The tile's approvable PRs in member order (base to head on a stack), split
 * into covered and left out. An approvable PR the agent does not back is
 * left out for its own block; an approvable stack layer above such a PR is
 * left out as `layer_below`, waiting on the lowest one (base up).
 */
function splitApprovable(view: AgentOfferView, facts: Map<PrKey, AgentPrFacts>): { covered: AgentApprovePr[]; leftOut: LeftOutPr[] } {
  const approvable = approvablePrs(view, facts);
  const blocked = new Set(approvable.filter((pr) => coveredPr(pr, facts.get(pr.key)) === null).map((pr) => pr.key));
  const safeKeys = new Set(approvable.filter((pr) => !blocked.has(pr.key)).map((pr) => pr.key));
  const covered: AgentApprovePr[] = [];
  const leftOut: LeftOutPr[] = [];
  for (const pr of approvable) {
    const fact = facts.get(pr.key);
    const below = layersBelow(pr.key, view.tile.stacks);
    const waitsOn = below.find((layer) => blocked.has(layer)) ?? null;
    const safe = coveredPr(pr, fact);
    const left = { prKey: pr.key, title: pr.title, verdict: fact?.verdict ?? null, riskLine: fact?.riskLine ?? null };
    if (waitsOn !== null) {
      leftOut.push({ ...left, reason: 'layer_below', waitsOn });
    } else if (safe) {
      // Nothing below blocks, so every approvable layer below is covered too.
      covered.push({ ...safe, dependsOn: below.filter((layer) => safeKeys.has(layer)) });
    } else {
      leftOut.push({ ...left, reason: (fact && approveBlock(fact)) ?? 'rechecking', waitsOn: null });
    }
  }
  return { covered, leftOut };
}

/** The own agent blocks among the left out: what a greyed pill can say. On a stack only its lowest blocking layer has one. */
function ownBlocks(leftOut: LeftOutPr[]): AgentBlock[] {
  return leftOut.flatMap((pr) => (pr.reason === 'layer_below' ? [] : [pr.reason]));
}

/**
 * The tile's ✨ Approve: gone without an approvable PR; active when at least
 * one is covered, approving only those (owner, 2026-10-01: the same as the
 * topic's Approve, base up on a stack); greyed when none is, with the first
 * own block in `TILE_APPROVE_ORDER`. On a stack tile that is the block of
 * its lowest blocking layer, the only one left out for its own reason.
 */
export function tileApproveOffer(view: AgentOfferView, facts: Map<PrKey, AgentPrFacts>): AgentApproveOffer | null {
  const { covered, leftOut } = splitApprovable(view, facts);
  const totalCount = covered.length + leftOut.length;
  if (totalCount === 0) {
    return null;
  }
  const active = covered.length > 0;
  return {
    state: active ? 'active' : 'greyed',
    risk: active ? highestRisk(covered.map((pr) => pr.risk)) : null,
    reason: active ? null : firstReason(ownBlocks(leftOut), TILE_APPROVE_ORDER),
    covered,
    leftOut,
    coveredCount: covered.length,
    totalCount,
    prCount: view.prs.length,
    naming: approveNaming(active, covered.length, view.prs.length),
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
export type TopicAgentTile = { tile: Pick<Tile, 'id'>; state: Pick<TileState, 'kind'>; agent: TileAgentOffers; prs: Pick<TileView['prs'][number], 'key'>[] };

/**
 * The topic's ✨ Approve: the approvable PRs of its unsnoozed tiles (each PR
 * once). It covers exactly what those tiles' Approves cover (so base up on
 * stacks too) and names the rest. Gone without an approvable PR; greyed
 * when none is covered, `rechecking` if any is rechecking, else
 * `look_closer`.
 */
export function topicApproveOffer(tiles: TopicAgentTile[]): AgentApproveOffer | null {
  const unsnoozed = tiles.filter((view) => view.state.kind !== 'snoozed');
  const offers = unsnoozed.flatMap((view) => view.agent.approve ?? []);
  const seen = new Set<PrKey>();
  const covered: AgentApprovePr[] = [];
  const leftOut: LeftOutPr[] = [];
  for (const pr of offers.flatMap((offer) => offer.covered)) {
    if (!seen.has(pr.prKey)) {
      seen.add(pr.prKey);
      covered.push(pr);
    }
  }
  for (const pr of offers.flatMap((offer) => offer.leftOut)) {
    if (!seen.has(pr.prKey)) {
      seen.add(pr.prKey);
      leftOut.push(pr);
    }
  }
  const totalCount = covered.length + leftOut.length;
  if (totalCount === 0) {
    return null;
  }
  const active = covered.length > 0;
  const prCount = new Set(unsnoozed.flatMap((view) => view.prs.map((pr) => pr.key))).size;
  return {
    state: active ? 'active' : 'greyed',
    risk: active ? highestRisk(covered.map((pr) => pr.risk)) : null,
    reason: active ? null : leftOut.some((pr) => pr.reason === 'rechecking') ? 'rechecking' : 'look_closer',
    covered,
    leftOut,
    coveredCount: covered.length,
    totalCount,
    prCount,
    naming: approveNaming(active, covered.length, prCount),
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

const AGENT_REFUSALS: Record<AgentBlock, string> = {
  rechecking: 'the agent is rechecking it',
  look_closer: 'the agent now says look closer',
  high: 'the agent now rates it high risk',
};

const APPROVE_REFUSALS: Record<LeftOutReason, string> = {
  ...AGENT_REFUSALS,
  layer_below: 'a layer below it needs a look first',
};

const SKIPPED_FAILED = 'skipped: a layer below failed';
const SKIPPED_NOT_FIRST = 'skipped: a layer below was not approved first';

const MARK_READ_REFUSALS: Record<MarkReadBlock, string> = {
  ...AGENT_REFUSALS,
  asks_for_you: 'it asks something of you',
};

/**
 * The click-time check of an agent Approve (approve is final): why `prKey`
 * no longer goes through, or null while a current tile view still covers it.
 * `views` are the current views of the tiles holding it; the topic's
 * Approve leaves out snoozed tiles, like `topicApproveOffer`.
 */
export function agentApproveRefusal(prKey: PrKey, views: Pick<TileView, 'state' | 'agent'>[], from: 'agent_tile' | 'agent_topic'): string | null {
  const counted = from === 'agent_topic' ? views.filter((view) => view.state.kind !== 'snoozed') : views;
  const offers = counted.flatMap((view) => view.agent.approve ?? []);
  if (offers.some((offer) => offer.covered.some((pr) => pr.prKey === prKey))) {
    return null;
  }
  const leftOut = offers.flatMap((offer) => offer.leftOut).find((pr) => pr.prKey === prKey);
  return leftOut ? APPROVE_REFUSALS[leftOut.reason] : 'nothing to approve on it any more';
}

/**
 * The click-time base-up check of an agent Approve: why to skip `prKey`
 * because a covered layer below it (`dependsOn` in the current offers) was
 * not approved earlier in this batch, or null. `earlier` holds the batch's
 * results so far. Approvals are final, so an upper layer never goes through
 * after its base failed.
 */
export function agentApproveSkip(prKey: PrKey, views: Pick<TileView, 'state' | 'agent'>[], from: 'agent_tile' | 'agent_topic', earlier: Pick<PrApproveResult, 'prKey' | 'ok'>[]): string | null {
  const counted = from === 'agent_topic' ? views.filter((view) => view.state.kind !== 'snoozed') : views;
  const entries = counted.flatMap((view) => view.agent.approve?.covered ?? []).filter((pr) => pr.prKey === prKey);
  const dependsOn = [...new Set(entries.flatMap((pr) => pr.dependsOn))];
  const missing = dependsOn.filter((key) => !earlier.some((result) => result.prKey === key && result.ok));
  if (missing.length === 0) {
    return null;
  }
  const failed = missing.some((key) => earlier.some((result) => result.prKey === key));
  return failed ? SKIPPED_FAILED : SKIPPED_NOT_FIRST;
}

/** The click-time check of an agent Mark read: why the tile is skipped, or null while the agent still backs its Mark read. */
export function agentMarkReadRefusal(view: Pick<TileView, 'agent'>): string | null {
  const backing = view.agent.markRead;
  if (!backing) {
    return 'nothing unread any more';
  }
  return backing.state === 'active' ? null : MARK_READ_REFUSALS[backing.reason ?? 'rechecking'];
}

function isSkip(result: { message: string }): boolean {
  return result.message === SKIPPED_FAILED || result.message === SKIPPED_NOT_FIRST;
}

/**
 * "Approved 3 PRs", or "Approved 1 of 3 PRs" with the first failure's
 * reason and how many upper layers were skipped for it ("; 1 skipped, a
 * layer below was not approved"); ok only when every PR was approved.
 */
export function approvalsSummary(results: { prKey: PrKey; ok: boolean; message: string }[]): { ok: boolean; message: string } {
  const approved = results.filter((result) => result.ok).length;
  const failure = results.find((result) => !result.ok && !isSkip(result)) ?? results.find((result) => !result.ok);
  if (!failure) {
    return { ok: results.length > 0, message: results.length === 1 ? 'Approved' : `Approved ${approved} PRs` };
  }
  const skipped = results.filter((result) => isSkip(result) && result !== failure).length;
  const skippedNote = skipped > 0 ? `; ${skipped} skipped, a layer below was not approved` : '';
  return { ok: false, message: `Approved ${approved} of ${results.length} PRs; ${failure.prKey}: ${failure.message}${skippedNote}` };
}

/** Both agent offers of a topic's header, from its tile views. */
export function topicAgentOffers(tiles: TopicAgentTile[]): TopicAgentOffers {
  return { approve: topicApproveOffer(tiles), markRead: topicMarkReadOffer(tiles) };
}
