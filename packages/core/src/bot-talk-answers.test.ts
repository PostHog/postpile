// Bot talk answers nobody (DESIGN.md "Bot talk leaves agent work" › Bot talk
// answers nobody): the viewer's own "@codex review" or "fixed" to a review
// bot is no reply to a person's ask, an author's reply to a bot is no answer
// to the viewer's changes request, and a command neither leads a tile nor
// ends a "someone replies" snooze.
import { describe, expect, it } from 'vitest';
import { changesAnswered } from './changes-answered.ts';
import { deriveEvents } from './events.ts';
import { at, makeComment, makeCommit, makePr, makeReview, makeThread, singleTile, viewer } from './fixtures.ts';
import { headlineClass, pickHeadlineEvent } from './headline.ts';
import { lastTouch } from './last-touch.ts';
import { lessonReview, reviewNow } from './lessons.ts';
import { isSnoozeOver } from './snooze.ts';
import type { FullComment, FullPr, FullReview } from './types.ts';
import { unansweredAsk, whoseTurn } from './whose-turn.ts';

const me = viewer.login;
const BOT = 'greptile-apps[bot]';

/** greptile's finding in a thread on a.ts, and `person`'s "fixed" to it in the empty review GitHub wraps a reply in. */
function botThreadWithReply(person: string, minutes: number): { comments: FullComment[]; thread: ReturnType<typeof makeThread>; carrier: FullReview } {
  const thread = makeThread('t-bot', [
    makeComment({ id: 'g1', author: BOT, body: 'Possible null dereference', createdAt: at(minutes - 1) }),
    makeComment({ id: 'fixed', author: person, body: 'fixed', createdAt: at(minutes), reviewId: 'r-carrier' }),
  ]);
  const carrier = makeReview({ id: 'r-carrier', author: person, state: 'COMMENTED', body: '', submittedAt: at(minutes) });
  return { comments: thread.comments as FullComment[], thread, carrier };
}

function turnOf(pr: FullPr) {
  return whoseTurn({ tile: singleTile(pr), prs: new Map([[pr.key, pr]]), events: new Map([[pr.key, deriveEvents(pr, viewer, null)]]), userStates: new Map(), viewer });
}

describe('your own bot talk is no reply to a person', () => {
  // rowan asks the viewer on alice's PR; the viewer then only talks to bots.
  const question = makeComment({ id: 'q', author: 'rowan', body: '@viewer can you check the retry logic?', createdAt: at(10) });
  const command = makeComment({ id: 'cmd', author: me, body: '@codex review', createdAt: at(20) });
  const bot = botThreadWithReply(me, 30);
  const pr = makePr({ author: 'alice', comments: [question, command, ...bot.comments], threads: [bot.thread], reviews: [bot.carrier] });
  const events = deriveEvents(pr, viewer, null);

  it('keeps the ask loud and open, and is no touch', () => {
    const ask = events.find((event) => event.sourceId === 'q')!;
    expect([ask.kind, ask.ruleLoudness, ask.ruleReason]).toEqual(['question_to_user', 'loud', 'asks you a question']);
    expect(unansweredAsk(pr, events, viewer)?.id).toBe(ask.id);
    expect(lastTouch(pr, events, viewer)).toBeNull();
    expect(turnOf(pr)).toMatchObject({ kind: 'you', move: 'reply' });
  });

  it('a reply to the person answers the ask', () => {
    const reply = makeComment({ id: 'reply', author: me, body: 'Checked, it backs off.', createdAt: at(40) });
    const answered = { ...pr, comments: [...pr.comments, reply] };
    const answeredEvents = deriveEvents(answered, viewer, null);
    expect(answeredEvents.find((event) => event.sourceId === 'q')!.ruleReason).toBe('you already replied');
    expect(unansweredAsk(answered, answeredEvents, viewer)).toBeNull();
    expect(lastTouch(answered, answeredEvents, viewer)).toEqual({ kind: 'comment', at: at(40) });
  });
});

