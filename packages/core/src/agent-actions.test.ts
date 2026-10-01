import { describe, expect, it } from 'vitest';
import { agentPrFacts, riskLevelOf, topicAgentOffers } from './agent-actions.ts';
import { at, makePr, makeReview, singleTile, viewer } from './fixtures.ts';
import { buildPrSummary, buildTileView, type PrSummaryInput } from './tile-view.ts';
import type { Glance, Pr, PrEvent, PrKey, TileState, UserPrState, Verdict } from './types.ts';
import type { TileView } from './views.ts';

const UNREAD: TileState = { kind: 'unread', unreadBecause: [], unreadOnGitHub: true, loud: false };
const OPEN: TileState = { kind: 'open', unreadBecause: [], unreadOnGitHub: false, loud: false };
const SNOOZED: TileState = { kind: 'snoozed', unreadBecause: [], unreadOnGitHub: false, loud: false };

interface RowSpec {
  pr: Pr;
  verdict?: Verdict;
  risk?: string;
  stale?: boolean;
}

/** A single-PR tile as the read models build it, with the agent facts from the same inputs as the row. */
function tileView(spec: RowSpec, state: TileState = OPEN): TileView {
  const { pr } = spec;
  const glance: Pick<Glance, 'verdict' | 'forYou' | 'risk'> | null = spec.verdict ? { verdict: spec.verdict, forYou: 'for you', risk: spec.risk ?? 'low' } : null;
  const input: PrSummaryInput = {
    pr,
    member: { prKey: pr.key, provenance: { kind: 'pinged', reason: 'review_requested' } },
    viewer,
    userState: null,
    events: [],
    reason: 'review_requested',
    glance,
    glanceStale: spec.stale ?? false,
    glanceGap: null,
    glanceState: glance ? 'ready' : 'queued',
    quietRepo: false,
    repoLabel: null,
    tileUnread: state.kind === 'unread',
    unreadOnGitHub: state.unreadOnGitHub,
    lastReadAt: null,
    now: at(100),
    pendingWrite: null,
  };
  return buildTileView({
    tile: singleTile(pr),
    state,
    prs: [buildPrSummary(input)],
    agentPrs: [agentPrFacts(input)],
    prsByKey: new Map<PrKey, Pr>([[pr.key, pr]]),
    events: new Map<PrKey, PrEvent[]>(),
    userStates: new Map<PrKey, UserPrState>(),
    viewer,
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
    now: at(100),
  });
}

/** ada's open PR asking the viewer for a review: approvable. */
function reviewPr(number: number): Pr {
  return makePr({ number, author: 'ada', reviewerUsers: [viewer.login] });
}

describe('riskLevelOf', () => {
  it('reads the first word, anything else is high', () => {
    expect(riskLevelOf('medium - touches the worker loop')).toBe('medium');
    expect(riskLevelOf('Low: docs only')).toBe('low');
    expect(riskLevelOf('moderate')).toBe('high');
  });
});

describe('tile Approve', () => {
  it('is active with the highest risk when every approvable PR is agent-safe', () => {
    const approve = tileView({ pr: reviewPr(1), verdict: 'LOOKS_SAFE', risk: 'medium - touches the worker loop' }).agent.approve;
    expect(approve).toMatchObject({ state: 'active', risk: 'medium', reason: null, coveredCount: 1, totalCount: 1 });
    expect(approve?.covered[0]).toMatchObject({ prKey: 'acme/app#1', verdict: 'LOOKS_SAFE', riskLine: 'medium - touches the worker loop' });
  });

  it('is greyed as look closer on a Look closer verdict', () => {
    const approve = tileView({ pr: reviewPr(1), verdict: 'LOOK_CLOSER', risk: 'low' }).agent.approve;
    expect(approve).toMatchObject({ state: 'greyed', reason: 'look_closer', risk: null });
  });

  it('is greyed as rechecking while the glance is stale', () => {
    const approve = tileView({ pr: reviewPr(1), verdict: 'LOOKS_SAFE', risk: 'low', stale: true }).agent.approve;
    expect(approve).toMatchObject({ state: 'greyed', reason: 'rechecking' });
  });

  it('is gone without an approvable PR (your own PR)', () => {
    const own = makePr({ number: 1, author: viewer.login });
    expect(tileView({ pr: own, verdict: 'LOOKS_SAFE', risk: 'low' }).agent.approve).toBeNull();
  });

  // Owner, 2026-09-30: an agent Approve on a PR someone already approved is redundant noise.
  it('is gone when someone else approved the PR on GitHub, while the pane keeps its Approve', () => {
    const approved = { ...reviewPr(1), reviewDecision: 'APPROVED' as const, reviews: [makeReview({ author: 'rowan', state: 'APPROVED' })] };
    const view = tileView({ pr: approved, verdict: 'LOOKS_SAFE', risk: 'low' });
    expect(view.agent.approve).toBeNull();
    expect(view.offers.pane[approved.key]?.lead).toBe('approve');
    const byDecision = { ...reviewPr(2), reviewDecision: 'APPROVED' as const };
    expect(tileView({ pr: byDecision, verdict: 'LOOKS_SAFE', risk: 'low' }).agent.approve).toBeNull();
  });
});

describe('topic Approve', () => {
  it('approves 3 of 5, names the rest with reasons and leaves out snoozed tiles', () => {
    const tiles = [
      tileView({ pr: reviewPr(1), verdict: 'LOOKS_SAFE', risk: 'low' }),
      tileView({ pr: reviewPr(2), verdict: 'LOOKS_SAFE', risk: 'medium - wide diff' }),
      tileView({ pr: reviewPr(3), verdict: 'LOOK_CLOSER', risk: 'low' }),
      tileView({ pr: reviewPr(4), verdict: 'LOOKS_SAFE', risk: 'high - auth' }),
      tileView({ pr: reviewPr(5), verdict: 'LOOKS_SAFE', risk: 'low' }),
      tileView({ pr: reviewPr(6), verdict: 'LOOKS_SAFE', risk: 'low' }, SNOOZED),
    ];
    const approve = topicAgentOffers(tiles).approve;
    expect(approve).toMatchObject({ state: 'active', risk: 'medium', coveredCount: 3, totalCount: 5 });
    expect(approve?.covered.map((pr) => pr.prKey)).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#5']);
    expect(approve?.leftOut.map((pr) => [pr.prKey, pr.reason])).toEqual([
      ['acme/app#3', 'look_closer'],
      ['acme/app#4', 'high'],
    ]);
  });
});

describe('topic Mark read', () => {
  it('covers the backed unread tile and skips the one with an ask for you', () => {
    const quiet = tileView({ pr: makePr({ number: 1, author: 'ada' }), verdict: 'LOOKS_SAFE', risk: 'low' }, UNREAD);
    const asks = tileView({ pr: reviewPr(2), verdict: 'LOOKS_SAFE', risk: 'low' }, UNREAD);
    expect(quiet.agent.markRead).toEqual({ state: 'active', risk: 'low', reason: null });
    const markRead = topicAgentOffers([quiet, asks]).markRead;
    expect(markRead).toMatchObject({ state: 'active', risk: 'low', coveredCount: 1, totalCount: 2 });
    expect(markRead?.coveredTileIds).toEqual([quiet.tile.id]);
    expect(markRead?.skipped).toEqual([{ tileId: asks.tile.id, reason: 'asks_for_you' }]);
  });
});
