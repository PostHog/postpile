// A PR's discussion (comments, review threads, reviews) as the rows the
// store keeps (DESIGN.md "PR storage"): one row per GitHub comment, a row
// per thread and per review. Pure split and join, so the round trip can be
// tested here and the store only maps columns.
//
// Both directions check the data and throw a DiscussionError rather than
// pick one of two answers: a comment twice in a list, a thread copy that
// differs from the flat copy, a position used twice, a review whose body
// points at a comment that is not there.
import { isBodyReadByRules } from './bot-bodies.ts';
import { prTeamMentions } from './team-mentions.ts';
import type { Comment, CommentKind, FullComment, FullPr, FullReview, FullReviewThread, IsoTime, Pr, Review, ReviewState, ReviewThread } from './types.ts';

/** The parts of a PR that live in the discussion rows, as a read gives them (a board read leaves some bodies out). */
export type Discussion = Pick<Pr, 'comments' | 'threads' | 'reviews'>;

/** The discussion with every stored body: what a write splits. */
export type FullDiscussion = Pick<FullPr, 'comments' | 'threads' | 'reviews'>;

/** One GitHub comment: an issue comment, a review's body or an inline comment. */
export interface CommentPart {
  id: string;
  kind: CommentKind;
  /** Index in `Pr.comments`; null for an inline comment only its thread holds. */
  ord: number | null;
  author: string;
  createdAt: IsoTime;
  url: string;
  path: string | null;
  threadId: string | null;
  /** Index in its thread's comments; null when no stored thread holds it. */
  threadOrd: number | null;
  reviewId: string | null;
  /** Null for never edited and for not recorded alike: every rule reads them `?? null`. */
  lastEditedAt: IsoTime | null;
  editor: string | null;
  /** Null: not recorded (older snapshots); read back as missing. */
  updatedAt: IsoTime | null;
  /** Null: not recorded (older snapshots); read back as missing. */
  viewerReacted: boolean | null;
  /** Null: left out of a board read (`isBodyReadByRules`). A split always has it. */
  body: string | null;
}

export interface ThreadPart {
  id: string;
  /** Index in `Pr.threads`. */
  ord: number;
  path: string;
  isResolved: boolean;
}

export interface ReviewPart {
  id: string;
  /** Index in `Pr.reviews`. */
  ord: number;
  author: string;
  state: ReviewState;
  submittedAt: IsoTime;
  commitOid: string | null;
  viewerReacted: boolean | null;
  /**
   * Null: the body is the kind 'review' comment with the same id, which
   * holds the identical text. Else the body itself, '' included (a review
   * without text, a pending one, the app's local-review-… mirror).
   */
  ownBody: string | null;
}

export interface DiscussionParts {
  comments: CommentPart[];
  threads: ThreadPart[];
  reviews: ReviewPart[];
}

/** Stored discussion data that does not hold together; never resolved by picking one side. */
export class DiscussionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscussionError';
  }
}

function commentPart(comment: FullComment, ord: number | null, threadOrd: number | null): CommentPart {
  if (comment.kind !== 'review_comment' && (comment.path !== null || comment.threadId !== null || comment.reviewId !== undefined)) {
    throw new DiscussionError(`comment ${comment.id} of kind ${comment.kind} has an inline comment's path, thread or review`);
  }
  return {
    id: comment.id,
    kind: comment.kind,
    ord,
    author: comment.author,
    createdAt: comment.createdAt,
    url: comment.url,
    path: comment.path,
    threadId: comment.threadId,
    threadOrd,
    reviewId: comment.reviewId ?? null,
    lastEditedAt: comment.lastEditedAt ?? null,
    editor: comment.editor ?? null,
    updatedAt: comment.updatedAt ?? null,
    viewerReacted: comment.viewerReacted ?? null,
    body: comment.body,
  };
}

/** The same comment apart from where it sits. */
function sameComment(a: CommentPart, b: CommentPart): boolean {
  return (
    a.kind === b.kind &&
    a.author === b.author &&
    a.createdAt === b.createdAt &&
    a.url === b.url &&
    a.path === b.path &&
    a.threadId === b.threadId &&
    a.reviewId === b.reviewId &&
    a.lastEditedAt === b.lastEditedAt &&
    a.editor === b.editor &&
    a.updatedAt === b.updatedAt &&
    a.viewerReacted === b.viewerReacted &&
    a.body === b.body
  );
}

