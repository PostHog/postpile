// The discussion rows round trip (DESIGN.md "PR storage"): what the store
// writes for a PR's comments, threads and reviews gives back the same PR,
// up to the missing fields every rule reads as null, and data that does not
// hold together is refused, never resolved by picking one side.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { at, makeComment, makePr, makeReview, makeThread } from './fixtures.ts';
import { isBodyReadByRules } from './bot-bodies.ts';
import { boardShape, canonicalPr, DiscussionError, joinDiscussion, splitDiscussion, type Discussion, type DiscussionParts, type FullDiscussion } from './pr-parts.ts';
import { boardSpecArb, buildBoard, CORPUS, CORPUS_SCENARIOS, corpusPrAfter, corpusPrBefore, PROPERTY_TIMEOUT_MS, propertyRuns } from './testing/index.ts';
import type { FullComment as Comment, FullPr as Pr } from './types.ts';

function discussionOf(pr: Discussion): Discussion {
  return { comments: pr.comments, threads: pr.threads, reviews: pr.reviews };
}

function roundTrip(pr: FullDiscussion): Discussion {
  return joinDiscussion(splitDiscussion(pr));
}

/** The round trip equals the canonical PR, and threads hold the flat list's comment objects. */
function expectRoundTrip(pr: FullDiscussion): void {
  const back = roundTrip(pr);
  expect(back).toEqual(discussionOf(canonicalPr(pr)));
  const flat = new Map(back.comments.map((comment) => [comment.id, comment]));
  for (const comment of back.threads.flatMap((thread) => thread.comments)) {
    if (flat.has(comment.id)) {
      expect(comment).toBe(flat.get(comment.id));
    }
  }
}

function inline(id: string, threadId: string, overrides: Partial<Comment> = {}): Comment {
  return makeComment({ id, kind: 'review_comment', threadId, path: 'a.ts', ...overrides });
}

/** A PR with one inline comment in its thread and in the flat list, the same object in both. */
function withThread(comment: Comment, rest: Partial<Pr> = {}): Pr {
  return makePr({ comments: [comment], threads: [{ id: comment.threadId!, path: 'a.ts', isResolved: false, comments: [comment] }], ...rest });
}

