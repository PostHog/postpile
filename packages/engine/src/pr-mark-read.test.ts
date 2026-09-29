import { UNDO_WINDOW_MS, type Pr, type TileView } from '@postpile/core';
import { at, makeComment, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';

const TOPIC = 'cache';
const SET_TILE = 'set:s1';

/** A PR the viewer follows: alice commented, nothing asks the viewer anything. */
function followedPr(number: number): Pr {
  return makePr({
    number,
    author: 'alice',
    comments: [makeComment({ id: `c${number}`, author: 'alice', body: 'moved the cache keys', createdAt: at(5) })],
    updatedAt: at(6),
  });
}

const first = followedPr(11);
const second = followedPr(12);

/** Both PRs synced, grouped by the agent into set s1 of topic "cache"; `first` read on GitHub, `second` unread. */
async function syncedSet(): Promise<Harness> {
  const h = makeHarness();
  h.reader.addPr(first, makeThreadFor(first, { reason: 'subscribed', unread: false, lastReadAt: at(7), updatedAt: at(6) }));
  h.reader.addPr(second, makeThreadFor(second, { reason: 'subscribed' }));
  await h.engine.sync({ maxAgentCalls: 0 });
  h.store.topics.create({
    id: TOPIC,
    name: TOPIC,
    summary: '',
    summaryInputHash: null,
    area: null,
    tailoring: '',
    driver: null,
    userRole: 'reviewer',
    status: 'active',
    retiredAt: null,
    createdAt: at(0),
    updatedAt: at(0),
  });
  for (const key of [first.key, second.key]) {
    h.store.memberships.assign({ prKey: key, topicId: TOPIC, assignedBy: 'agent', reason: '', createdAt: at(0) });
  }
  h.store.sets.save({
    id: 's1',
    topicId: TOPIC,
    title: 'Cache keys',
    take: '',
    members: [
      { prKey: first.key, reason: 'a' },
      { prKey: second.key, reason: 'b' },
    ],
    removedKeys: [],
    status: 'active',
    inputHash: 'h',
    createdAt: at(0),
    updatedAt: at(0),
  });
  return h;
}

async function setView(h: Harness): Promise<TileView> {
  const view = (await h.engine.getTopic(TOPIC))?.tiles.find((tile) => tile.tile.id === SET_TILE);
  if (!view) {
    throw new Error('no set tile');
  }
  return view;
}

function doneByKey(view: TileView): Record<string, boolean> {
  return Object.fromEntries(view.prs.map((pr) => [pr.key, pr.done]));
}

/** Lets the queued send (and its awaits) run after the fake timer fired. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('markPrRead: the detail pane acts on the selected PR', () => {
  it('starts with neither PR done and the set not done', async () => {
    const h = await syncedSet();
    const view = await setView(h);
    expect(view.state.kind).not.toBe('done');
    expect(doneByKey(view)).toEqual({ [first.key]: false, [second.key]: false });
    expect(view.prs.map((pr) => pr.afterRead.done)).toEqual([true, true]);
  });

  it('marks the read PR done and leaves the set open while the other PR is not done; the last one finishes the set', async () => {
    const h = await syncedSet();

    const result = await h.engine.markPrRead(SET_TILE, first.key);

    expect(result.ok).toBe(true);
    expect(result.undoToken).not.toBeNull();
    const afterFirst = await setView(h);
    expect(afterFirst.state.kind).toBe('open');
    expect(doneByKey(afterFirst)).toEqual({ [first.key]: true, [second.key]: false });
    expect(h.store.userPrStates.get(second.key)?.handledAt ?? null).toBeNull();

    await h.engine.markPrRead(SET_TILE, second.key);

    const afterSecond = await setView(h);
    expect(afterSecond.state.kind).toBe('done');
    expect(doneByKey(afterSecond)).toEqual({ [first.key]: true, [second.key]: true });
  });

  it('marks only that PR thread read on GitHub, after the undo window', async () => {
    const h = await syncedSet();

    await h.engine.markPrRead(SET_TILE, second.key);
    expect(h.writer.calls).toEqual([]);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(h.writer.calls).toEqual([`markThreadRead thread-${second.ref.number}`]);
  });

  it('undo brings back that PR only', async () => {
    const h = await syncedSet();
    await h.engine.markPrRead(SET_TILE, first.key);
    const { undoToken } = await h.engine.markPrRead(SET_TILE, second.key);

    expect((await h.engine.undo(undoToken)).ok).toBe(true);

    expect(doneByKey(await setView(h))).toEqual({ [first.key]: true, [second.key]: false });
  });

  it('refuses a PR that is not in the tile, and an unknown tile', async () => {
    const h = await syncedSet();
    expect((await h.engine.markPrRead(SET_TILE, 'acme/app#99')).ok).toBe(false);
    expect((await h.engine.markPrRead('set:nope', first.key)).ok).toBe(false);
  });

  it('while GitHub writes are locked changes nothing here until the write is sent', async () => {
    const h = await syncedSet();
    await h.engine.setGitHubWrites(false);

    const result = await h.engine.markPrRead(SET_TILE, second.key);

    expect(result.message).toContain('pending until you unlock GitHub writes');
    expect(doneByKey(await setView(h))[second.key]).toBe(false);
  });

  it('shows a locked mark-read as pending on that PR only, so its neighbours stay markable', async () => {
    const h = await syncedSet();
    await h.engine.setGitHubWrites(false);

    await h.engine.markPrRead(SET_TILE, second.key);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    const view = await setView(h);
    expect(view.pendingWrite).not.toBeNull();
    expect(Object.fromEntries(view.prs.map((pr) => [pr.key, pr.pendingWrite !== null]))).toEqual({ [first.key]: false, [second.key]: true });
  });
});

describe('markOpenedRead on a set: checked per PR', () => {
  /** A PR in the set that asks the viewer for a review: a mark-read cannot make it done. */
  async function syncedWithAsk(): Promise<{ h: Harness; asking: Pr }> {
    const h = await syncedSet();
    const asking = makePr({ number: 13, author: 'alice', reviewerUsers: ['viewer'], updatedAt: at(6) });
    h.reader.addPr(asking, makeThreadFor(asking, { reason: 'review_requested' }));
    // A new inbox answer, so the second sync fetches it.
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.memberships.assign({ prKey: asking.key, topicId: TOPIC, assignedBy: 'agent', reason: '', createdAt: at(0) });
    const set = h.store.sets.get('s1')!;
    h.store.sets.save({ ...set, members: [...set.members, { prKey: asking.key, reason: 'c' }] });
    return { h, asking };
  }

  it('opening one PR handles it while another member still asks for a review; the set stays open', async () => {
    const { h, asking } = await syncedWithAsk();
    await h.engine.setGitHubWrites(true);
    expect((await setView(h)).afterRead.done).toBe(false);

    expect(await h.engine.markOpenedRead(second.key)).toEqual({ marked: true });

    expect(h.writer.calls).toEqual([`markThreadRead thread-${second.ref.number}`]);
    const view = await setView(h);
    expect(doneByKey(view)).toEqual({ [first.key]: false, [second.key]: true, [asking.key]: false });
    expect(view.state.kind).not.toBe('done');
    // The PR that asks for a review is left alone.
    expect(await h.engine.markOpenedRead(asking.key)).toEqual({ marked: false });
  });
});
