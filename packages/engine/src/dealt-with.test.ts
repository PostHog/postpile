import type { Pr } from '@postpile/core';
import { at, makeComment, makePr, makeReview, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

// NOW is 2026-09-02T12:00Z. The fixture `at` counts minutes from 2026-09-01T09:00Z.
const READY_AT = '2026-09-02T11:40:00.000Z';
const APPROVED_AT = '2026-09-02T11:45:00.000Z';

function tileState(h: Harness, topicId: string) {
  return h.engine.getTopic(topicId).then((detail) => detail?.tiles[0]?.state.kind);
}

/**
 * The tile has unseen loud news. The touch rule is about seen and loud;
 * whether the tile is unread follows its GitHub thread (DESIGN.md "GitHub
 * unread is PostPile unread"), and with writes locked the thread stays unread.
 */
function tileLoud(h: Harness, topicId: string) {
  return h.engine.getTopic(topicId).then((detail) => detail?.tiles[0]?.state.loud);
}

/** alice marked her PR ready for review, then the viewer approved it from the gh CLI: GitHub keeps the thread unread. */
function approvedFromTheCli(pr: Pr): Pr {
  return {
    ...pr,
    updatedAt: APPROVED_AT,
    timeline: [...pr.timeline, makeTimelineItem({ id: 'ready-1', kind: 'ready_for_review', actor: 'alice', subject: null, at: READY_AT })],
    reviews: [makeReview({ id: 'r-me', author: viewer.login, state: 'APPROVED', submittedAt: APPROVED_AT, commitOid: pr.headOid })],
  };
}

describe('You already dealt with it: events before the viewer last touch count as seen', () => {
  it('makes the tile calm after an approval from the CLI, the earlier ready for review seen at the approval time', async () => {
    const h = makeHarness({ writesEnabled: false });
    const pr = approvedFromTheCli(reviewRequestedPr(1));
    topicWithPrs(h, 't', [pr]);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(await tileLoud(h, 't')).toBe(false);
    const ready = h.store.events.listForPr(pr.key).find((event) => event.kind === 'ready_for_review');
    expect(ready?.ruleLoudness).toBe('loud');
    expect(ready?.seenAt).toBe(APPROVED_AT);
    // The tile rule alone never writes to GitHub; locked, the thread and so the tile stay unread, without loud news.
    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.unread).toBe(true);
    expect(await tileState(h, 't')).toBe('unread');
  });

  it('never pings for what came before the touch when the poll brings both', async () => {
    let clock = new Date('2026-09-02T11:30:00.000Z');
    const h = makeHarness({ writesEnabled: false, now: () => clock });
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.pollOnce();
    clock = new Date('2026-09-02T11:50:00.000Z');

    const approved = approvedFromTheCli(pr);
    h.reader.addPr(approved, makeThreadFor(approved, { updatedAt: APPROVED_AT }));
    h.reader.etag = 'etag-2';
    const cycle = await h.engine.pollOnce();

    expect(cycle).toMatchObject({ kind: 'done', prsUpdated: 1, pings: [] });
    expect(await tileLoud(h, 't')).toBe(false);
  });

  it('keeps a loud event after the touch unseen', async () => {
    const h = makeHarness({ writesEnabled: false });
    const early = approvedFromTheCli(reviewRequestedPr(1));
    const pr: Pr = {
      ...early,
      timeline: [...early.timeline, makeTimelineItem({ id: 'rr-again', kind: 'review_requested', actor: 'alice', subject: viewer.login, at: '2026-09-02T11:50:00.000Z' })],
      updatedAt: '2026-09-02T11:50:00.000Z',
    };
    topicWithPrs(h, 't', [pr]);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(await tileLoud(h, 't')).toBe(true);
    const again = h.store.events.listForPr(pr.key).find((event) => event.sourceId === 'rr-again');
    expect(again?.seenAt).toBeNull();
  });

  it('counts a push on the viewer own PR for the tile', async () => {
    const h = makeHarness({ writesEnabled: false });
    const pr = reviewRequestedPr(1, {
      author: viewer.login,
      timeline: [],
      reviews: [makeReview({ id: 'r-rowan', author: 'rowan', state: 'CHANGES_REQUESTED', submittedAt: at(10) })],
      commits: [{ oid: 'c2', headline: 'address the review', author: viewer.login, committer: viewer.login, committedAt: at(30) }],
      headOid: 'c2',
      updatedAt: at(30),
    });
    topicWithPrs(h, 't', [pr]);

    await h.engine.sync({ maxAgentCalls: 0 });

    const review = h.store.events.listForPr(pr.key).find((event) => event.kind === 'review_changes_requested');
    expect(review?.seenAt).toBe(at(30));
    expect(await tileLoud(h, 't')).toBe(false);
  });

  it('does not count the viewer commit that a collaborator cherry-picked onto their PR', async () => {
    const h = makeHarness({ writesEnabled: false });
    const pr = reviewRequestedPr(1, {
      author: viewer.login,
      timeline: [],
      reviews: [makeReview({ id: 'r-rowan', author: 'rowan', state: 'CHANGES_REQUESTED', submittedAt: at(10) })],
      commits: [{ oid: 'c2', headline: 'address the review', author: viewer.login, committer: 'rowan', committedAt: at(30) }],
      headOid: 'c2',
      updatedAt: at(30),
    });
    topicWithPrs(h, 't', [pr]);

    await h.engine.sync({ maxAgentCalls: 0 });

    const review = h.store.events.listForPr(pr.key).find((event) => event.kind === 'review_changes_requested');
    expect(review?.seenAt).toBeNull();
    expect(await tileLoud(h, 't')).toBe(true);
  });

  it('counts a force push by the viewer on their own PR', async () => {
    const h = makeHarness({ writesEnabled: false });
    const pr = reviewRequestedPr(1, {
      author: viewer.login,
      timeline: [makeTimelineItem({ id: 'fp-1', kind: 'head_ref_force_pushed', actor: viewer.login, subject: null, at: at(30) })],
      reviews: [makeReview({ id: 'r-rowan', author: 'rowan', state: 'CHANGES_REQUESTED', submittedAt: at(10) })],
      updatedAt: at(30),
    });
    topicWithPrs(h, 't', [pr]);

    await h.engine.sync({ maxAgentCalls: 0 });

    const review = h.store.events.listForPr(pr.key).find((event) => event.kind === 'review_changes_requested');
    expect(review?.seenAt).toBe(at(30));
  });

  it('also applies to events stored before the rule, on the next full sync', async () => {
    const h = makeHarness({ writesEnabled: false });
    const pr = approvedFromTheCli(reviewRequestedPr(1));
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    // As an older build left it: the ready for review stored unseen.
    const ready = h.store.events.listForPr(pr.key).find((event) => event.kind === 'ready_for_review')!;
    h.store.events.clearSeen([ready.id]);
    expect(await tileLoud(h, 't')).toBe(true);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.events.listForPr(pr.key).find((event) => event.id === ready.id)?.seenAt).toBe(APPROVED_AT);
  });
});