describe('splitDiscussion and joinDiscussion', () => {
  it('round-trip every PR of generated boards', () => {
    fc.assert(
      fc.property(boardSpecArb, (spec) => {
        for (const pr of buildBoard(spec).fullPrs.values()) {
          expectRoundTrip(pr);
        }
      }),
      { numRuns: Math.min(propertyRuns(), 500) },
    );
  }, PROPERTY_TIMEOUT_MS);

  it('round-trip every corpus PR, before and after each entry', () => {
    for (const scenario of Object.values(CORPUS_SCENARIOS)) {
      for (const entry of Object.values(CORPUS)) {
        expectRoundTrip(corpusPrBefore(scenario.pr, entry));
        expectRoundTrip(corpusPrAfter(scenario.pr, entry));
      }
    }
  });

  it('keeps the order of comments with the same createdAt', () => {
    const comments = ['c3', 'c1', 'c2'].map((id) => makeComment({ id, createdAt: at(10) }));
    expect(roundTrip(makePr({ comments })).comments.map((comment) => comment.id)).toEqual(['c3', 'c1', 'c2']);
  });

  it('stores one row per comment, the thread copy as a position in its thread', () => {
    const parts = splitDiscussion(withThread(inline('rc1', 't1')));
    expect(parts.comments).toMatchObject([{ id: 'rc1', ord: 0, threadId: 't1', threadOrd: 0 }]);
    expect(parts.threads).toEqual([{ id: 't1', ord: 0, path: 'a.ts', isResolved: false }]);
  });

  it('keeps an inline comment its thread holds but the flat list does not, out of the flat list', () => {
    const lone = inline('rc1', 't1');
    const pr = makePr({ comments: [], threads: [makeThread('t1', [lone])] });
    expect(splitDiscussion(pr).comments).toMatchObject([{ id: 'rc1', ord: null, threadOrd: 0 }]);
    const back = roundTrip(pr);
    expect(back.comments).toEqual([]);
    expect(back.threads[0]!.comments.map((comment) => comment.id)).toEqual(['rc1']);
    expectRoundTrip(pr);
  });

  it('keeps an inline comment whose thread is not stored in the flat list, without a thread position', () => {
    const pr = makePr({ comments: [inline('rc1', 't-gone')] });
    expect(splitDiscussion(pr).comments).toMatchObject([{ threadId: 't-gone', threadOrd: null }]);
    expectRoundTrip(pr);
  });

  it('leaves a review body to its comment only when the text is identical', () => {
    const pr = makePr({
      comments: [
        makeComment({ id: 'r-same', kind: 'review', body: 'Looks good' }),
        makeComment({ id: 'r-differs', kind: 'review', body: 'what the comment says' }),
      ],
      reviews: [
        makeReview({ id: 'r-same', body: 'Looks good' }),
        makeReview({ id: 'r-differs', body: 'what the review says' }),
        makeReview({ id: 'r-empty', body: '' }),
        makeReview({ id: 'r-blank', body: '  \n' }),
        makeReview({ id: 'r-pending', state: 'PENDING', body: 'a draft only the viewer sees' }),
        makeReview({ id: `local-review-${at(30)}`, state: 'COMMENTED', body: 'mirrored after a write' }),
      ],
    });
    expect(splitDiscussion(pr).reviews.map((review) => [review.id, review.ownBody])).toEqual([
      ['r-same', null],
      ['r-differs', 'what the review says'],
      ['r-empty', ''],
      ['r-blank', '  \n'],
      ['r-pending', 'a draft only the viewer sees'],
      [`local-review-${at(30)}`, 'mirrored after a write'],
    ]);
    expectRoundTrip(pr);
  });

  it('keeps viewerReacted missing, true or false, on comments and reviews', () => {
    const pr = makePr({
      comments: [makeComment({ id: 'c-unknown' }), makeComment({ id: 'c-yes', viewerReacted: true }), makeComment({ id: 'c-no', viewerReacted: false })],
      reviews: [makeReview({ id: 'r-unknown' }), makeReview({ id: 'r-yes', viewerReacted: true }), makeReview({ id: 'r-no', viewerReacted: false })],
    });
    const back = roundTrip(pr);
    expect(back.comments.map((comment) => comment.viewerReacted)).toEqual([undefined, true, false]);
    expect(back.comments[0]).not.toHaveProperty('viewerReacted');
    expect(back.reviews.map((review) => review.viewerReacted)).toEqual([undefined, true, false]);
    expect(back.reviews[0]).not.toHaveProperty('viewerReacted');
  });

  it('keeps reviewId and updatedAt when known and leaves them out when not, and reads a missing edit as never', () => {
    const known = inline('rc1', 't1', { reviewId: 'rv1', updatedAt: at(12), lastEditedAt: at(11), editor: 'bob' });
    const back = roundTrip(withThread(known)).comments[0]!;
    expect(back).toEqual(known);
    const old = roundTrip(makePr({ comments: [makeComment({ id: 'c-old' })] })).comments[0]!;
    expect(old).not.toHaveProperty('reviewId');
    expect(old).not.toHaveProperty('updatedAt');
    expect(old).toMatchObject({ lastEditedAt: null, editor: null });
  });

  it('takes a thread copy equal to the flat one but for a missing edit time as the same comment', () => {
    const flat = inline('rc1', 't1', { lastEditedAt: null, editor: null });
    const { lastEditedAt: _edited, editor: _editor, ...threadCopy } = flat;
    const pr = makePr({ comments: [flat], threads: [{ id: 't1', path: 'a.ts', isResolved: false, comments: [threadCopy] }] });
    expect(splitDiscussion(pr).comments).toHaveLength(1);
  });
});

