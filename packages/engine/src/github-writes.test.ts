import { UNDO_WINDOW_MS } from '@postpile/core';
import { makeThreadFor } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness, type Harness, type HarnessOptions } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { FORCED_READ_ONLY_REASON } from './writes/write-switch.ts';

const pr = reviewRequestedPr(1);
const tileId = `pr:${pr.key}`;

async function synced(options: HarnessOptions = {}): Promise<Harness> {
  const h = makeHarness(options);
  h.reader.addPr(pr, makeThreadFor(pr));
  await h.engine.sync({ maxAgentCalls: 0 });
  return h;
}

/** Lets the queued send (and its awaits) run after the fake timer fired. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function afterUndoWindow(h: Harness): Promise<void> {
  h.timers.advance(UNDO_WINDOW_MS);
  await settle();
}

/** The log oldest first, as [action, origin, outcome]. */
function logRows(h: Harness): string[][] {
  return h.store.actionLog
    .listRecent(100)
    .toReversed()
    .map((entry) => [entry.action, entry.origin, entry.outcome]);
}

async function tile(h: Harness) {
  return (await h.engine.getTopic(UNSORTED_TOPIC_ID))?.tiles.find((view) => view.tile.id === tileId);
}

describe('GitHub writes switch', () => {
  it('starts read-only on a fresh store', async () => {
    const h = makeHarness({ writesEnabled: false });
    expect(await h.engine.githubWrites()).toEqual({ enabled: false, forcedOffReason: null, pending: [] });
  });

  it('uses the real writer after turning on and the read-only one after turning off, without a restart', async () => {
    const h = await synced({ writesEnabled: false });

    expect((await h.engine.approve(pr.key, pr.headOid)).ok).toBe(false);
    expect(h.writer.calls).toEqual([]);

    const on = await h.engine.setGitHubWrites(true);
    expect(on.status.enabled).toBe(true);
    expect((await h.engine.approve(pr.key, pr.headOid)).ok).toBe(true);
    expect(h.writer.calls).toEqual([`approvePr ${pr.key}@${pr.headOid}`]);

    await h.engine.setGitHubWrites(false);
    expect((await h.engine.sendComment(pr.key, 'hi')).ok).toBe(false);
    expect(h.writer.calls).toHaveLength(1);
  });

  it('keeps the choice in the store, so it survives a restart', async () => {
    const store = Store.open(':memory:');
    const first = makeHarness({ store, writesEnabled: false });
    await first.engine.setGitHubWrites(true);

    const second = makeHarness({ store, writesEnabled: false });
    expect((await second.engine.githubWrites()).enabled).toBe(true);
  });

  it('refuses to turn on while POSTPILE_READ_ONLY=1 forces read-only', async () => {
    const h = makeHarness({ forcedReadOnly: true });

    const change = await h.engine.setGitHubWrites(true);

    expect(change).toMatchObject({ ok: false, status: { enabled: false, forcedOffReason: FORCED_READ_ONLY_REASON } });
    expect(h.store.actionLog.listRecent(10)).toEqual([]);
  });

  it('logs every flip of the lock', async () => {
    const h = makeHarness({ writesEnabled: false });
    await h.engine.setGitHubWrites(true);
    await h.engine.setGitHubWrites(false);
    expect(logRows(h)).toEqual([
      ['writes_on', 'footer', 'local'],
      ['writes_off', 'footer', 'local'],
    ]);
  });
});

