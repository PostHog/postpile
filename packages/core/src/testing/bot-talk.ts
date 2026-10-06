// Bot talk added to a PR, for the properties that say it changes no agent
// work (DESIGN.md "Bot talk leaves agent work"): a review bot's new thread with a person's
// "fixed" in it, the empty review GitHub wraps that reply in, and the same
// person's "@codex review" and "/trunk merge". Written after everything
// else on the PR, so it can only add to what came before.
import type { FullComment, FullPr, FullReview, IsoTime } from '../types.ts';

const REVIEW_BOT = 'greptile-apps[bot]';

/** The newest time anything happened on the PR, or its creation. */
function newestTime(pr: FullPr): IsoTime {
  const times = [
    pr.createdAt,
    pr.updatedAt,
    ...pr.comments.flatMap((comment) => [comment.createdAt, comment.lastEditedAt ?? comment.createdAt]),
    ...pr.reviews.map((review) => review.submittedAt),
    ...pr.commits.map((commit) => commit.committedAt),
    ...pr.timeline.map((item) => item.at),
  ];
  return times.toSorted().at(-1)!;
}

function minutesAfter(time: IsoTime, minutes: number): IsoTime {
  return new Date(Date.parse(time) + minutes * 60_000).toISOString();
}

function noiseComment(pr: FullPr, id: string, author: string, body: string, at: IsoTime, thread: { id: string; reviewId: string } | null): FullComment {
  return {
    id,
    author,
    body,
    createdAt: at,
    kind: thread === null ? 'comment' : 'review_comment',
    url: `${pr.url}#${id}`,
    path: thread === null ? null : 'src/noise.ts',
    threadId: thread?.id ?? null,
    ...(thread === null ? {} : { reviewId: thread.reviewId }),
  };
}

/**
 * The PR with bot talk by `person`, a person's login, the viewer's
 * included: their own bot talk is no touch either (2026-10-06).
 */
export function withBotTalk(pr: FullPr, person: string): FullPr {
  const start = newestTime(pr);
  const thread = { id: `${pr.key}:noise-thread`, reviewId: `${pr.key}:noise-review-${person}` };
  const opener = noiseComment(pr, `${pr.key}:noise-bot`, REVIEW_BOT, '**logic:** this can be null', minutesAfter(start, 1), { ...thread, reviewId: `${pr.key}:noise-bot-review` });
  const reply = noiseComment(pr, `${pr.key}:noise-reply`, person, 'fixed', minutesAfter(start, 2), thread);
  const codex = noiseComment(pr, `${pr.key}:noise-codex`, person, '@codex review', minutesAfter(start, 3), null);
  const trunk = noiseComment(pr, `${pr.key}:noise-trunk`, person, '/trunk merge', minutesAfter(start, 4), null);
  const botReview: FullReview = { id: `${pr.key}:noise-bot-review`, author: REVIEW_BOT, state: 'COMMENTED', body: '', submittedAt: opener.createdAt, commitOid: pr.headOid };
  const carrier: FullReview = { id: thread.reviewId, author: person, state: 'COMMENTED', body: '', submittedAt: reply.createdAt, commitOid: pr.headOid };
  return {
    ...pr,
    comments: [...pr.comments, opener, reply, codex, trunk],
    threads: [...pr.threads, { id: thread.id, path: 'src/noise.ts', isResolved: false, comments: [opener, reply] }],
    reviews: [...pr.reviews, botReview, carrier],
  };
}
