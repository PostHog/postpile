import { SYNC_MAX_PRS } from '@postpile/core';
import { at, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

describe('Engine.sync without the agent', () => {
  it('stores threads, PRs and events and shows them as Unsorted', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1, { reviewerUsers: [viewer.login] });
    h.reader.addPr(pr, makeThreadFor(pr));

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.errors).toEqual([]);
    expect(report).toMatchObject({ threads: 1, prsFetched: 1, newEvents: 1, agentCalls: 0 });
    const topics = await h.engine.listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ group: 'needs_you', unreadTiles: 1, topic: { id: UNSORTED_TOPIC_ID } });
    const detail = await h.engine.getTopic(UNSORTED_TOPIC_ID);
    expect(detail?.tiles[0]?.state.unreadBecause[0]?.kind).toBe('review_requested');
    expect(detail?.tiles[0]).toMatchObject({ why: 'RV', turn: { kind: 'you', prKey: pr.key } });
    expect(detail?.tiles[0]?.prs[0]).toMatchObject({ why: 'RV', status: { lifecycle: 'open' }, openThreads: 0 });
    expect(h.writer.calls).toEqual([]);
  });

  it('keeps the last report, errors and timing included, so it survives a restart', async () => {
    const h = makeHarness();
    expect(await h.engine.lastSyncReport()).toBeNull();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(await h.engine.lastSyncReport()).toEqual(report);
    expect(JSON.parse(h.store.meta.get('last_sync_report') ?? 'null')).toMatchObject({ prsFetched: 1, startedAt: report.startedAt, finishedAt: report.finishedAt });
  });

  it('keeps going when a PR batch fails: the rest store, the error is reported, the next sync retries', async () => {
    const h = makeHarness();
    const good = reviewRequestedPr(1, { reviewerUsers: [viewer.login] });
    const bad = reviewRequestedPr(2, { reviewerUsers: [viewer.login] });
    h.reader.addPr(good, makeThreadFor(good));
    h.reader.addPr(bad, makeThreadFor(bad));
    h.reader.failingPrs.add(bad.key);

    const first = await h.engine.sync({ maxAgentCalls: 0 });

    expect(first).toMatchObject({ prsFetched: 1, newEvents: 1 });
    expect(first.errors).toEqual([`PRs: 1 PRs from ${bad.key}: GitHub PR batch query failed: Something went wrong`]);

    h.reader.failingPrs.clear();
    const second = await h.engine.sync({ maxAgentCalls: 0 });
    expect(second).toMatchObject({ prsFetched: 1, errors: [] });
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

  it('takes a big inbox in batches of SYNC_MAX_PRS and never fetches threads older than 30 days', async () => {
    const h = makeHarness();
    for (let n = 1; n <= SYNC_MAX_PRS + 10; n++) {
      const pr = reviewRequestedPr(n, { updatedAt: at(n) });
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    const old = reviewRequestedPr(9001, { updatedAt: '2026-07-01T00:00:00Z' });
    h.reader.addPr(old, makeThreadFor(old));

    const first = await h.engine.sync({ maxAgentCalls: 0 });
    expect(first).toMatchObject({ threads: SYNC_MAX_PRS + 11, prsFetched: SYNC_MAX_PRS, prsSkipped: 10 });

    const second = await h.engine.sync({ maxAgentCalls: 0 });
    expect(second).toMatchObject({ prsFetched: 10, prsSkipped: 0 });
    const fetched = h.reader.fetchedRefs.flat().map((ref) => ref.number);
    expect(fetched).not.toContain(9001);
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
  it('assigns topics, then skips every agent call on an unchanged second sync', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.runner.answer('topic_assignment', {
      assignments: [{ prKey: pr.key, kind: 'new', name: 'Move CI to Depot', reason: 'CI runners' }],
    });

    const report = await h.engine.sync();

    expect(report.errors).toEqual([]);
    expect(report.agentCallStats.byKind).toMatchObject({
      topic_assignment: { calls: 1 },
      dossier_update: { calls: 1 },
      glance_batch: { calls: 1 },
      event_classification: { calls: 1 },
    });
    expect(report.agentCalls).toBe(4);
    expect(report.dossiersUpdated).toBe(1);
    const [item] = await h.engine.listTopics();
    expect(item?.topic).toMatchObject({ name: 'Move CI to Depot', summary: 'Move CI to Depot: 1 new events', driver: 'alice' });
    expect(item?.topic.userRole).toBe('reviewer');
    expect(item?.statusLine).toEqual({ status: 'active', note: '' });
    const tiles = (await h.engine.getTopic(item!.topic.id))?.tiles ?? [];
    expect(item?.yourMoveTiles).toBe(tiles.filter((view) => view.state.kind !== 'done' && view.turn.kind === 'you').length);
    expect((await h.engine.getPr(pr.key))?.glance).toMatchObject({ verdict: 'LOOKS_SAFE', dossierVersion: 1 });

    h.reader.etag = 'etag-2';
    const again = await h.engine.sync();
    expect(again.errors).toEqual([]);
    expect(again.agentCalls).toBe(0);
    expect(again.agentCallStats.byKind.glance_batch?.skippedUnchanged).toBe(1);
    expect(h.writer.calls).toEqual([]);
  });

  it('logs per-phase timings and keeps them in the report', async () => {
    const lines: string[] = [];
    const h = makeHarness({ syncLog: (line) => lines.push(line) });
    const pr = reviewRequestedPr(1, { reviewerUsers: [viewer.login] });
    h.reader.addPr(pr, makeThreadFor(pr));

    const report = await h.engine.sync();

    expect(Object.keys(report.phaseMs ?? {}).sort()).toEqual(['dossiers', 'events', 'facts', 'fetch', 'glances', 'sets', 'topics']);
    expect(lines.find((line) => line.startsWith('sync: done'))).toMatch(/; phases fetch 0\.0s, topics 0\.0s, dossiers 0\.0s/);
  });

  it('writes one agent_call row per call with the sync as run id', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));

    const report = await h.engine.sync({ agentJobs: ['glances'] });

    expect(report.agentCallStats.byKind.glance_batch).toMatchObject({ calls: 1, failed: 0, durationMs: 5, costUsd: 0.01 });
    expect(h.store.agentCalls.statsForRun(`sync:${report.startedAt}`).total).toBe(1);
  });

  it('flags a stored glance as stale when the PR moved and no new glance was made', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ agentJobs: ['glances'] });
    expect((await h.engine.getPr(pr.key))?.glanceStale).toBe(false);

    const pushed = { ...pr, headOid: 'new-head' };
    h.reader.addPr(pushed, makeThreadFor(pushed, { updatedAt: '2026-09-03T00:00:00.000Z' }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    const detail = await h.engine.getPr(pr.key);
    expect(detail?.glance?.verdict).toBe('LOOKS_SAFE');
    expect(detail?.glanceStale).toBe(true);
    const tile = (await h.engine.getTopic(UNSORTED_TOPIC_ID))?.tiles[0];
    expect(tile?.prs[0]?.glanceStale).toBe(true);
  });

  it('keeps going when one agent answer is broken', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.runner.answer('topic_assignment', 'not json at all');
    h.runner.answer('topic_assignment', 'not json either');

    const report = await h.engine.sync({ agentJobs: ['topics', 'glances'] });

    // Both calls fail (first try and retry), then one line says the PR waits for the next sync.
    expect(report.errors).toHaveLength(3);
    expect(report.errors.every((line) => line.startsWith('topic assignment'))).toBe(true);
    expect(report.agentCallStats.byKind.topic_assignment).toMatchObject({ calls: 2, failed: 2 });
    expect((await h.engine.getPr(pr.key))?.glance?.verdict).toBe('LOOKS_SAFE');
  });

  it('stores agent sets and keeps the set id when the agent keeps the title', async () => {
    const h = makeHarness();
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    for (const pr of prs) {
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    const topic = { id: 'depot', name: 'Depot', summary: '', summaryInputHash: null,
    area: null, tailoring: '', driver: null, userRole: 'watcher' as const, status: 'active' as const, createdAt: at(0), updatedAt: at(0) };
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

  it('never puts a PR back into a set the user removed it from', async () => {
    const h = makeHarness();
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2), reviewRequestedPr(3)];
    for (const pr of prs) {
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    const topic = { id: 'depot', name: 'Depot', summary: '', summaryInputHash: null,
    area: null, tailoring: '', driver: null, userRole: 'watcher' as const, status: 'active' as const, createdAt: at(0), updatedAt: at(0) };
    h.store.topics.create(topic);
    for (const pr of prs) {
      h.store.memberships.assign({ prKey: pr.key, topicId: 'depot', assignedBy: 'user', reason: '', createdAt: at(0) });
    }
    const members = prs.map((pr) => ({ prKey: pr.key, reason: 'runner change' }));
    h.runner.answer('set_grouping', { sets: [{ title: 'Runner switch', take: 'All three.', members }] });
    await h.engine.sync({ agentJobs: ['sets'] });
    const setId = h.store.sets.listActiveForTopic('depot')[0]!.id;

    const removed = prs[2]!.key;
    await h.engine.giveFeedback({ kind: 'not_related', tileId: `set:${setId}`, prKey: removed, targetTopicId: null, note: '' });
    // The agent proposes the same grouping again, once under the old title and once under a new one.
    h.runner.answer('set_grouping', {
      sets: [
        { title: 'Runner switch', take: 'All three again.', members },
        { title: 'Other name', take: 'Same pair.', members: [members[0], members[2]] },
      ],
    });
    const report = await h.engine.sync({ agentJobs: ['sets'] });

    expect(report.agentCalls).toBe(1);
    const sets = h.store.sets.listActiveForTopic('depot');
    expect(sets.map((s) => s.id)).toEqual([setId]);
    expect(sets[0]?.members.map((m) => m.prKey)).toEqual([prs[0]!.key, prs[1]!.key]);
    expect(sets[0]?.removedKeys).toEqual([removed]);
  });
});

describe('Engine.search', () => {
  it('finds stored PRs by title and number, per topic and tile', async () => {
    const h = makeHarness();
    for (const [n, title] of [[1, 'Move CI to Depot'], [2, 'Fix flaky test']] as const) {
      const pr = reviewRequestedPr(n, { title });
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    await h.engine.sync({ maxAgentCalls: 0 });

    const byTitle = await h.engine.search('depot');
    expect(byTitle.topics).toHaveLength(1);
    expect(byTitle.topics[0]).toMatchObject({ topicId: UNSORTED_TOPIC_ID, prKeys: ['acme/app#1'] });
    expect((await h.engine.search('#2 flaky')).topics[0]?.prKeys).toEqual(['acme/app#2']);
    expect((await h.engine.search('nothing-like-this')).topics).toEqual([]);
  });
});