describe('action log at every write path', () => {
  it('tile mark-read: queued at the click, sent by the queue after the window', async () => {
    const h = await synced();

    await h.engine.markRead(tileId);
    await afterUndoWindow(h);

    expect(logRows(h)).toEqual([
      ['mark_read', 'tile', 'queued'],
      ['mark_read', 'queue', 'github'],
    ]);
    const [queued, sent] = h.store.actionLog.listRecent(2).toReversed();
    expect(sent).toMatchObject({ threadId: 'thread-1', prKey: pr.key, tileId, batch: queued?.batch });
  });

  it('undo inside the window is logged', async () => {
    const h = await synced();
    const result = await h.engine.markRead(tileId);
    await h.engine.undo(result.undoToken);
    expect(logRows(h)).toEqual([
      ['mark_read', 'tile', 'queued'],
      ['undo_mark_read', 'tile', 'local'],
    ]);
  });

  it('quit flush is logged with origin quit', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    await h.engine.flushPendingWrites();
    expect(logRows(h).at(-1)).toEqual(['mark_read', 'quit', 'github']);
  });

  it('a failed send is logged with the error', async () => {
    const h = await synced();
    h.writer.failingThreads.add('thread-1');
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ outcome: 'failed', detail: "GitHub didn't take it: boom thread-1; still unread" });
  });

  it('a thread read elsewhere before the send is logged as observed, not sent', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    h.reader.threads = [];
    await afterUndoWindow(h);
    expect(h.writer.calls).toEqual([]);
    expect(logRows(h).at(-1)).toEqual(['mark_read', 'queue', 'observed']);
  });

  it('"not mine" queues a mark-read from the tile', async () => {
    const h = await synced();
    await h.engine.giveFeedback({ kind: 'not_mine', tileId, prKey: null, targetTopicId: null, note: '' });
    expect(logRows(h)).toEqual([['mark_read', 'tile', 'queued']]);
  });

  it('approve and comment log the GitHub call, then approve queues its mark-read', async () => {
    const h = await synced();
    await h.engine.approve(pr.key, pr.headOid);
    await h.engine.sendComment(pr.key, 'looks good');
    expect(logRows(h)).toEqual([
      ['approve', 'tile', 'github'],
      ['mark_read', 'tile', 'queued'],
      ['comment', 'tile', 'github'],
    ]);
  });

  it('approve and comment while read-only are logged as skipped', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.approve(pr.key, pr.headOid);
    await h.engine.sendComment(pr.key, 'looks good');
    expect(logRows(h)).toEqual([
      ['approve', 'tile', 'skipped'],
      ['comment', 'tile', 'skipped'],
    ]);
    expect(h.store.userPrStates.get(pr.key)?.approvedAt ?? null).toBeNull();
  });

  it('debug view mark-read goes through the same queue with origin debug', async () => {
    const h = await synced();
    await h.engine.markThreadRead('thread-1');
    await afterUndoWindow(h);
    expect(logRows(h)).toEqual([
      ['mark_read', 'debug', 'queued'],
      ['mark_read', 'queue', 'github'],
    ]);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
  });

  it('sync logs a thread that left the inbox as read elsewhere', async () => {
    const h = await synced();
    h.reader.threads = [];
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(logRows(h)).toEqual([['mark_read', 'sync', 'observed']]);
  });

  it('the live poll logs a thread that left the inbox with origin poll', async () => {
    const h = await synced();
    h.reader.threads = [];
    h.reader.etag = 'etag-2';
    await h.engine.pollOnce();
    expect(logRows(h)).toEqual([['mark_read', 'poll', 'observed']]);
  });
});

