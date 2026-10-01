import { describe, expect, it } from 'vitest';
import { makePr } from './fixtures.ts';
import { isDraftTile, topicPrRollup, topicPrState, type StatedPr } from './topic-pr-state.ts';
import type { PrSummary } from './views.ts';
import type { Pr, Provenance, Tile } from './types.ts';

const open: StatedPr = { state: 'OPEN', isDraft: false, review: 'review', pulledIn: false };
const draft: StatedPr = { state: 'OPEN', isDraft: true, review: null, pulledIn: false };
const merged: StatedPr = { state: 'MERGED', isDraft: false, review: null, pulledIn: false };
const closed: StatedPr = { state: 'CLOSED', isDraft: false, review: null, pulledIn: false };

const pinged: Provenance = { kind: 'pinged', reason: 'review_requested' };
const found: Provenance = { kind: 'found', via: 'own_open', reason: 'your open PR' };
const pulled: Provenance = { kind: 'pulled_in', reason: 'stack layer' };

describe('topicPrState', () => {
  it('shows the most alive state: open, draft, merged, closed', () => {
    expect(topicPrState([merged, merged, open, merged]).state).toBe('open');
    expect(topicPrState([merged, draft, closed]).state).toBe('draft');
    expect(topicPrState([closed, merged]).state).toBe('merged');
    expect(topicPrState([closed, closed]).state).toBe('closed');
    expect(topicPrState([]).state).toBeNull();
  });

  it('counts tracked PRs per state and per review status', () => {
    const approved: StatedPr = { ...open, review: 'approved' };
    const summary = topicPrState([open, open, approved, merged, closed]);
    expect(summary.counts).toEqual({ open: 3, draft: 0, merged: 1, closed: 1 });
    expect(summary.reviews).toEqual({ review: 2, changes: 0, approved: 1 });
  });

  it('ignores pulled-in layers for the state, but counts them in the total', () => {
    const layer: StatedPr = { ...open, pulledIn: true };
    const summary = topicPrState([layer, merged]);
    expect(summary.state).toBe('merged');
    expect(summary.counts.open).toBe(0);
    expect(summary.reviews.review).toBe(0);
    expect(summary).toMatchObject({ total: 2, pulledIn: 1 });
    expect(topicPrState([layer]).state).toBeNull();
  });
});

function tileOf(id: string, members: [Pr, Provenance][]): Tile {
  return {
    id,
    topicId: 'topic-1',
    kind: members.length > 1 ? 'stack' : 'single',
    title: id,
    members: members.map(([pr, provenance]) => ({ prKey: pr.key, provenance })),
    stacks: [],
  };
}

describe('topicPrRollup', () => {
  it('counts PRs the sync found on its own, so a topic of only found PRs is not empty', () => {
    const own = makePr({ number: 1 });
    const recentMerge = makePr({ number: 2, state: 'MERGED' });
    const summary = topicPrRollup([tileOf('a', [[own, found]]), tileOf('b', [[recentMerge, found]])], [own, recentMerge]);
    expect(summary).toMatchObject({ state: 'open', total: 2, pulledIn: 0 });
    expect(summary.counts).toEqual({ open: 1, draft: 0, merged: 1, closed: 0 });
    expect(summary.reviews).toEqual({ review: 1, changes: 0, approved: 0 });
  });

  it('treats a PR as pulled in only when no tile tracks it', () => {
    const base = makePr({ number: 1 });
    const top = makePr({ number: 2, isDraft: true });
    const stack = tileOf('stack', [
      [base, pulled],
      [top, found],
    ]);
    expect(topicPrRollup([stack, tileOf('single', [[base, pinged]])], [base, top])).toMatchObject({ state: 'open', total: 2, pulledIn: 0 });
    expect(topicPrRollup([stack], [base, top])).toMatchObject({ state: 'draft', total: 2, pulledIn: 1 });
  });
});

describe('isDraftTile', () => {
  const row = (overrides: Partial<Pick<PrSummary, 'state' | 'isDraft' | 'provenance'>>): Pick<PrSummary, 'state' | 'isDraft' | 'status' | 'provenance'> => ({
    state: 'OPEN',
    isDraft: false,
    status: { lifecycle: 'open', review: null, agentApprovers: [] },
    provenance: pinged,
    ...overrides,
  });

  it('is a draft when every open tracked PR is a draft, skipping pulled-in layers', () => {
    expect(isDraftTile([row({ isDraft: true }), row({ provenance: pulled })])).toBe(true);
    expect(isDraftTile([row({ isDraft: true }), row({})])).toBe(false);
    expect(isDraftTile([row({ isDraft: true }), row({ state: 'MERGED' })])).toBe(true);
    expect(isDraftTile([row({ state: 'MERGED' })])).toBe(false);
  });
});
