import type { Pr } from '@postpile/core';
import { at, makeComment, makeCommit, makePr, makeReview, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness, type HarnessOptions } from './testing/fakes.ts';

// alice's PR, read by the viewer at minute 20; a bot commented at minute 30.
const botComment = makeComment({ id: 'c-bot', author: 'github-actions[bot]', body: 'Bundle size: +2 kB', createdAt: at(30) });

function alicePr(overrides: Partial<Pr> & { number?: number } = {}): Pr {
  return makePr({ number: 5, author: 'alice', title: 'Speed up the test shards', updatedAt: at(30), comments: [botComment], ...overrides });
}

function threadFor(pr: Pr) {
  return makeThreadFor(pr, { reason: 'subscribed', lastReadAt: at(20), updatedAt: at(30), unread: true });
}

async function synced(pr: Pr, options: HarnessOptions = {}): Promise<Harness> {
  const h = makeHarness(options);
  h.reader.addPr(pr, threadFor(pr));
  await h.engine.sync({ maxAgentCalls: 0 });
  return h;
}

function quietRows(h: Harness) {
  return h.store.actionLog.listRecent(50).filter((entry) => entry.origin === 'quiet');
}

describe('Handled quietly: the full sync marks bot-only threads read', () => {
  it('marks the thread read on GitHub when only bots acted since the last read, logged with origin quiet', async () => {
    const pr = alicePr();
    const h = await synced(pr);

    expect(h.writer.calls).toEqual([`markThreadRead ${threadFor(pr).id}`]);
    expect(quietRows(h)).toEqual([
      expect.objectContaining({
        action: 'mark_read',
        outcome: 'github',
        threadId: threadFor(pr).id,
        prKey: pr.key,
        detail: 'only bot activity since your last read: github-actions[bot]',
      }),
    ]);
    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.unread).toBe(false);
    expect(h.store.pendingWrites.list()).toEqual([]);
  });

  it('lists it under Handled quietly with the title and the bots', async () => {
    const pr = alicePr();
    const h = await synced(pr);

    expect(await h.engine.handledQuietly()).toEqual([
      expect.objectContaining({
        prKey: pr.key,
        repo: 'acme/app',
        number: 5,
        title: 'Speed up the test shards',
        bots: ['github-actions[bot]'],
        threadId: threadFor(pr).id,
      }),
    ]);
  });

  it('shows the quiet mark-read as the thread last action in the debug view', async () => {
    const pr = alicePr();
    const h = await synced(pr);

    const row = (await h.engine.debugNotifications(10)).find((candidate) => candidate.prKey === pr.key);
    expect(row?.lastAction).toMatchObject({ origin: 'quiet', outcome: 'github' });
  });

  it('does nothing while GitHub writes are locked, and nothing piles up as a pending write', async () => {
    const h = await synced(alicePr(), { writesEnabled: false });

    expect(h.writer.calls).toEqual([]);
    expect(quietRows(h)).toEqual([]);
    expect(h.store.pendingWrites.list()).toEqual([]);
  });

  it('leaves the viewer own PR alone: bot reviews there can mean work', async () => {
    const h = await synced(alicePr({ author: viewer.login }));

    expect(h.writer.calls).toEqual([]);
    expect(quietRows(h)).toEqual([]);
  });

  it('leaves a PR whose snapshot was cut off after the last read: a human reply may be past the caps', async () => {
    // 60 bot comments after the read at minute 20 fill the comment cap: an older reply may have fallen off.
    const flood = Array.from({ length: 60 }, (_, index) => makeComment({ id: `c-bot-${index}`, author: 'github-actions[bot]', body: 'Bundle size: +2 kB', createdAt: at(25) }));
    const h = await synced(alicePr({ truncated: true, capHits: [{ list: 'comments', nodes: 60, oldestAt: at(25) }], comments: flood }));

    expect(h.writer.calls).toEqual([]);
    expect(quietRows(h)).toEqual([]);
  });

  it('trusts a snapshot cut off only before the last read', async () => {
    // Everything that fell off the 60-comment cap is older than the read at minute 20.
    const older = Array.from({ length: 59 }, (_, index) => makeComment({ id: `c-old-${index}`, author: 'rowan', body: 'noted', createdAt: at(10) }));
    const pr = alicePr({ truncated: true, capHits: [{ list: 'comments', nodes: 60, oldestAt: at(10) }], comments: [...older, botComment] });
    const h = await synced(pr);

    expect(h.writer.calls).toEqual([`markThreadRead ${threadFor(pr).id}`]);
  });

  it('leaves it when a person commented after the last read', async () => {
    const human = makeComment({ id: 'c-human', author: 'rowan', body: 'Should we keep the old shard count?', createdAt: at(32) });
    const h = await synced(alicePr({ comments: [botComment, human], updatedAt: at(32) }));

    expect(h.writer.calls).toEqual([]);
  });

  it('leaves a merge without the viewer review unseen, even when a bot merged it', async () => {
    const merged = alicePr({
      state: 'MERGED',
      mergedAt: at(31),
      mergedBy: 'trunk-io[bot]',
      reviewerUsers: [viewer.login],
      timeline: [
        makeTimelineItem({ id: 't-ask', kind: 'review_requested', actor: 'alice', subject: viewer.login, at: at(1) }),
        makeTimelineItem({ id: 't-merge', kind: 'merged', actor: 'trunk-io[bot]', subject: null, at: at(31) }),
      ],
      updatedAt: at(31),
    });
    const h = await synced(merged);

    expect(h.store.events.listForPr(merged.key).some((event) => event.kind === 'merged_without_review')).toBe(true);
    expect(h.writer.calls).toEqual([]);
  });

  it('leaves it while the tile is unread', async () => {
    const pr = alicePr();
    const h = await synced(pr, { writesEnabled: false });
    const botEvent = h.store.events.listForPr(pr.key).find((event) => event.isBot);
    h.store.events.setOverride(botEvent!.id, { loudness: 'loud', reason: 'the agent raised it', by: 'agent' });
    await h.engine.setGitHubWrites(true);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual([]);
  });

  it('waits the grace period after the newest bot activity, then marks it on a later sync', async () => {
    let now = new Date(new Date(at(30)).getTime() + 5 * 60_000);
    const pr = alicePr();
    const h = await synced(pr, { now: () => now });
    expect(h.writer.calls).toEqual([]);

    now = new Date(new Date(at(30)).getTime() + 11 * 60_000);
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual([`markThreadRead ${threadFor(pr).id}`]);
  });

  // Codex review on PR #5: a sync refreshes every thread but may leave a PR's snapshot stale.
  describe('only with a PR snapshot at least as fresh as the thread', () => {
    const humanReply = makeComment({ id: 'c-human', author: 'rowan', body: 'Why did the shard count change?', createdAt: at(45) });

    /** Synced (locked) at minute 40 with only the bot comment; then rowan replies at 45 and GitHub moves the thread. */
    async function staleAfterReply(overrides: Partial<Pr> = {}): Promise<{ h: Harness; pr: Pr; setNow: (minute: number) => void }> {
      let now = new Date(at(40));
      const pr = alicePr(overrides);
      const h = await synced(pr, { writesEnabled: false, now: () => now });
      const replied = { ...pr, comments: [botComment, humanReply], updatedAt: at(45) };
      h.reader.addPr(replied, { ...threadFor(pr), updatedAt: at(45) });
      h.reader.etag = 'etag-2';
      await h.engine.setGitHubWrites(true);
      return { h, pr, setNow: (minute) => (now = new Date(at(minute))) };
    }

    it('leaves the thread when the PR fetch failed: the stored events miss the human reply', async () => {
      const { h, pr, setNow } = await staleAfterReply();
      h.reader.failingPrs.add(pr.key);
      setNow(70);

      await h.engine.sync({ maxAgentCalls: 0 });

      // The thread is fresh, the snapshot is not: without the check the stored bot-only events would pass.
      expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.updatedAt).toBe(at(45));
      expect(h.store.events.listForPr(pr.key).some((event) => event.actor === 'rowan')).toBe(false);
      expect(h.writer.calls).toEqual([]);
    });

    it('leaves the thread when the sync left the PR out at its cap', async () => {
      // Merged two days before the sync, so the freshness check (open PRs, merges of the last day) skips it too.
      const merged = { state: 'MERGED' as const, mergedAt: at(10), timeline: [makeTimelineItem({ id: 't-merge', kind: 'merged', actor: 'alice', subject: null, at: at(10) })] };
      const { h, pr, setNow } = await staleAfterReply(merged);
      const other = makePr({ number: 6, author: 'alice', updatedAt: at(50) });
      h.reader.addPr(other, makeThreadFor(other, { reason: 'subscribed', updatedAt: at(50) }));
      setNow(40 + 2 * 24 * 60);

      await h.engine.sync({ maxAgentCalls: 0, maxPrs: 1 });

      expect(h.reader.fetchedRefs.flat().filter((ref) => ref.number === pr.ref.number)).toHaveLength(1);
      expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.updatedAt).toBe(at(45));
      expect(h.writer.calls).toEqual([]);
    });

    it('still marks a PR whose snapshot is fresh, and leaves it once the human reply is fetched', async () => {
      const { h, pr, setNow } = await staleAfterReply();
      setNow(70);

      await h.engine.sync({ maxAgentCalls: 0 });

      expect(h.store.events.listForPr(pr.key).some((event) => event.actor === 'rowan')).toBe(true);
      expect(h.writer.calls).toEqual([]);

      const fresh = alicePr({ number: 8 });
      const h2 = await synced(fresh);
      expect(h2.writer.calls).toEqual([`markThreadRead ${threadFor(fresh).id}`]);
    });
  });

  it('leaves a thread that moved on GitHub since the sync for the next one', async () => {
    const pr = alicePr();
    const h = makeHarness({ writesEnabled: false });
    h.reader.addPr(pr, threadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setGitHubWrites(true);
    // GitHub has a newer update than the stored thread, but the stored ETag still answers 304.
    h.reader.threads = [{ ...threadFor(pr), updatedAt: at(45) }];

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual([]);
  });
});