describe('pending writes while locked', () => {
  it('a locked mark-read changes nothing, then becomes a pending write and the tile stays unread', async () => {
    const h = await synced({ writesEnabled: false });

    const result = await h.engine.markRead(tileId);
    expect(result.message).toMatch(/pending until you unlock/);
    expect((await h.engine.githubWrites()).pending).toEqual([]);
    await afterUndoWindow(h);

    const view = await tile(h);
    expect(view?.state.kind).toBe('unread');
    expect(view?.pendingWrite).toMatchObject({ error: null });
    expect(h.writer.calls).toEqual([]);
    expect(h.store.notifications.get('thread-1')?.unread).toBe(true);
    const status = await h.engine.githubWrites();
    expect(status.pending).toEqual([expect.objectContaining({ title: pr.title, prKeys: [pr.key], threadCount: 1, tileId, origin: 'tile' })]);
    expect(logRows(h)).toEqual([
      ['mark_read', 'tile', 'queued'],
      ['mark_read', 'tile', 'pending'],
    ]);
  });

  it('undo inside the window leaves nothing pending', async () => {
    const h = await synced({ writesEnabled: false });
    const result = await h.engine.markRead(tileId);
    await h.engine.undo(result.undoToken);
    await afterUndoWindow(h);
    expect((await h.engine.githubWrites()).pending).toEqual([]);
    expect((await tile(h))?.pendingWrite).toBeNull();
  });

  it('a second send while one runs joins it instead of sending twice', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    await h.engine.setGitHubWrites(true);

    const [first, second] = await Promise.all([h.engine.sendPendingWrites(), h.engine.sendPendingWrites()]);

    expect(first).toBe(second);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
  });

  it('unlock and send: reaches GitHub, is logged, and only then the tile turns done', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);

    await h.engine.setGitHubWrites(true);
    const sent = await h.engine.sendPendingWrites();

    expect(sent).toMatchObject({ ok: true, done: 1, failed: 0 });
    expect(sent.status.pending).toEqual([]);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
    expect(h.store.notifications.get('thread-1')?.unread).toBe(false);
    const view = await tile(h);
    expect(view?.state.kind).toBe('done');
    expect(view?.pendingWrite).toBeNull();
    expect(logRows(h).slice(-2)).toEqual([
      ['writes_on', 'footer', 'local'],
      ['mark_read', 'footer', 'github'],
    ]);
  });

  it('discard drops them: nothing is sent and the tile stays unread, like on GitHub', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);

    const discarded = await h.engine.discardPendingWrites();

    expect(discarded).toMatchObject({ ok: true, done: 1 });
    expect(discarded.status.pending).toEqual([]);
    expect(h.writer.calls).toEqual([]);
    const view = await tile(h);
    expect(view?.state.kind).toBe('unread');
    expect(view?.pendingWrite).toBeNull();
    expect(logRows(h).at(-1)).toEqual(['mark_read', 'footer', 'discarded']);
  });

  it('survives a restart', async () => {
    const store = Store.open(':memory:');
    const first = await synced({ store, writesEnabled: false });
    await first.engine.markRead(tileId);
    await afterUndoWindow(first);

    const second = makeHarness({ store, writesEnabled: false });
    expect((await second.engine.githubWrites()).pending).toHaveLength(1);
  });

  it('a quit flush while locked stores the mark-read as pending', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await h.engine.flushPendingWrites();
    expect((await h.engine.githubWrites()).pending).toHaveLength(1);
    expect(h.writer.calls).toEqual([]);
  });

  it('locking inside the undo window of an unlocked mark-read puts the tile back and parks it', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    expect((await tile(h))?.state.kind).toBe('done');

    await h.engine.setGitHubWrites(false);
    await afterUndoWindow(h);

    expect(h.writer.calls).toEqual([]);
    const view = await tile(h);
    expect(view?.state.kind).toBe('unread');
    expect(view?.pendingWrite).not.toBeNull();
  });

  it('a failed send stays pending with the error', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    await h.engine.setGitHubWrites(true);
    h.writer.failingThreads.add('thread-1');

    const sent = await h.engine.sendPendingWrites();

    expect(sent).toMatchObject({ ok: false, done: 0, failed: 1 });
    expect(sent.status.pending).toEqual([expect.objectContaining({ error: 'boom thread-1', threadCount: 1 })]);
    const view = await tile(h);
    expect(view?.state.kind).toBe('unread');
    expect(view?.pendingWrite).toMatchObject({ error: 'boom thread-1' });
    expect(logRows(h).at(-1)).toEqual(['mark_read', 'footer', 'failed']);
  });

  it('is refused while locked and keeps the pending writes', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    const sent = await h.engine.sendPendingWrites();
    expect(sent.ok).toBe(false);
    expect(sent.status.pending).toHaveLength(1);
  });

  it('POSTPILE_READ_ONLY=1 keeps them pending and refuses the send', async () => {
    const h = await synced({ forcedReadOnly: true });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);

    expect((await h.engine.setGitHubWrites(true)).ok).toBe(false);
    const sent = await h.engine.sendPendingWrites();

    expect(sent).toMatchObject({ ok: false, done: 0, failed: 1 });
    expect(sent.message).toContain(FORCED_READ_ONLY_REASON);
    expect(sent.status.pending).toHaveLength(1);
    expect(h.writer.calls).toEqual([]);
    expect((await tile(h))?.state.kind).toBe('unread');
  });

  it('the debug view mark-read goes pending too, with origin debug', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markThreadRead('thread-1');
    await afterUndoWindow(h);
    expect((await h.engine.githubWrites()).pending).toEqual([expect.objectContaining({ origin: 'debug' })]);
    const [row] = await h.engine.debugNotifications(10);
    expect(row?.lastAction).toMatchObject({ outcome: 'pending' });
  });

  it('approve and comment stay blocked, with no pending queue', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.approve(pr.key, pr.headOid);
    await h.engine.sendComment(pr.key, 'hi');
    await afterUndoWindow(h);
    expect((await h.engine.githubWrites()).pending).toEqual([]);
  });
});

