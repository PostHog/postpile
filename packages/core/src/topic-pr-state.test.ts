import { describe, expect, it } from 'vitest';
import { at, makeComment, makePr } from './fixtures.ts';
import { isDraftTile, topicPrRollup, topicPrState, type StatedPr } from './topic-pr-state.ts';
import type { PrIcon } from './pr-status.ts';
import type { PrSummary } from './views.ts';
import type { Pr, Provenance, Tile } from './types.ts';

const open: StatedPr = { icon: 'open', review: 'review', pulledIn: false };
const draft: StatedPr = { icon: 'draft', review: null, pulledIn: false };
const merged: StatedPr = { icon: 'merged', review: null, pulledIn: false };
const closed: StatedPr = { icon: 'closed', review: null, pulledIn: false };
const queued: StatedPr = { icon: 'merge_queue', review: 'approved', pulledIn: false };
const failed: StatedPr = { icon: 'merge_queue_failed', review: 'approved', pulledIn: false };

const noCounts = { open: 0, merge_queue: 0, merge_queue_failed: 0, draft: 0, merged: 0, closed: 0 };

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
    expect(summary.counts).toEqual({ ...noCounts, open: 3, merged: 1, closed: 1 });
    expect(summary.reviews).toEqual({ review: 2, changes: 0, approved: 1 });
  });

  it('shows the merge queue when every open PR is in it, failed when one failed', () => {
    expect(topicPrState([queued, merged]).state).toBe('merge_queue');
    expect(topicPrState([queued, queued, closed]).state).toBe('merge_queue');
    // Not every open PR is queued: as before, a queued PR counts as open.
    expect(topicPrState([queued, open]).state).toBe('open');
    expect(topicPrState([queued, draft]).state).toBe('open');
    expect(topicPrState([failed, open, queued]).state).toBe('merge_queue_failed');
    expect(topicPrState([failed, merged]).counts).toEqual({ ...noCounts, merge_queue_failed: 1, merged: 1 });
  });

  it('leaves a pulled-in layer in the queue out of the state', () => {
    expect(topicPrState([{ ...failed, pulledIn: true }, open]).state).toBe('open');
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
    expect(summary.counts).toEqual({ ...noCounts, open: 1, merged: 1 });
    expect(summary.reviews).toEqual({ review: 1, changes: 0, approved: 0 });
  });

  it("reads each PR's merge queue from trunk's comment", () => {
    const testing = makeComment({ id: 't1', author: 'trunk-io[bot]', body: '🧪\u2002Running tests on this pull request - [details](https://trunk.example/1).', createdAt: at(5) });
    const inQueue = makePr({ number: 1, reviewDecision: 'APPROVED', comments: [testing] });
    const recentMerge = makePr({ number: 2, state: 'MERGED' });
    const summary = topicPrRollup([tileOf('a', [[inQueue, found]]), tileOf('b', [[recentMerge, found]])], [inQueue, recentMerge]);
    expect(summary).toMatchObject({ state: 'merge_queue', counts: { ...noCounts, merge_queue: 1, merged: 1 } });
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
  const row = (icon: PrIcon, provenance: Provenance = pinged): Pick<PrSummary, 'status' | 'provenance'> => ({
    status: { lifecycle: 'open', review: null, agentApprovers: [], mergeQueue: null, icon },
    provenance,
  });

  it('is a draft when every open tracked PR is a draft, skipping pulled-in layers', () => {
    expect(isDraftTile([row('draft'), row('open', pulled)])).toBe(true);
    expect(isDraftTile([row('draft'), row('open')])).toBe(false);
    expect(isDraftTile([row('draft'), row('merge_queue')])).toBe(false);
    expect(isDraftTile([row('draft'), row('merged')])).toBe(true);
    expect(isDraftTile([row('merged')])).toBe(false);
  });
});
