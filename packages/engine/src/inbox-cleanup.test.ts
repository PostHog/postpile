import { makePr, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

// NOW is 2026-09-02T12:00Z.
const OLD_20 = '2026-08-13T12:00:00.000Z';
const OLD_40 = '2026-07-24T12:00:00.000Z';
const CUTOFF_14 = '2026-08-19T12:00:00.000Z';

/** One fresh unread PR thread plus two old unread issue threads (20 and 40 days). */
async function withOldThreads(options: { writesEnabled?: boolean } = {}): Promise<Harness> {
  const h = makeHarness(options);
  const pr = reviewRequestedPr(1);
  h.reader.addPr(pr, makeThreadFor(pr));
  const issue = (number: number, updatedAt: string) => ({ ...makeThreadFor(makePr({ number }), { updatedAt }), subjectType: 'Issue' });
  h.reader.threads = [...h.reader.threads, issue(20, OLD_20), issue(40, OLD_40)];
  await h.engine.sync({ maxAgentCalls: 0 });
  return h;
}

function logRows(h: Harness) {
  return h.store.actionLog.listRecent(20).toReversed().map((row) => [row.action, row.origin, row.outcome]);
}

describe('inbox cleanup', () => {
  it('counts old unread threads and shows a banner on the first run', async () => {
    const h = await withOldThreads();
    expect(await h.engine.inboxCleanup()).toEqual({
      unreadOlderThan14: 2,
      unreadOlderThan30: 1,
      look: 'banner',
      baseline: null,
      hiddenUntil: null,
      pendingCutoff: null,
    });
  });

  it('turns quiet after a normal sync gap once the dialog was answered, and prominent again after 5 days', async () => {
    let clock = NOW;
    const h = makeHarness({ now: () => clock });
    h.reader.threads = [{ ...makeThreadFor(makePr({ number: 20 }), { updatedAt: OLD_20 }), subjectType: 'Issue' }];
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.startFresh();
    await h.engine.clearStartFresh();
    clock = new Date('2026-09-03T12:00:00.000Z');
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await h.engine.inboxCleanup()).look).toBe('line');
    clock = new Date('2026-09-09T12:00:00.000Z');
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await h.engine.inboxCleanup()).look).toBe('banner');
  });

  it('marks everything older than 14 days read with one PUT, logged, then reads the inbox again', async () => {
    const h = await withOldThreads();
    const callsBefore = h.reader.notificationCalls;

    const result = await h.engine.cleanUpInbox(14);

    expect(result.ok).toBe(true);
    expect(h.writer.calls).toEqual([`markAllReadBefore ${CUTOFF_14}`]);
    expect(logRows(h)).toEqual([['mark_all_read_before', 'cleanup', 'github']]);
    expect(h.store.actionLog.listRecent(1)[0]?.detail).toBe(`last_read_at=${CUTOFF_14}`);
    expect(h.reader.notificationCalls).toBe(callsBefore + 1);
    expect((await h.engine.inboxCleanup()).look).toBe('line');
  });

  it('becomes one pending write while locked, shown in the lock, and goes out on send', async () => {
    const h = await withOldThreads({ writesEnabled: false });

    const result = await h.engine.cleanUpInbox(14);

    expect(result).toMatchObject({ ok: true, message: expect.stringMatching(/^Pending/) });
    expect(h.writer.calls).toEqual([]);
    const status = await h.engine.githubWrites();
    expect(status.pending).toEqual([
      expect.objectContaining({ kind: 'mark_all_read_before', origin: 'cleanup', threadCount: 2, title: 'Cleanup: mark everything before 2026-08-19 read' }),
    ]);
    expect((await h.engine.inboxCleanup()).pendingCutoff).toBe(CUTOFF_14);

    await h.engine.setGitHubWrites(true);
    const sent = await h.engine.sendPendingWrites();

    expect(sent).toMatchObject({ ok: true, done: 1, failed: 0 });
    expect(sent.status.pending).toEqual([]);
    expect(h.writer.calls).toEqual([`markAllReadBefore ${CUTOFF_14}`]);
    expect(logRows(h)).toEqual([
      ['mark_all_read_before', 'cleanup', 'pending'],
      ['writes_on', 'footer', 'local'],
      ['mark_all_read_before', 'footer', 'github'],
    ]);
  });

  it('keeps a pending cleanup when the lock closes while pending writes are sent', async () => {
    const h = await withOldThreads({ writesEnabled: false });
    const pr = reviewRequestedPr(1);
    await h.engine.markRead(`pr:${pr.key}`);
    await h.engine.flushPendingWrites();
    await h.engine.cleanUpInbox(14);
    await h.engine.setGitHubWrites(true);
    // The lock closes right after the first pending write reached GitHub.
    const markThreadRead = h.writer.markThreadRead.bind(h.writer);
    h.writer.markThreadRead = async (threadId) => {
      await markThreadRead(threadId);
      await h.engine.setGitHubWrites(false);
    };

    const sent = await h.engine.sendPendingWrites();

    expect(sent).toMatchObject({ ok: false, done: 1, failed: 1 });
    expect(sent.message).toContain("GitHub didn't take it: GitHub writes are off; still pending");
    expect(h.writer.calls).toEqual([`markThreadRead ${makeThreadFor(pr).id}`]);
    expect(sent.status.pending).toEqual([expect.objectContaining({ kind: 'mark_all_read_before', error: 'GitHub writes are off' })]);
    expect((await h.engine.inboxCleanup()).pendingCutoff).toBe(CUTOFF_14);
  });

  it('discards a pending cleanup without writing anything', async () => {
    const h = await withOldThreads({ writesEnabled: false });
    await h.engine.cleanUpInbox(30);
    await h.engine.discardPendingWrites();
    expect(h.writer.calls).toEqual([]);
    expect(logRows(h).at(-1)).toEqual(['mark_all_read_before', 'footer', 'discarded']);
  });

  it('starts fresh: older events are background, nothing goes to GitHub, and it can be cleared', async () => {
    let clock = NOW;
    const h = makeHarness({ now: () => clock });
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 't', [pr]);
    h.reader.threads = [...h.reader.threads, { ...makeThreadFor(makePr({ number: 20 }), { updatedAt: OLD_20 }), subjectType: 'Issue' }];
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await h.engine.getTopic('t'))?.tiles[0]?.state.kind).toBe('unread');

    await h.engine.startFresh();

    expect(h.writer.calls).toEqual([]);
    expect((await h.engine.getTopic('t'))?.tiles[0]?.state.kind).toBe('open');
    expect((await h.engine.listTopics())[0]).toMatchObject({ unreadTiles: 0 });
    expect(await h.engine.inboxCleanup()).toMatchObject({ unreadOlderThan14: 0, look: 'none', baseline: NOW.toISOString() });
    // The store keeps GitHub's state; only reads apply the baseline.
    expect(h.store.events.listForPr(pr.key).every((event) => event.seenAt === null)).toBe(true);

    await h.engine.clearStartFresh();
    expect((await h.engine.getTopic('t'))?.tiles[0]?.state.kind).toBe('unread');
    expect((await h.engine.inboxCleanup()).baseline).toBeNull();
  });

  it('hides the cleanup for 7 days on "Not now"', async () => {
    let clock = NOW;
    const h = makeHarness({ now: () => clock });
    h.reader.threads = [{ ...makeThreadFor(makePr({ number: 20 }), { updatedAt: OLD_20 }), subjectType: 'Issue' }];
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.hideInboxCleanup();
    expect(await h.engine.inboxCleanup()).toMatchObject({ look: 'none', hiddenUntil: '2026-09-09T12:00:00.000Z' });
    clock = new Date('2026-09-10T12:00:00.000Z');
    expect((await h.engine.inboxCleanup()).look).toBe('line');
  });
});