describe("an author's bot talk is no answer to your changes request", () => {
  const request = makeReview({ id: 'r-changes', author: me, state: 'CHANGES_REQUESTED', body: 'Please add a test.', submittedAt: at(10), commitOid: 'c0' });
  const commits = [makeCommit({ oid: 'c0', author: 'bob', committedAt: at(5) })];

  it('a "fixed" to a review bot and "@codex review" leave the move with bob', () => {
    const bot = botThreadWithReply('bob', 20);
    const command = makeComment({ id: 'cmd', author: 'bob', body: '@codex review', createdAt: at(25) });
    const pr = makePr({ author: 'bob', headOid: 'c0', commits, reviews: [request, bot.carrier], comments: [...bot.comments, command], threads: [bot.thread] });
    expect(changesAnswered(pr, viewer)).toBeNull();
    const reply = makeComment({ id: 'reply', author: 'bob', body: 'Added the test.', createdAt: at(30) });
    expect(changesAnswered({ ...pr, comments: [...pr.comments, reply] }, viewer)).toEqual({ pushed: false, replied: true, since: at(10) });
  });

  it('your own "@codex review" after the push keeps the push an answer', () => {
    const pushed = [...commits, makeCommit({ oid: 'c1', author: 'bob', committedAt: at(20) })];
    const command = makeComment({ id: 'cmd', author: me, body: '@codex review', createdAt: at(30) });
    const pr = makePr({ author: 'bob', headOid: 'c1', commits: pushed, reviews: [request], comments: [command] });
    expect(changesAnswered(pr, viewer)).toEqual({ pushed: true, replied: false, since: at(10) });
  });
});

describe('the headline', () => {
  it('ranks a bot command with quiet events, below a person comment', () => {
    const comment = makeComment({ id: 'c1', author: 'rowan', body: 'Retry looks off to me.', createdAt: at(10) });
    const command = makeComment({ id: 'c2', author: 'rowan', body: '@codex review', createdAt: at(20) });
    const pr = makePr({ author: 'alice', comments: [comment, command] });
    const events = deriveEvents(pr, viewer, null);
    const commandEvent = events.find((event) => event.sourceId === 'c2')!;
    expect(headlineClass(commandEvent, pr, viewer)).toBe(4);
    expect(pickHeadlineEvent(events, pr, viewer)?.sourceId).toBe('c1');
  });
});

describe('"someone replies" snoozes', () => {
  const snooze = { prKey: 'acme/app#1', condition: { kind: 'someone_replies' as const }, since: at(5) };

  it('stay snoozed through a bot command, and end on a person comment', () => {
    const command = makeComment({ id: 'c1', author: 'rowan', body: '/trunk merge', createdAt: at(10) });
    const pr = makePr({ author: 'alice', comments: [command] });
    expect(isSnoozeOver(snooze, { pr, events: deriveEvents(pr, viewer, null), now: at(20), viewer })).toBe(false);
    const comment = makeComment({ id: 'c2', author: 'rowan', body: 'Merging after lunch.', createdAt: at(15) });
    const replied = { ...pr, comments: [command, comment] };
    expect(isSnoozeOver(snooze, { pr: replied, events: deriveEvents(replied, viewer, null), now: at(20), viewer })).toBe(true);
  });
});

describe('lesson context', () => {
  const inline = makeComment({ id: 'inline', author: me, kind: 'review_comment', body: 'This drops the backfill.', createdAt: at(25), threadId: 't-mine', path: 'a.ts' });
  const bot = botThreadWithReply(me, 28);
  const changes = makeReview({ id: 'r9', author: me, state: 'CHANGES_REQUESTED', body: '', submittedAt: at(30), commitOid: 'head' });
  const pr = makePr({ author: 'alice', reviews: [bot.carrier, changes], comments: [inline, ...bot.comments], threads: [makeThread('t-mine', [inline]), bot.thread] });

  it('leaves out your replies to bots', () => {
    expect(lessonReview(pr, changes, viewer).comments.map((comment) => comment.id)).toEqual(['inline']);
  });

  it('reads a lesson stored with a reply to a bot as unchanged', () => {
    const stored = { ...lessonReview(pr, changes, viewer), comments: [{ id: 'inline', path: 'a.ts', body: 'This drops the backfill.' }, { id: 'fixed', path: 'a.ts', body: 'fixed' }] };
    expect(reviewNow(stored, pr, viewer)).toEqual({ kind: 'same' });
  });
});
