import type { Pr } from '@postpile/core';
import { makeComment, makeReview, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

// NOW is 2026-09-02T12:00Z. The sync stores PRs with fetchedAt NOW.
const READ_AT = '2026-09-02T12:01:00.000Z';
const MERGED_AT = '2026-09-02T12:03:00.000Z';
const THREAD_MOVED = '2026-09-02T12:04:00.000Z';

/** The viewer's own PR, synced, with its thread read on github.com and the inbox answering 304 from here on. */
async function ownReadPr(h: Harness): Promise<Pr> {
  const pr = reviewRequestedPr(1, { author: viewer.login });
  h.reader.addPr(pr, makeThreadFor(pr, { reason: 'author', unread: false, lastReadAt: READ_AT }));
  await h.engine.sync({ maxAgentCalls: 0 });
  return pr;
}

function mergedByViewer(pr: Pr): Pr {
  return {
    ...pr,
    state: 'MERGED',
    mergedAt: MERGED_AT,
    mergedBy: viewer.login,
    updatedAt: MERGED_AT,
    timeline: [...pr.timeline, makeTimelineItem({ id: 'merged-1', kind: 'merged', actor: viewer.login, at: MERGED_AT, subject: null })],
  };
}

describe('the poll watches read threads', () => {
  it('shows a merge on a read thread within one cycle, keeps it read and counts the own merge as seen', async () => {
    const h = makeHarness();
    const pr = await ownReadPr(h);
    await h.engine.pollOnce();

    // Merged on github.com: the thread moves but stays read, so the unread inbox does not change.
    const merged = mergedByViewer(pr);
    h.reader.addPr(merged, makeThreadFor(merged, { reason: 'author', unread: false, lastReadAt: READ_AT, updatedAt: THREAD_MOVED }));
    h.reader.readListEtag = 'read-etag-2';

    const cycle = await h.engine.pollOnce();

    expect(cycle).toMatchObject({ kind: 'done', notModified: false, prsUpdated: 1 });
    expect(h.store.prs.get(pr.key)?.state).toBe('MERGED');
    expect(h.store.notifications.get('thread-1')).toMatchObject({ unread: false, updatedAt: THREAD_MOVED });
    const mergeEvent = h.store.events.listForPr(pr.key).find((event) => event.at === MERGED_AT);
    expect(mergeEvent?.seenAt).toBe(MERGED_AT);
    expect(h.writer.calls).toEqual([]);
  });

  it('asks with its own cursor every cycle and gets a 304 until something moves', async () => {
    const h = makeHarness();
    const pr = await ownReadPr(h);
    const syncCalls = h.reader.readListCalls.length;

    await h.engine.pollOnce();
    await h.engine.pollOnce();
    const merged = mergedByViewer(pr);
    h.reader.addPr(merged, makeThreadFor(merged, { reason: 'author', unread: false, lastReadAt: READ_AT, updatedAt: THREAD_MOVED }));
    h.reader.readListEtag = 'read-etag-2';
    await h.engine.pollOnce();
    await h.engine.pollOnce();

    expect(h.reader.readListCalls.slice(syncCalls)).toEqual([
      // Starts at the last full sync, no ETag yet.
      [NOW.toISOString(), null],
      [NOW.toISOString(), 'read-etag-1'],
      [NOW.toISOString(), 'read-etag-1'],
      // After the 200 with the merged thread: its update less a minute of overlap.
      ['2026-09-02T12:03:00.000Z', 'read-etag-2'],
    ]);
  });

  it('logs every 200 of the watch with the tally', async () => {
    const lines: string[] = [];
    const h = makeHarness({ syncLog: (line) => lines.push(line) });
    const pr = await ownReadPr(h);
    const merged = mergedByViewer(pr);
    h.reader.addPr(merged, makeThreadFor(merged, { reason: 'author', unread: false, lastReadAt: READ_AT, updatedAt: THREAD_MOVED }));

    await h.engine.pollOnce();

    expect(lines).toContain(`live poll: read-threads watch answered 200 with 1 threads since ${NOW.toISOString()} (200 on 1 of 1 polls since start)`);
  });
});

describe('after a full sync', () => {
  it('runs one poll cycle right away, since the poll was blocked while the sync ran', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.engine.startLivePoll({ intervalSeconds: 10, onNotify: () => {} });

    await h.engine.sync({ maxAgentCalls: 0 });
    for (let i = 0; i < 50 && (await h.engine.livePollStatus()).lastPollAt === null; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect((await h.engine.livePollStatus()).lastPollAt).not.toBeNull();
    // One inbox read by the sync, one by the poll right after it.
    expect(h.reader.notificationCalls).toBe(2);
    h.engine.stopLivePoll();
  });
});

describe('poll on window focus', () => {
  /** Live poll started and one full sync done, so the cycle right after it ran. */
  async function afterFirstCycle(h: Harness): Promise<void> {
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.engine.startLivePoll({ intervalSeconds: 60, onNotify: () => {} });
    await h.engine.sync({ maxAgentCalls: 0 });
    for (let i = 0; i < 50 && (await h.engine.livePollStatus()).lastPollAt === null; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  it('runs one cycle without opened PRs, but not within 15s of the last one', async () => {
    const h = makeHarness();
    await afterFirstCycle(h);
    const calls = h.reader.notificationCalls;

    await h.engine.refreshOnFocus([]);
    expect(h.reader.notificationCalls).toBe(calls);
    h.timers.advance(15_000);
    await h.engine.refreshOnFocus([]);
    expect(h.reader.notificationCalls).toBe(calls + 1);
    h.engine.stopLivePoll();
  });

  it('runs no cycle while a full sync runs', async () => {
    const h = makeHarness();
    await afterFirstCycle(h);
    h.timers.advance(20_000);
    const lastPollAt = (await h.engine.livePollStatus()).lastPollAt;

    const sync = h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.refreshOnFocus([]);
    expect((await h.engine.livePollStatus()).lastPollAt).toBe(lastPollAt);
    await sync;
    h.engine.stopLivePoll();
  });
});

describe('how a read elsewhere was noticed', () => {
  it('logs a thread that left the unread list after a 200', async () => {
    const lines: string[] = [];
    const h = makeHarness({ syncLog: (line) => lines.push(line) });
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    h.reader.threads = [];
    h.reader.etag = 'etag-2';

    await h.engine.pollOnce();

    expect(lines).toContain(`poll: ${pr.key} was read elsewhere, noticed because it left the unread list (unread list 200)`);
  });

  it('logs one the read list reports while the unread list answered 304', async () => {
    const lines: string[] = [];
    const h = makeHarness({ syncLog: (line) => lines.push(line) });
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    // GitHub keeps the inbox ETag, but the thread shows up read in the watch.
    h.reader.readList = [makeThreadFor(pr, { unread: false, lastReadAt: READ_AT, updatedAt: THREAD_MOVED })];

    await h.engine.pollOnce();

    expect(lines).toContain(`poll: ${pr.key} was read elsewhere, noticed because the read list says read (unread list 304)`);
    expect(h.store.notifications.get('thread-1')).toMatchObject({ unread: false, lastReadAt: READ_AT });
  });
});

describe('freshness check', () => {
  function approvedByBob(pr: Pr): Pr {
    return { ...pr, updatedAt: '2026-09-02T12:30:00.000Z', reviewDecision: 'APPROVED', reviews: [makeReview({ id: 'r-bob', author: 'bob', state: 'APPROVED' })] };
  }

  it('refetches a PR whose thread did not move but GitHub has newer, on the next full sync', async () => {
    const lines: string[] = [];
    const h = makeHarness({ syncLog: (line) => lines.push(line) });
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    h.reader.prs.set(pr.key, approvedByBob(pr));

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.prsFetched).toBe(1);
    expect(h.store.prs.get(pr.key)?.reviewDecision).toBe('APPROVED');
    expect(lines).toContain(`sync: freshness check, 1 PRs checked, 1 moved: ${pr.key}`);
  });

  it('runs from the poll at most once a minute', async () => {
    let clock = NOW;
    const h = makeHarness({ now: () => clock });
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    const checks = h.reader.updatedAtCalls.length;
    h.reader.prs.set(pr.key, approvedByBob(pr));

    // Right after the sync: not due yet.
    await h.engine.pollOnce();
    expect(h.reader.updatedAtCalls.length).toBe(checks);

    clock = new Date(NOW.getTime() + 60_000);
    h.runner.answer('ping_decision', { decisions: [] });
    const cycle = await h.engine.pollOnce();

    expect(h.reader.updatedAtCalls.length).toBe(checks + 1);
    expect(cycle).toMatchObject({ kind: 'done', notModified: false, prsUpdated: 1 });
    expect(h.store.prs.get(pr.key)?.reviewDecision).toBe('APPROVED');
  });

  it('leaves out merged PRs older than a day and PRs no tile shows', async () => {
    let clock = NOW;
    const h = makeHarness({ now: () => clock });
    const open = reviewRequestedPr(1);
    const merged = reviewRequestedPr(2, { state: 'MERGED', updatedAt: '2026-08-30T12:00:00.000Z' });
    h.reader.addPr(open, makeThreadFor(open));
    h.reader.addPr(merged, makeThreadFor(merged));
    await h.engine.sync({ maxAgentCalls: 0 });

    clock = new Date(NOW.getTime() + 60_000);
    await h.engine.pollOnce();

    expect(h.reader.updatedAtCalls.at(-1)?.map((ref) => ref.number)).toEqual([1]);
  });
});

describe('refresh after a write and on focus', () => {
  it('fetches the PR again right after an approve, without holding up the answer', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    const approved = { ...pr, reviewDecision: 'APPROVED' as const, reviews: [makeReview({ id: 'r-me', author: viewer.login, state: 'APPROVED' })] };
    h.reader.prs.set(pr.key, approved);
    const fetches = h.reader.fetchedRefs.length;
    const changesBefore = (await h.engine.livePollStatus()).changeCount;
    // GitHub answers the refetch only once the test lets it.
    let answer = () => {};
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const fetchPrs = h.reader.fetchPrs.bind(h.reader);
    h.reader.fetchPrs = async (refs) => {
      await gate;
      return fetchPrs(refs);
    };

    const result = await h.engine.approve(pr.key, pr.headOid);

    expect(result.ok).toBe(true);
    expect(h.store.prs.get(pr.key)?.reviewDecision).not.toBe('APPROVED');
    answer();
    await h.engine.writeRefreshSettled();
    expect(h.reader.fetchedRefs.slice(fetches)).toEqual([[pr.ref]]);
    expect(h.store.prs.get(pr.key)?.reviewDecision).toBe('APPROVED');
    // The renderer refetches on a moved changeCount.
    expect((await h.engine.livePollStatus()).changeCount).toBe(changesBefore + 1);
  });

  it('keeps a teammate\'s comment that the refresh after an approve brings in unseen', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    const comment = makeComment({ id: 'c-new', author: 'lyra', body: 'one more thing', createdAt: '2026-09-02T12:02:00.000Z' });
    h.reader.prs.set(pr.key, {
      ...pr,
      updatedAt: '2026-09-02T12:02:00.000Z',
      comments: [...pr.comments, comment],
      reviews: [makeReview({ id: 'r-me', author: viewer.login, state: 'APPROVED' })],
    });

    await h.engine.approve(pr.key, pr.headOid);
    await h.engine.writeRefreshSettled();

    const fresh = h.store.events.listForPr(pr.key).filter((event) => event.sourceId === 'c-new');
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.seenAt).toBeNull();
  });

  it('looks up the thread of a PR opened on github.com, and fetches one without a thread', async () => {
    const h = makeHarness();
    const pr = await ownReadPr(h);
    const found = reviewRequestedPr(2);
    h.reader.addStackPr(found);
    const merged = mergedByViewer(pr);
    h.reader.prs.set(pr.key, merged);
    // The watch has not caught up yet (same ETag); only the direct lookup sees the move.
    const lookups: string[] = [];
    h.reader.getThread = async (id) => {
      lookups.push(id);
      return makeThreadFor(merged, { reason: 'author', unread: false, lastReadAt: READ_AT, updatedAt: THREAD_MOVED });
    };
    await h.engine.pollOnce();
    const fetches = h.reader.fetchedRefs.length;

    await h.engine.refreshOnFocus([pr.key, found.key]);

    expect(lookups).toEqual(['thread-1']);
    expect(h.reader.fetchedRefs.slice(fetches)).toEqual([[pr.ref, found.ref]]);
    expect(h.store.prs.get(pr.key)?.state).toBe('MERGED');
  });
});

describe('the live status counts finished syncs', () => {
  it('moves changeCount when a sync ends, so a sync between two looks is not missed', async () => {
    const h = makeHarness();
    const before = (await h.engine.livePollStatus()).changeCount;
    await h.engine.sync({ maxAgentCalls: 0 });
    const after = await h.engine.livePollStatus();
    expect(after.syncRunning).toBe(false);
    expect(after.changeCount).toBeGreaterThan(before);
  });
});
