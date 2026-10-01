import { describe, expect, it } from 'vitest';
import { topicPrState, type StatedPr } from './topic-pr-state.ts';

const open: StatedPr = { state: 'OPEN', isDraft: false, pulledIn: false };
const draft: StatedPr = { state: 'OPEN', isDraft: true, pulledIn: false };
const merged: StatedPr = { state: 'MERGED', isDraft: false, pulledIn: false };
const closed: StatedPr = { state: 'CLOSED', isDraft: false, pulledIn: false };

describe('topicPrState', () => {
  it('shows the most alive state: open, draft, merged, closed', () => {
    expect(topicPrState([merged, merged, open, merged]).state).toBe('open');
    expect(topicPrState([merged, draft, closed]).state).toBe('draft');
    expect(topicPrState([closed, merged]).state).toBe('merged');
    expect(topicPrState([closed, closed]).state).toBe('closed');
    expect(topicPrState([]).state).toBeNull();
  });

  it('counts tracked PRs per state', () => {
    expect(topicPrState([open, open, merged, closed]).counts).toEqual({ open: 2, draft: 0, merged: 1, closed: 1 });
  });

  it('ignores pulled-in layers', () => {
    const layer: StatedPr = { ...open, pulledIn: true };
    const summary = topicPrState([layer, merged]);
    expect(summary.state).toBe('merged');
    expect(summary.counts.open).toBe(0);
    expect(topicPrState([layer]).state).toBeNull();
  });
});
