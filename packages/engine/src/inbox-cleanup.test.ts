import type { NotificationThread, Pr } from '@postpile/core';
import { makePr, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { Board } from './board.ts';
import { glanceTargetKeys } from './glance-inputs.ts';
import { makeHarness, NOW, type Harness, type HarnessOptions } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

// NOW is 2026-09-02T12:00Z.
const DAY_MS = 24 * 3_600_000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

/** A merged PR the viewer was never asked on. */
function mergedPr(number: number, days: number, repo = 'acme/app'): Pr {
  return makePr({ number, repo, state: 'MERGED', mergedAt: daysAgo(days), mergedBy: 'alice', updatedAt: daysAgo(days) });
}

/** Merged while the viewer's review was asked: a merge without your review, glanced after the fact. */
function mergedWithoutReview(number: number, repo: string): Pr {
  return makePr({
    number,
    repo,
    state: 'MERGED',
    mergedAt: daysAgo(1),
    mergedBy: 'alice',
    reviewerUsers: [viewer.login],
    timeline: [
      makeTimelineItem({ id: `ask-${number}`, kind: 'review_requested', actor: 'alice', subject: viewer.login, at: daysAgo(3) }),
      makeTimelineItem({ id: `merge-${number}`, kind: 'merged', actor: 'alice', subject: null, at: daysAgo(1) }),
    ],
    updatedAt: daysAgo(1),
  });
}

/** 21 merged PRs in acme/app, nothing else there. */
function mergedPile(): Pr[] {
  return Array.from({ length: 21 }, (_, index) => mergedPr(index + 1, 1 + (index % 3)));
}

function harnessWith(prs: Pr[], options: HarnessOptions = {}): Harness {
  const h = makeHarness({ catchUpGate: true, ...options });
  for (const pr of prs) {
    h.reader.addPr(pr, makeThreadFor(pr));
  }
  return h;
}

/** What GitHub lists after the cleanup's calls: only `unread` stays in the inbox. */
function githubAfterCleanup(h: Harness, unread: NotificationThread[]): void {
  h.reader.threads = unread;
  h.reader.etag = 'etag-after-cleanup';
}

describe('inbox catch-up: the sync gate', () => {
  it('holds the first sync after the fetch while the start dialog is due; Start as usual lets it go on', async () => {
    const open = reviewRequestedPr(100, { repo: 'acme/web' });
    const h = harnessWith([...mergedPile(), open]);

    const held = await h.engine.sync();

    expect(held.heldForCatchUp).toBe(true);
    expect(held.prsFetched).toBeGreaterThan(0);
    expect(h.runner.requests).toEqual([]);
    expect(await h.engine.pollOnce()).toEqual({ kind: 'blocked', reason: 'waiting for the inbox catch-up answer' });
    expect(await h.engine.inboxCleanup()).toMatchObject({
      start: { kind: 'first_run', load: 'light' },
      counts: { unread: 22, mergedAll: 21, mergedQuiet7: 0 },
    });

    await h.engine.startAsUsual();
    const resumed = await h.engine.sync();

    expect(resumed.heldForCatchUp).toBeUndefined();
    expect(h.runner.requests.length).toBeGreaterThan(0);
    expect((await h.engine.inboxCleanup()).start).toBeNull();
    // Answered: the next start does not ask again.
    expect((await h.engine.sync()).heldForCatchUp).toBeUndefined();
  });

  it('never holds without a window to ask in (the CLI), and below 20 merged PRs', async () => {
    const cli = harnessWith(mergedPile(), { catchUpGate: false });
    expect((await cli.engine.sync({ maxAgentCalls: 0 })).heldForCatchUp).toBeUndefined();

    const few = harnessWith(mergedPile().slice(0, 19));
    expect((await few.engine.sync({ maxAgentCalls: 0 })).heldForCatchUp).toBeUndefined();
  });
});

describe('inbox catch-up: clearing', () => {
  it('sends one PUT for everything older, a repo PUT and a PATCH, reads the PATCHed thread here, then resumes the sync', async () => {
    const skipped = mergedWithoutReview(200, 'acme/web');
    const open = reviewRequestedPr(201, { repo: 'acme/web' });
    const h = harnessWith([...mergedPile(), skipped, open]);
    // An old thread on a PR the sync never fetches.
    const old = makeThreadFor(makePr({ number: 300, repo: 'acme/docs' }), { updatedAt: daysAgo(40) });
    h.reader.threads = [...h.reader.threads, old];
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(glanceTargetKeys(Board.load(h.store, NOW.toISOString())).has(skipped.key)).toBe(true);

    const view = await h.engine.inboxCleanup();
    expect(view.counts).toMatchObject({ mergedAll: 22, mergedWithoutReview: 1, olderThan30: 1 });
    expect(view.glances).toBe(2);
    expect(view.options.find((option) => option.merged === 'all' && option.older === 30)).toMatchObject({ clears: 23, bulkCalls: 2, threadCalls: 1, glancesSaved: 1 });

    githubAfterCleanup(h, [makeThreadFor(open)]);
    const result = await h.engine.clearInbox({ merged: 'all', older: 30, countedAt: view.countedAt, from: 'start' });
    await h.engine.inboxCleanupSettled();
    const resumed = await h.engine.sync({ maxAgentCalls: 0 });

    expect(result).toMatchObject({ ok: true, message: 'Clearing 23 on GitHub in the background' });
    expect(h.writer.calls).toEqual([`markAllReadBefore ${daysAgo(30)}`, `markRepoReadBefore acme/app ${NOW.toISOString()}`, 'markThreadRead thread-200']);
    expect(h.store.notifications.get('thread-200')).toMatchObject({ unread: false, lastReadAt: skipped.updatedAt });
    // The merge without your review was seen through the read: the glance step leaves the PR alone now.
    expect(h.store.events.listForPr(skipped.key).find((event) => event.kind === 'merged_without_review')?.seenAt).not.toBeNull();
    const targets = glanceTargetKeys(Board.load(h.store, NOW.toISOString()));
    expect([targets.has(skipped.key), targets.has(open.key)]).toEqual([false, true]);
    expect(resumed.heldForCatchUp).toBeUndefined();
    expect(h.store.notifications.list().filter((thread) => thread.unread).map((thread) => thread.id)).toEqual(['thread-201']);
    expect(h.store.actionLog.listRecent(50).find((row) => row.action === 'inbox_cleanup')).toMatchObject({ origin: 'cleanup', outcome: 'github', detail: 'marked 23 read on GitHub' });
    expect(h.telemetry.events).toContainEqual({ event: 'marked_read', props: { count: 23, origin: 'cleanup' } });
    expect((await h.engine.inboxCleanup()).lastRun).toMatchObject({ marked: 23, failed: 0 });
  });

  it('parks one pending write while locked and lets the held sync go on; Send runs the same plan', async () => {
    const h = harnessWith(mergedPile(), { writesEnabled: false });
    await h.engine.sync({ maxAgentCalls: 0 });
    const view = await h.engine.inboxCleanup();

    const result = await h.engine.clearInbox({ merged: 'all', older: null, countedAt: view.countedAt, from: 'start' });
    const resumed = await h.engine.sync({ maxAgentCalls: 0 });

    expect(result).toMatchObject({ ok: true, message: 'Pending: clears 21 on GitHub once you unlock and send it from the lock' });
    expect(resumed.heldForCatchUp).toBeUndefined();
    expect(h.writer.calls).toEqual([]);
    expect((await h.engine.githubWrites()).pending).toEqual([
      expect.objectContaining({ kind: 'catch_up', origin: 'cleanup', title: 'Inbox cleanup: merged PRs', threadCount: 21 }),
    ]);
    expect((await h.engine.inboxCleanup()).pending).toBe(true);

    await h.engine.setGitHubWrites(true);
    const sent = await h.engine.sendPendingWrites();
    await h.engine.inboxCleanupSettled();

    expect(sent).toMatchObject({ ok: true, done: 1 });
    expect(sent.status.pending).toEqual([]);
    expect(h.writer.calls).toEqual([`markRepoReadBefore acme/app ${view.countedAt}`]);
  });
});
