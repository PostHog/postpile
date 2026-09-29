import { describe, expect, it } from 'vitest';
import { changesAnswered } from './changes-answered.ts';
import { deriveEvents } from './events.ts';
import { makeComment, makeCommit, makePr, makeReview, makeThread, singleTile, viewer } from './fixtures.ts';
import { forWhom } from './for-whom.ts';
import { pingRule, pingTemplate } from './pings.ts';
import { prTier } from './pr-tier.ts';
import type { Pr } from './types.ts';
import { whoseTurn, type WhoseTurn } from './whose-turn.ts';

const me = viewer.login;

// A PR where the viewer requested changes: the author pushed three commits,
// answered in the review threads and left a comment, and never pressed
// "re-request review".
const changesRequested = makeReview({
  id: 'r-changes',
  author: me,
  state: 'CHANGES_REQUESTED',
  body: 'A few things',
  submittedAt: '2026-09-18T10:00:00.000Z',
  commitOid: 'c0',
});
const threadStart = makeComment({ id: 'tc1', author: me, body: 'This leaks', createdAt: '2026-09-18T10:00:00.000Z' });
const threadReply = makeComment({ id: 'tc2', author: 'bob', body: 'done, see the new commit', createdAt: '2026-09-25T12:51:00.000Z' });
const thread = makeThread('th1', [threadStart, threadReply]);
// PR comments carry the thread id, as the reader stores them.
const [threadStartInline, threadReplyInline] = thread.comments as [typeof threadStart, typeof threadReply];
const bobReview = makeReview({ id: 'r-bob', author: 'bob', state: 'COMMENTED', submittedAt: '2026-09-25T12:51:00.000Z', commitOid: 'c1' });
const bobComment = makeComment({ id: 'ic1', author: 'bob', body: 'Should be good now', createdAt: '2026-09-25T13:11:00.000Z' });
const commits = [
  makeCommit({ oid: 'c0', author: 'bob', committedAt: '2026-09-17T09:00:00.000Z' }),
  makeCommit({ oid: 'c1', author: 'bob', committedAt: '2026-09-25T12:18:00.000Z' }),
  makeCommit({ oid: 'c2', author: 'bob', committedAt: '2026-09-25T12:59:00.000Z' }),
  makeCommit({ oid: 'c3', author: 'bob', committedAt: '2026-09-25T13:14:00.000Z' }),
];

function prWith(overrides: Partial<Pr> = {}): Pr {
  return makePr({
    number: 4521,
    author: 'bob',
    headOid: 'c3',
    reviewerUsers: [],
    reviews: [changesRequested, bobReview],
    commits,
    threads: [thread],
    comments: [threadStartInline, threadReplyInline, bobComment],
    ...overrides,
  });
}

/** Only the review and the first commit: bob has not done anything since. */
const untouched = prWith({ headOid: 'c0', reviews: [changesRequested], commits: [commits[0]!], threads: [makeThread('th1', [threadStart])], comments: [threadStartInline] });

function turn(pr: Pr): WhoseTurn {
  return whoseTurn({
    tile: singleTile(pr),
    prs: new Map([[pr.key, pr]]),
    events: new Map([[pr.key, deriveEvents(pr, viewer, null)]]),
    userStates: new Map(),
    viewer,
  });
}

function tier(pr: Pr): string {
  return prTier({ pr, events: deriveEvents(pr, viewer, null), viewer, userState: null, reason: 'comment' });
}

describe('addressed your changes: the #4521 timeline', () => {
  const pr = prWith();

  it('hands the move back to the viewer', () => {
    expect(changesAnswered(pr, viewer)).toEqual({ pushed: true, replied: true, since: changesRequested.submittedAt });
    expect(turn(pr)).toEqual({ kind: 'you', who: null, what: 'bob addressed your changes: re-review', prKey: pr.key });
  });

  it('files the PR under Changes you requested, even when the author is a teammate', () => {
    expect(tier(pr)).toBe('changes_requested');
    const teammate = { ...viewer, teamMembers: ['bob'] };
    expect(prTier({ pr, events: deriveEvents(pr, teammate, null), viewer: teammate, userState: null, reason: 'comment' })).toBe('changes_requested');
  });

  it('shows the tile as for you, whatever the notification reason', () => {
    expect(forWhom('CM', pr, viewer)).toEqual({ kind: 'you' });
    expect(forWhom('CM', untouched, viewer)).toEqual({ kind: 'none' });
  });

  it('makes the pushes and the comment loud, and pings for them', () => {
    const events = deriveEvents(pr, viewer, null);
    const loudness = Object.fromEntries(events.map((event) => [event.sourceId, [event.ruleLoudness, event.ruleReason]]));
    expect(loudness['c1']).toEqual(['loud', 'addressed your changes']);
    expect(loudness['c3']).toEqual(['loud', 'addressed your changes']);
    expect(loudness['ic1']).toEqual(['loud', 'addressed your changes']);
    expect(loudness['tc2']).toEqual(['loud', 'replies to you']);
    // The commit from before the changes request stays quiet.
    expect(loudness['c0']?.[0]).toBe('quiet');
    const newOnes = events.filter((event) => event.at > changesRequested.submittedAt);
    const rule = pingRule(newOnes, pr, viewer, false);
    expect(rule.class).toBe('addressed');
    expect(pingTemplate(rule.event!, pr).title).toBe('@bob addressed your changes · app#4521');
  });
});