/** Adds a thread's comments to `parts`: as a position in the thread of the flat copy, or as a comment only the thread holds. */
function addThreadComments(parts: Map<string, CommentPart>, thread: FullReviewThread): void {
  thread.comments.forEach((comment, threadOrd) => {
    if (comment.threadId !== thread.id) {
      throw new DiscussionError(`comment ${comment.id} in thread ${thread.id} names thread ${comment.threadId}`);
    }
    const part = commentPart(comment, null, threadOrd);
    const flat = parts.get(comment.id);
    if (flat === undefined) {
      parts.set(comment.id, part);
      return;
    }
    if (flat.threadOrd !== null) {
      throw new DiscussionError(`comment ${comment.id} is in a thread twice`);
    }
    if (!sameComment(flat, part)) {
      throw new DiscussionError(`comment ${comment.id} differs between the comment list and thread ${thread.id}`);
    }
    flat.threadOrd = threadOrd;
  });
}

function reviewPart(review: FullReview, ord: number, parts: Map<string, CommentPart>): ReviewPart {
  const linked = parts.get(review.id);
  const shared = linked !== undefined && linked.kind === 'review' && linked.body === review.body;
  return {
    id: review.id,
    ord,
    author: review.author,
    state: review.state,
    submittedAt: review.submittedAt,
    commitOid: review.commitOid ?? null,
    viewerReacted: review.viewerReacted ?? null,
    ownBody: shared ? null : review.body,
  };
}

function requireUnique(ids: string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new DiscussionError(`${what} ${id} is stored twice`);
    }
    seen.add(id);
  }
}

/**
 * The rows of a PR's discussion: every comment once (a thread holds the
 * same comment as the flat list), each thread and each review. A review's
 * body is left to its comment when the two are identical.
 */
export function splitDiscussion(discussion: FullDiscussion): DiscussionParts {
  const parts = new Map<string, CommentPart>();
  discussion.comments.forEach((comment, ord) => {
    if (parts.has(comment.id)) {
      throw new DiscussionError(`comment ${comment.id} is in the comment list twice`);
    }
    parts.set(comment.id, commentPart(comment, ord, null));
  });
  requireUnique(
    discussion.threads.map((thread) => thread.id),
    'thread',
  );
  for (const thread of discussion.threads) {
    addThreadComments(parts, thread);
  }
  requireUnique(
    discussion.reviews.map((review) => review.id),
    'review',
  );
  return {
    comments: [...parts.values()],
    threads: discussion.threads.map((thread, ord) => ({ id: thread.id, ord, path: thread.path, isResolved: thread.isResolved })),
    reviews: discussion.reviews.map((review, ord) => reviewPart(review, ord, parts)),
  };
}

function toComment(part: CommentPart): Comment {
  const comment: Comment = {
    id: part.id,
    author: part.author,
    body: part.body,
    createdAt: part.createdAt,
    kind: part.kind,
    url: part.url,
    path: part.path,
    threadId: part.threadId,
  };
  if (part.reviewId !== null) {
    comment.reviewId = part.reviewId;
  }
  comment.lastEditedAt = part.lastEditedAt;
  comment.editor = part.editor;
  if (part.updatedAt !== null) {
    comment.updatedAt = part.updatedAt;
  }
  if (part.viewerReacted !== null) {
    comment.viewerReacted = part.viewerReacted;
  }
  return comment;
}

/** The items in position order; throws when two share a position. */
function inOrder<T>(placed: Array<{ position: number; item: T }>, what: string): T[] {
  const sorted = placed.toSorted((a, b) => a.position - b.position);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.position === sorted[index - 1]!.position) {
      throw new DiscussionError(`two entries at position ${sorted[index]!.position} of ${what}`);
    }
  }
  return sorted.map((entry) => entry.item);
}

function reviewBody(part: ReviewPart, comments: Map<string, Comment>): string | null {
  if (part.ownBody !== null) {
    return part.ownBody;
  }
  const linked = comments.get(part.id);
  if (linked === undefined || linked.kind !== 'review') {
    throw new DiscussionError(`review ${part.id} has its body in a comment that is not stored`);
  }
  return linked.body;
}

function toReview(part: ReviewPart, comments: Map<string, Comment>): Review {
  const review: Review = {
    id: part.id,
    author: part.author,
    state: part.state,
    body: reviewBody(part, comments),
    submittedAt: part.submittedAt,
    commitOid: part.commitOid,
  };
  if (part.viewerReacted !== null) {
    review.viewerReacted = part.viewerReacted;
  }
  return review;
}

