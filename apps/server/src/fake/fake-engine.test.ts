import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

describe('FakeEngine', () => {
  it('refuses undo after the 6s window', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    const marked = await engine.markRead('pr:PostHog/posthog#41915');
    now = new Date(now.getTime() + 7000);
    const undone = await engine.undo(marked.undoToken);
    expect(undone).toEqual({ ok: false, message: 'undo window closed', undoToken: null });
  });

  it('undoes the newest batch when no token is given', async () => {
    const engine = new FakeEngine();
    await engine.markRead('pr:PostHog/posthog#41915');
    await engine.markRead('pr:PostHog/posthog#41790');
    await engine.undo(null);
    const topics = await engine.listTopics();
    expect(topics.find((item) => item.topic.id === 'topic-ci-tests')?.unreadTiles).toBe(2);
    expect(topics.find((item) => item.topic.id === 'topic-depot')?.unreadTiles).toBe(2);
  });

  it('wakes a time snooze once the time has passed', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    const tileId = 'pr:PostHog/posthog#41822';
    await engine.markRead(tileId);
    await engine.snooze(tileId, { kind: 'until_time', until: '2026-09-27T11:00:00.000Z' });
    expect((await engine.getTopic('topic-ci-tests'))?.tiles.find((view) => view.tile.id === tileId)?.state.kind).toBe('snoozed');
    now = new Date('2026-09-27T12:00:00Z');
    expect((await engine.getTopic('topic-ci-tests'))?.tiles.find((view) => view.tile.id === tileId)?.state.kind).toBe('done');
  });
});

describe('FakeEngine memory', () => {
  it('shows the Depot dossier with changes since the seen cursor, until the topic is marked seen', async () => {
    const engine = new FakeEngine();
    const before = (await engine.getTopic('topic-depot'))?.dossier;
    expect(before?.version).toBe(3);
    expect(before?.history.map((note) => note.version)).toEqual([3, 2, 1]);
    expect(before?.changesSinceSeen?.changes.length).toBeGreaterThan(0);

    await engine.markTopicSeen('topic-depot');

    expect((await engine.getTopic('topic-depot'))?.dossier?.changesSinceSeen?.changes).toEqual([]);
  });

  it('forgets a fact marked wrong and remembers a dossier line marked wrong', async () => {
    const engine = new FakeEngine();
    const prKey = 'PostHog/posthog#41902';
    const facts = (await engine.getPr(prKey))?.facts ?? [];
    expect(facts.some((view) => view.stale === 'head_moved')).toBe(true);

    await engine.correctMemory({ kind: 'wrong', factId: 'fact-lyra-reviews-41902', topicId: null, text: '' });
    await engine.correctMemory({ kind: 'forget', factId: null, topicId: 'topic-depot', text: 'Storybook build time' });

    const after = (await engine.getPr(prKey))?.facts ?? [];
    expect(after.map((view) => view.fact.id)).not.toContain('fact-lyra-reviews-41902');
    expect((await engine.getTopic('topic-depot'))?.dossier?.correctedClaims).toContain('Storybook build time');
  });

  it('files the next rule proposal once and merges a topic on accept', async () => {
    const engine = new FakeEngine();
    expect((await engine.consolidate()).ruleProposalsFiled).toBe(1);
    expect((await engine.consolidate()).ruleProposalsFiled).toBe(0);
    expect((await engine.listProposals()).rules).toHaveLength(2);

    await engine.decideTopicProposal('proposal-merge-frontend', true);

    const topics = await engine.listTopics();
    expect(topics.map((item) => item.topic.id)).not.toContain('topic-frontend-build');
  });
});
