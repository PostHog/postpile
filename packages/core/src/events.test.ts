import { describe, expect, it } from 'vitest';
import { deriveEvents } from './events.ts';
import {
  at,
  makeComment,
  makeCommit,
  makePr,
  makeReview,
  makeThread,
  makeTimelineItem,
  makeUserState,
  viewer,
} from './fixtures.ts';
import type { PrEvent } from './types.ts';

function only(events: PrEvent[], kind: PrEvent['kind']): PrEvent[] {
  return events.filter((event) => event.kind === kind);
}

describe('deriveEvents: comments', () => {
  it('turns a human @-mention into a loud mention with a stable id', () => {
    const pr = makePr({ comments: [makeComment({ id: 'c9', body: 'cc @viewer for devex' })] });
    const [event] = deriveEvents(pr, viewer, null);
    expect(event).toMatchObject({
      id: 'acme/app#1:mention:c9',
      kind: 'mention',
      actor: 'bob',
      ruleLoudness: 'loud',
      seenAt: null,
      override: null,
      summary: 'bob mentioned you: cc @viewer for devex',
    });
  });

  it('strips HTML comment markers from summaries and falls back to the kind label', () => {
    const marked = makePr({ comments: [makeComment({ id: 'c1', author: 'deployment-status-posthog[bot]', body: '<!-- deploy-notify-bot -->\n  Deployed   to   prod' })] });
    expect(deriveEvents(marked, viewer, null)[0]?.summary).toBe('deployment-status-posthog[bot] deploy: Deployed to prod');
    const bare = makePr({ comments: [makeComment({ id: 'c2', author: 'deployment-status-posthog[bot]', body: '<!-- deploy-notify-bot -->' })] });
    expect(deriveEvents(bare, viewer, null)[0]?.summary).toBe('deployment-status-posthog[bot] deploy');
  });

  it('needs a word boundary after the login', () => {
    const pr = makePr({ comments: [makeComment({ body: 'ping @viewers' })] });
    expect(deriveEvents(pr, viewer, null)[0]?.kind).toBe('comment');
  });

  it('turns a mention with a question into question_to_user', () => {
    const pr = makePr({ comments: [makeComment({ body: '@viewer can you check the migration?' })] });
    const [event] = deriveEvents(pr, viewer, null);
    expect(event?.kind).toBe('question_to_user');
    expect(event?.ruleLoudness).toBe('loud');
  });

  it('makes a question quiet once the viewer replied after it', () => {
    const pr = makePr({
      comments: [
        makeComment({ id: 'c1', body: '@viewer ok?', createdAt: at(10) }),
        makeComment({ id: 'c2', author: 'viewer', body: 'yes', createdAt: at(12) }),
      ],
    });
    const question = only(deriveEvents(pr, viewer, null), 'question_to_user')[0];
    expect(question?.ruleLoudness).toBe('quiet');
    expect(question?.ruleReason).toBe('you already replied');
  });

  it('keeps an ask loud while the viewer only has a pending review after it', () => {
    const pr = makePr({
      comments: [makeComment({ id: 'c1', body: '@viewer can you look?', createdAt: at(10) })],
      reviews: [makeReview({ id: 'r1', author: 'viewer', state: 'PENDING', body: '', submittedAt: at(12) })],
    });
    const question = only(deriveEvents(pr, viewer, null), 'question_to_user')[0];
    expect(question?.ruleLoudness).toBe('loud');
  });

  it('finds replies in review threads the viewer took part in, without any mention', () => {
    const thread = makeThread('th1', [
      makeComment({ id: 'a', author: 'viewer', body: 'why this?', createdAt: at(10) }),
      makeComment({ id: 'b', author: 'alice', body: 'because of the cache', createdAt: at(11) }),
    ]);
    const pr = makePr({ threads: [thread], comments: thread.comments });
    const reply = only(deriveEvents(pr, viewer, null), 'reply_to_user')[0];
    expect(reply).toMatchObject({ actor: 'alice', ruleLoudness: 'loud' });
  });

  it('does not count thread comments before the viewer joined as replies', () => {
    const thread = makeThread('th1', [
      makeComment({ id: 'a', author: 'alice', body: 'note', createdAt: at(10) }),
      makeComment({ id: 'b', author: 'viewer', body: 'ack', createdAt: at(11) }),
    ]);
    const events = deriveEvents(makePr({ threads: [thread], comments: thread.comments }), viewer, null);
    expect(only(events, 'reply_to_user')).toHaveLength(0);
  });

  it('flags team mentions without matching longer team slugs', () => {
    const pr = makePr({
      comments: [
        makeComment({ id: 'c1', body: '@acme/team-platform please look' }),
        makeComment({ id: 'c2', body: '@acme/team-platform-other please look' }),
      ],
    });
    const kinds = deriveEvents(pr, viewer, null).map((e) => e.kind);
    expect(kinds).toEqual(['team_mention', 'comment']);
  });

  it('classifies bot comments and deploy comments as quiet', () => {
    const pr = makePr({
      comments: [
        makeComment({ id: 'c1', author: 'vercel', body: 'Preview deployment ready' }),
        makeComment({ id: 'c2', author: 'codecov[bot]', body: 'Coverage 91% @viewer' }),
        makeComment({ id: 'c3', author: 'alice', body: 'This is an automated review. @viewer' }),
      ],
    });
    const events = deriveEvents(pr, viewer, null);
    expect(events.map((e) => [e.kind, e.ruleLoudness, e.isBot])).toEqual([
      ['deploy', 'quiet', true],
      ['bot_comment', 'quiet', true],
      ['bot_comment', 'quiet', true],
    ]);
  });

  it('skips a review body that addresses nobody, since the review event covers it', () => {
    const pr = makePr({
      comments: [makeComment({ id: 'rb', kind: 'review', body: 'nice' })],
      reviews: [makeReview({ id: 'r1', state: 'COMMENTED', body: 'nice' })],
    });
    expect(deriveEvents(pr, viewer, null).map((e) => e.kind)).toEqual(['review_commented']);
  });

  it("skips the viewer's own review body, so an approval with words shows once", () => {
    const pr = makePr({
      // Like the reader: the body comment carries the review's id.
      comments: [makeComment({ id: 'r1', kind: 'review', author: viewer.login, body: 'Looks good, @alice one nit?' })],
      reviews: [makeReview({ id: 'r1', author: viewer.login, state: 'APPROVED', body: 'Looks good, @alice one nit?' })],
    });
    const events = deriveEvents(pr, viewer, null);
    expect(events.map((e) => [e.kind, e.summary])).toEqual([['review_approved', `${viewer.login} approved: Looks good, @alice one nit?`]]);
  });

  it("keeps the viewer's body of a dismissed review, which has no review event", () => {
    const pr = makePr({
      comments: [makeComment({ id: 'r1', kind: 'review', author: viewer.login, body: 'Needs a retry limit.' })],
      reviews: [makeReview({ id: 'r1', author: viewer.login, state: 'DISMISSED', body: 'Needs a retry limit.' })],
    });
    expect(deriveEvents(pr, viewer, null).map((e) => e.kind)).toEqual(['comment']);
  });

  it("keeps someone else's review body that mentions the viewer as its own event", () => {
    const pr = makePr({
      comments: [makeComment({ id: 'r1', kind: 'review', author: 'bob', body: '@viewer can you check the retry?' })],
      reviews: [makeReview({ id: 'r1', author: 'bob', state: 'COMMENTED', body: '@viewer can you check the retry?' })],
    });
    expect(deriveEvents(pr, viewer, null).map((e) => e.kind).sort()).toEqual(['question_to_user', 'review_commented']);
  });
});

