import { UNDO_WINDOW_MS } from '@postpile/core';
import { makeThreadFor } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { FORCED_READ_ONLY_REASON, GITHUB_WRITES_META_KEY } from './writes/write-switch.ts';

const one = reviewRequestedPr(1);
const two = reviewRequestedPr(2);
const LATER = '2026-09-03T00:00:00Z';

/** Lets the queued send (and its awaits) run after the fake timer fired. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The log oldest first, as [action, origin, outcome]. */
function logRows(h: Harness): string[][] {
  return h.store.actionLog
    .listRecent(100)
    .toReversed()
    .map((entry) => [entry.action, entry.origin, entry.outcome]);
}

async function tileState(h: Harness, key: string): Promise<string | undefined> {
  return (await h.engine.getTopic(UNSORTED_TOPIC_ID))?.tiles.find((view) => view.tile.id === `pr:${key}`)?.state.kind;
}

function defaultEvents(h: Harness): unknown[] {
  return h.telemetry.events.filter((event) => event.event === 'github_writes_changed').map((event) => event.props);
}

/**
 * An install from before the default: it never touched the lock, so writes
 * were locked, and both PRs were marked read then. Both clicks wait as
 * pending writes.
 */
async function lockedInstallWithBacklog(): Promise<Store> {
  const store = Store.open(':memory:');
  const before = makeHarness({ store, writesEnabled: false });
  before.reader.addPr(one, makeThreadFor(one));
  before.reader.addPr(two, makeThreadFor(two));
  await before.engine.sync({ maxAgentCalls: 0 });
  await before.engine.markRead(`pr:${one.key}`);
  await before.engine.markRead(`pr:${two.key}`);
  before.timers.advance(UNDO_WINDOW_MS);
  await settle();
  expect((await before.engine.githubWrites()).pending).toHaveLength(2);
  expect(store.meta.get(GITHUB_WRITES_META_KEY)).toBeNull();
  return store;
}

/** The same store after the update: the packaged app's default, with GitHub as it is now. */
function afterUpdate(store: Store, threads: { two: string } = { two: two.updatedAt }): Harness {
  const h = makeHarness({ store, writesEnabled: false, writesOnByDefault: true });
  h.reader.addPr(one, makeThreadFor(one));
  h.reader.addPr({ ...two, updatedAt: threads.two }, makeThreadFor(two, { updatedAt: threads.two }));
  return h;
}

describe('GitHub writes on by default', () => {
  it('is on when the user never chose, and the first sync keeps it as the choice and says so once', async () => {
    const h = makeHarness({ writesEnabled: false, writesOnByDefault: true });
    h.reader.addPr(one, makeThreadFor(one));

    expect(await h.engine.githubWrites()).toEqual({ enabled: true, forcedOffReason: null, pending: [] });
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.meta.get(GITHUB_WRITES_META_KEY)).toBe('on');
    expect(defaultEvents(h)).toEqual([{ enabled: true, from: 'default' }]);
    expect(logRows(h)).toEqual([['writes_on', 'default', 'local']]);
    expect(h.telemetry.events.find((event) => event.event === 'sync_completed')?.props).toMatchObject({ writes_on: true });
  });

  it('keeps an explicit off: an install that locked writes on purpose stays locked', async () => {
    const store = Store.open(':memory:');
    store.meta.set(GITHUB_WRITES_META_KEY, 'off');
    const h = makeHarness({ store, writesEnabled: false, writesOnByDefault: true });
    h.reader.addPr(one, makeThreadFor(one));

    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.githubWrites()).enabled).toBe(false);
    expect(store.meta.get(GITHUB_WRITES_META_KEY)).toBe('off');
    expect(defaultEvents(h)).toEqual([]);
    expect((await h.engine.approve(one.key, one.headOid)).ok).toBe(false);
    expect(h.writer.calls).toEqual([]);
  });

  it('lets POSTPILE_READ_ONLY=1 win: no writer, nothing kept, nothing sent', async () => {
    const store = await lockedInstallWithBacklog();
    const h = makeHarness({ store, writesEnabled: false, writesOnByDefault: true, forcedReadOnly: true });
    h.reader.addPr(one, makeThreadFor(one));
    h.reader.addPr(two, makeThreadFor(two));

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(await h.engine.githubWrites()).toMatchObject({ enabled: false, forcedOffReason: FORCED_READ_ONLY_REASON });
    expect((await h.engine.githubWrites()).pending).toHaveLength(2);
    expect(store.meta.get(GITHUB_WRITES_META_KEY)).toBeNull();
    expect(defaultEvents(h)).toEqual([]);
    expect(h.writer.calls).toEqual([]);
  });

  it('stays locked without the default, as in a dev run', async () => {
    const h = makeHarness({ writesEnabled: false });
    h.reader.addPr(one, makeThreadFor(one));
    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.githubWrites()).enabled).toBe(false);
    expect(h.store.meta.get(GITHUB_WRITES_META_KEY)).toBeNull();
    expect(defaultEvents(h)).toEqual([]);
  });
});

