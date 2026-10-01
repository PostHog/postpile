import { describe, expect, it } from 'vitest';
import { agentApproveRefusal, agentApproveSkip, agentPrFacts, riskLevelOf, topicAgentOffers } from './agent-actions.ts';
import { at, makePr, makeReview, NO_OPENED_READ_INPUT, singleTile, viewer } from './fixtures.ts';
import { buildPrSummary, buildTileView, type PrSummaryInput } from './tile-view.ts';
import type { Glance, Pr, PrEvent, PrKey, Tile, TileState, UserPrState, Verdict } from './types.ts';
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

/** One row's read-model input, with the agent facts built from the same input. */
function rowInput(spec: RowSpec, state: TileState): PrSummaryInput {
  const { pr } = spec;
  const glance: Pick<Glance, 'verdict' | 'forYou' | 'risk'> | null = spec.verdict ? { verdict: spec.verdict, forYou: 'for you', risk: spec.risk ?? 'low' } : null;
  return {
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
    opened: NO_OPENED_READ_INPUT,
  };
}

/** A tile as the read models build it: the given tile with one row per spec, in member order. */
function buildView(tile: Tile, specs: RowSpec[], state: TileState): TileView {
  const inputs = specs.map((spec) => rowInput(spec, state));
  return buildTileView({
    tile,
    state,
    prs: inputs.map(buildPrSummary),
    agentPrs: inputs.map(agentPrFacts),
    prsByKey: new Map<PrKey, Pr>(specs.map((spec) => [spec.pr.key, spec.pr])),
    events: new Map<PrKey, PrEvent[]>(),
    userStates: new Map<PrKey, UserPrState>(),
    viewer,
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
    now: at(100),
  });
}

/** A single-PR tile. */
function tileView(spec: RowSpec, state: TileState = OPEN): TileView {
  return buildView(singleTile(spec.pr), [spec], state);
}

