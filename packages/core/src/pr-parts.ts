// A PR as the rows the store keeps (DESIGN.md "PR storage"): the
// discussion (one row per GitHub comment, a row per thread and per review),
// the activity lists (a row per commit, timeline item and changed file) and
// the text (header columns and the PR body). Pure split and join, so the
// round trip can be tested here and the store only maps columns.
//
// Both directions check the data and throw rather than pick one of two
// answers: a comment twice in a list, a thread copy that differs from the
// flat copy, a position used twice, a review whose body points at a
// comment that is not there (DiscussionError); a commit, timeline item or
// file path twice (ActivityError).
import { isBodyReadByRules } from './bot-bodies.ts';
import { prTeamMentions } from './team-mentions.ts';
import type {
  CapHit,
  Comment,
  CommentKind,
  Commit,
  FullComment,
  FullPr,
  FullReview,
  FullReviewThread,
  IsoTime,
  Pr,
  PrFile,
  PrKey,
  PrRef,
  PrState,
  Review,
  ReviewDecision,
  ReviewState,
  ReviewThread,
  TimelineItem,
  TimelineItemKind,
} from './types.ts';

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
  /** The review's permalink; null for a review stored without one (before 0.25.0). */
  url: string | null;
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
    url: review.url ?? null,
    ownBody: shared ? null : review.body,
  };
}

/** Stored activity data that does not hold together: a commit, timeline item or file path twice, a position used twice. */
export class ActivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityError';
  }
}

/** DiscussionError or ActivityError: which part of the PR does not hold together. */
type PartsError = new (message: string) => Error;