describe('You already dealt with it: opening a PR in PostPile marks its thread read when nothing is asked', () => {
  /** alice's PR the viewer follows: rowan commented, nothing asks the viewer anything. */
  function followedPr(): Pr {
    return makePr({ number: 3, comments: [makeComment({ id: 'c-rowan', author: 'rowan', body: 'Nice cleanup', createdAt: at(10) })], updatedAt: at(10) });
  }

  function openedRows(h: Harness) {
    return h.store.actionLog.listRecent(50).filter((entry) => entry.origin === 'quiet' && entry.detail === 'opened in PostPile');
  }

  async function syncedTopic(pr: Pr, writesEnabled = true): Promise<Harness> {
    const h = makeHarness({ writesEnabled: false });
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    if (writesEnabled) {
      await h.engine.setGitHubWrites(true);
    }
    return h;
  }

  it('marks the thread read once, logged as opened in PostPile and listed under Handled quietly', async () => {
    const pr = followedPr();
    const h = await syncedTopic(pr);

    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: true });
    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: false });

    expect(h.writer.calls).toEqual(['markThreadRead thread-3']);
    expect(openedRows(h)).toEqual([expect.objectContaining({ action: 'mark_read', outcome: 'github', prKey: pr.key })]);
    expect(await h.engine.handledQuietly()).toEqual([expect.objectContaining({ prKey: pr.key, reason: 'opened' })]);
    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.unread).toBe(false);
    expect(h.store.events.listForPr(pr.key).every((event) => event.seenAt !== null)).toBe(true);
  });

  it('handles the PR in PostPile too, so the tile turns done', async () => {
    const pr = followedPr();
    const h = await syncedTopic(pr);

    await h.engine.markOpenedRead(pr.key);

    expect(h.store.userPrStates.get(pr.key)?.handledAt).not.toBeNull();
    expect(await tileState(h, 't')).toBe('done');
  });

  it('only handles the PR here when GitHub has its thread read already', async () => {
    const pr = followedPr();
    const h = makeHarness({ writesEnabled: false });
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setGitHubWrites(true);
    const thread = h.store.notifications.getByPrKeys([pr.key]).get(pr.key)!;
    h.store.notifications.markRead(thread.id, thread.updatedAt);
    expect(await tileState(h, 't')).not.toBe('done');

    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: true });

    expect(h.writer.calls).toEqual([]);
    expect(await tileState(h, 't')).toBe('done');
    const rows = h.store.actionLog.listRecent(10).filter((entry) => entry.origin === 'quiet' && entry.prKey === pr.key);
    expect(rows).toEqual([expect.objectContaining({ action: 'mark_read', outcome: 'local' })]);
    // Nothing reached GitHub, so nothing to list under Handled quietly.
    expect(await h.engine.handledQuietly()).toEqual([]);
  });

  it('does nothing while GitHub writes are locked, not even a pending write', async () => {
    const pr = followedPr();
    const h = await syncedTopic(pr, false);

    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: false });

    expect(h.writer.calls).toEqual([]);
    expect(h.store.pendingWrites.list()).toEqual([]);
    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.unread).toBe(true);
  });

  it('never marks a tile that stays your move', async () => {
    const pr = reviewRequestedPr(4, { reviewerUsers: [viewer.login] });
    const h = await syncedTopic(pr);

    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: false });
    expect(h.writer.calls).toEqual([]);
    expect(h.store.userPrStates.get(pr.key)?.handledAt ?? null).toBeNull();
  });

  /** The opened-read verdict on the PR's row, as the detail pane reads it. */
  async function rowVerdict(h: Harness, prKey: string) {
    const detail = await h.engine.getTopic('t');
    return detail?.tiles.flatMap((view) => view.prs).find((row) => row.key === prKey)?.openedRead;
  }

  it('marks a fresh truncated snapshot when no list hit our caps (only GitHub counted more)', async () => {
    const pr = { ...followedPr(), truncated: true, capHits: [] };
    const h = await syncedTopic(pr);
    expect(await rowVerdict(h, pr.key)).toEqual({ kind: 'mark' });

    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: true });

    expect(h.writer.calls).toEqual(['markThreadRead thread-3']);
  });

  it('skips a fresh snapshot our caps cut inside the unread interval: the detail pane missed it too', async () => {
    const pr = { ...followedPr(), truncated: true, capHits: [{ list: 'comments' as const, nodes: 100, oldestAt: at(10) }] };
    const h = await syncedTopic(pr);
    expect(await rowVerdict(h, pr.key)).toEqual({ kind: 'skip', why: 'stale_snapshot' });

    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: false });

    expect(h.writer.calls).toEqual([]);
  });

  it('skips a stale snapshot, logs why, and the row says so before anyone asks', async () => {
    const lines: string[] = [];
    const pr = followedPr();
    const h = makeHarness({ writesEnabled: false, syncLog: (line) => lines.push(line) });
    topicWithPrs(h, 't', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setGitHubWrites(true);
    // The thread moved after the snapshot was fetched (NOW): the user has not seen the newest activity.
    const thread = h.store.notifications.getByPrKeys([pr.key]).get(pr.key)!;
    h.store.notifications.upsertMany([{ ...thread, updatedAt: '2026-09-02T12:30:00.000Z' }]);
    expect(await rowVerdict(h, pr.key)).toEqual({ kind: 'skip', why: 'stale_snapshot' });

    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: false });

    expect(h.writer.calls).toEqual([]);
    expect(lines.filter((line) => line.startsWith('opened read of'))).toEqual([
      `opened read of ${pr.key} skipped: stale_snapshot (snapshot fetched 2026-09-02T12:00:00.000Z, thread updated 2026-09-02T12:30:00.000Z)`,
    ]);
  });

  it('never marks a snoozed tile', async () => {
    const pr = followedPr();
    const h = await syncedTopic(pr);
    await h.engine.snooze(`pr:${pr.key}`, { kind: 'until_time', until: '2099-01-01T00:00:00.000Z' });

    expect(await h.engine.markOpenedRead(pr.key)).toEqual({ marked: false });
    expect(h.writer.calls).toEqual([]);
  });
});