describe('splitDiscussion refuses data that does not hold together', () => {
  const refuses = (pr: FullDiscussion, message: RegExp) => expect(() => splitDiscussion(pr)).toThrow(message);

  it('a thread copy that differs from the flat copy', () => {
    const flat = inline('rc1', 't1');
    const pr = makePr({ comments: [flat], threads: [{ id: 't1', path: 'a.ts', isResolved: false, comments: [{ ...flat, body: 'edited since' }] }] });
    refuses(pr, /rc1 differs between the comment list and thread t1/);
  });

  it('a comment twice in the flat list, or in two threads', () => {
    refuses(makePr({ comments: [makeComment({ id: 'c1' }), makeComment({ id: 'c1' })] }), /c1 is in the comment list twice/);
    const comment = inline('rc1', 't1');
    const twice = makePr({
      comments: [comment],
      threads: [
        { id: 't1', path: 'a.ts', isResolved: false, comments: [comment] },
        { id: 't2', path: 'a.ts', isResolved: false, comments: [{ ...comment, threadId: 't2' }] },
      ],
    });
    refuses(twice, /rc1/);
  });

  it('a thread comment that names another thread', () => {
    refuses(makePr({ threads: [{ id: 't1', path: 'a.ts', isResolved: false, comments: [inline('rc1', 't2')] }] }), /rc1 in thread t1 names thread t2/);
  });

  it('a thread or a review stored twice', () => {
    refuses(makePr({ threads: [makeThread('t1', []), makeThread('t1', [])] }), /thread t1 is stored twice/);
    refuses(makePr({ reviews: [makeReview({ id: 'r1' }), makeReview({ id: 'r1' })] }), /review r1 is stored twice/);
  });

  it("a comment that is no inline comment but carries an inline comment's thread, path or review", () => {
    refuses(makePr({ comments: [makeComment({ id: 'c1', threadId: 't1' })] }), /c1 of kind comment/);
    refuses(makePr({ comments: [makeComment({ id: 'c1', kind: 'review', path: 'a.ts' })] }), /c1 of kind review/);
    refuses(makePr({ comments: [makeComment({ id: 'c1', reviewId: 'rv1' })] }), /c1 of kind comment/);
  });

  it('throws DiscussionError', () => {
    expect(() => splitDiscussion(makePr({ reviews: [makeReview(), makeReview()] }))).toThrow(DiscussionError);
  });
});

describe('joinDiscussion refuses rows that do not hold together', () => {
  function parts(overrides: Partial<DiscussionParts>): DiscussionParts {
    return { ...splitDiscussion(withThread(inline('rc1', 't1'), { reviews: [makeReview({ id: 'r1', body: '' })] })), ...overrides };
  }
  const refuses = (rows: DiscussionParts, message: RegExp) => expect(() => joinDiscussion(rows)).toThrow(message);

  it('a review whose body is its comment, when that comment is not stored', () => {
    const rows = parts({});
    refuses({ ...rows, reviews: [{ ...rows.reviews[0]!, ownBody: null }] }, /review r1 has its body in a comment that is not stored/);
  });

  it('a review whose body is its comment, when that comment is no review body', () => {
    const rows = parts({});
    refuses({ ...rows, reviews: [{ ...rows.reviews[0]!, id: 'rc1', ownBody: null }] }, /review rc1 has its body in a comment that is not stored/);
  });

  it('two comments at one position', () => {
    const rows = parts({});
    const second = { ...rows.comments[0]!, id: 'rc2', threadOrd: 1 };
    refuses({ ...rows, comments: [...rows.comments, second] }, /two entries at position 0 of the comment list/);
    refuses({ ...rows, comments: [...rows.comments, { ...second, ord: 1, threadOrd: 0 }] }, /two entries at position 0 of thread t1/);
  });

  it('comments in a thread that is not stored, and a comment in no list', () => {
    const rows = parts({});
    refuses({ ...rows, threads: [] }, /comments sit in thread t1, which is not stored/);
    refuses({ ...rows, comments: [{ ...rows.comments[0]!, ord: null, threadOrd: null }] }, /rc1 is in no list/);
  });

  it('two threads or reviews at one position', () => {
    const rows = parts({});
    refuses({ ...rows, threads: [...rows.threads, { ...rows.threads[0]!, id: 't2' }] }, /two entries at position 0 of the threads/);
    refuses({ ...rows, reviews: [...rows.reviews, { ...rows.reviews[0]!, id: 'r2' }] }, /two entries at position 0 of the reviews/);
  });
});