describe('deriveEvents: reviews, commits, timeline, CI', () => {
  it('maps review states and skips pending and dismissed', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', state: 'APPROVED' }),
        makeReview({ id: 'r2', state: 'CHANGES_REQUESTED', body: 'fix the test' }),
        makeReview({ id: 'r3', state: 'PENDING' }),
        makeReview({ id: 'r4', state: 'DISMISSED' }),
      ],
    });
    const events = deriveEvents(pr, viewer, null);
    expect(events.map((e) => e.kind)).toEqual(['review_approved', 'review_changes_requested']);
    expect(events[1]?.summary).toBe('bob requested changes: fix the test');
  });

  it('marks commits after the approved commit as commits_after_approval', () => {
    const pr = makePr({
      headOid: 'c3',
      commits: [
        makeCommit({ oid: 'c1', committedAt: at(1) }),
        makeCommit({ oid: 'c2', committedAt: at(2) }),
        makeCommit({ oid: 'c3', committedAt: at(3) }),
      ],
    });
    const state = makeUserState({ approvedAt: at(2), approvedCommitOid: 'c2' });
    const events = deriveEvents(pr, viewer, state);
    expect(events.map((e) => [e.sourceId, e.kind, e.ruleLoudness])).toEqual([
      ['c1', 'commits_pushed', 'quiet'],
      ['c2', 'commits_pushed', 'quiet'],
      ['c3', 'commits_after_approval', 'quiet'],
    ]);
  });

  it('falls back to time when the approved commit was force-pushed away', () => {
    const pr = makePr({
      commits: [makeCommit({ oid: 'n1', committedAt: at(1) }), makeCommit({ oid: 'n2', committedAt: at(30) })],
    });
    const state = makeUserState({ approvedAt: at(10), approvedCommitOid: 'gone' });
    expect(deriveEvents(pr, viewer, state).map((e) => e.kind)).toEqual(['commits_pushed', 'commits_after_approval']);
  });

  it('uses an approval made on github.com when the app has none', () => {
    const pr = makePr({
      reviews: [makeReview({ author: 'viewer', commitOid: 'c1', submittedAt: at(2) })],
      commits: [makeCommit({ oid: 'c1', committedAt: at(1) }), makeCommit({ oid: 'c2', committedAt: at(3) })],
    });
    const pushed = only(deriveEvents(pr, viewer, null), 'commits_after_approval');
    expect(pushed.map((e) => e.sourceId)).toEqual(['c2']);
  });

  it('maps timeline items and keeps the review request subject', () => {
    const pr = makePr({
      timeline: [
        makeTimelineItem({ id: 't1', kind: 'review_requested', subject: 'viewer', at: at(1) }),
        makeTimelineItem({ id: 't2', kind: 'head_ref_force_pushed', actor: 'alice', subject: null, at: at(2) }),
        makeTimelineItem({ id: 't3', kind: 'added_to_merge_queue', actor: 'alice', subject: null, at: at(3) }),
        makeTimelineItem({ id: 't4', kind: 'deployed', actor: 'github-actions', subject: null, at: at(4) }),
      ],
    });
    const events = deriveEvents(pr, viewer, null);
    expect(events.map((e) => [e.kind, e.ruleLoudness])).toEqual([
      ['review_requested', 'loud'],
      ['force_pushed', 'quiet'],
      ['merge_queue', 'quiet'],
      ['deploy', 'quiet'],
    ]);
  });

  it('keeps a review request quiet once the viewer reviewed after it or it was removed', () => {
    const request = makeTimelineItem({ id: 't1', kind: 'review_requested', subject: 'viewer', at: at(1) });
    const reviewed = makePr({
      timeline: [request],
      reviews: [makeReview({ author: 'viewer', state: 'COMMENTED', submittedAt: at(5) })],
    });
    expect(only(deriveEvents(reviewed, viewer, null), 'review_requested')[0]?.ruleLoudness).toBe('quiet');

    const removed = makePr({
      timeline: [
        request,
        makeTimelineItem({ id: 't2', kind: 'review_request_removed', subject: 'viewer', at: at(3) }),
      ],
    });
    expect(only(deriveEvents(removed, viewer, null), 'review_requested')[0]?.ruleLoudness).toBe('quiet');

    // Asked again after the review: loud again.
    const again = makePr({
      timeline: [request, makeTimelineItem({ id: 't3', kind: 'review_requested', subject: 'viewer', at: at(9) })],
      reviews: [makeReview({ author: 'viewer', state: 'COMMENTED', submittedAt: at(5) })],
    });
    expect(only(deriveEvents(again, viewer, null), 'review_requested').map((e) => e.ruleLoudness)).toEqual([
      'quiet',
      'loud',
    ]);
  });

  it('flags a merge without the viewer review when they were asked', () => {
    const pr = makePr({
      state: 'MERGED',
      timeline: [
        makeTimelineItem({ id: 't1', kind: 'review_requested', subject: 'viewer', at: at(1) }),
        makeTimelineItem({ id: 't2', kind: 'merged', actor: 'alice', subject: null, at: at(9) }),
      ],
    });
    const event = only(deriveEvents(pr, viewer, null), 'merged_without_review')[0];
    expect(event?.ruleLoudness).toBe('quiet');
  });

  it('calls it a plain merge when the viewer reviewed or was never asked', () => {
    const merged = makeTimelineItem({ id: 't2', kind: 'merged', actor: 'alice', subject: null, at: at(9) });
    const notAsked = makePr({ state: 'MERGED', timeline: [merged] });
    expect(only(deriveEvents(notAsked, viewer, null), 'merged')).toHaveLength(1);
    const reviewed = makePr({
      state: 'MERGED',
      reviewerUsers: ['viewer'],
      reviews: [makeReview({ author: 'viewer', state: 'COMMENTED' })],
      timeline: [merged],
    });
    expect(only(deriveEvents(reviewed, viewer, null), 'merged')).toHaveLength(1);
  });

  it('returns events oldest first', () => {
    const pr = makePr({
      comments: [makeComment({ id: 'late', createdAt: at(50) })],
      commits: [makeCommit({ oid: 'early', committedAt: at(1) })],
    });
    expect(deriveEvents(pr, viewer, null).map((e) => e.sourceId)).toEqual(['early', 'late']);
  });
});
