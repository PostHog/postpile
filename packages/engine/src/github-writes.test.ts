import { UNDO_WINDOW_MS } from '@code-manager/core';
import { makeThreadFor } from '@code-manager/core/fixtures';
import { Store } from '@code-manager/store';
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
    expect(await h.engine.githubWrites()).toEqual({ enabled: false, forcedOffReason: null });
  });

  it('uses the real writer after turning on and the read-only one after turning off, without a restart', async () => {
    const h = await synced({ writesEnabled: false });

    expect((await h.engine.approve(pr.key)).ok).toBe(false);
    expect(h.writer.calls).toEqual([]);

    const on = await h.engine.setGitHubWrites(true);
    expect(on.status.enabled).toBe(true);
    expect((await h.engine.approve(pr.key)).ok).toBe(true);
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

  it('refuses to turn on while CODE_MANAGER_READ_ONLY=1 forces read-only', async () => {
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

  it('read-only mark-read: changes the app, sends nothing, logs local, even if writes come on inside the window', async () => {
    const h = await synced({ writesEnabled: false });

    const result = await h.engine.markRead(tileId);
    await h.engine.setGitHubWrites(true);
    await afterUndoWindow(h);

    expect(result.message).toMatch(/here only/);
    expect((await tile(h))?.state.kind).toBe('done');
    expect(h.writer.calls).toEqual([]);
    expect(h.store.notifications.get('thread-1')?.unread).toBe(true);
    expect(logRows(h)).toEqual([
      ['mark_read', 'tile', 'local'],
      ['writes_on', 'footer', 'local'],
    ]);
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
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ outcome: 'failed', detail: 'boom thread-1' });
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
    await h.engine.approve(pr.key);
    await h.engine.sendComment(pr.key, 'looks good');
    expect(logRows(h)).toEqual([
      ['approve', 'tile', 'github'],
      ['mark_read', 'tile', 'queued'],
      ['comment', 'tile', 'github'],
    ]);
  });

  it('approve and comment while read-only are logged as skipped', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.approve(pr.key);
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

describe('bring back', () => {
  it('makes a done tile unread again with "brought back by you", local only', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    expect((await tile(h))?.state.kind).toBe('done');

    const result = await h.engine.bringBack(pr.key);

    expect(result.ok).toBe(true);
    const view = await tile(h);
    expect(view?.state.kind).toBe('unread');
    expect(view?.state.unreadBecause).toEqual([expect.objectContaining({ kind: 'brought_back', summary: 'brought back by you' })]);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
    expect(logRows(h).at(-1)).toEqual(['bring_back', 'debug', 'local']);
  });

  it('ends with the next mark-read, and that mark-read undoes back to brought back', async () => {
    const h = await synced();
    await h.engine.bringBack(pr.key);

    const result = await h.engine.markRead(tileId);
    expect((await tile(h))?.state.kind).toBe('done');

    await h.engine.undo(result.undoToken);
    expect((await tile(h))?.state.unreadBecause.map((reason) => reason.kind)).toContain('brought_back');
  });

  it('ends a snooze on the tile', async () => {
    const h = await synced();
    await h.engine.snooze(tileId, { kind: 'new_push' });
    await h.engine.bringBack(pr.key);
    expect((await tile(h))?.state.kind).toBe('unread');
  });

  it('refuses a PR the store does not have', async () => {
    const h = await synced();
    expect((await h.engine.bringBack('acme/app#99')).ok).toBe(false);
  });

  it('shows up as the last action on the debug row', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);
    let [row] = await h.engine.debugNotifications(10);
    expect(row?.lastAction).toMatchObject({ origin: 'queue', outcome: 'github' });
    expect(row?.decidedBy).toMatchObject({ origin: 'tile', outcome: 'queued' });

    await h.engine.bringBack(pr.key);
    [row] = await h.engine.debugNotifications(10);
    expect(row?.lastAction).toMatchObject({ action: 'bring_back' });
    expect(row?.decidedBy).toBeNull();
  });
});