describe('a mark-read GitHub did not take goes back to unread', () => {
  it('a failed queue send puts the tile back to unread and the sync report says why', async () => {
    const h = await synced();
    h.writer.failingThreads.add('thread-1');
    await h.engine.markRead(tileId);
    expect((await tile(h))?.state.kind).toBe('done');

    await afterUndoWindow(h);

    expect((await tile(h))?.state.kind).toBe('unread');
    expect(h.store.userPrStates.get(pr.key)?.handledAt ?? null).toBeNull();
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toContain(`mark-read of ${pr.key}: GitHub didn't take it: boom thread-1; still unread`);
  });

  it('a queue send skipped for newer activity the refresh cannot cover puts the tile back to unread', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    const [thread] = h.reader.threads;
    h.reader.threads = [{ ...thread!, updatedAt: '2026-09-03T00:00:00Z' }];

    await afterUndoWindow(h);

    expect(h.writer.calls).toEqual([]);
    expect((await tile(h))?.state.kind).toBe('unread');
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({
      origin: 'queue',
      outcome: 'skipped',
      detail: 'kept unread: activity after the last sync',
    });
  });

  it('a failed quit flush puts the tile back to unread', async () => {
    const h = await synced();
    h.writer.failingThreads.add('thread-1');
    await h.engine.markRead(tileId);
    await h.engine.flushPendingWrites();
    expect((await tile(h))?.state.kind).toBe('unread');
    expect(logRows(h).at(-1)).toEqual(['mark_read', 'quit', 'failed']);
  });

  it('a pending send skipped for newer activity drops out, stays unread and says why', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    await h.engine.setGitHubWrites(true);
    const [thread] = h.reader.threads;
    h.reader.threads = [{ ...thread!, updatedAt: '2026-09-03T00:00:00Z' }];

    const sent = await h.engine.sendPendingWrites();

    expect(sent.message).toContain(`${pr.title}: GitHub didn't take it: activity after the last sync; still unread`);
    expect(sent.status.pending).toEqual([]);
    expect((await tile(h))?.state.kind).toBe('unread');
  });

  it('a failed pending send says why in the result', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    await h.engine.setGitHubWrites(true);
    h.writer.failingThreads.add('thread-1');
    const sent = await h.engine.sendPendingWrites();
    expect(sent.message).toContain("GitHub didn't take it: boom thread-1; still pending");
  });
});

describe('a pending write for a thread read elsewhere', () => {
  async function pendingThenReadElsewhere(): Promise<Harness> {
    const h = await synced({ writesEnabled: false });
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    expect((await h.engine.githubWrites()).pending).toHaveLength(1);
    h.reader.threads = [];
    h.reader.etag = 'etag-2';
    return h;
  }

  it('is cleared by the sync, and the tile follows GitHub', async () => {
    const h = await pendingThenReadElsewhere();

    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.githubWrites()).pending).toEqual([]);
    expect(h.writer.calls).toEqual([]);
    const view = await tile(h);
    expect(view?.pendingWrite).toBeNull();
    expect(view?.state.kind).toBe('done');
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({
      action: 'mark_read',
      origin: 'sync',
      outcome: 'observed',
      threadId: 'thread-1',
      detail: expect.stringContaining('pending mark-read cleared'),
    });
  });

  it('is cleared by the live poll with origin poll', async () => {
    const h = await pendingThenReadElsewhere();
    await h.engine.pollOnce();
    expect((await h.engine.githubWrites()).pending).toEqual([]);
    expect(logRows(h).at(-1)).toEqual(['mark_read', 'poll', 'observed']);
  });
});

describe('debug view rows', () => {
  it('show the queue send as the last action and the click that queued it', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    const [row] = await h.engine.debugNotifications(10);
    expect(row?.lastAction).toMatchObject({ origin: 'queue', outcome: 'github' });
    expect(row?.decidedBy).toMatchObject({ origin: 'tile', outcome: 'queued' });
  });
});