describe('addressed your changes: variants', () => {
  it('counts a push alone', () => {
    const pushed = prWith({ reviews: [changesRequested], threads: [makeThread('th1', [threadStart])], comments: [threadStartInline] });
    expect(turn(pushed)).toMatchObject({ kind: 'you', what: 'bob addressed your changes: re-review' });
    expect(tier(pushed)).toBe('changes_requested');
  });

  it('counts replies alone, with softer words', () => {
    const replied = prWith({ headOid: 'c0', commits: [commits[0]!] });
    expect(turn(replied)).toMatchObject({ kind: 'you', what: 'bob replied to your review' });
    expect(tier(replied)).toBe('changes_requested');
    const onlyComment = prWith({ headOid: 'c0', commits: [commits[0]!], reviews: [changesRequested], threads: [], comments: [bobComment] });
    expect(turn(onlyComment)).toMatchObject({ kind: 'you', what: 'bob replied to your review' });
  });

  it('leaves the move with the author while they did nothing', () => {
    expect(changesAnswered(untouched, viewer)).toBeNull();
    expect(turn(untouched)).toMatchObject({ kind: 'them', who: 'bob', what: 'to address 1 thread' });
    // The change request still stands: listed, waiting on the author.
    expect(tier(untouched)).toBe('changes_requested');
  });

  it('does not re-list once the viewer re-reviewed after the push', () => {
    const reReview = makeReview({ id: 'r-again', author: me, state: 'COMMENTED', submittedAt: '2026-09-25T15:00:00.000Z', commitOid: 'c3' });
    const reviewed = prWith({ reviews: [changesRequested, bobReview, reReview] });
    expect(changesAnswered(reviewed, viewer)).toBeNull();
    expect(turn(reviewed).kind).toBe('them');
    // A comment review is no verdict: the change request stands, waiting on the author.
    expect(tier(reviewed)).toBe('changes_requested');
    const events = deriveEvents(reviewed, viewer, null);
    expect(events.find((event) => event.sourceId === 'c3')?.ruleLoudness).toBe('quiet');
    // A later push makes it the viewer's move again.
    const pushedAgain = { ...reviewed, headOid: 'c4', commits: [...commits, makeCommit({ oid: 'c4', author: 'bob', committedAt: '2026-09-26T09:00:00.000Z' })] };
    expect(turn(pushedAgain)).toMatchObject({ kind: 'you', what: 'bob addressed your changes: re-review' });
  });

  it('stops once the viewer approved', () => {
    const approval = makeReview({ id: 'r-ok', author: me, state: 'APPROVED', submittedAt: '2026-09-25T15:00:00.000Z', commitOid: 'c3' });
    const approved = prWith({ reviews: [changesRequested, bobReview, approval] });
    expect(changesAnswered(approved, viewer)).toBeNull();
    expect(turn(approved)).toMatchObject({ kind: 'them', what: 'to merge' });
  });

  it('ignores bot pushes and the viewer’s own pushes', () => {
    const botPush = makeCommit({ oid: 'c1', author: 'github-actions', committedAt: '2026-09-25T12:18:00.000Z' });
    const ownPush = makeCommit({ oid: 'c2', author: me, committedAt: '2026-09-25T12:59:00.000Z' });
    const pr = prWith({ headOid: 'c2', reviews: [changesRequested], commits: [commits[0]!, botPush, ownPush], threads: [], comments: [] });
    expect(changesAnswered(pr, viewer)).toBeNull();
  });

  it('lets an ask from someone else go first', () => {
    const lyra = makeComment({ id: 'q1', author: 'lyra', body: `@${me} can you check the migration?`, createdAt: '2026-09-25T14:00:00.000Z' });
    const pr = prWith({ comments: [threadStartInline, threadReplyInline, bobComment, lyra] });
    expect(turn(pr)).toMatchObject({ kind: 'you', what: "Answer lyra's question" });
    expect(tier(pr)).toBe('needs_reply');
  });

  it('follows the draft rules on a draft: only a reply to the viewer is a move', () => {
    const draft = prWith({ isDraft: true });
    expect(turn(draft)).toMatchObject({ kind: 'you', what: 'Reply to bob on draft' });
    expect(tier(draft)).toBe('needs_reply');
    const pushedDraft = prWith({ isDraft: true, reviews: [changesRequested], threads: [makeThread('th1', [threadStart])], comments: [threadStartInline] });
    expect(turn(pushedDraft).kind).toBe('none');
    // The change request stands on a draft too, as the viewer's open loop.
    expect(tier(pushedDraft)).toBe('changes_requested');
    expect(forWhom('CM', pushedDraft, viewer)).toEqual({ kind: 'none' });
    expect(changesAnswered(pushedDraft, viewer)).toBeNull();
    const events = deriveEvents(pushedDraft, viewer, null);
    expect(events.find((event) => event.sourceId === 'c3')?.ruleLoudness).toBe('quiet');
  });
});