// "You already dealt with it": alice asked the viewer at minute 1 and marked the PR ready at 10; the viewer approved from the gh CLI at 30.
describe('Handled quietly: the full sync marks threads read the viewer acted on after every unread event', () => {
  function approvedFromTheCli(overrides: Partial<Pr> = {}): Pr {
    return makePr({
      number: 9,
      author: 'alice',
      title: 'Split the deploy job',
      timeline: [
        makeTimelineItem({ id: 't-ask', kind: 'review_requested', actor: 'alice', subject: viewer.login, at: at(1) }),
        makeTimelineItem({ id: 't-ready', kind: 'ready_for_review', actor: 'alice', subject: null, at: at(10) }),
      ],
      reviews: [makeReview({ id: 'r-me', author: viewer.login, state: 'APPROVED', submittedAt: at(30) })],
      updatedAt: at(30),
      ...overrides,
    });
  }

  async function syncedNeverRead(pr: Pr, options: HarnessOptions = {}): Promise<Harness> {
    const h = makeHarness(options);
    h.reader.addPr(pr, makeThreadFor(pr, { lastReadAt: null, updatedAt: pr.updatedAt, unread: true }));
    await h.engine.sync({ maxAgentCalls: 0 });
    return h;
  }

  it('marks the thread read with the reason in the log detail, listed under Handled quietly', async () => {
    const pr = approvedFromTheCli();
    const h = await syncedNeverRead(pr);

    expect(h.writer.calls).toEqual([`markThreadRead thread-9`]);
    expect(quietRows(h)).toEqual([expect.objectContaining({ outcome: 'github', prKey: pr.key, detail: 'you approved after it' })]);
    expect(await h.engine.handledQuietly()).toEqual([expect.objectContaining({ prKey: pr.key, reason: 'approved', bots: [] })]);
    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.unread).toBe(false);
  });

  it('does nothing while GitHub writes are locked', async () => {
    const h = await syncedNeverRead(approvedFromTheCli(), { writesEnabled: false });

    expect(h.writer.calls).toEqual([]);
    expect(quietRows(h)).toEqual([]);
    expect(h.store.pendingWrites.list()).toEqual([]);
  });

  it('includes the viewer own PR when they replied after the review comments', async () => {
    const review = makeComment({ id: 'c-rowan', author: 'rowan', body: 'Rename this?', createdAt: at(10) });
    const reply = makeComment({ id: 'c-me', author: viewer.login, body: 'Done in the next commit', createdAt: at(30) });
    const pr = makePr({ number: 9, author: viewer.login, comments: [review, reply], updatedAt: at(30) });
    const h = await syncedNeverRead(pr);

    expect(quietRows(h)).toEqual([expect.objectContaining({ prKey: pr.key, detail: 'you replied after it' })]);
  });

  it('never counts a push as having read the comments', async () => {
    const review = makeComment({ id: 'c-rowan', author: 'rowan', body: 'Rename this?', createdAt: at(10) });
    const pr = makePr({
      number: 9,
      author: viewer.login,
      comments: [review],
      commits: [makeCommit({ oid: 'c2', author: viewer.login, committedAt: at(30) })],
      headOid: 'c2',
      updatedAt: at(30),
    });
    const h = await syncedNeverRead(pr);

    expect(h.writer.calls).toEqual([]);
  });

  it('leaves it when someone acted after the approval', async () => {
    const late = makeComment({ id: 'c-late', author: 'rowan', body: 'Merging after lunch', createdAt: at(40) });
    const h = await syncedNeverRead(approvedFromTheCli({ comments: [late], updatedAt: at(40) }));

    expect(h.writer.calls).toEqual([]);
  });

  it('leaves it when the PR snapshot is older than the thread', async () => {
    const pr = approvedFromTheCli();
    const h = await syncedNeverRead(pr, { writesEnabled: false });
    await h.engine.setGitHubWrites(true);
    h.reader.failingPrs.add(pr.key);
    h.reader.addPr(pr, makeThreadFor(pr, { lastReadAt: null, updatedAt: '2026-09-02T12:30:00.000Z', unread: true }));
    h.reader.etag = 'etag-2';

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual([]);
  });
});
