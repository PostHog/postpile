import { describe, expect, it } from 'vitest';
import { botReviewOf, foldedBotReviewComments } from './bot-reviews.ts';
import { at, makeComment, makePr, makeReview, viewer } from './fixtures.ts';
import type { Comment, Pr, Review, ReviewThread } from './types.ts';

const BOT = 'greptile-apps[bot]';
const me = viewer.login;

/** An inline comment that opens or answers thread `threadId` on `path`. */
function inline(id: string, author: string, threadId: string, reviewId: string | undefined, body = 'Possible null dereference.'): Comment {
  return makeComment({ id, author, body, createdAt: at(1), kind: 'review_comment', path: `src/${threadId}.ts`, threadId, ...(reviewId === undefined ? {} : { reviewId }) });
}

/** A PR with these inline comments, each thread in the order given. */
function prWith(comments: Comment[], reviews: Review[]): Pr {
  const threads = new Map<string, Comment[]>();
  for (const comment of comments) {
    threads.set(comment.threadId!, [...(threads.get(comment.threadId!) ?? []), comment]);
  }
  const built: ReviewThread[] = [...threads.entries()].map(([id, list]) => ({ id, path: `src/${id}.ts`, isResolved: false, comments: list }));
  return makePr({ comments, threads: built, reviews });
}

const review = (overrides: Partial<Review> = {}) => makeReview({ id: 'rv', author: BOT, state: 'COMMENTED', body: '', submittedAt: at(1), ...overrides });

describe('foldedBotReviewComments', () => {
  it("takes a bot review's inline comments when each opens a thread", () => {
    const pr = prWith([inline('g1', BOT, 't1', 'rv'), inline('g2', BOT, 't2', 'rv'), inline('a1', 'alice', 't1', 'ra', 'fixed')], [review(), review({ id: 'ra', author: 'alice' })]);
    expect(foldedBotReviewComments(pr.reviews[0]!, pr, viewer).map((comment) => comment.id)).toEqual(['g1', 'g2']);
  });

  it('folds a review with text too', () => {
    const pr = prWith([inline('g1', BOT, 't1', 'rv')], [review({ body: 'Greptile summary: 1 comment.' })]);
    expect(foldedBotReviewComments(pr.reviews[0]!, pr, viewer)).toHaveLength(1);
  });

  it("never folds a person's review, a verdict, or comments without a review id", () => {
    const person = prWith([inline('b1', 'bob', 't1', 'rv')], [review({ author: 'bob' })]);
    const changes = prWith([inline('g1', BOT, 't1', 'rv')], [review({ state: 'CHANGES_REQUESTED' })]);
    const approved = prWith([inline('g1', BOT, 't1', 'rv')], [review({ state: 'APPROVED' })]);
    const old = prWith([inline('g1', BOT, 't1', undefined)], [review()]);
    for (const pr of [person, changes, approved, old]) {
      expect(foldedBotReviewComments(pr.reviews[0]!, pr, viewer)).toEqual([]);
    }
  });

  it('keeps the normal lines when the review or a comment mentions you', () => {
    const inText = prWith([inline('g1', BOT, 't1', 'rv')], [review({ body: `@${me} please check the retry` })]);
    const inComment = prWith([inline('g1', BOT, 't1', 'rv'), inline('g2', BOT, 't2', 'rv', `@${me} this drops the cache`)], [review()]);
    expect(foldedBotReviewComments(inText.reviews[0]!, inText, viewer)).toEqual([]);
    expect(foldedBotReviewComments(inComment.reviews[0]!, inComment, viewer)).toEqual([]);
  });

  it('does not fold a bot review whose comments answer in existing threads', () => {
    const pr = prWith([inline('a1', 'alice', 't1', 'ra'), inline('g1', BOT, 't1', 'rv', 'Thanks, resolved.')], [review({ id: 'ra', author: 'alice' }), review()]);
    expect(foldedBotReviewComments(pr.reviews[1]!, pr, viewer)).toEqual([]);
  });
});

describe('botReviewOf', () => {
  const pr = prWith(
    [inline('g1', BOT, 't1', 'rv'), inline('a1', 'alice', 't1', 'ra', 'fixed')],
    [review({ body: 'Greptile summary' }), review({ id: 'ra', author: 'alice' })],
  );

  it('finds the review for the review itself, its text, its comments and their edits', () => {
    expect(botReviewOf({ kind: 'review_commented', sourceId: 'rv', isBot: true }, pr, viewer)?.id).toBe('rv');
    expect(botReviewOf({ kind: 'bot_comment', sourceId: 'rv', isBot: true }, pr, viewer)?.id).toBe('rv');
    expect(botReviewOf({ kind: 'bot_comment', sourceId: 'g1', isBot: true }, pr, viewer)?.id).toBe('rv');
    expect(botReviewOf({ kind: 'comment_edited', sourceId: 'g1', isBot: true }, pr, viewer)?.id).toBe('rv');
  });

  it("has nothing for a person's event, even on the bot's comment", () => {
    expect(botReviewOf({ kind: 'comment', sourceId: 'a1', isBot: false }, pr, viewer)).toBeNull();
    expect(botReviewOf({ kind: 'comment_edited', sourceId: 'g1', isBot: false }, pr, viewer)).toBeNull();
    expect(botReviewOf({ kind: 'review_commented', sourceId: 'ra', isBot: false }, pr, viewer)).toBeNull();
  });
});
