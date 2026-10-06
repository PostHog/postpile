import { UNDO_WINDOW_MS, type NotificationThread, type FullPr } from '@postpile/core';
import { at, makeComment, makeCommit, makePr, makeReview, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';

// DESIGN.md "GitHub writes: lock, action log" › Newer activity after a click.

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
function movesOn(h: Harness, next: FullPr): void {
  h.reader.prs.set(next.key, next);
  h.reader.threads = [{ ...thread, updatedAt: next.updatedAt }];
  h.reader.etag = 'etag-2';
}

/** The stored thread's unread flag at every getThread call: the send's guard, the retry after the refresh, the second guard. */
function watchStoredUnread(h: Harness): (boolean | null)[] {
  const seen: (boolean | null)[] = [];
  const getThread = h.reader.getThread.bind(h.reader);
  h.reader.getThread = async (id: string): Promise<NotificationThread | null> => {
    seen.push(h.store.notifications.get(id)?.unread ?? null);
    return getThread(id);
  };
  return seen;
}

async function tileState(h: Harness): Promise<string | undefined> {
  const tile = (await h.engine.getTopic(UNSORTED_TOPIC_ID))?.tiles.find((view) => view.tile.id === tileId);
  return tile?.state.kind;
}

describe('a clicked mark-read skipped for newer activity', () => {
  it('refreshes the PR and marks it read when only own pushes and a bot review came since, without the tile turning unread in between', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    expect(await tileState(h)).not.toBe('unread');
    movesOn(h, {
      ...ownPr,
      commits: [...ownPr.commits, makeCommit({ oid: 'c2', author: viewer.login, committedAt: at(30) })],
      reviews: [makeReview({ id: 'r-bot', author: 'review-bot[bot]', state: 'COMMENTED', submittedAt: at(31), commitOid: 'c2' })],
      updatedAt: at(31),
    });
    const storedUnread = watchStoredUnread(h);

    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(h.reader.fetchedRefs.at(-1)).toEqual([ownPr.ref]);
    expect(storedUnread).toEqual([false, false, false]);
    expect(h.writer.calls).toEqual([`markThreadRead ${thread.id}`]);
    expect(h.store.notifications.get(thread.id)).toMatchObject({ unread: false, updatedAt: at(31), lastReadAt: at(31) });
    expect(await tileState(h)).not.toBe('unread');
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({
      origin: 'queue',
      outcome: 'github',
      detail: 'marked after refresh: only your own activity and automation (review-bot[bot])',
    });
    expect((await h.engine.livePollStatus()).keptUnread).toBeNull();
  });

  it('keeps it unread with a notice when a person commented since', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    movesOn(h, { ...ownPr, comments: [makeComment({ id: 'c-bob', author: 'bob', createdAt: at(30) })], updatedAt: at(30) });
    const storedUnread = watchStoredUnread(h);

    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    // Held read through the refresh, then unread together with the notice.
    expect(storedUnread).toEqual([false, false]);
    expect(h.writer.calls).toEqual([]);
    expect(h.store.notifications.get(thread.id)).toMatchObject({ unread: true, updatedAt: at(30) });
    expect(await tileState(h)).toBe('unread');
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ origin: 'queue', outcome: 'skipped', detail: 'kept unread: new comment from bob' });
    expect((await h.engine.livePollStatus()).keptUnread).toEqual({ id: 1, message: 'New since you looked: a comment from bob', prKey: ownPr.key });
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toContain(`mark-read of ${ownPr.key}: GitHub didn't take it: new comment from bob; still unread`);
  });

  it('mirrors a read elsewhere during the refresh onto the events the refresh stored', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    movesOn(h, { ...ownPr, comments: [makeComment({ id: 'c-bob', author: 'bob', createdAt: at(30) })], updatedAt: at(30) });
    const fetchPrs = h.reader.fetchPrs.bind(h.reader);
    h.reader.fetchPrs = async (refs) => {
      h.reader.threads = [{ ...thread, unread: false, updatedAt: at(30), lastReadAt: at(31) }];
      return fetchPrs(refs);
    };

    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(h.writer.calls).toEqual([]);
    const comment = h.store.events.listForPr(ownPr.key).find((event) => event.sourceId === 'c-bob');
    expect(comment?.seenAt).toBe(at(31));
    expect(h.store.notifications.get(thread.id)).toMatchObject({ unread: false, lastReadAt: at(31) });
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ outcome: 'observed', detail: 'already read on GitHub' });
  });

  it('still fetches the PR after joining a running full sync, which may have left it alone', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    // Only the thread moved: the PR's updated_at stays, so the sync has no reason to fetch it.
    movesOn(h, { ...ownPr, commits: [...ownPr.commits, makeCommit({ oid: 'c2', author: viewer.login, committedAt: at(30) })] });
    h.reader.threads = [{ ...thread, updatedAt: at(30) }];
    h.reader.fetchedRefs = [];

    const syncing = h.engine.sync({ maxAgentCalls: 0 });
    h.timers.advance(UNDO_WINDOW_MS);
    await syncing;
    await settle();

    expect(h.reader.fetchedRefs.at(-1)).toEqual([ownPr.ref]);
    expect(h.store.events.listForPr(ownPr.key).some((event) => event.sourceId === 'c2')).toBe(true);
    expect(h.writer.calls).toEqual([`markThreadRead ${thread.id}`]);
  });
});
