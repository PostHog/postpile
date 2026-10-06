import { UNDO_WINDOW_MS, type FullPr } from '@postpile/core';
import { at, makeComment, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness, NOW, type Harness, type HarnessOptions } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

// "Mute until I'm mentioned" (DESIGN.md "Mute"): a snooze only a personal
// ask ends, plus the mark-read and GitHub's own thread unsubscribe, through
// the same undo window, lock and pending writes as a mark-read.

const pr = reviewRequestedPr(1);
const tileId = `pr:${pr.key}`;
const MUTED = { kind: 'muted' } as const;

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

/** Puts `pr` and `other` in topic `depot` as set `s1`, so they share one tile. */
function pairInSet(h: Harness, other: FullPr): void {
  h.store.topics.create({ id: 'depot', name: 'depot', summary: '', summaryInputHash: null, area: null, tailoring: '', driver: null, userRole: 'reviewer', status: 'active', kind: 'project', retiredAt: null, createdAt: at(0), updatedAt: at(0) });
  for (const key of [pr.key, other.key]) {
    h.store.memberships.assign({ prKey: key, topicId: 'depot', assignedBy: 'agent', reason: '', createdAt: at(0) });
  }
  const members = [{ prKey: pr.key, reason: 'a' }, { prKey: other.key, reason: 'b' }];
  h.store.sets.save({ id: 's1', topicId: 'depot', title: 'Pair', take: '', members, removedKeys: [], status: 'active', inputHash: 'h', createdAt: at(0), updatedAt: at(0) });
}

async function tile(h: Harness) {
  return (await h.engine.getTopic(UNSORTED_TOPIC_ID))?.tiles.find((view) => view.tile.id === tileId);
}

/** The log oldest first, as [action, origin, outcome]. */
function logRows(h: Harness): string[][] {
  return h.store.actionLog
    .listRecent(100)
    .toReversed()
    .map((entry) => [entry.action, entry.origin, entry.outcome]);
}