function requireUnique(ids: string[], what: string, PartsErrorType: PartsError = DiscussionError): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new PartsErrorType(`${what} ${id} is stored twice`);
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
function inOrder<T>(placed: Array<{ position: number; item: T }>, what: string, PartsErrorType: PartsError = DiscussionError): T[] {
  const sorted = placed.toSorted((a, b) => a.position - b.position);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.position === sorted[index - 1]!.position) {
      throw new PartsErrorType(`two entries at position ${sorted[index]!.position} of ${what}`);
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
  if (part.url !== null) {
    review.url = part.url;
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
 * A body stays on a board read when a board rule reads it
 * (`isBodyReadByRules`), and when it is empty or whitespace: whether a
 * bot's review has text decides whether it only carries thread replies
 * (`carriedReplies`), and an empty body costs nothing. So a body left out
 * (null) always had text.
 */
function staysOnBoard(author: string, editor: string | null, body: string): boolean {
  return isBodyReadByRules({ author, editor }) || body.trim() === '';
}

/**
 * The reviews as a board read gives them: a body left out (null) unless it
 * stays on the board (`staysOnBoard`), judged like the cut on save, with
 * the editor of its review comment. The store applies this to the reviews
 * it joined from rows; `boardShape` to a whole PR.
 */
export function boardReviews(reviews: Review[], comments: Comment[]): Review[] {
  const editors = new Map(comments.map((comment) => [comment.id, comment.editor ?? null]));
  return reviews.map((review) => {
    if (review.body === null || staysOnBoard(review.author, editors.get(review.id) ?? null, review.body)) {
      return review;
    }
    return { ...review, body: null };
  });
}

function boardComment(comment: Comment): Comment {
  return comment.body === null || staysOnBoard(comment.author, comment.editor ?? null, comment.body) ? comment : { ...comment, body: null };
}

/**
 * What a board read returns for a stored PR (DESIGN.md "The board diet"):
 * every comment and review body with text no board rule reads left out
 * (null), and
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

/** The activity lists of a PR: what the activity rows hold. */
export type Activity = Pick<Pr, 'commits' | 'timeline' | 'files'>;

/** One commit of `Pr.commits`. */
export interface CommitPart {
  oid: string;
  /** Index in `Pr.commits`: paged-in older pages come first, so it is not commit time order. */
  ord: number;
  headline: string;
  author: string;
  /** Null: not recorded (snapshots stored before it was fetched); read back as missing. */
  committer: string | null;
  committedAt: IsoTime;
}

/** One item of `Pr.timeline`. */
export interface TimelinePart {
  id: string;
  ord: number;
  kind: TimelineItemKind;
  actor: string;
  at: IsoTime;
  subject: string | null;
}

/** One changed file of `Pr.files`. The path is GitHub's identity for it. */
export interface FilePart {
  path: string;
  /** Index in `Pr.files`, GitHub's order: prompts take the first N. */
  ord: number;
  additions: number;
  deletions: number;
}

export interface ActivityParts {
  commits: CommitPart[];
  timeline: TimelinePart[];
  files: FilePart[];
}

/**
 * The rows of a PR's activity lists, one per commit, timeline item and
 * changed file, each with its position. A commit oid, timeline id or file
 * path twice is refused (ActivityError), never one of them dropped.
 */
export function splitActivity(activity: Activity): ActivityParts {
  requireUnique(
    activity.commits.map((commit) => commit.oid),
    'commit',
    ActivityError,
  );
  requireUnique(
    activity.timeline.map((item) => item.id),
    'timeline item',
    ActivityError,
  );
  requireUnique(
    activity.files.map((file) => file.path),
    'file',
    ActivityError,
  );
  return {
    commits: activity.commits.map((commit, ord) => ({
      oid: commit.oid,
      ord,
      headline: commit.headline,
      author: commit.author,
      committer: commit.committer ?? null,
      committedAt: commit.committedAt,
    })),
    timeline: activity.timeline.map((item, ord) => ({ id: item.id, ord, kind: item.kind, actor: item.actor, at: item.at, subject: item.subject })),
    files: activity.files.map((file, ord) => ({ path: file.path, ord, additions: file.additions, deletions: file.deletions })),
  };
}

function toCommit(part: CommitPart): Commit {
  const commit: Commit = { oid: part.oid, headline: part.headline, author: part.author, committedAt: part.committedAt };
  if (part.committer !== null) {
    commit.committer = part.committer;
  }
  return commit;
}

/** A PR's activity lists from their rows, in stored order. Rows that do not hold together throw (ActivityError). */
export function joinActivity(parts: ActivityParts): Activity {
  requireUnique(
    parts.commits.map((commit) => commit.oid),
    'commit',
    ActivityError,
  );
  requireUnique(
    parts.timeline.map((item) => item.id),
    'timeline item',
    ActivityError,
  );
  requireUnique(
    parts.files.map((file) => file.path),
    'file',
    ActivityError,
  );
  const commits = inOrder(
    parts.commits.map((part) => ({ position: part.ord, item: part })),
    'the commits',
    ActivityError,
  ).map(toCommit);
  const timeline = inOrder(
    parts.timeline.map((part) => ({ position: part.ord, item: part })),
    'the timeline',
    ActivityError,
  ).map((part): TimelineItem => ({ id: part.id, kind: part.kind, actor: part.actor, at: part.at, subject: part.subject }));
  const files = inOrder(
    parts.files.map((part) => ({ position: part.ord, item: part })),
    'the files',
    ActivityError,
  ).map((part): PrFile => ({ path: part.path, additions: part.additions, deletions: part.deletions }));
  return { commits, timeline, files };
}

/** Everything of a PR but its lists: the header and the text. What a read builds before it joins the rows. */
export type PrText = Omit<Pr, 'comments' | 'threads' | 'reviews' | 'commits' | 'timeline' | 'files' | 'mentionedTeams'>;

/**
 * Optional `Pr` fields with a header column that cannot tell missing from
 * empty (`[]`, false). A snapshot stored before they were fetched lacks
 * them, and a read gives them back missing: the sync refetches a PR
 * without `assignees` once, so missing must not turn into none.
 */
export const OPTIONAL_HEADER_FIELDS = ['assignees', 'previousBaseRefs', 'isCrossRepository'] as const;

export type OptionalHeaderField = (typeof OPTIONAL_HEADER_FIELDS)[number];

/** What the text rows hold: the PR's own text and short fields beyond the header. */
export type PrTextFields = Pick<
  Pr,
  'url' | 'body' | 'additions' | 'deletions' | 'changedFiles' | 'labels' | 'reviewDecision' | 'mergedBy' | 'truncated' | 'capHits' | OptionalHeaderField
>;

/** The header columns of a stored PR (store `pr`), the optional fields as written: [] or false when the snapshot lacked them. */
export interface HeaderPart {
  key: PrKey;
  ref: PrRef;
  title: string;
  author: string;
  assignees: string[];
  state: PrState;
  isDraft: boolean;
  baseRef: string;
  headRef: string;
  headOid: string;
  reviewerUsers: string[];
  reviewerTeams: string[];
  previousBaseRefs: string[];
  isCrossRepository: boolean;
  createdAt: IsoTime;
  updatedAt: IsoTime;
  mergedAt: IsoTime | null;
}

/** The text columns of the header and the `pr_body` row. */
export interface TextPart {
  url: string;
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  reviewDecision: ReviewDecision;
  mergedBy: string | null;
  /** Null: not recorded (snapshots stored before it existed); read back as missing. */
  truncated: boolean | null;
  /** Null: not recorded; read back as missing, which never vouches (`snapshotCoversSince`). An empty list is not the same. */
  capHits: CapHit[] | null;
  /** The optional header fields the snapshot lacked, in `OPTIONAL_HEADER_FIELDS` order. */
  absentFields: OptionalHeaderField[];
}

/** The text rows of a PR. Missing stays missing: `truncated` and `capHits` become null, absent header fields are named. */
export function splitText(pr: PrTextFields): TextPart {
  return {
    url: pr.url,
    body: pr.body,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    labels: pr.labels,
    reviewDecision: pr.reviewDecision,
    mergedBy: pr.mergedBy,
    truncated: pr.truncated ?? null,
    capHits: pr.capHits ?? null,
    absentFields: OPTIONAL_HEADER_FIELDS.filter((field) => pr[field] === undefined),
  };
}

/** A PR without its lists, from its header and text rows: every field as the snapshot had it, missing ones missing. */
export function joinText(header: HeaderPart, text: TextPart): PrText {
  const pr: PrText = {
    key: header.key,
    ref: header.ref,
    title: header.title,
    url: text.url,
    body: text.body,
    author: header.author,
    assignees: header.assignees,
    state: header.state,
    isDraft: header.isDraft,
    baseRef: header.baseRef,
    headRef: header.headRef,
    additions: text.additions,
    deletions: text.deletions,
    changedFiles: text.changedFiles,
    labels: text.labels,
    reviewDecision: text.reviewDecision,
    reviewerUsers: header.reviewerUsers,
    reviewerTeams: header.reviewerTeams,
    headOid: header.headOid,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    mergedAt: header.mergedAt,
    mergedBy: text.mergedBy,
    previousBaseRefs: header.previousBaseRefs,
    isCrossRepository: header.isCrossRepository,
  };
  for (const field of text.absentFields) {
    delete pr[field];
  }
  if (text.truncated !== null) {
    pr.truncated = text.truncated;
  }
  if (text.capHits !== null) {
    pr.capHits = text.capHits;
  }
  return pr;
}