/**
 * A PR's discussion from its rows. Threads hold the same comment objects
 * as `comments`, and callers must not mutate them. Comments that are only
 * in a thread (no `ord`) stay out of the flat list.
 */
export function joinDiscussion(parts: DiscussionParts): Discussion {
  const byId = new Map<string, Comment>();
  const flat: Array<{ position: number; item: Comment }> = [];
  const inThreads = new Map<string, Array<{ position: number; item: Comment }>>();
  for (const part of parts.comments) {
    if (byId.has(part.id)) {
      throw new DiscussionError(`comment ${part.id} is stored twice`);
    }
    const comment = toComment(part);
    byId.set(part.id, comment);
    if (part.ord === null && part.threadOrd === null) {
      throw new DiscussionError(`comment ${part.id} is in no list`);
    }
    if (part.ord !== null) {
      flat.push({ position: part.ord, item: comment });
    }
    if (part.threadOrd !== null) {
      if (part.threadId === null) {
        throw new DiscussionError(`comment ${part.id} has a thread position but no thread`);
      }
      const members = inThreads.get(part.threadId) ?? [];
      members.push({ position: part.threadOrd, item: comment });
      inThreads.set(part.threadId, members);
    }
  }
  requireUnique(
    parts.threads.map((thread) => thread.id),
    'thread',
  );
  const threads = inOrder(
    parts.threads.map((part) => ({ position: part.ord, item: part })),
    'the threads',
  ).map((part): ReviewThread => {
    const comments = inOrder(inThreads.get(part.id) ?? [], `thread ${part.id}`);
    inThreads.delete(part.id);
    return { id: part.id, path: part.path, isResolved: part.isResolved, comments };
  });
  const orphan = [...inThreads.keys()][0];
  if (orphan !== undefined) {
    throw new DiscussionError(`comments sit in thread ${orphan}, which is not stored`);
  }
  requireUnique(
    parts.reviews.map((review) => review.id),
    'review',
  );
  const reviews = inOrder(
    parts.reviews.map((part) => ({ position: part.ord, item: part })),
    'the reviews',
  ).map((part) => toReview(part, byId));
  return { comments: inOrder(flat, 'the comment list'), threads, reviews };
}

function canonicalComment(comment: Comment): Comment {
  return { ...comment, lastEditedAt: comment.lastEditedAt ?? null, editor: comment.editor ?? null };
}

/**
 * The PR as the discussion rows give it back: a comment's missing
 * `lastEditedAt` / `editor` become null (every rule reads them `?? null`), a
 * review's missing `commitOid` null. Everything else round-trips as it is,
 * missing fields included.
 */
export function canonicalPr<T extends Discussion>(pr: T): T {
  return {
    ...pr,
    comments: pr.comments.map(canonicalComment),
    threads: pr.threads.map((thread) => ({ ...thread, comments: thread.comments.map(canonicalComment) })),
    reviews: pr.reviews.map((review) => ({ ...review, commitOid: review.commitOid ?? null })),
  };
}

/**
 * A review's body on a board read: left out (null) unless a board rule
 * reads it (`isBodyReadByRules`), judged like the cut on save, with the
 * editor of its comment. The store applies this to the reviews it joined
 * from rows; `boardShape` to a whole PR.
 */
export function boardReviews(reviews: Review[], comments: Comment[]): Review[] {
  const editors = new Map(comments.map((comment) => [comment.id, comment.editor ?? null]));
  return reviews.map((review) => {
    if (review.body === null || isBodyReadByRules({ author: review.author, editor: editors.get(review.id) ?? null })) {
      return review;
    }
    return { ...review, body: null };
  });
}

function boardComment(comment: Comment): Comment {
  return comment.body === null || isBodyReadByRules(comment) ? comment : { ...comment, body: null };
}

/**
 * What a board read returns for a stored PR (DESIGN.md "The board diet"):
 * every comment and review body no board rule reads left out (null), and
 * `mentionedTeams` from the bodies as stored. The store reads this shape
 * from rows (SQL `postpile_reads_body`) and from the json before the
 * switch alike, so a cached board copy never changes shape; tests hold the
 * store to it.
 */
export function boardShape(pr: FullPr): Pr {
  return {
    ...pr,
    comments: pr.comments.map(boardComment),
    threads: pr.threads.map((thread) => ({ ...thread, comments: thread.comments.map(boardComment) })),
    reviews: boardReviews(pr.reviews, pr.comments),
    mentionedTeams: prTeamMentions(pr),
  };
}