describe('boardShape', () => {
  const human = makeComment({ id: 'c1', author: 'bob', body: 'cc @acme/team-platform' });
  const bot = makeComment({ id: 'c2', author: 'coderabbitai[bot]', body: 'Walkthrough for @acme/team-infra' });
  const trunk = makeComment({ id: 'c3', author: 'trunk-io[bot]', body: '⏳ Testing' });
  const editedByPerson = makeComment({ id: 'c4', author: 'github-actions[bot]', body: 'Preview ready @viewer', lastEditedAt: at(30), editor: 'bob' });
  const editedByBot = makeComment({ id: 'c5', author: 'github-actions[bot]', body: 'Bundle +2 KB', lastEditedAt: at(30), editor: 'github-actions[bot]' });
  const deleted = makeComment({ id: 'c6', author: '', body: 'from a deleted account' });
  const botReviewBody = makeComment({ id: 'r2', kind: 'review', author: 'greptile-apps[bot]', body: 'Summary of the PR' });
  const pr = makePr({
    body: 'Fixes the runner',
    comments: [human, bot, trunk, editedByPerson, editedByBot, deleted, botReviewBody],
    reviews: [
      makeReview({ id: 'r1', author: 'bob', body: 'Looks good' }),
      makeReview({ id: 'r2', author: 'greptile-apps[bot]', state: 'COMMENTED', body: 'Summary of the PR' }),
      makeReview({ id: 'r3', author: 'copilot-pull-request-reviewer[bot]', state: 'COMMENTED', body: '' }),
    ],
  });

  it('leaves out the bodies no board rule reads and keeps the rest, empty ones too', () => {
    const board = boardShape(pr);
    expect(board.comments.map((comment) => comment.body)).toEqual(['cc @acme/team-platform', null, '⏳ Testing', 'Preview ready @viewer', null, 'from a deleted account', null]);
    expect(board.reviews.map((review) => review.body)).toEqual(['Looks good', null, '']);
    expect(board.body).toBe('Fixes the runner');
  });

  it('keeps every team the stored bodies mention, a bot body left out included', () => {
    expect(boardShape(pr).mentionedTeams).toEqual(['acme/team-infra', 'acme/team-platform']);
  });

  it('leaves out the same bodies in threads as in the flat list', () => {
    const inline = makeComment({ id: 'rc1', kind: 'review_comment', author: 'greptile-apps[bot]', threadId: 't1', path: 'a.ts', body: 'Consider a guard' });
    const board = boardShape(makePr({ comments: [inline], threads: [makeThread('t1', [inline])] }));
    expect(board.threads[0]!.comments[0]!.body).toBeNull();
    expect(board.comments[0]!.body).toBeNull();
  });

  it('reads a body by the same rule that keeps it whole on save', () => {
    expect(isBodyReadByRules({ author: 'bob' })).toBe(true);
    expect(isBodyReadByRules({ author: '' })).toBe(true);
    expect(isBodyReadByRules({ author: 'mergify[bot]' })).toBe(true);
    expect(isBodyReadByRules({ author: 'vercel[bot]', editor: 'bob' })).toBe(true);
    expect(isBodyReadByRules({ author: 'vercel[bot]', editor: 'vercel[bot]' })).toBe(false);
    expect(isBodyReadByRules({ author: 'vercel[bot]', editor: null })).toBe(false);
  });
});
