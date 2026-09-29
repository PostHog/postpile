import type { Pr, TopicProposal } from '@postpile/core';
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

/** #1 <- #2 is a stack, #3 stands alone; all three in topic depot, synced into the store. */
async function depotWithStack(h: Harness): Promise<{ bottom: Pr; top: Pr; lone: Pr }> {
  const bottom = reviewRequestedPr(1, { baseRef: 'master', headRef: 's1' });
  const top = reviewRequestedPr(2, { baseRef: 's1', headRef: 's2' });
  const lone = reviewRequestedPr(3);
  topicWithPrs(h, 'depot', [bottom, top, lone]);
  await h.engine.sync({ maxAgentCalls: 0 });
  return { bottom, top, lone };
}

describe('accepting a topic proposal', () => {
  it('moves a whole stack with a split and reports the source in telemetry', async () => {
    const { h } = clockedHarness();
    const { bottom, top, lone } = await depotWithStack(h);
    h.store.proposals.add(proposal({ id: 's', kind: 'split', name: 'Runner images', prKeys: [top.key] }));

    expect((await h.engine.decideTopicProposal('s', true)).ok).toBe(true);

    const moved = h.store.memberships.get(bottom.key)?.topicId;
    expect(moved).not.toBe('depot');
    expect(h.store.memberships.get(top.key)?.topicId).toBe(moved);
    expect(h.store.memberships.get(lone.key)?.topicId).toBe('depot');
    expect(h.telemetry.events).toContainEqual({ event: 'proposal_resolved', props: { kind: 'topic_split', accepted: true, source: 'agent' } });
  });

  it('refuses when the proposal no longer fits, and changes nothing', async () => {
    const { h } = clockedHarness();
    const { bottom, top, lone } = await depotWithStack(h);
    h.store.topics.create({ ...h.store.topics.get('depot')!, id: 'other', name: 'Other' });
    h.store.proposals.add(proposal({ id: 'gone', kind: 'split', name: 'Moved', prKeys: [lone.key] }));
    h.store.proposals.add(proposal({ id: 'all', kind: 'split', name: 'Everything', prKeys: [top.key, lone.key] }));
    h.store.proposals.add(proposal({ id: 'merge', kind: 'merge', name: null, intoTopicId: 'other' }));
    h.store.memberships.assign({ prKey: lone.key, topicId: 'other', assignedBy: 'user', reason: '', createdAt: '2026-09-02T12:00:00.000Z' });
    h.store.topics.setStatus('other', 'archived', '2026-09-02T12:00:00.000Z');

    expect((await h.engine.decideTopicProposal('gone', true)).message).toBe(`Can't accept: ${lone.key} left the topic since. Nothing changed; reject it instead.`);
    expect((await h.engine.decideTopicProposal('merge', true)).message).toContain('the topic to merge into is no longer active');
    h.store.memberships.assign({ prKey: lone.key, topicId: 'depot', assignedBy: 'user', reason: '', createdAt: '2026-09-02T12:00:00.000Z' });
    expect((await h.engine.decideTopicProposal('all', true)).message).toContain('no PR would stay behind');
    expect(h.store.memberships.get(bottom.key)?.topicId).toBe('depot');
    expect(h.store.proposals.get('all')?.status).toBe('pending');
    // Rejecting always works.
    expect((await h.engine.decideTopicProposal('all', false)).ok).toBe(true);
  });

  it('refuses an expired outside proposal', async () => {
    const { h, setNow } = clockedHarness();
    await depotWithStack(h);
    h.store.proposals.add(proposal({ id: 'r' }));
    setNow('2026-09-20T00:00:00Z');
    expect((await h.engine.decideTopicProposal('r', true)).message).toBe('This suggestion expired; nothing changed.');
    expect(h.store.topics.get('depot')?.name).not.toBe('Depot runners');
  });
});

describe('proposeTopicChange from an outside agent', () => {
  const client = { client: 'claude-code' };

  it('files a split for the user with a preview that names the stack, and never applies it', async () => {
    const { h } = clockedHarness();
    const { bottom, top, lone } = await depotWithStack(h);
    const change = { topicId: 'depot', kind: 'split' as const, prKeys: [top.key], name: 'Runner images', intoTopicId: null, reason: 'separate work', dryRun: false };

    const result = await h.engine.proposeTopicChange(change, client);

    expect(result).toMatchObject({ status: 'filed', movedPrKeys: [bottom.key, top.key], reason: null });
    expect(result.preview).toContain(`${top.key} brings ${bottom.key} along (same stack).`);
    expect(result.preview).toContain('1 PR stay in "depot".');
    expect(h.store.proposals.get(result.proposalId!)).toMatchObject({ kind: 'split', source: 'agent', client: 'claude-code', status: 'pending', prKeys: [top.key] });
    expect(h.store.memberships.get(top.key)?.topicId).toBe('depot');
    expect(h.store.memberships.get(lone.key)?.topicId).toBe('depot');
    expect((await h.engine.listProposals()).topics.map((p) => p.id)).toEqual([result.proposalId]);

    const again = await h.engine.proposeTopicChange(change, client);
    expect(again).toMatchObject({ status: 'refused', reason: expect.stringContaining('pending already') });
  });

  it('only previews on a dry run, and refuses a PR from another topic', async () => {
    const { h } = clockedHarness();
    const { lone } = await depotWithStack(h);
    const dry = await h.engine.proposeTopicChange({ topicId: 'depot', kind: 'rename', prKeys: [], name: 'Depot CI', intoTopicId: null, reason: 'clearer', dryRun: true }, client);
    expect(dry).toEqual({ status: 'dry_run', proposalId: null, preview: ['Rename "depot" to "Depot CI".'], reason: null, movedPrKeys: [] });
    expect((await h.engine.listProposals()).topics).toEqual([]);

    topicWithPrs(h, 'other', [reviewRequestedPr(7)]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const wrong = await h.engine.proposeTopicChange({ topicId: 'other', kind: 'split', prKeys: [lone.key], name: 'X', intoTopicId: null, reason: 'r', dryRun: false }, client);
    expect(wrong).toMatchObject({ status: 'refused', reason: expect.stringContaining('is not in "other"') });
  });
});
