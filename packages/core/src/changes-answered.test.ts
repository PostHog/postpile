import { describe, expect, it } from 'vitest';
import { changesAnswered } from './changes-answered.ts';
import { deriveEvents } from './events.ts';
import { makeComment, makeCommit, makePr, makeReview, makeThread, makeTimelineItem, singleTile, viewer } from './fixtures.ts';
import { forWhom } from './for-whom.ts';
import { isPersonalPing, pingRule, pingTemplate } from './pings.ts';
import { boardShape } from './pr-parts.ts';
import { prTier } from './pr-tier.ts';
import type { FullPr as Pr } from './types.ts';
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
    // The first answer is bob's push at 12:18: the re-review is the viewer's move from then.
    expect(changesAnswered(pr, viewer)).toEqual({ pushed: true, replied: true, since: changesRequested.submittedAt, at: '2026-09-25T12:18:00.000Z' });
    expect(turn(pr)).toEqual({ kind: 'you', move: 're_review', who: null, what: 'bob addressed your changes: re-review', prKey: pr.key, since: '2026-09-25T12:18:00.000Z' });
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

  it('counts the answer as a personal ping, so the Dock bounces', () => {
    const events = deriveEvents(pr, viewer, null);
    const answers = events.filter((event) => event.ruleReason === 'addressed your changes');
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(isPersonalPing(answer, pr, viewer)).toBe(true);
    }
  });

  it('makes the first answer loud, keeps the rest of the round quiet, and pings once', () => {
    const events = deriveEvents(pr, viewer, null);
    const loudness = Object.fromEntries(events.map((event) => [event.sourceId, [event.ruleLoudness, event.ruleReason]]));
    expect(loudness['c1']).toEqual(['loud', 'addressed your changes']);
    expect(loudness['c2']).toEqual(['quiet', 'pushed again after addressing your changes']);
    expect(loudness['c3']).toEqual(['quiet', 'pushed again after addressing your changes']);
    expect(loudness['ic1']).toEqual(['quiet', 'replied again after addressing your changes']);
    // A reply aimed at the viewer stays loud by its own row, later in the round too.
    expect(loudness['tc2']).toEqual(['loud', 'replies to you']);
    // The commit from before the changes request stays quiet.
    expect(loudness['c0']?.[0]).toBe('quiet');
    // With everything new, the ping is about the newest loud event: bob's reply in the thread.
    const newOnes = events.filter((event) => event.at > changesRequested.submittedAt);
    const rule = pingRule(newOnes, pr, viewer, false);
    expect(rule.class).toBe('addressed');
    expect(pingTemplate(rule.event!, pr).title).toBe('@bob replied to you · app#4521');
    // The first push alone pings as the answer.
    const firstPush = pingRule(events.filter((event) => event.sourceId === 'c1'), pr, viewer, false);
    expect(firstPush.class).toBe('addressed');
    expect(pingTemplate(firstPush.event!, pr).title).toBe('@bob addressed your changes · app#4521');
    // A later push in the same round does not ping.
    expect(pingRule(events.filter((event) => event.sourceId === 'c3'), pr, viewer, false).class).toBe('quiet');
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
    expect(turn(draft)).toMatchObject({ kind: 'you', what: 'bob replied to you on draft' });
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

// Property counterexample (2026-10-07): a bot's PR where the viewer asked for
// changes, and the bot then commented "@codex review". A board read leaves
// the bot's body out, so the rule has to answer the same without it.
describe('addressed your changes: a bot owner', () => {
  const bot = 'renovate[bot]';
  const botPr = makePr({
    number: 11,
    author: bot,
    headOid: 'b0',
    reviewerUsers: [],
    reviews: [makeReview({ id: 'r-bot', author: me, state: 'CHANGES_REQUESTED', body: '', submittedAt: '2026-09-01T09:10:00.000Z', commitOid: 'b0' })],
    commits: [makeCommit({ oid: 'b0', author: bot, committedAt: '2026-09-01T09:00:00.000Z' })],
    threads: [],
    comments: [makeComment({ id: 'cm-bot', author: bot, body: '@codex review', createdAt: '2026-09-01T09:20:00.000Z' })],
  });

  it('counts the bot’s own comment as its reply, with or without the body', () => {
    const board = boardShape(botPr);
    expect(board.comments[0]?.body).toBeNull();
    const answer = { pushed: false, replied: true, since: '2026-09-01T09:10:00.000Z', at: '2026-09-01T09:20:00.000Z' };
    expect(changesAnswered(botPr, viewer)).toEqual(answer);
    expect(changesAnswered(board, viewer)).toEqual(answer);
    expect(forWhom('CM', botPr, viewer)).toEqual({ kind: 'you' });
    expect(forWhom('CM', board, viewer)).toEqual({ kind: 'you' });
  });
});

// Real DB, 2026-11: an author's force-push series pinged up to six times a
// day on one PR. One ping per round: only the answer that opens it is loud.
describe('addressed your changes: one ping per round', () => {
  const pushes = [
    makeCommit({ oid: 'p0', author: 'bob', committedAt: '2026-10-01T09:00:00.000Z' }),
    makeCommit({ oid: 'p1', author: 'bob', committedAt: '2026-10-02T10:00:00.000Z' }),
    makeCommit({ oid: 'p2', author: 'bob', committedAt: '2026-10-02T11:00:00.000Z' }),
    makeCommit({ oid: 'p3', author: 'bob', committedAt: '2026-10-02T12:00:00.000Z' }),
  ];
  const request = makeReview({ id: 'r-req', author: me, state: 'CHANGES_REQUESTED', body: 'Please split this', submittedAt: '2026-10-01T10:00:00.000Z', commitOid: 'p0' });
  const forcePush = makeTimelineItem({ id: 'fp1', kind: 'head_ref_force_pushed', actor: 'bob', at: '2026-10-02T13:00:00.000Z' });

  function series(overrides: Partial<Pr> = {}): Pr {
    return makePr({ number: 77, author: 'bob', headOid: 'p3', reviewerUsers: [], reviews: [request], commits: pushes, timeline: [forcePush], threads: [], comments: [], ...overrides });
  }

  function loudnessBySource(pr: Pr): Record<string, [string, string]> {
    return Object.fromEntries(deriveEvents(pr, viewer, null).map((event) => [event.sourceId, [event.ruleLoudness, event.ruleReason]]));
  }

  it('makes the first push loud and the rest of the series quiet', () => {
    const loudness = loudnessBySource(series());
    expect(loudness['p1']).toEqual(['loud', 'addressed your changes']);
    expect(loudness['p2']).toEqual(['quiet', 'pushed again after addressing your changes']);
    expect(loudness['p3']).toEqual(['quiet', 'pushed again after addressing your changes']);
    expect(loudness['fp1']).toEqual(['quiet', 'pushed again after addressing your changes']);
  });

  it('keeps whose turn and the tier as they were', () => {
    const pr = series();
    expect(turn(pr)).toMatchObject({ kind: 'you', move: 're_review', what: 'bob addressed your changes: re-review', since: '2026-10-02T10:00:00.000Z' });
    expect(tier(pr)).toBe('changes_requested');
  });

  it('starts a new round once the viewer speaks again: its first push is loud again', () => {
    const nudge = makeComment({ id: 'me1', author: me, body: 'Still one thing left', createdAt: '2026-10-02T14:00:00.000Z' });
    const later = [
      makeCommit({ oid: 'p4', author: 'bob', committedAt: '2026-10-03T09:00:00.000Z' }),
      makeCommit({ oid: 'p5', author: 'bob', committedAt: '2026-10-03T10:00:00.000Z' }),
    ];
    const pr = series({ headOid: 'p5', commits: [...pushes, ...later], comments: [nudge] });
    const loudness = loudnessBySource(pr);
    expect(loudness['p4']).toEqual(['loud', 'addressed your changes']);
    expect(loudness['p5']).toEqual(['quiet', 'pushed again after addressing your changes']);
    // The first round is behind the viewer's comment: its answers are no longer part of the answer.
    expect(loudness['p1']?.[0]).toBe('quiet');
  });

  it('keeps an owner reply aimed at the viewer loud later in the round', () => {
    const viewerThread = makeComment({ id: 'vt1', author: me, body: 'Split this file', createdAt: '2026-10-01T10:00:00.000Z' });
    const ownerReply = makeComment({ id: 'vt2', author: 'bob', body: 'Done, which name do you prefer?', createdAt: '2026-10-02T12:30:00.000Z' });
    const reviewThread = makeThread('th-split', [viewerThread, ownerReply]);
    const pr = series({ threads: [reviewThread], comments: reviewThread.comments });
    const loudness = loudnessBySource(pr);
    expect(loudness['p1']).toEqual(['loud', 'addressed your changes']);
    expect(loudness['vt2']?.[0]).toBe('loud');
    expect(loudness['vt2']?.[1]).not.toContain('again');
  });
});
