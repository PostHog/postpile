import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import { at, makeCommit, makeComment, makeEvent, makePr, makeReview, makeTimelineItem, viewer } from './fixtures.ts';
import { eventsSeenByTouch, lastTouch, READING_TOUCH_KINDS, touchKindOf } from './last-touch.ts';
import { isUnseenLoud } from './loudness.ts';
import type { Pr, PrEvent } from './types.ts';

const me = viewer.login;

function own(kind: PrEvent['kind'], minutes: number): PrEvent {
  return makeEvent({ id: `own-${kind}-${minutes}`, kind, actor: me, at: at(minutes) });
}

function seenWhere(events: PrEvent[], ids: string[], seenAt: string): PrEvent[] {
  return events.map((event) => (ids.includes(event.id) ? { ...event, seenAt } : event));
}

describe('touchKindOf', () => {
  const alicePr = makePr();
  // Own events carry sourceId c1 (makeEvent): the viewer committed c1 on their own PR.
  const ownPr = makePr({ author: me, commits: [makeCommit({ oid: 'c1', author: me })] });

  it('names reviews, comments, merges and closes by the viewer', () => {
    expect(touchKindOf(own('review_approved', 0), alicePr, viewer)).toBe('approval');
    expect(touchKindOf(own('review_changes_requested', 0), alicePr, viewer)).toBe('changes_request');
    expect(touchKindOf(own('review_commented', 0), alicePr, viewer)).toBe('review');
    expect(touchKindOf(own('comment', 0), alicePr, viewer)).toBe('comment');
    expect(touchKindOf(own('merged', 0), alicePr, viewer)).toBe('merge');
    expect(touchKindOf(own('merged_without_review', 0), alicePr, viewer)).toBe('merge');
    expect(touchKindOf(own('closed', 0), alicePr, viewer)).toBe('close');
  });

  it('counts a push only on the viewer own PR', () => {
    expect(touchKindOf(own('commits_pushed', 0), ownPr, viewer)).toBe('push');
    expect(touchKindOf(own('force_pushed', 0), ownPr, viewer)).toBe('push');
    expect(touchKindOf(own('commits_pushed', 0), { ...alicePr, commits: ownPr.commits }, viewer)).toBeNull();
  });

  it('needs evidence the viewer pushed, not just that they wrote the commit', () => {
    const withCommit = (committer: string | undefined) => ({ ...ownPr, commits: [{ ...makeCommit({ oid: 'c1', author: me }), committer }] });
    // A collaborator cherry-picked or rebased the viewer's commit onto the PR.
    expect(touchKindOf(own('commits_pushed', 0), withCommit('rowan'), viewer)).toBeNull();
    expect(touchKindOf(own('commits_pushed', 0), withCommit('renovate[bot]'), viewer)).toBeNull();
    // The viewer clicked a suggestion or "Update branch" in the web UI.
    expect(touchKindOf(own('commits_pushed', 0), withCommit('web-flow'), viewer)).toBe('push');
    // A snapshot stored before the committer was fetched.
    expect(touchKindOf(own('commits_pushed', 0), withCommit(undefined), viewer)).toBeNull();
    // The viewer committed someone else's commit (their own cherry-pick).
    const picked = makeEvent({ id: 'picked', kind: 'commits_pushed', actor: 'rowan', sourceId: 'c1' });
    expect(touchKindOf(picked, { ...ownPr, commits: [{ ...makeCommit({ oid: 'c1', author: 'rowan' }), committer: me }] }, viewer)).toBe('push');
    // A force push by someone else is not the viewer's.
    expect(touchKindOf(makeEvent({ kind: 'force_pushed', actor: 'rowan' }), ownPr, viewer)).toBeNull();
  });

  it('is null for other people, CI and own events that are not a touch', () => {
    expect(touchKindOf(makeEvent({ kind: 'review_approved', actor: 'rowan' }), alicePr, viewer)).toBeNull();
    expect(touchKindOf(makeEvent({ kind: 'ci', actor: '', isBot: true }), alicePr, viewer)).toBeNull();
    expect(touchKindOf(own('review_requested', 0), alicePr, viewer)).toBeNull();
  });
});

