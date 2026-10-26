import { CATCH_UP_CONFIRM_TRIES, CLEANUP_ALREADY_PENDING, SAFE_CLEAR_WAITS_FOR_SYNC, type NotificationThread, type FullPr, type Verdict } from '@postpile/core';
import { makeComment, makePr, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { Board } from './board.ts';
import { glanceTargetKeys } from './glance-inputs.ts';
import { makeHarness, NOW, type Harness, type HarnessOptions } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

// NOW is 2026-09-02T12:00Z.
const DAY_MS = 24 * 3_600_000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

/** A merged PR the viewer was never asked on. */
function mergedPr(number: number, days: number, repo = 'acme/app'): FullPr {
  return makePr({ number, repo, state: 'MERGED', mergedAt: daysAgo(days), mergedBy: 'alice', updatedAt: daysAgo(days) });
}

/** Merged while the viewer's review was asked: a merge without your review, glanced after the fact. */
function mergedWithoutReview(number: number, repo: string): FullPr {
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
function mergedPile(): FullPr[] {
  return Array.from({ length: 21 }, (_, index) => mergedPr(index + 1, 1 + (index % 3)));
}

function harnessWith(prs: FullPr[], options: HarnessOptions = {}): Harness {
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

/** Action-log rows that say a thread was read on github.com or another client. */
function observedReads(h: Harness): string[] {
  return h.store.actionLog
    .listRecent(200)
    .filter((row) => row.action === 'mark_read' && row.outcome === 'observed')
    .map((row) => row.threadId ?? '');
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

describe('inbox catch-up: getting to the dialog fast', () => {
  it('holds as soon as the count is in: moved PRs without an unread thread, diffs and CODEOWNERS wait for the answer', async () => {
    let clock = NOW.getTime();
    const hoursAgo = (hours: number) => new Date(clock - hours * 3_600_000).toISOString();
    const h = harnessWith(mergedPile(), { now: () => new Date(clock) });
    const silentlyMerged = reviewRequestedPr(100, { repo: 'acme/web', updatedAt: hoursAgo(1) });
    const readOpen = reviewRequestedPr(101, { repo: 'acme/web', updatedAt: hoursAgo(1) });
    h.reader.addPr(silentlyMerged, makeThreadFor(silentlyMerged));
    h.reader.addPr(readOpen, makeThreadFor(readOpen, { unread: false, lastReadAt: hoursAgo(1) }));
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.startAsUsual();
    await h.engine.sync({ maxAgentCalls: 0 });

    // Six days away. Both PRs moved without their threads moving: one merged, one got a push.
    clock += 6 * DAY_MS;
    h.reader.addStackPr({ ...silentlyMerged, state: 'MERGED', mergedAt: hoursAgo(1), mergedBy: 'alice', updatedAt: hoursAgo(1) });
    h.reader.addStackPr({ ...readOpen, updatedAt: hoursAgo(1) });
    const fetchesBefore = h.reader.fetchedRefs.length;
    const codeOwnersBefore = h.reader.codeOwnersCalls.length;
    const diffsBefore = h.reader.diffCalls.length;

    const held = await h.engine.sync({ maxAgentCalls: 0 });

    expect(held.heldForCatchUp).toBe(true);
    // The silent merge counts: its PR has an unread thread, so it was fetched before the hold.
    expect((await h.engine.inboxCleanup()).counts).toMatchObject({ mergedAll: 22 });
    const fetchedWhileHeld = h.reader.fetchedRefs.slice(fetchesBefore).flat().map((ref) => `${ref.repo}#${ref.number}`);
    expect(fetchedWhileHeld).toContain(silentlyMerged.key);
    expect(fetchedWhileHeld).not.toContain(readOpen.key);
    expect(h.reader.codeOwnersCalls.length).toBe(codeOwnersBefore);
    expect(h.reader.diffCalls.length).toBe(diffsBefore);

    await h.engine.startAsUsual();
    const resumed = await h.engine.sync({ maxAgentCalls: 0 });

    expect(resumed.heldForCatchUp).toBeUndefined();
    expect(h.reader.fetchedRefs.slice(fetchesBefore).flat().map((ref) => `${ref.repo}#${ref.number}`)).toContain(readOpen.key);
    expect(h.reader.codeOwnersCalls.length).toBeGreaterThan(codeOwnersBefore);
  });

  it('walks the stack of a merged PR the held fetch stored, though the resumed fetch skips its unchanged snapshot', async () => {
    const top = makePr({ number: 31, baseRef: 'layer-30', headRef: 'layer-31', state: 'MERGED', mergedAt: daysAgo(1), mergedBy: 'alice', updatedAt: daysAgo(1) });
    const below = makePr({ number: 30, baseRef: 'master', headRef: 'layer-30', author: 'bob' });
    const h = harnessWith([...mergedPile(), top]);
    h.reader.addStackPr(below);

    const held = await h.engine.sync({ maxAgentCalls: 0 });
    expect(held.heldForCatchUp).toBe(true);
    expect(h.store.pullIns.get(below.key)).toBeNull();

    await h.engine.startAsUsual();
    const resumed = await h.engine.sync({ maxAgentCalls: 0 });

    expect(resumed.heldForCatchUp).toBeUndefined();
    expect(h.store.pullIns.get(below.key)).toMatchObject({ anchorPrKey: top.key });
  });
});

describe('inbox catch-up: background syncs while it holds', () => {
  it('does not bring the next sync forward for a held sync, even with PRs over the cap, and skips auto syncs until the answer', async () => {
    const lines: string[] = [];
    const pile = Array.from({ length: 25 }, (_, index) => mergedPr(index + 1, 1 + (index % 3)));
    const h = harnessWith(pile, { syncLog: (line) => lines.push(line) });
    h.engine.startAutoSync({ minutes: 60, maxAgentCalls: 0 });

    const held = await h.engine.sync({ maxAgentCalls: 0, maxPrs: 22 });

    expect([held.heldForCatchUp, held.prsSkipped > 0]).toEqual([true, true]);
    expect((await h.engine.livePollStatus()).nextAutoSyncAt).toBe(new Date(h.timers.now() + 60 * 60_000).toISOString());
    h.timers.advance(60 * 60_000);
    await vi.waitFor(() => expect(lines).toContain('auto sync: skipped, waiting for the inbox catch-up answer (the answer starts the sync)'));
    expect(lines.filter((line) => line.startsWith('sync: started'))).toHaveLength(1);

    // The answer resumes the sync, and its end sets the next auto sync.
    const skippedAt = h.timers.now();
    await h.engine.startAsUsual();
    await vi.waitFor(() => expect(lines.filter((line) => line.startsWith('sync: done'))).toHaveLength(2));
    await vi.waitFor(async () => expect((await h.engine.livePollStatus()).nextAutoSyncAt).toBe(new Date(skippedAt + 60 * 60_000).toISOString()));
    h.engine.stopAutoSync();
  });

  it('lets the auto sync and the poll go on when the sync resuming it fails after the answer', async () => {
    const lines: string[] = [];
    const h = harnessWith(mergedPile(), { syncLog: (line) => lines.push(line) });
    h.engine.startAutoSync({ minutes: 60, maxAgentCalls: 0 });
    expect((await h.engine.sync({ maxAgentCalls: 0 })).heldForCatchUp).toBe(true);

    h.reader.failNext = new Error('GitHub answered 502');
    await h.engine.startAsUsual();
    const failed = await h.engine.sync({ maxAgentCalls: 0 });

    expect(failed.errors).toContain('sync: GitHub answered 502');
    expect(await h.engine.pollOnce()).not.toEqual({ kind: 'blocked', reason: 'waiting for the inbox catch-up answer' });
    h.timers.advance(60 * 60_000);
    await vi.waitFor(() => expect(lines).toContain('auto sync: starting (every 60 min)'));
    await vi.waitFor(() => expect(lines.filter((line) => line.startsWith('sync: done'))).toHaveLength(3));
    expect(lines).not.toContain('auto sync: skipped, waiting for the inbox catch-up answer (the answer starts the sync)');
    h.engine.stopAutoSync();
  });

  it('keeps waiting when a sync fails while the start dialog is still unanswered', async () => {
    const h = harnessWith(mergedPile());
    expect((await h.engine.sync({ maxAgentCalls: 0 })).heldForCatchUp).toBe(true);

    h.reader.failNext = new Error('GitHub answered 502');
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(await h.engine.pollOnce()).toEqual({ kind: 'blocked', reason: 'waiting for the inbox catch-up answer' });
    expect((await h.engine.inboxCleanup()).start).not.toBeNull();
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
    // The bulk calls' threads left the inbox because PostPile read them, not because they were read elsewhere.
    expect(observedReads(h)).toEqual([]);
    expect(h.store.actionLog.listRecent(50).find((row) => row.action === 'inbox_cleanup')).toMatchObject({ origin: 'cleanup', outcome: 'github', detail: 'marked 23 read on GitHub' });
    expect(h.telemetry.events).toContainEqual({ event: 'marked_read', props: { count: 23, origin: 'cleanup' } });
    expect((await h.engine.inboxCleanup()).lastRun).toMatchObject({ marked: 23, failed: 0 });
  });

  it('leaves a merged PR someone asked you about after the merge out of the counts and every clear, and glances it', async () => {
    const question = makeComment({ id: 'c-bob', author: 'bob', body: '> an earlier line\n\n@viewer any thoughts here?', createdAt: daysAgo(1) });
    const asked = makePr({ number: 170, repo: 'acme/charts', state: 'MERGED', mergedAt: daysAgo(2), mergedBy: 'bob', updatedAt: daysAgo(1), comments: [question] });
    const h = harnessWith(mergedPile());
    h.reader.addPr(asked, makeThreadFor(asked, { reason: 'mention' }));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(glanceTargetKeys(Board.load(h.store, NOW.toISOString())).has(asked.key)).toBe(true);

    const view = await h.engine.inboxCleanup();
    expect(view.counts).toMatchObject({ unread: 22, mergedAll: 21 });

    githubAfterCleanup(h, [makeThreadFor(asked, { reason: 'mention' })]);
    await h.engine.clearInbox({ merged: 'all', older: 14, countedAt: view.countedAt, from: 'start' });
    await h.engine.inboxCleanupSettled();

    expect(h.writer.calls).toEqual([`markAllReadBefore ${daysAgo(14)}`, `markRepoReadBefore acme/app ${view.countedAt}`]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.notifications.list().filter((thread) => thread.unread).map((thread) => thread.id)).toEqual(['thread-170']);
  });

  it('counts bulk-covered threads only once the inbox shows them read, and says what GitHub is still working on', async () => {
    const h = harnessWith(mergedPile());
    await h.engine.sync({ maxAgentCalls: 0 });
    const view = await h.engine.inboxCleanup();
    const callsBefore = h.reader.notificationCalls;

    // GitHub took the repo PUT with 202 and never finished it while the run waited.
    await h.engine.clearInbox({ merged: 'all', older: null, countedAt: view.countedAt, from: 'start' });
    await h.engine.inboxCleanupSettled();

    expect(h.writer.calls).toEqual([`markRepoReadBefore acme/app ${view.countedAt}`]);
    expect(h.reader.notificationCalls - callsBefore).toBeGreaterThanOrEqual(CATCH_UP_CONFIRM_TRIES);
    expect((await h.engine.inboxCleanup()).lastRun).toMatchObject({ marked: 0, stillOnGitHub: 21 });
    expect(h.store.actionLog.listRecent(50).find((row) => row.action === 'inbox_cleanup')?.detail).toBe('marked 0 read on GitHub; GitHub is still working on 21');

    // GitHub finished the PUT later: the next inbox read sees PostPile's own read, not a read elsewhere.
    githubAfterCleanup(h, []);
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.notifications.list().filter((thread) => thread.unread)).toEqual([]);
    expect(h.store.notifications.get('thread-1')?.lastReadAt).toBe(view.countedAt);
    expect(observedReads(h)).toEqual([]);
  });

  it('still logs a thread with activity after the bulk call\'s last_read_at as read elsewhere', async () => {
    const h = harnessWith(mergedPile());
    await h.engine.sync({ maxAgentCalls: 0 });
    const view = await h.engine.inboxCleanup();
    githubAfterCleanup(h, []);
    await h.engine.clearInbox({ merged: 'all', older: null, countedAt: view.countedAt, from: 'start' });
    await h.engine.inboxCleanupSettled();
    await h.engine.sync({ maxAgentCalls: 0 });

    // New activity on a cleared thread, then the user reads it on github.com.
    const later = makeThreadFor(mergedPr(1, 1), { updatedAt: new Date(NOW.getTime() + 60_000).toISOString() });
    h.reader.threads = [later];
    h.reader.etag = 'etag-new-activity';
    await h.engine.sync({ maxAgentCalls: 0 });
    githubAfterCleanup(h, []);
    h.reader.etag = 'etag-read-elsewhere';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(observedReads(h)).toEqual(['thread-1']);
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
    // Only one cleanup waits in the lock.
    expect(await h.engine.clearInbox({ merged: 'all', older: null, countedAt: view.countedAt, from: 'sidebar' })).toMatchObject({ ok: false, message: CLEANUP_ALREADY_PENDING });
    expect((await h.engine.githubWrites()).pending).toHaveLength(1);

    await h.engine.setGitHubWrites(true);
    const sent = await h.engine.sendPendingWrites();
    await h.engine.inboxCleanupSettled();

    expect(sent).toMatchObject({ ok: true, done: 1 });
    expect(sent.status.pending).toEqual([]);
    expect(h.writer.calls).toEqual([`markRepoReadBefore acme/app ${view.countedAt}`]);
  });
});

describe('inbox catch-up: merged PRs that look safe', () => {
  /** The stored glance keeps its input hash (current) with this verdict; `stale` makes it read as made for an older input. */
  function setVerdict(h: Harness, pr: FullPr, verdict: Verdict, stale = false): void {
    const glance = h.store.glances.get(pr.key);
    expect(glance).not.toBeNull();
    h.store.glances.put({ ...glance!, verdict, inputHash: stale ? 'an-older-input' : glance!.inputHash });
  }

  it('parks only merged PRs with a current LOOKS_SAFE or NOT_YOURS glance; Send PATCHes just those and sees their merges', async () => {
    const safe = mergedWithoutReview(400, 'acme/app');
    const closer = mergedWithoutReview(401, 'acme/app');
    const notYours = mergedWithoutReview(402, 'acme/web');
    const stale = mergedWithoutReview(403, 'acme/web');
    const h = harnessWith([safe, closer, notYours, stale], { writesEnabled: false });
    await h.engine.sync({ maxAgentCalls: 50 });
    setVerdict(h, safe, 'LOOKS_SAFE');
    setVerdict(h, closer, 'LOOK_CLOSER');
    setVerdict(h, notYours, 'NOT_YOURS');
    setVerdict(h, stale, 'LOOKS_SAFE', true);
    const agentCalls = h.runner.requests.length;

    const view = await h.engine.inboxCleanup();
    expect(view.counts).toMatchObject({ mergedAll: 4, mergedSafe: 2 });
    const parked = await h.engine.clearSafeMerged({ countedAt: view.countedAt });

    expect(parked).toMatchObject({ ok: true, message: 'Pending: clears 2 on GitHub once you unlock and send it from the lock' });
    expect((await h.engine.githubWrites()).pending).toEqual([
      expect.objectContaining({ kind: 'catch_up', title: 'Inbox cleanup: merged PRs that look safe', threadCount: 2 }),
    ]);
    expect(await h.engine.clearSafeMerged({ countedAt: view.countedAt })).toMatchObject({ ok: false, message: CLEANUP_ALREADY_PENDING });

    await h.engine.setGitHubWrites(true);
    await h.engine.sendPendingWrites();
    await h.engine.inboxCleanupSettled();

    expect(h.writer.calls).toEqual(['markThreadRead thread-400', 'markThreadRead thread-402']);
    const unread = h.store.notifications.list().filter((thread) => thread.unread).map((thread) => thread.id);
    expect(unread.sort()).toEqual(['thread-401', 'thread-403']);
    const mergeSeen = (pr: FullPr) => h.store.events.listForPr(pr.key).find((event) => event.kind === 'merged_without_review')?.seenAt ?? null;
    expect([mergeSeen(safe), mergeSeen(notYours), mergeSeen(closer)].map((seenAt) => seenAt !== null)).toEqual([true, true, false]);
    // Counting and clearing read the glances there are; neither asks the agent for one.
    expect(h.runner.requests.length).toBe(agentCalls);
  });

  it('refuses while a full sync runs, since its glance step may turn a LOOKS_SAFE into LOOK_CLOSER, and offers it again after', async () => {
    const h = harnessWith([]);
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    const release = h.agent.holdDossier('depot');

    const syncing = h.engine.sync({ agentJobs: ['dossiers', 'glances'] });
    await vi.waitFor(async () => expect((await h.engine.syncProgress())?.running).toContain('dossiers'));
    const view = await h.engine.inboxCleanup();
    expect(view.syncing).toBe(true);
    expect(await h.engine.clearSafeMerged({ countedAt: view.countedAt })).toMatchObject({ ok: false, message: SAFE_CLEAR_WAITS_FOR_SYNC });

    release();
    await syncing;
    expect((await h.engine.inboxCleanup()).syncing).toBe(false);
  });
});
