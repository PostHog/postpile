import type { Pr } from '@postpile/core';
import { at, makeComment, makePr, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness, type HarnessOptions } from './testing/fakes.ts';

// alice's PR, read by the viewer at minute 20; a bot commented at minute 30.
const botComment = makeComment({ id: 'c-bot', author: 'github-actions[bot]', body: 'Bundle size: +2 kB', createdAt: at(30) });

function alicePr(overrides: Partial<Pr> = {}): Pr {
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
