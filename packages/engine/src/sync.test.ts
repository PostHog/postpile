import { at, makeThreadFor } from '@code-manager/core/fixtures';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { glanceAnswer, makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

describe('Engine.sync without the agent', () => {
  it('stores threads, PRs and events and shows them as Unsorted', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.errors).toEqual([]);
    expect(report).toMatchObject({ threads: 1, prsFetched: 1, newEvents: 1, agentCalls: 0 });
    const topics = await h.engine.listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ group: 'needs_you', unreadTiles: 1, topic: { id: UNSORTED_TOPIC_ID } });
    const detail = await h.engine.getTopic(UNSORTED_TOPIC_ID);
    expect(detail?.tiles[0]?.state.unreadBecause[0]?.kind).toBe('review_requested');
    expect(h.writer.calls).toEqual([]);
  });

  it('fetches at most maxPrs and picks up the rest after a 304', async () => {
    const h = makeHarness();
    for (const n of [1, 2, 3]) {
      const pr = reviewRequestedPr(n, { updatedAt: at(n) });
      h.reader.addPr(pr, makeThreadFor(pr));
    }

    const first = await h.engine.sync({ maxPrs: 2, maxAgentCalls: 0 });
    expect(first).toMatchObject({ prsFetched: 2, prsSkipped: 1 });
    // Newest notification first.
    expect(h.reader.fetchedRefs[0]?.map((r) => r.number)).toEqual([3, 2]);

    const second = await h.engine.sync({ maxPrs: 2, maxAgentCalls: 0 });
    expect(second).toMatchObject({ notificationsNotModified: true, prsFetched: 1, prsSkipped: 0 });

    const third = await h.engine.sync({ maxAgentCalls: 0 });
    expect(third.prsFetched).toBe(0);
  });

  it('refetches a PR only when its thread moved after the last fetch', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    // Thread activity newer than the PR's own updatedAt, as with CI or bot activity.
    h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: at(60) }));
    await h.engine.sync({ maxAgentCalls: 0 });

    h.reader.etag = 'etag-2';
    expect((await h.engine.sync({ maxAgentCalls: 0 })).prsFetched).toBe(0);

    h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: '2026-09-03T00:00:00.000Z' }));
    h.reader.etag = 'etag-3';
    expect((await h.engine.sync({ maxAgentCalls: 0 })).prsFetched).toBe(1);
  });

  it('treats events older than the last read on github.com as seen', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1, { updatedAt: at(30) });
    h.reader.addPr(pr, makeThreadFor(pr, { lastReadAt: at(5) }));

    await h.engine.sync({ maxAgentCalls: 0 });

    const detail = await h.engine.getPr(pr.key);
    expect(detail?.events.map((e) => e.display)).toEqual(['seen']);
  });

  it('marks threads that left the inbox as read locally', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });

    h.reader.threads = [];
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.notifications.list()[0]?.unread).toBe(false);
  });
});

describe('Engine.sync with the agent', () => {
  it('assigns topics, summarizes, glances, and skips all of it on an unchanged second sync', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.runner
      .answer('topic_assignment', {
        assignments: [{ prKey: pr.key, kind: 'new', name: 'Move CI to Depot', reason: 'CI runners' }],
      })
      .answer('topic_summary', { summary: 'Moving CI to Depot.' })
      .answer('glance', glanceAnswer())
      .answer('event_classification', { overrides: [] });

    const report = await h.engine.sync();

    expect(report.errors).toEqual([]);
    expect(report.agentCalls).toBe(4);
    const [item] = await h.engine.listTopics();
    expect(item?.topic).toMatchObject({ name: 'Move CI to Depot', summary: 'Moving CI to Depot.', driver: 'alice' });
    expect(item?.topic.userRole).toBe('reviewer');
    expect((await h.engine.getPr(pr.key))?.glance?.verdict).toBe('LOOKS_SAFE');

    h.reader.etag = 'etag-2';
    const again = await h.engine.sync();
    expect(again.errors).toEqual([]);
    expect(again.agentCalls).toBe(0);
    expect(h.writer.calls).toEqual([]);
  });

  it('respects maxAgentCalls and agentJobs', async () => {
    const h = makeHarness();
    for (const n of [1, 2]) {
      const pr = reviewRequestedPr(n);
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    h.runner.answer('glance', glanceAnswer()).answer('glance', glanceAnswer());

    const report = await h.engine.sync({ maxAgentCalls: 1, agentJobs: ['glances'] });

    expect(report.agentCalls).toBe(1);
    expect(h.runner.requests.map((r) => r.purpose)).toEqual(['glance']);
  });

  it('keeps going when one agent answer is broken', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.runner.answer('glance', 'not json at all');

    const report = await h.engine.sync({ agentJobs: ['glances'] });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/^glance PostHog\/posthog#1/);
    expect(await h.engine.listTopics()).toHaveLength(1);
  });

  it('stores agent sets and keeps the set id when the agent keeps the title', async () => {
    const h = makeHarness();
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    for (const pr of prs) {
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    const topic = { id: 'depot', name: 'Depot', summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher' as const, status: 'active' as const, createdAt: at(0), updatedAt: at(0) };
    h.store.topics.create(topic);
    for (const pr of prs) {
      h.store.memberships.assign({ prKey: pr.key, topicId: 'depot', assignedBy: 'user', reason: '', createdAt: at(0) });
    }
    const members = prs.map((pr) => ({ prKey: pr.key, reason: 'same runner change' }));
    h.runner.answer('set_grouping', { sets: [{ title: 'Runner switch', take: 'Both switch runners.', members }] });

    await h.engine.sync({ agentJobs: ['sets'] });

    const detail = await h.engine.getTopic('depot');
    expect(detail?.sets).toHaveLength(1);
    const setTile = detail?.tiles.find((t) => t.tile.kind === 'set');
    expect(setTile?.prs.map((p) => p.key)).toEqual(prs.map((p) => p.key));

    // Feedback changes the input hash, so the next sync regroups; same title keeps the id.
    await h.engine.giveFeedback({ kind: 'not_mine', tileId: setTile!.tile.id, prKey: prs[0]!.key, targetTopicId: null, note: '' });
    h.runner.answer('set_grouping', { sets: [{ title: 'Runner switch', take: 'Still both.', members }] });
    await h.engine.sync({ agentJobs: ['sets'] });
    const after = await h.engine.getTopic('depot');
    expect(after?.sets.map((s) => s.id)).toEqual(detail?.sets.map((s) => s.id));
    expect(after?.sets[0]?.take).toBe('Still both.');
  });
});
