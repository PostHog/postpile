// GitHub unread is PostPile unread (DESIGN.md, 2026-09-30): every thread
// unread on GitHub ends one of two ways, cleared by PostPile because it is
// obviously clearable, or unread in PostPile. The shapes of the 155-thread
// case that started it, end to end through sync and the quiet reads.
import type { NotificationThread } from '@postpile/core';
import { at, makeComment, makePr, makeReview, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { readThreadsOnGitHub, topicWithPrs } from './testing/topics.ts';

const TEAM = 'acme/team-platform';

function tileOf(h: Harness, topicId: string) {
  return h.engine.getTopic(topicId).then((detail) => detail?.tiles[0]);
}

function markReadCalls(h: Harness): string[] {
  return h.writer.calls.filter((call) => call.startsWith('markThreadRead'));
}


describe('GitHub unread is PostPile unread', () => {
  it("keeps a PR requested of the viewer's team unread after a teammate approved it and it merged, when the viewer never looked", async () => {
    const h = makeHarness();
    h.reader.teams.set(TEAM, ['lyra']);
    const pr = makePr({
      number: 11,
      state: 'MERGED',
      mergedAt: at(40),
      mergedBy: 'alice',
      timeline: [
        makeTimelineItem({ id: 'rr-team', kind: 'review_requested', actor: 'alice', subject: TEAM, at: at(1) }),
        makeTimelineItem({ id: 'merged', kind: 'merged', actor: 'alice', subject: null, at: at(40) }),
      ],
      reviews: [makeReview({ id: 'r-lyra', author: 'lyra', state: 'APPROVED', submittedAt: at(30) })],
      updatedAt: at(40),
    });
    topicWithPrs(h, 'team', [pr]);
    h.reader.addPr(pr, makeThreadFor(pr, { reason: 'review_requested', updatedAt: at(40) }));

    await h.engine.sync({ agentJobs: ['events'] });

    expect(markReadCalls(h)).toEqual([]);
    expect((await tileOf(h, 'team'))?.state.kind).toBe('unread');
    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.unread).toBe(true);
  });

  it('marks a release notification read on GitHub by itself and shows nothing for it', async () => {
    const h = makeHarness();
    const release: NotificationThread = {
      id: 'thread-release',
      reason: 'subscribed',
      unread: true,
      updatedAt: at(10),
      lastReadAt: null,
      subjectType: 'Release',
      repo: 'acme/web-sdk',
      number: null,
      title: 'web-sdk 1.260.0',
    };
    h.reader.threads = [release];

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(markReadCalls(h)).toEqual(['markThreadRead thread-release']);
    expect(h.store.actionLog.listRecent(1)[0]).toMatchObject({ origin: 'quiet', outcome: 'github', prKey: null, threadId: 'thread-release', detail: 'not a pull request' });
    expect(h.store.notifications.get('thread-release')?.unread).toBe(false);
    expect(await h.engine.handledQuietly()).toEqual([]);
    expect(await h.engine.listTopics()).toEqual([]);
  });

  it('leaves a release unread while GitHub writes are locked', async () => {
    const h = makeHarness({ writesEnabled: false });
    h.reader.threads = [{ ...makeThreadFor(makePr({ number: 90 }), { updatedAt: at(10) }), subjectType: 'Issue' }];

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.writer.calls).toEqual([]);
    expect(h.store.pendingWrites.list()).toEqual([]);
  });

  it('shows a done PR unread again when a person flags its thread, until it is read', async () => {
    let clock = new Date('2026-09-02T12:00:00.000Z');
    const h = makeHarness({ writesEnabled: false, now: () => clock });
    const pr = makePr({ number: 14, reviews: [makeReview({ id: 'r-me', author: viewer.login, state: 'APPROVED', submittedAt: at(10), commitOid: 'head' })], updatedAt: at(10) });
    topicWithPrs(h, 'approved', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    readThreadsOnGitHub(h, [pr]);
    expect((await tileOf(h, 'approved'))?.state.kind).toBe('done');

    // A person comments after the approval: GitHub flags the thread unread again.
    clock = new Date('2026-09-02T12:30:00.000Z');
    const flagged = { ...pr, comments: [makeComment({ id: 'c-ada', author: 'ada', body: 'merging this tomorrow', createdAt: '2026-09-02T12:20:00.000Z' })], updatedAt: '2026-09-02T12:20:00.000Z' };
    h.reader.addPr(flagged, makeThreadFor(flagged, { lastReadAt: at(10), updatedAt: '2026-09-02T12:20:00.000Z' }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    const view = await tileOf(h, 'approved');
    expect(view?.prs[0]?.done).toBe(true);
    expect(view?.state).toMatchObject({ kind: 'unread', loud: false });
    expect(view?.offers.footer).toBe('mark_read');

    await h.engine.setGitHubWrites(true);
    await h.engine.markRead(`pr:${pr.key}`);
    // The click reads the thread here right away; GitHub follows after the undo window.
    expect((await tileOf(h, 'approved'))?.state.kind).toBe('done');
  });

  it('puts the thread back unread when a Mark read is undone', async () => {
    const h = makeHarness();
    const pr = makePr({ number: 15, comments: [makeComment({ id: 'c-ada', author: 'ada', body: 'ping', createdAt: at(30) })], updatedAt: at(30) });
    topicWithPrs(h, 'undo', [pr]);
    h.reader.addPr(pr, makeThreadFor(pr, { reason: 'subscribed', updatedAt: at(30) }));
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await tileOf(h, 'undo'))?.state.kind).toBe('unread');

    const marked = await h.engine.markRead(`pr:${pr.key}`);
    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.unread).toBe(false);
    await h.engine.undo(marked.undoToken);

    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)).toMatchObject({ unread: true, lastReadAt: null });
    expect((await tileOf(h, 'undo'))?.state.kind).toBe('unread');
    expect(h.writer.calls).toEqual([]);
  });
});
