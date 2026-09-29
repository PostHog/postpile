import type { TopicProposal } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

/** Harness clock that tests move forward. */
function clockedHarness(start = '2026-09-02T12:00:00Z'): { h: Harness; setNow: (iso: string) => void } {
  let now = new Date(start);
  const h = makeHarness({ now: () => now });
  return { h, setNow: (iso) => (now = new Date(iso)) };
}

function proposal(overrides: Partial<TopicProposal>): TopicProposal {
  return {
    id: 'p1',
    kind: 'rename',
    topicId: 'depot',
    name: 'Depot runners',
    intoTopicId: null,
    fromArea: null,
    prKeys: [],
    reason: 'clearer',
    status: 'pending',
    createdAt: '2026-09-02T12:00:00.000Z',
    decidedAt: null,
    source: 'agent',
    client: 'claude-code',
    ...overrides,
  };
}

describe('topic proposals from outside agents', () => {
  it('drop out of the Inbox and the topic 14 days after they were filed', async () => {
    const { h, setNow } = clockedHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    h.store.proposals.add(proposal({ id: 'outside' }));
    h.store.proposals.add(proposal({ id: 'own', name: 'Depot CI', source: 'consolidation', client: null }));

    expect((await h.engine.listProposals()).topics.map((p) => p.id)).toEqual(['outside', 'own']);
    setNow('2026-09-16T12:00:00Z');
    expect((await h.engine.listProposals()).topics.map((p) => p.id)).toEqual(['own']);
    const topic = await h.engine.getTopic('depot');
    expect(topic?.pendingProposals.map((p) => p.id)).toEqual(['own']);
    expect(topic?.decidedProposals.map((p) => p.id)).toEqual(['outside']);
  });

  it('list decisions of the last 14 days on the topic, newest first', async () => {
    const { h, setNow } = clockedHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    h.store.proposals.add(proposal({ id: 'old' }));
    h.store.proposals.add(proposal({ id: 'recent', name: 'Depot' }));
    h.store.proposals.decide('old', 'rejected', '2026-09-03T00:00:00.000Z');
    h.store.proposals.decide('recent', 'rejected', '2026-09-10T00:00:00.000Z');

    setNow('2026-09-12T00:00:00Z');
    expect((await h.engine.getTopic('depot'))?.decidedProposals.map((p) => p.id)).toEqual(['recent', 'old']);
    setNow('2026-09-20T00:00:00Z');
    expect((await h.engine.getTopic('depot'))?.decidedProposals.map((p) => p.id)).toEqual(['recent']);
  });
});
