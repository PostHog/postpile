import type { Pr } from '@postpile/core';
import { makeComment, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

// NOW is 2026-09-02T12:00Z; events a few minutes before it are fresh.
const FRESH = '2026-09-02T11:55:00.000Z';
// Thread activity after the sync's fetch time (NOW), so the poll refetches the PR.
const LATER = '2026-09-02T12:01:00.000Z';

/** A synced PR, then new activity on GitHub the next poll will see. */
async function syncedPr(h: Harness, number: number): Promise<Pr> {
  const pr = reviewRequestedPr(number);
  h.reader.addPr(pr, makeThreadFor(pr));
  await h.engine.sync({ maxAgentCalls: 0 });
  return pr;
}

function withActivity(h: Harness, pr: Pr, changes: Partial<Pr>, etag: string): Pr {
  const next = { ...pr, ...changes, updatedAt: LATER };
  h.reader.addPr(next, makeThreadFor(next, { updatedAt: LATER }));
  h.reader.etag = etag;
  return next;
}

function mention(pr: Pr, body = `@${viewer.login} can you check the cache key?`): Partial<Pr> {
  return { comments: [makeComment({ id: `m-${pr.ref.number}`, author: 'bob', body, createdAt: FRESH })] };
}

describe('Engine.pollOnce', () => {
  it('does nothing on a 304', async () => {
    const h = makeHarness();
    await syncedPr(h, 1);
    const fetchesBefore = h.reader.fetchedRefs.length;

    const cycle = await h.engine.pollOnce();

    expect(cycle).toMatchObject({ kind: 'done', notModified: true, githubPollIntervalSeconds: 60, prsUpdated: 0, pings: [] });
    expect(h.reader.fetchedRefs.length).toBe(fetchesBefore);
    expect(h.runner.requests).toEqual([]);
  });

  it('asks the agent only about addressed activity and pings what it keeps', async () => {
    const h = makeHarness();
    const mentioned = await syncedPr(h, 1);
    const botOnly = await syncedPr(h, 2);
    withActivity(h, mentioned, mention(mentioned), 'etag-2');
    withActivity(h, botOnly, { comments: [makeComment({ id: 'b1', author: 'github-actions[bot]', body: 'Size report', createdAt: FRESH })] }, 'etag-2');
    h.runner.answer('ping_decision', {
      decisions: [{ id: 'thread-1', ping: true, title: '@bob asks about the cache key', body: 'On #1.', reason: 'direct question' }],
    });

    const cycle = await h.engine.pollOnce();

    if (cycle.kind !== 'done') throw new Error('expected a done cycle');
    expect(cycle.prsUpdated).toBe(2);
    expect(cycle.pings).toEqual([
      {
        title: '@bob asks about the cache key',
        body: 'On #1.',
        target: { topicId: 'unsorted', tileId: `pr:${mentioned.key}`, prKey: mentioned.key },
      },
    ]);
    const prompts = h.runner.promptsFor('ping_decision');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('## Item thread-1');
    expect(prompts[0]).not.toContain('## Item thread-2');
    expect(h.store.pingDecisions.listRecent(10).map((d) => [d.prKey, d.ping, d.source])).toEqual([
      [botOnly.key, false, 'rules'],
      [mentioned.key, true, 'agent'],
    ]);
  });

  it('records a veto and pings nothing', async () => {
    const h = makeHarness();
    const pr = await syncedPr(h, 1);
    withActivity(h, pr, mention(pr, `thanks @${viewer.login}!`), 'etag-2');
    h.runner.answer('ping_decision', { decisions: [{ id: 'thread-1', ping: false, reason: 'just a thank-you' }] });

    const cycle = await h.engine.pollOnce();

    expect(cycle).toMatchObject({ kind: 'done', pings: [] });
    expect(h.store.pingDecisions.listRecent(1)[0]).toMatchObject({ ping: false, source: 'agent', reason: 'just a thank-you' });
  });

  it('falls back to the rules with template text when the agent fails', async () => {
    const h = makeHarness();
    const pr = await syncedPr(h, 1);
    withActivity(h, pr, mention(pr), 'etag-2');
    h.runner.answer('ping_decision', 'no json here');

    const cycle = await h.engine.pollOnce();

    if (cycle.kind !== 'done') throw new Error('expected a done cycle');
    expect(cycle.pings.map((p) => p.title)).toEqual(['@bob asked you something · posthog#1']);
    expect(cycle.errors.some((e) => e.startsWith('ping decision:'))).toBe(true);
    expect(h.store.pingDecisions.listRecent(1)[0]).toMatchObject({ ping: true, source: 'fallback' });
    expect(h.store.pingDecisions.listRecent(1)[0]?.reason).toMatch(/^agent failed; rules: /);
  });

  it('skips the agent once the daily cap is spent', async () => {
    const h = makeHarness({ pingDecisionsPerDay: 0 });
    const pr = await syncedPr(h, 1);
    withActivity(h, pr, mention(pr), 'etag-2');

    const cycle = await h.engine.pollOnce();

    expect(h.runner.promptsFor('ping_decision')).toEqual([]);
    expect(cycle).toMatchObject({ kind: 'done', pings: [{ target: { prKey: pr.key } }] });
    expect(h.store.pingDecisions.listRecent(1)[0]?.reason).toMatch(/^daily cap of 0 ping decisions reached/);
  });

  it('does not ping for events older than the fresh window', async () => {
    const h = makeHarness();
    const pr = await syncedPr(h, 1);
    withActivity(h, pr, { comments: [makeComment({ id: 'old', body: `@${viewer.login} ?`, createdAt: '2026-09-02T10:00:00.000Z' })] }, 'etag-2');

    const cycle = await h.engine.pollOnce();

    expect(cycle).toMatchObject({ kind: 'done', prsUpdated: 1, pings: [], decisions: [] });
  });

  it('treats the first look at an empty store as a baseline', async () => {
    const h = makeHarness();
    const base = reviewRequestedPr(1, { updatedAt: LATER });
    const pr = { ...base, ...mention(base) };
    h.reader.addPr(pr, makeThreadFor(pr));

    const cycle = await h.engine.pollOnce();

    expect(cycle).toMatchObject({ kind: 'done', notModified: false, prsUpdated: 1, pings: [], decisions: [] });
    expect(await h.engine.getPr(pr.key)).not.toBeNull();
  });

  it('gives a PR new to the app a topic with one call', async () => {
    const h = makeHarness();
    await syncedPr(h, 1);
    const fresh = reviewRequestedPr(3, { updatedAt: LATER });
    const next = { ...fresh, ...mention(fresh) };
    h.reader.addPr(next, makeThreadFor(next));
    h.reader.etag = 'etag-2';
    h.runner.answer('topic_assignment', { assignments: [{ prKey: next.key, kind: 'new', name: 'Depot', reason: 'runners' }] });
    h.runner.answer('ping_decision', { decisions: [] });

    const cycle = await h.engine.pollOnce();

    const topicId = h.store.memberships.get(next.key)?.topicId;
    expect(topicId).toBeDefined();
    expect(cycle).toMatchObject({ kind: 'done', pings: [{ target: { topicId, tileId: `pr:${next.key}` } }] });
    // Agent answered nothing for the item, so the rules pinged it.
    expect(h.store.pingDecisions.listRecent(1)[0]?.source).toBe('fallback');
  });

  it('never writes to GitHub and leaves the thread unread', async () => {
    const h = makeHarness();
    const pr = await syncedPr(h, 1);
    withActivity(h, pr, mention(pr), 'etag-2');
    h.runner.answer('ping_decision', { decisions: [{ id: 'thread-1', ping: true, title: 't', body: 'b', reason: 'r' }] });

    await h.engine.pollOnce();

    expect(h.writer.calls).toEqual([]);
    expect(h.store.notifications.getByPrKey(pr.key)?.unread).toBe(true);
  });

  it('is blocked while a full sync runs, and a sync waits for a running poll', async () => {
    const h = makeHarness();
    await syncedPr(h, 1);

    const sync = h.engine.sync({ maxAgentCalls: 0 });
    expect(await h.engine.pollOnce()).toEqual({ kind: 'blocked', reason: 'full sync running' });
    await sync;

    h.reader.etag = 'etag-9';
    const poll = h.engine.pollOnce();
    const callsBefore = h.reader.notificationCalls;
    const syncAfter = h.engine.sync({ maxAgentCalls: 0 });
    await poll;
    await syncAfter;
    // The poll read the inbox first; the sync came after it and got a 304.
    expect(h.reader.notificationCalls).toBe(callsBefore + 1);
    expect((await syncAfter).notificationsNotModified).toBe(true);
  });

  it('hands the PRs it fetched to the next full sync for stacks and fact checks', async () => {
    let clock = NOW;
    const h = makeHarness({ now: () => clock });
    const pr = await syncedPr(h, 1);
    withActivity(h, pr, mention(pr), 'etag-2');
    // The poll fetches after the thread moved, as it would for real.
    clock = new Date('2026-09-02T12:05:00.000Z');
    h.runner.answer('ping_decision', { decisions: [] });
    await h.engine.pollOnce();
    const lookupsBefore = h.reader.branchLookups.length;

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report).toMatchObject({ notificationsNotModified: true, prsFetched: 0 });
    // The polled PR seeds a stack walk although the sync itself fetched nothing.
    expect(h.reader.branchLookups.length).toBeGreaterThan(lookupsBefore);
    expect(h.store.meta.get('poll_fetched_since_sync')).toBeNull();
  });

  it('records ping_decision calls under the poll run', async () => {
    const h = makeHarness();
    const pr = await syncedPr(h, 1);
    withActivity(h, pr, mention(pr), 'etag-2');
    h.runner.answer('ping_decision', { decisions: [] });

    await h.engine.pollOnce();

    const since = new Date(NOW.getTime() - 60_000).toISOString();
    expect(h.store.agentCalls.countSince('ping_decision', since)).toBe(1);
  });
});
