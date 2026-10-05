import { UNDO_WINDOW_MS, type Pr } from '@postpile/core';
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

  it('stays muted through other people, and a mention of the viewer brings the tile back', async () => {
    let now = NOW;
    const h = await synced({ now: () => now });
    await h.engine.snooze(tileId, MUTED);
    await afterUndoWindow(h);

    const rogue: Pr = { ...pr, updatedAt: at(1700), comments: [makeComment({ id: 'c1', author: 'rogue', body: 'ping ping ping', createdAt: at(1690) })] };
    h.reader.addPr(rogue, makeThreadFor(rogue));
    h.reader.etag = 'etag-2';
    now = new Date(at(1705));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await tile(h))?.state).toMatchObject({ kind: 'snoozed', muted: true });

    const mention = makeComment({ id: 'c2', author: 'rogue', body: `@${viewer.login} please look`, createdAt: at(1790) });
    const asked: Pr = { ...rogue, updatedAt: at(1800), comments: [...rogue.comments, mention] };
    h.reader.addPr(asked, makeThreadFor(asked));
    h.reader.etag = 'etag-3';
    now = new Date(at(1805));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await tile(h))?.state.kind).toBe('unread');
  });
});
