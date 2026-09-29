import { describe, expect, it } from 'vitest';
import { isLiveProposal, proposalExpiresAt, proposalOutcome, proposalOutcomeAt, sameTopicChange } from './topic-proposals.ts';
import type { TopicProposal } from './types.ts';

function proposal(overrides: Partial<TopicProposal>): TopicProposal {
  return {
    id: 'p1',
    kind: 'rename',
    topicId: 'topic-a',
    name: 'Runner images',
    intoTopicId: null,
    fromArea: null,
    prKeys: [],
    reason: 'clearer',
    status: 'pending',
    createdAt: '2026-09-01T10:00:00.000Z',
    decidedAt: null,
    source: 'agent',
    client: 'claude-code',
    ...overrides,
  };
}

describe('outside topic proposals', () => {
  it('expire 14 days after they were filed, consolidation ones never', () => {
    const outside = proposal({});
    expect(proposalExpiresAt(outside)).toBe('2026-09-15T10:00:00.000Z');
    expect(proposalOutcome(outside, '2026-09-15T09:59:59.000Z')).toBe('pending');
    expect(proposalOutcome(outside, '2026-09-15T10:00:00.000Z')).toBe('expired');
    expect(isLiveProposal(outside, '2026-09-20T00:00:00.000Z')).toBe(false);
    expect(proposalOutcomeAt(outside, '2026-09-20T00:00:00.000Z')).toBe('2026-09-15T10:00:00.000Z');

    const own = proposal({ source: 'consolidation', client: null });
    expect(proposalExpiresAt(own)).toBeNull();
    expect(isLiveProposal(own, '2027-01-01T00:00:00.000Z')).toBe(true);
  });

  it('keep their decision once decided', () => {
    const rejected = proposal({ status: 'rejected', decidedAt: '2026-09-03T00:00:00.000Z' });
    expect(proposalOutcome(rejected, '2026-12-01T00:00:00.000Z')).toBe('rejected');
    expect(proposalOutcomeAt(rejected, '2026-12-01T00:00:00.000Z')).toBe('2026-09-03T00:00:00.000Z');
  });

  it('count as the same change by kind, topic and name or merge target', () => {
    expect(sameTopicChange(proposal({}), proposal({ name: '  runner IMAGES ' }))).toBe(true);
    expect(sameTopicChange(proposal({}), proposal({ name: 'Runners' }))).toBe(false);
    expect(sameTopicChange(proposal({}), proposal({ topicId: 'topic-b' }))).toBe(false);
    expect(sameTopicChange(proposal({ kind: 'merge', name: null, intoTopicId: 'x' }), proposal({ kind: 'merge', name: null, intoTopicId: 'x' }))).toBe(true);
    expect(sameTopicChange(proposal({ kind: 'merge', name: null, intoTopicId: 'x' }), proposal({ kind: 'merge', name: null, intoTopicId: 'y' }))).toBe(false);
    expect(sameTopicChange(proposal({ kind: 'split' }), proposal({ kind: 'rename' }))).toBe(false);
  });
});
