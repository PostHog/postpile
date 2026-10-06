import { describe, expect, it } from 'vitest';
import { botThreadOf, carriedBotThreadReplies, isBotThreadReply, threadReplyOf } from './bot-threads.ts';
import { deriveEvents } from './events.ts';
import { at, makeComment, makePr, makeReview, makeThread, viewer } from './fixtures.ts';
import { headlineClass } from './headline.ts';
import { isSnoozeOver } from './snooze.ts';
import type { FullComment as Comment, FullPr as Pr, FullReview as Review } from './types.ts';

const BOT = 'greptile-apps[bot]';

/** A PR whose threads are made of `comments` per thread id; every thread comment is also in `pr.comments`, like the reader. */
function prWith(threads: Record<string, Comment[]>, extra: Partial<Pr> = {}): Pr {
  const built = Object.entries(threads).map(([id, comments]) => makeThread(id, comments));
  const comments = [...(extra.comments ?? []), ...built.flatMap((thread) => thread.comments)].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return makePr({ ...extra, threads: built, comments });
}

function say(id: string, author: string, minute: number, body = 'fixed'): Comment {
  return makeComment({ id, author, body, createdAt: at(minute) });
}

/** The empty review GitHub makes for a thread reply, the same second. */
function carrier(id: string, author: string, minute: number): Review {
  return makeReview({ id, author, state: 'COMMENTED', body: '', submittedAt: at(minute) });
}

function comment(pr: Pr, id: string): Comment {
  return pr.comments.find((candidate) => candidate.id === id)!;
}

describe('threadReplyOf', () => {
  const pr = prWith({ t1: [say('g1', BOT, 1, 'Possible null dereference'), say('a1', 'alice', 2), say('g2', BOT, 3, 'Thanks'), say('a2', 'alice', 4, 'also renamed it')] });

  it('names the opener a reply answers, and the file', () => {
    expect(threadReplyOf(comment(pr, 'a1'), pr)).toEqual({ threadId: 't1', to: BOT, path: 'a.ts' });
    expect(threadReplyOf(comment(pr, 'a2'), pr)?.to).toBe(BOT);
  });

  it('has nothing for the opener or a comment outside a thread', () => {
    expect(threadReplyOf(comment(pr, 'g1'), pr)).toBeNull();
    expect(threadReplyOf(makeComment({ id: 'c9' }), pr)).toBeNull();
  });

  it("answers the last other person when the opener replies in their own thread", () => {
    const own = prWith({ t1: [say('b1', 'bob', 1, 'why?'), say('c1', 'carol', 2, 'because'), say('b2', 'bob', 3, 'ok')] });
    expect(threadReplyOf(comment(own, 'b2'), own)?.to).toBe('carol');
  });

  it('answers the last person, not a bot that chimed in', () => {
    const mixed = prWith({ t1: [say('b1', 'bob', 1, 'why?'), say('g1', BOT, 2, 'agreed'), say('a1', 'alice', 3, 'because')] });
    expect(threadReplyOf(comment(mixed, 'a1'), mixed)?.to).toBe('bob');
  });
});

describe('isBotThreadReply', () => {
  it('is a person answering only bots', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2), say('s1', 'sonarcloud[bot]', 3, 'ok'), say('a2', 'alice', 4)] });
    expect(isBotThreadReply(comment(pr, 'a1'), pr)).toBe(true);
    expect(isBotThreadReply(comment(pr, 'a2'), pr)).toBe(true);
  });

  it('is never the bot itself, the opener, or a comment outside a thread', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2), say('g2', BOT, 3, 'thanks')] });
    expect(isBotThreadReply(comment(pr, 'g1'), pr)).toBe(false);
    expect(isBotThreadReply(comment(pr, 'g2'), pr)).toBe(false);
    expect(isBotThreadReply(makeComment({ id: 'c9', author: 'alice' }), pr)).toBe(false);
  });

  it('is not a reply in a mixed thread', () => {
    const pr = prWith({ t1: [say('b1', 'bob', 1, 'rename this?'), say('g1', BOT, 2, 'agreed'), say('a1', 'alice', 3)] });
    expect(isBotThreadReply(comment(pr, 'a1'), pr)).toBe(false);
  });

  it('keeps earlier replies quiet when a person joins later; the newcomer and later replies are normal', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2), say('b1', 'bob', 3, 'not fixed yet'), say('a2', 'alice', 4, 'now it is')] });
    expect(isBotThreadReply(comment(pr, 'a1'), pr)).toBe(true);
    expect(isBotThreadReply(comment(pr, 'b1'), pr)).toBe(false);
    expect(isBotThreadReply(comment(pr, 'a2'), pr)).toBe(false);
  });

  it('counts automation on a user account by its body', () => {
    const pr = prWith({ t1: [say('h1', 'helper', 1, 'This is an automated comment: nit'), say('a1', 'alice', 2)] });
    expect(isBotThreadReply(comment(pr, 'a1'), pr)).toBe(true);
  });
});

