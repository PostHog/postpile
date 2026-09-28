import { makeComment, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

// NOW is 2026-09-02T12:00Z. The PR's events sit on 2026-09-01 (fixture `at`).
const READ_ON_GITHUB = '2026-09-02T08:00:00.000Z';

function tileState(h: Harness, topicId: string) {
  return h.engine.getTopic(topicId).then((detail) => detail?.tiles[0]?.state.kind);
}

describe('GitHub read times', () => {
  it('makes a tile calm when its thread was read on github.com after the first sync', async () => {
    let clock = NOW;
    const h = makeHarness({ now: () => clock });
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.markTopicSeen('t');
    expect(await tileState(h, 't')).toBe('unread');

    // Cleared on github.com while the app was closed: the thread left the inbox, the read list has its read time.
    const readAt = '2026-09-02T15:00:00.000Z';
    clock = new Date('2026-09-03T09:00:00.000Z');
    const read = makeThreadFor(pr, { unread: false, lastReadAt: readAt, updatedAt: readAt });
    h.reader.threads = [];
    h.reader.readList = [read];
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(await tileState(h, 't')).toBe('open');
    const events = h.store.events.listForPr(pr.key);
    expect(events.every((event) => event.seenAt === readAt)).toBe(true);
    expect(h.store.notifications.get(read.id)).toMatchObject({ unread: false, lastReadAt: readAt });
    expect(h.store.actionLog.listRecent(5).map((row) => [row.action, row.origin, row.outcome])).toEqual([['mark_read', 'sync', 'observed']]);
  });

  it('applies the read time on every sync, not only the first fetch of a PR', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });

    // Still unread on GitHub (new activity later), but read up to a point in between.
    h.reader.threads = [makeThreadFor(pr, { lastReadAt: READ_ON_GITHUB })];
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.events.listForPr(pr.key).map((event) => event.seenAt)).toEqual([READ_ON_GITHUB]);
  });

  it('asks GitHub for the read time of a thread that left the inbox without showing up in the read list', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });

    const read = makeThreadFor(pr, { unread: false, lastReadAt: READ_ON_GITHUB });
    h.reader.threads = [read];
    h.reader.readList = [];
    // The inbox no longer lists it; getThread still knows it.
    const inbox = h.reader.listNotifications.bind(h.reader);
    h.reader.listNotifications = async (conditions) => {
      const result = await inbox(conditions);
      return result.notModified ? result : { ...result, threads: [] };
    };
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.notifications.get(read.id)?.lastReadAt).toBe(READ_ON_GITHUB);
  });

  it('logs the events of a PR handled entirely on github.com, as seen', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(2, {
      updatedAt: '2026-09-02T07:00:00.000Z',
      comments: [makeComment({ id: 'c2', author: 'bob', body: `@${viewer.login} ok?`, createdAt: '2026-09-02T06:00:00.000Z' })],
    });
    h.reader.prs.set(pr.key, pr);
    h.reader.readList = [makeThreadFor(pr, { unread: false, lastReadAt: READ_ON_GITHUB, updatedAt: '2026-09-02T07:00:00.000Z' })];

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.prsFetched).toBe(1);
    const events = h.store.events.listForPr(pr.key);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.seenAt !== null)).toBe(true);
    expect(h.store.eventLog.countSince([pr.key], 0)).toBe(events.length);
    const unsorted = await h.engine.getTopic('unsorted');
    expect(unsorted?.tiles.map((view) => [view.prs[0]?.key, view.state.kind])).toEqual([[pr.key, 'open']]);
  });

  it('moves the read-list since to each full sync, and the poll reuses its ETag', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.reader.readListCalls).toEqual([['2026-08-26T12:00:00.000Z', null]]);
    expect(h.store.meta.get('read_threads_since')).toBe(NOW.toISOString());

    // An unchanged inbox: the poll does not ask for the read list.
    await h.engine.pollOnce();
    expect(h.reader.readListCalls).toHaveLength(1);

    h.reader.etag = 'etag-2';
    await h.engine.pollOnce();
    h.reader.etag = 'etag-3';
    await h.engine.pollOnce();
    expect(h.reader.readListCalls.slice(1)).toEqual([
      [NOW.toISOString(), null],
      [NOW.toISOString(), 'read-etag-1'],
    ]);
  });

  it('moves "since you last looked" forward once the topic is caught up on GitHub', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.cursors.get('seen', 't')).toBeNull();

    h.reader.threads = [makeThreadFor(pr, { unread: false, lastReadAt: READ_ON_GITHUB })];
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.cursors.get('seen', 't')).toMatchObject({ seq: h.store.eventLog.maxSeq(), updatedAt: NOW.toISOString() });
  });

  it('leaves a locked mark-read pending while GitHub still has the thread unread', async () => {
    const h = makeHarness({ writesEnabled: false });
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const tileId = (await h.engine.getTopic('t'))!.tiles[0]!.tile.id;
    await h.engine.markRead(tileId);
    h.timers.advance(7000);
    await h.engine.flushPendingWrites();

    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.githubWrites()).pending).toHaveLength(1);
    expect(await tileState(h, 't')).toBe('unread');
  });
});