describe('the pending backlog when writes go on by default', () => {
  it('sends only what is unchanged since the click; a thread with newer activity is left unread, not decided again', async () => {
    const h = afterUpdate(await lockedInstallWithBacklog(), { two: LATER });

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
    expect((await h.engine.githubWrites()).pending).toEqual([]);
    expect(await tileState(h, one.key)).toBe('done');
    expect(await tileState(h, two.key)).toBe('unread');
    expect(logRows(h).slice(-3)).toEqual([
      ['writes_on', 'default', 'local'],
      ['mark_read', 'default', 'github'],
      ['mark_read', 'default', 'skipped'],
    ]);
    // Not the click's second decision ("kept unread: ..."): nobody clicked now.
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ threadId: 'thread-2', detail: "GitHub didn't take it: activity after the last sync; still unread" });
    expect(defaultEvents(h)).toEqual([{ enabled: true, from: 'default' }]);
  });

  it('keeps a send that failed pending with its error, for the footer', async () => {
    const h = afterUpdate(await lockedInstallWithBacklog());
    h.writer.failingThreads.add('thread-2');

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
    expect((await h.engine.githubWrites()).pending).toEqual([expect.objectContaining({ prKeys: [two.key], error: 'boom thread-2' })]);
    expect(await tileState(h, two.key)).toBe('unread');
  });

  it('leaves a waiting cleanup pending for the user to send or discard', async () => {
    const store = await lockedInstallWithBacklog();
    store.pendingWrites.add({
      kind: 'catch_up',
      readBefore: null,
      createdAt: '2026-09-02T11:00:00.000Z',
      origin: 'cleanup',
      tileId: null,
      batch: 'cleanup:1',
      prKeys: [],
      handleKeys: [],
      threads: [],
      catchUp: { merged: 'all', older: null, countedAt: '2026-09-02T11:00:00.000Z' },
    });
    const h = afterUpdate(store);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual(['markThreadRead thread-1', 'markThreadRead thread-2']);
    expect((await h.engine.githubWrites()).pending).toEqual([expect.objectContaining({ kind: 'catch_up', error: null })]);
  });

  it('a Discard while the send runs stops it before the next write: the discarded ones never reach GitHub', async () => {
    const h = afterUpdate(await lockedInstallWithBacklog());
    // The guard's read of the first thread waits until the test lets it go, so Discard lands mid-send.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => {};
    const atFirstThread = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const getThread = h.reader.getThread.bind(h.reader);
    h.reader.getThread = async (threadId) => {
      if (threadId === 'thread-1') {
        reached();
        await held;
      }
      return getThread(threadId);
    };

    const sync = h.engine.sync({ maxAgentCalls: 0 });
    await atFirstThread;
    const discard = h.engine.discardPendingWrites();
    release();
    const [discarded] = await Promise.all([discard, sync]);

    // The write it was on went through; the other one was dropped, never sent.
    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
    expect(discarded).toMatchObject({ ok: true, done: 1 });
    expect(discarded.status.pending).toEqual([]);
    expect(await tileState(h, two.key)).toBe('unread');
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ threadId: 'thread-2', origin: 'footer', outcome: 'discarded' });
  });

  it('waits while gh does not work: nothing kept, nothing sent', async () => {
    const h = afterUpdate(await lockedInstallWithBacklog());
    h.commands.missing.add('gh');

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual([]);
    expect(h.store.meta.get(GITHUB_WRITES_META_KEY)).toBeNull();
    expect((await h.engine.githubWrites()).pending).toHaveLength(2);
    expect(defaultEvents(h)).toEqual([]);
  });
});