/** A stack tile, base first, every layer pinged. */
function stackView(specs: RowSpec[], state: TileState = OPEN): TileView {
  const keys = specs.map((spec) => spec.pr.key);
  const tile: Tile = {
    id: `stack:${keys[0]}`,
    topicId: 'topic-1',
    kind: 'stack',
    title: 'stack',
    members: keys.map((prKey) => ({ prKey, provenance: { kind: 'pinged', reason: 'review_requested' } })),
    stacks: [{ id: `stack:${keys[0]}`, prKeys: keys }],
  };
  return buildView(tile, specs, state);
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

  // Owner, 2026-10-01: base up. A stack layer goes through only when no approvable layer below it needs a look.
  it('covers a stack base up: the lowest blocking layer holds back every layer above it', () => {
    const view = stackView([
      { pr: reviewPr(1), verdict: 'LOOKS_SAFE', risk: 'low' },
      { pr: reviewPr(2), verdict: 'LOOK_CLOSER', risk: 'low' },
      { pr: reviewPr(3), verdict: 'LOOKS_SAFE', risk: 'medium - wide diff' },
      { pr: reviewPr(4), verdict: 'LOOKS_SAFE', risk: 'low', stale: true },
    ]);
    const approve = view.agent.approve;
    expect(approve).toMatchObject({ state: 'active', risk: 'low', reason: null, coveredCount: 1, totalCount: 4, prCount: 4, naming: 'one' });
    expect(approve?.covered.map((pr) => pr.prKey)).toEqual(['acme/app#1']);
    expect(approve?.leftOut.map((pr) => [pr.prKey, pr.reason, pr.waitsOn])).toEqual([
      ['acme/app#2', 'look_closer', null],
      ['acme/app#3', 'layer_below', 'acme/app#2'],
      ['acme/app#4', 'layer_below', 'acme/app#2'],
    ]);
    const topic = topicAgentOffers([view]).approve;
    expect(topic?.covered.map((pr) => pr.prKey)).toEqual(['acme/app#1']);
    expect(topic).toMatchObject({ state: 'active', coveredCount: 1, totalCount: 4, naming: 'one' });
  });

  it('is greyed on a stack whose base needs a look, with the base block as the reason', () => {
    const view = stackView([
      { pr: reviewPr(1), verdict: 'LOOK_CLOSER', risk: 'medium - worker loop' },
      { pr: reviewPr(2), verdict: 'LOOKS_SAFE', risk: 'high - auth' },
      { pr: reviewPr(3) },
      { pr: reviewPr(4), verdict: 'LOOKS_SAFE', risk: 'low' },
    ]);
    const approve = view.agent.approve;
    expect(approve).toMatchObject({ state: 'greyed', risk: null, reason: 'look_closer', coveredCount: 0, totalCount: 4, naming: 'none' });
    expect(approve?.leftOut.map((pr) => pr.reason)).toEqual(['look_closer', 'layer_below', 'layer_below', 'layer_below']);
    expect(topicAgentOffers([view]).approve).toMatchObject({ state: 'greyed', reason: 'look_closer', coveredCount: 0 });
  });

  it('is not held back by layers below that need no review from you: your own PR, one approved already', () => {
    const approved = { ...reviewPr(2), reviewDecision: 'APPROVED' as const };
    const approve = stackView([
      { pr: makePr({ number: 1, author: viewer.login }), verdict: 'LOOK_CLOSER', risk: 'low' },
      { pr: approved, verdict: 'LOOK_CLOSER', risk: 'low' },
      { pr: reviewPr(3), verdict: 'LOOKS_SAFE', risk: 'low' },
    ]).agent.approve;
    expect(approve).toMatchObject({ state: 'active', coveredCount: 1, totalCount: 1, prCount: 3, naming: 'one' });
    expect(approve?.covered.map((pr) => pr.prKey)).toEqual(['acme/app#3']);
  });

  it('names the base alone when the layers above are drafts, never "every"', () => {
    const approve = stackView([
      { pr: reviewPr(1), verdict: 'LOOKS_SAFE', risk: 'low' },
      { pr: { ...reviewPr(2), isDraft: true }, verdict: 'LOOK_CLOSER', risk: 'low' },
      { pr: { ...reviewPr(3), isDraft: true } },
    ]).agent.approve;
    expect(approve).toMatchObject({ state: 'active', coveredCount: 1, totalCount: 1, prCount: 3, naming: 'one' });
    const all = stackView([
      { pr: reviewPr(1), verdict: 'LOOKS_SAFE', risk: 'low' },
      { pr: reviewPr(2), verdict: 'LOOKS_SAFE', risk: 'low' },
    ]).agent.approve;
    expect(all).toMatchObject({ coveredCount: 2, prCount: 2, naming: 'every' });
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

describe('agentApproveRefusal', () => {
  it('lets the covered PRs of a partial tile through and refuses the ones left out', () => {
    const view = stackView([
      { pr: reviewPr(1), verdict: 'LOOKS_SAFE', risk: 'low' },
      { pr: reviewPr(2), verdict: 'LOOK_CLOSER', risk: 'low' },
      { pr: reviewPr(3), verdict: 'LOOKS_SAFE', risk: 'low' },
    ]);
    expect(agentApproveRefusal('acme/app#1', [view], 'agent_tile')).toBeNull();
    expect(agentApproveRefusal('acme/app#2', [view], 'agent_tile')).toBe('the agent now says look closer');
    expect(agentApproveRefusal('acme/app#3', [view], 'agent_tile')).toBe('a layer below it needs a look first');
  });

  it('lets a covered stack layer through only after the covered layers below it', () => {
    const view = stackView([
      { pr: reviewPr(1), verdict: 'LOOKS_SAFE', risk: 'low' },
      { pr: reviewPr(2), verdict: 'LOOKS_SAFE', risk: 'low' },
    ]);
    expect(view.agent.approve?.covered.map((pr) => pr.dependsOn)).toEqual([[], ['acme/app#1']]);
    expect(agentApproveSkip('acme/app#2', [view], 'agent_tile', [{ prKey: 'acme/app#1', ok: true }])).toBeNull();
    expect(agentApproveSkip('acme/app#2', [view], 'agent_tile', [{ prKey: 'acme/app#1', ok: false }])).toBe('skipped: a layer below failed');
    expect(agentApproveSkip('acme/app#2', [view], 'agent_tile', [])).toBe('skipped: a layer below was not approved first');
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