describe('carriedBotThreadReplies', () => {
  const thread = { t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2)], t2: [say('b1', 'bob', 1, 'why?'), say('a2', 'alice', 5, 'because')] };

  it('takes the empty review posted with a bot-thread reply', () => {
    const pr = prWith(thread, { reviews: [carrier('r1', 'alice', 2)] });
    expect(carriedBotThreadReplies(pr.reviews[0]!, pr).map((c) => c.id)).toEqual(['a1']);
  });

  it('leaves a review with a body, another time, or a reply to a person alone', () => {
    const pr = prWith(thread, {
      reviews: [makeReview({ id: 'r1', author: 'alice', state: 'COMMENTED', body: 'see inline', submittedAt: at(2) }), carrier('r2', 'alice', 3), carrier('r3', 'alice', 5)],
    });
    expect(pr.reviews.map((review) => carriedBotThreadReplies(review, pr))).toEqual([[], [], []]);
  });
});

describe('botThreadOf', () => {
  const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2)] }, { reviews: [carrier('r1', 'alice', 2)] });

  it('finds the thread of a reply, its edit and its carrier review', () => {
    expect(botThreadOf({ kind: 'comment', sourceId: 'a1' }, pr)).toBe('t1');
    expect(botThreadOf({ kind: 'comment_edited', sourceId: 'a1' }, pr)).toBe('t1');
    expect(botThreadOf({ kind: 'review_commented', sourceId: 'r1' }, pr)).toBe('t1');
  });

  it('has nothing for an ask, which has its own kind', () => {
    expect(botThreadOf({ kind: 'mention', sourceId: 'a1' }, pr)).toBeNull();
    expect(botThreadOf({ kind: 'bot_comment', sourceId: 'g1' }, pr)).toBeNull();
  });
});

describe('replies to a bot on the tile side', () => {
  const me = viewer.login;

  it('is quiet with thread context on the viewer’s own PR, its carrier review too', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('l1', 'lyra', 2, 'fixed it for you')] }, { author: me, reviews: [carrier('r1', 'lyra', 2)] });
    const events = deriveEvents(pr, viewer, null);
    const reply = events.find((event) => event.sourceId === 'l1')!;
    expect(reply).toMatchObject({ kind: 'comment', ruleLoudness: 'quiet', ruleReason: 'replied to a bot in a review thread', summary: `lyra replied to ${BOT} on a.ts: fixed it for you` });
    expect(events.find((event) => event.sourceId === 'r1')).toMatchObject({ kind: 'review_commented', ruleLoudness: 'quiet' });
  });

  it('stays loud when the reply mentions the viewer', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('l1', 'lyra', 2, `@${me} is this a real issue?`)] }, { author: me });
    const reply = deriveEvents(pr, viewer, null).find((event) => event.sourceId === 'l1')!;
    expect(reply).toMatchObject({ kind: 'question_to_user', ruleLoudness: 'loud' });
  });

  it('does not count as the author addressing the viewer’s changes request; a push still does', () => {
    const pr = prWith(
      { t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 20)] },
      { reviews: [makeReview({ id: 'rv', author: me, state: 'CHANGES_REQUESTED', body: 'please split', submittedAt: at(10) }), carrier('r1', 'alice', 20)], commits: [{ oid: 'c2', headline: 'split', author: 'alice', committer: 'alice', committedAt: at(21) }] },
    );
    const events = deriveEvents(pr, viewer, null);
    expect(events.find((event) => event.sourceId === 'a1')?.ruleLoudness).toBe('quiet');
    expect(events.find((event) => event.sourceId === 'r1')?.ruleLoudness).toBe('quiet');
    expect(events.find((event) => event.sourceId === 'c2')).toMatchObject({ ruleLoudness: 'loud', ruleReason: 'addressed your changes' });
  });

  it('says whom a reply in a human thread answers', () => {
    const pr = prWith({ t1: [say('b1', 'bob', 1, 'why?'), say('a1', 'alice', 2, 'because')] });
    expect(deriveEvents(pr, viewer, null).find((event) => event.sourceId === 'a1')?.summary).toBe('alice replied to bob on a.ts: because');
  });

  it('ranks below a person’s comment in the headline', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 2)] }, { comments: [say('c1', 'bob', 3, 'looks good')] });
    const events = deriveEvents(pr, viewer, null);
    expect(headlineClass(events.find((event) => event.sourceId === 'a1')!, pr, viewer)).toBe(4);
    expect(headlineClass(events.find((event) => event.sourceId === 'c1')!, pr, viewer)).toBe(3);
  });

  it('does not end a "someone replies" snooze', () => {
    const pr = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 20)] });
    const events = deriveEvents(pr, viewer, null);
    const snooze = { prKey: pr.key, condition: { kind: 'someone_replies' as const }, since: at(10) };
    expect(isSnoozeOver(snooze, { pr, events, now: at(30), viewer })).toBe(false);
    const answered = prWith({ t1: [say('g1', BOT, 1, 'nit'), say('a1', 'alice', 20)] }, { comments: [say('c1', 'bob', 25, 'and the docs?')] });
    expect(isSnoozeOver(snooze, { pr: answered, events: deriveEvents(answered, viewer, null), now: at(30), viewer })).toBe(true);
  });
});