describe('lastTouch', () => {
  const pr = makePr({ author: me, commits: [makeCommit({ oid: 'c1', author: me })] });

  it('takes the newest touch, or the newest before a time', () => {
    const events = [own('comment', 0), own('commits_pushed', 30)];
    expect(lastTouch(pr, events, viewer)).toEqual({ kind: 'push', at: at(30) });
    expect(lastTouch(pr, events, viewer, { before: at(30) })).toEqual({ kind: 'comment', at: at(0) });
  });

  it('leaves out pushes for the reading touches (a push does not mean the comments were read)', () => {
    const events = [own('comment', 0), own('commits_pushed', 30)];
    expect(lastTouch(pr, events, viewer, { kinds: READING_TOUCH_KINDS })).toEqual({ kind: 'comment', at: at(0) });
    expect(lastTouch(pr, [own('commits_pushed', 30), own('merged', 40)], viewer, { kinds: READING_TOUCH_KINDS })).toBeNull();
  });
});

describe('eventsSeenByTouch', () => {
  // The real case behind the rule: a loud "ready for review" stayed unread for days after an approval from the gh CLI.
  function approvedFromTheCli(): Pr {
    return makePr({
      number: 7,
      author: 'alice',
      reviewerUsers: [],
      timeline: [
        makeTimelineItem({ id: 't-ask', kind: 'review_requested', actor: 'alice', subject: me, at: at(0) }),
        makeTimelineItem({ id: 't-ready', kind: 'ready_for_review', actor: 'alice', subject: null, at: at(60) }),
      ],
      reviews: [makeReview({ id: 'r-me', author: me, state: 'APPROVED', submittedAt: at(4 * 24 * 60) })],
    });
  }

  it('marks a loud ready for review before the viewer approval as seen, stamped with the approval', () => {
    const pr = approvedFromTheCli();
    const events = deriveEvents(pr, viewer, null);
    const ready = events.find((event) => event.kind === 'ready_for_review')!;
    expect(isUnseenLoud(ready)).toBe(true);

    const seen = eventsSeenByTouch(pr, events, viewer);

    expect(seen.touch).toEqual({ kind: 'approval', at: at(4 * 24 * 60) });
    expect(seen.ids).toContain(ready.id);
    expect(seenWhere(events, seen.ids, seen.touch!.at).some(isUnseenLoud)).toBe(false);
  });

  it('keeps what came after the touch unseen', () => {
    const pr = makePr({
      reviews: [makeReview({ id: 'r-me', author: me, state: 'APPROVED', submittedAt: at(10) })],
      comments: [makeComment({ id: 'c-late', author: 'alice', body: `@${me} one more look?`, createdAt: at(20) })],
    });
    const events = deriveEvents(pr, viewer, null);

    const seen = eventsSeenByTouch(pr, events, viewer);

    const mention = events.find((event) => event.kind === 'question_to_user')!;
    expect(seen.ids).not.toContain(mention.id);
    expect(isUnseenLoud(mention)).toBe(true);
  });

  it('counts a push on the viewer own PR: review comments before it are seen', () => {
    const pr = makePr({
      author: me,
      reviews: [makeReview({ id: 'r-rowan', author: 'rowan', state: 'CHANGES_REQUESTED', submittedAt: at(10) })],
      commits: [makeCommit({ oid: 'c2', author: me, committedAt: at(30) })],
    });
    const events = deriveEvents(pr, viewer, null);
    expect(events.some(isUnseenLoud)).toBe(true);

    const seen = eventsSeenByTouch(pr, events, viewer);

    expect(seen.touch).toEqual({ kind: 'push', at: at(30) });
    expect(seenWhere(events, seen.ids, at(30)).some(isUnseenLoud)).toBe(false);
  });

  it('leaves a merge without the viewer review unseen when it came after the touch, and sees it when the touch came after', () => {
    const merge = makeEvent({ id: 'merge', kind: 'merged_without_review', actor: 'rowan', at: at(20) });
    const pr = makePr();
    expect(eventsSeenByTouch(pr, [own('comment', 10), merge], viewer).ids).not.toContain('merge');
    expect(eventsSeenByTouch(pr, [merge, own('comment', 30)], viewer).ids).toContain('merge');
  });

  it('includes the touch itself and skips events already seen', () => {
    const earlier = makeEvent({ id: 'earlier', at: at(0), seenAt: at(1) });
    const touch = own('merged_without_review', 10);
    const seen = eventsSeenByTouch(makePr(), [earlier, touch], viewer);
    expect(seen.ids).toEqual([touch.id]);
  });

  it('is empty when the viewer never touched the PR', () => {
    expect(eventsSeenByTouch(makePr(), [makeEvent({ kind: 'mention', actor: 'lyra' })], viewer)).toEqual({ ids: [], touch: null });
  });
});