describe('Mute until I am mentioned', () => {
  it('puts the tile away muted, marks it read and unsubscribes on GitHub after the undo window', async () => {
    const h = await synced();

    const result = await h.engine.snooze(tileId, MUTED);

    expect(result.ok).toBe(true);
    expect(result.undoToken).not.toBeNull();
    expect(h.store.snoozes.get(pr.key)?.condition).toEqual(MUTED);
    expect((await tile(h))?.state).toMatchObject({ kind: 'snoozed', muted: true, unreadOnGitHub: false });
    expect(h.writer.calls).toEqual([]);
    await afterUndoWindow(h);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1', 'unsubscribeThread thread-1']);
    expect(logRows(h)).toContainEqual(['unsubscribe', 'queue', 'github']);
    expect(h.telemetry.events.map((event) => [event.event, event.props])).toContainEqual(['snoozed', { duration_bucket: 'muted' }]);
  });

  it('unsubscribes from a thread that is read already', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    await afterUndoWindow(h);

    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);

    expect(h.writer.calls).toEqual(['markThreadRead thread-1', 'unsubscribeThread thread-1']);
  });

  it('takes it all back on Undo inside the window: no snooze, still unread, nothing sent', async () => {
    const h = await synced();
    const result = await h.engine.snooze(tileId, MUTED);

    expect((await h.engine.undo(result.undoToken)).ok).toBe(true);

    expect(h.store.snoozes.get(pr.key)).toBeNull();
    expect((await tile(h))?.state.kind).toBe('unread');
    await afterUndoWindow(h);
    expect(h.writer.calls).toEqual([]);
  });

  it('waits as two pending writes while locked, changing nothing on GitHub, and sends both from the lock', async () => {
    const h = await synced({ writesEnabled: false });

    await h.engine.snooze(tileId, MUTED);
    // Muted here at once, but still unread: GitHub has not heard of it.
    expect((await tile(h))?.state).toMatchObject({ kind: 'snoozed', muted: true, unreadOnGitHub: true });
    await afterUndoWindow(h);

    const pending = (await h.engine.githubWrites()).pending;
    expect(pending.map((write) => [write.kind, write.title, write.threadCount])).toEqual([
      ['mark_read', pr.title, 1],
      ['unsubscribe', `Mute: ${pr.title}`, 1],
    ]);
    expect(logRows(h)).toContainEqual(['unsubscribe', 'tile', 'pending']);
    expect(h.writer.calls).toEqual([]);

    await h.engine.setGitHubWrites(true);
    const sent = await h.engine.sendPendingWrites();

    expect(sent).toMatchObject({ ok: true, done: 2, failed: 0 });
    expect(h.writer.calls).toEqual(['markThreadRead thread-1', 'unsubscribeThread thread-1']);
    expect((await h.engine.githubWrites()).pending).toEqual([]);
    expect((await tile(h))?.state).toMatchObject({ kind: 'snoozed', muted: true, unreadOnGitHub: false });
  });

  it('keeps the subscription when a mention during the undo window ends the mute', async () => {
    let now = NOW;
    const h = await synced({ now: () => now });
    await h.engine.snooze(tileId, MUTED);

    const mention = makeComment({ id: 'c1', author: 'rogue', body: `@${viewer.login} one question`, createdAt: at(1690) });
    const asked: FullPr = { ...pr, updatedAt: at(1700), comments: [mention] };
    h.reader.addPr(asked, makeThreadFor(asked));
    h.reader.etag = 'etag-2';
    now = new Date(at(1705));
    await afterUndoWindow(h);

    // The retry refreshed the PR and kept it unread for the mention; that ended the mute, so no unsubscribe either.
    expect(h.writer.calls).toEqual([]);
    expect(logRows(h)).toContainEqual(['unsubscribe', 'queue', 'skipped']);
    expect((await tile(h))?.state).toMatchObject({ kind: 'unread' });
    expect((await h.engine.githubWrites()).pending).toEqual([]);
  });

  it('keeps the subscription as it was when the pending mute is discarded', async () => {
    const h = await synced({ writesEnabled: false });
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);

    await h.engine.discardPendingWrites();

    expect(logRows(h)).toContainEqual(['unsubscribe', 'footer', 'discarded']);
    expect((await h.engine.githubWrites()).pending).toEqual([]);
    expect(h.writer.calls).toEqual([]);
  });

  it('subscribes again on Unmute, after the undo window; a plain Unsnooze subscribes nothing', async () => {
    const h = await synced();
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);

    const result = await h.engine.unsnooze(tileId);

    expect(result.message).toMatch(/^Unmuted/);
    expect(h.store.snoozes.get(pr.key)).toBeNull();
    expect((await tile(h))?.state.kind).not.toBe('snoozed');
    await afterUndoWindow(h);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1', 'unsubscribeThread thread-1', 'subscribeThread thread-1']);

    await h.engine.snooze(tileId, { kind: 'new_push' });
    expect((await h.engine.unsnooze(tileId)).message).toBe('Unsnoozed');
    await afterUndoWindow(h);
    expect(h.writer.calls).toHaveLength(3);
  });

  it('lets Undo of an Unmute put the mute back and send nothing', async () => {
    const h = await synced();
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);
    const unmuted = await h.engine.unsnooze(tileId);

    await h.engine.undo(unmuted.undoToken);

    expect(h.store.snoozes.get(pr.key)?.condition).toEqual(MUTED);
    await afterUndoWindow(h);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1', 'unsubscribeThread thread-1']);
  });

  it('mutes again when a pending Unmute is discarded, so Unmute is offered again', async () => {
    const h = await synced();
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);
    await h.engine.setGitHubWrites(false);
    await h.engine.unsnooze(tileId);
    await afterUndoWindow(h);
    expect(h.store.snoozes.get(pr.key)).toBeNull();

    await h.engine.discardPendingWrites();

    expect(h.store.snoozes.get(pr.key)?.condition).toEqual(MUTED);
    expect((await tile(h))?.state).toMatchObject({ kind: 'snoozed', muted: true });
    expect(logRows(h)).toContainEqual(['subscribe', 'footer', 'discarded']);
    expect((await h.engine.githubWrites()).pending).toEqual([]);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1', 'unsubscribeThread thread-1']);
  });

  it('keeps a subscribe GitHub did not take as a failed pending write, so it can be sent again', async () => {
    const h = await synced();
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);
    h.writer.failSubscribe = true;

    await h.engine.unsnooze(tileId);
    await afterUndoWindow(h);

    const pending = (await h.engine.githubWrites()).pending;
    expect(pending.map((write) => [write.kind, write.error])).toEqual([['subscribe', 'boom: subscribe']]);
    expect(logRows(h).slice(-2)).toEqual([
      ['subscribe', 'queue', 'failed'],
      ['subscribe', 'tile', 'pending'],
    ]);

    h.writer.failSubscribe = false;
    expect(await h.engine.sendPendingWrites()).toMatchObject({ ok: true, done: 1 });
    expect(h.writer.calls.at(-1)).toBe('subscribeThread thread-1');
    expect((await h.engine.githubWrites()).pending).toEqual([]);
  });

  it('skips a failed Unmute sent again after the PR was muted again, so the newer mute stays', async () => {
    const h = await synced();
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);
    h.writer.failSubscribe = true;
    await h.engine.unsnooze(tileId);
    await afterUndoWindow(h);
    h.writer.failSubscribe = false;

    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);
    expect(await h.engine.sendPendingWrites()).toMatchObject({ ok: true, done: 1 });

    expect(h.writer.calls.filter((call) => call.startsWith('subscribeThread'))).toEqual([]);
    expect(logRows(h).at(-1)).toEqual(['subscribe', 'footer', 'skipped']);
    expect((await h.engine.githubWrites()).pending).toEqual([]);
    expect(h.store.snoozes.get(pr.key)?.condition).toEqual(MUTED);
  });

  it('mutes again from the Unmute click when it is discarded, so a mention inside the undo window still counts', async () => {
    let now = NOW;
    const h = await synced({ now: () => now });
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);
    await h.engine.setGitHubWrites(false);
    await h.engine.unsnooze(tileId);
    const mention = makeComment({ id: 'c1', author: 'rogue', body: `@${viewer.login} one question`, createdAt: at(1690) });
    const asked: FullPr = { ...pr, updatedAt: at(1700), comments: [mention] };
    h.reader.addPr(asked, makeThreadFor(asked));
    h.reader.etag = 'etag-2';
    now = new Date(at(1705));
    await afterUndoWindow(h);
    await h.engine.sync({ maxAgentCalls: 0 });

    await h.engine.discardPendingWrites();

    expect(h.store.snoozes.get(pr.key)).toEqual({ prKey: pr.key, condition: MUTED, since: NOW.toISOString() });
    expect((await tile(h))?.state.kind).toBe('unread');
  });

  it('waits as a pending subscribe when Unmute happens while locked', async () => {
    const h = await synced();
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);
    await h.engine.setGitHubWrites(false);

    await h.engine.unsnooze(tileId);
    await afterUndoWindow(h);

    expect((await h.engine.githubWrites()).pending.map((write) => [write.kind, write.title])).toEqual([['subscribe', `Unmute: ${pr.title}`]]);
    expect(h.writer.calls).toEqual(['markThreadRead thread-1', 'unsubscribeThread thread-1']);
  });

  it('on a snoozed set that mixes a mute with a plain snooze, says partly muted and Unsnooze subscribes the muted PR again', async () => {
    const h = makeHarness();
    const other = reviewRequestedPr(2);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.addPr(other, makeThreadFor(other));
    await h.engine.sync({ maxAgentCalls: 0 });
    pairInSet(h, other);
    h.store.snoozes.put({ prKey: pr.key, condition: MUTED, since: NOW.toISOString() });
    h.store.snoozes.put({ prKey: other.key, condition: { kind: 'new_push' }, since: NOW.toISOString() });

    const snoozed = (await h.engine.getTopic('depot'))?.tiles.find((view) => view.tile.id === 'set:s1');
    expect(snoozed?.state).toMatchObject({ kind: 'snoozed', partlyMuted: true });
    expect(snoozed?.state.muted).toBeUndefined();
    expect(snoozed?.offers.unmuteRest).toBe(false);

    expect((await h.engine.unsnooze('set:s1')).message).toMatch(/^Unmuted/);
    await afterUndoWindow(h);
    expect(h.writer.calls).toEqual(['subscribeThread thread-1']);
  });

  it('leaves a mute that still holds alone when the rest of the tile is snoozed', async () => {
    const h = makeHarness();
    const other = reviewRequestedPr(2);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.addPr(other, makeThreadFor(other));
    await h.engine.sync({ maxAgentCalls: 0 });
    pairInSet(h, other);
    h.store.snoozes.put({ prKey: pr.key, condition: MUTED, since: NOW.toISOString() });

    expect((await h.engine.snooze('set:s1', { kind: 'new_push' })).ok).toBe(true);

    expect(h.store.snoozes.get(pr.key)?.condition).toEqual(MUTED);
    expect(h.store.snoozes.get(other.key)?.condition).toEqual({ kind: 'new_push' });
    const snoozed = (await h.engine.getTopic('depot'))?.tiles.find((view) => view.tile.id === 'set:s1');
    expect(snoozed?.state).toMatchObject({ kind: 'snoozed', partlyMuted: true });
  });

  it('on a set, a mention on one PR brings the tile back and offers Unmute for the rest, which subscribes both again', async () => {
    let now = NOW;
    const h = makeHarness({ now: () => now });
    const other = reviewRequestedPr(2);
    h.reader.addPr(pr, makeThreadFor(pr));
    h.reader.addPr(other, makeThreadFor(other));
    await h.engine.sync({ maxAgentCalls: 0 });
    pairInSet(h, other);
    const setTile = async () => (await h.engine.getTopic('depot'))?.tiles.find((view) => view.tile.id === 'set:s1');

    await h.engine.snooze('set:s1', MUTED);
    await afterUndoWindow(h);
    expect((await setTile())?.state).toMatchObject({ kind: 'snoozed', muted: true });

    const mention = makeComment({ id: 'c1', author: 'rogue', body: `@${viewer.login} one question`, createdAt: at(1690) });
    const asked: FullPr = { ...pr, updatedAt: at(1700), comments: [mention] };
    h.reader.addPr(asked, makeThreadFor(asked));
    h.reader.etag = 'etag-2';
    now = new Date(at(1705));
    await h.engine.sync({ maxAgentCalls: 0 });
    const back = await setTile();
    expect(back?.state).toMatchObject({ kind: 'unread', partlyMuted: true });
    expect(back?.offers.unmuteRest).toBe(true);

    await h.engine.unsnooze('set:s1');
    await afterUndoWindow(h);
    expect(h.writer.calls.filter((call) => call.startsWith('subscribeThread')).sort()).toEqual(['subscribeThread thread-1', 'subscribeThread thread-2']);
    expect((await setTile())?.state.partlyMuted).toBeUndefined();
  });

  it('stays muted through other people, and a mention of the viewer brings the tile back', async () => {
    let now = NOW;
    const h = await synced({ now: () => now });
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);

    const rogue: FullPr = { ...pr, updatedAt: at(1700), comments: [makeComment({ id: 'c1', author: 'rogue', body: 'ping ping ping', createdAt: at(1690) })] };
    h.reader.addPr(rogue, makeThreadFor(rogue));
    h.reader.etag = 'etag-2';
    now = new Date(at(1705));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await tile(h))?.state).toMatchObject({ kind: 'snoozed', muted: true });

    const mention = makeComment({ id: 'c2', author: 'rogue', body: `@${viewer.login} please look`, createdAt: at(1790) });
    const asked: FullPr = { ...rogue, updatedAt: at(1800), comments: [...rogue.comments, mention] };
    h.reader.addPr(asked, makeThreadFor(asked));
    h.reader.etag = 'etag-3';
    now = new Date(at(1805));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await tile(h))?.state.kind).toBe('unread');
  });
});
