import { UNDO_WINDOW_MS, type NotificationThread, type Pr } from '@postpile/core';
import { at, makeComment, makeCommit, makePr, makeReview, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';

// Mark-read queue scenarios: a click, the undo window, polls and syncs that
// see new activity, an Undo, a guarded skip with its retry (ClickedReadRetry)
// and a read elsewhere on GitHub, interleaved. DESIGN.md "GitHub writes:
// lock, action log" › Newer activity after a click, and "GitHub unread is
// PostPile unread". The rules under test: the stored thread is never unread
// in the middle of a retry, an Undo only puts back what is still the click's
// own write, and the end state is what the rules say for the order things
// happened in.

const ownPr = makePr({ number: 3, author: viewer.login, updatedAt: at(2), commits: [makeCommit({ oid: 'c1', author: viewer.login, committedAt: at(1) })] });
const tileId = `pr:${ownPr.key}`;
const thread = makeThreadFor(ownPr, { reason: 'author', updatedAt: at(2) });

/** Lets the queued send, its refresh and the second decision run after the fake timer fired. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function synced(): Promise<Harness> {
  const h = makeHarness();
  h.reader.addPr(ownPr, thread);
  await h.engine.sync({ maxAgentCalls: 0 });
  return h;
}

/** GitHub moves on after the click: the PR as `next`, its thread updated then, a new inbox ETag. */
function movesOn(h: Harness, next: Pr): void {
  h.reader.prs.set(next.key, next);
  h.reader.threads = [{ ...thread, updatedAt: next.updatedAt }];
  h.reader.etag = `etag-${next.updatedAt}`;
}

const bobComments: Pr = { ...ownPr, comments: [makeComment({ id: 'c-bob', author: 'bob', createdAt: at(30) })], updatedAt: at(30) };

const ownPushAndBot: Pr = {
  ...ownPr,
  commits: [...ownPr.commits, makeCommit({ oid: 'c2', author: viewer.login, committedAt: at(30) })],
  reviews: [makeReview({ id: 'r-bot', author: 'review-bot[bot]', state: 'COMMENTED', submittedAt: at(31), commitOid: 'c2' })],
  updatedAt: at(31),
};

async function tileState(h: Harness): Promise<string | undefined> {
  const tile = (await h.engine.getTopic(UNSORTED_TOPIC_ID))?.tiles.find((view) => view.tile.id === tileId);
  return tile?.state.kind;
}

function storedThread(h: Harness): NotificationThread | null {
  return h.store.notifications.get(thread.id);
}

function unseenEventIds(h: Harness): string[] {
  return h.store.events
    .listForPr(ownPr.key)
    .filter((event) => event.seenAt === null)
    .map((event) => event.sourceId);
}

/** The stored thread's unread flag at each getThread call (the send's guard, the retry after the refresh, the second guard). */
function watchStoredUnread(h: Harness): (boolean | null)[] {
  const seen: (boolean | null)[] = [];
  const getThread = h.reader.getThread.bind(h.reader);
  h.reader.getThread = async (id: string): Promise<NotificationThread | null> => {
    seen.push(storedThread(h)?.unread ?? null);
    return getThread(id);
  };
  return seen;
}

describe('mark-read queue scenarios', () => {
  it('undo after a poll and a sync saw a comment inside the window puts the click back but keeps the newer activity unread', async () => {
    const h = await synced();
    const { undoToken } = await h.engine.markRead(tileId);
    expect(await tileState(h)).not.toBe('unread');

    movesOn(h, bobComments);
    await h.engine.pollOnce();
    await h.engine.sync({ maxAgentCalls: 0 });
    const undone = await h.engine.undo(undoToken);
    h.timers.advance(UNDO_WINDOW_MS * 2);
    await settle();

    expect(undone.ok).toBe(true);
    expect(h.writer.calls).toEqual([]);
    // GitHub's newer row stands: the click's read time is gone, the thread is unread at the new time.
    expect(storedThread(h)).toMatchObject({ unread: true, updatedAt: at(30) });
    expect(await tileState(h)).toBe('unread');
    expect(unseenEventIds(h)).toContain('c-bob');
  });

  it('undo with nothing newer restores the exact state from before the click', async () => {
    const h = await synced();
    const before = { thread: storedThread(h), unseen: unseenEventIds(h), state: await tileState(h) };
    const { undoToken } = await h.engine.markRead(tileId);

    await h.engine.undo(undoToken);
    h.timers.advance(UNDO_WINDOW_MS * 2);
    await settle();

    expect({ thread: storedThread(h), unseen: unseenEventIds(h), state: await tileState(h) }).toEqual(before);
    expect(h.writer.calls).toEqual([]);
  });

  it('undo does not revert a read that GitHub reported since the click', async () => {
    const h = await synced();
    const { undoToken } = await h.engine.markRead(tileId);
    // Read on github.com inside the window; the poll mirrors it with GitHub's read time.
    h.reader.threads = [{ ...thread, unread: false, lastReadAt: at(40) }];
    h.reader.etag = 'etag-read-elsewhere';
    await h.engine.pollOnce();

    await h.engine.undo(undoToken);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(storedThread(h)).toMatchObject({ unread: false, lastReadAt: at(40) });
    expect(await tileState(h)).not.toBe('unread');
  });

  it('a read elsewhere inside the window ends as observed, with no write and no flicker', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    h.reader.threads = [{ ...thread, unread: false, lastReadAt: at(40) }];
    h.reader.etag = 'etag-read-elsewhere';
    await h.engine.pollOnce();
    const storedUnread = watchStoredUnread(h);

    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(storedUnread.every((unread) => unread === false)).toBe(true);
    expect(h.writer.calls).toEqual([]);
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ outcome: 'observed', detail: 'already read on GitHub' });
    expect(await tileState(h)).not.toBe('unread');
  });

  it('a skip the retry clears (own push and a bot) never shows the thread unread while it decides, even when a poll reports the news then', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    movesOn(h, ownPushAndBot);
    const storedUnread = watchStoredUnread(h);
    const midRetry: (boolean | null)[] = [];
    const polls: Promise<unknown>[] = [];
    const fetchPrs = h.reader.fetchPrs.bind(h.reader);
    h.reader.fetchPrs = async (refs) => {
      // The poll sees the same news while the retry refreshes: the held thread is left alone.
      polls.push(h.engine.pollOnce());
      await settle();
      midRetry.push(storedThread(h)?.unread ?? null);
      return fetchPrs(refs);
    };

    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    await Promise.all(polls);
    await settle();
    await settle();

    expect(midRetry).toEqual([false]);
    expect(storedUnread.every((unread) => unread === false)).toBe(true);
    expect(h.writer.calls).toEqual([`markThreadRead ${thread.id}`]);
    expect(storedThread(h)).toMatchObject({ unread: false, updatedAt: at(31) });
    expect(await tileState(h)).not.toBe('unread');
  });

  it('a skip the retry keeps (a person commented) stays unread, and a second click after seeing it is sent once', async () => {
    const h = await synced();
    const first = await h.engine.markRead(tileId);
    movesOn(h, bobComments);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect(storedThread(h)).toMatchObject({ unread: true, updatedAt: at(30) });
    expect(await tileState(h)).toBe('unread');
    expect(h.writer.calls).toEqual([]);

    // The first click's window is over: its undo is too late, and must not touch the kept-unread row.
    expect((await h.engine.undo(first.undoToken)).ok).toBe(false);
    expect(storedThread(h)).toMatchObject({ unread: true });

    await h.engine.markRead(tileId);
    expect(await tileState(h)).not.toBe('unread');
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(h.writer.calls).toEqual([`markThreadRead ${thread.id}`]);
    expect(storedThread(h)).toMatchObject({ unread: false, lastReadAt: at(30) });
    expect(unseenEventIds(h)).toEqual([]);
    expect(await tileState(h)).not.toBe('unread');
  });

  it('click, undo, click again sends once, and the old token cannot undo the new click', async () => {
    const h = await synced();
    const first = await h.engine.markRead(tileId);
    await h.engine.undo(first.undoToken);
    const second = await h.engine.markRead(tileId);

    expect((await h.engine.undo(first.undoToken)).ok).toBe(false);
    expect(await tileState(h)).not.toBe('unread');
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(second.undoToken).not.toBe(first.undoToken);
    expect(h.writer.calls).toEqual([`markThreadRead ${thread.id}`]);
    expect(storedThread(h)).toMatchObject({ unread: false });
  });
});
