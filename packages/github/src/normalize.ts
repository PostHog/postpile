import {
  prKey,
  trimBotBody,
  type CapHit,
  type Comment,
  type Commit,
  type Pr,
  type PrRef,
  type PrState,
  type Review,
  type ReviewDecision,
  type ReviewState,
  type ReviewThread,
  type TimelineItem,
  type TimelineItemKind,
} from '@postpile/core';
import { QUERY_CAPS } from './queries.ts';
import type { BranchPr } from './reader.ts';
import type {
  RawActor,
  RawBaseRefChanges,
  RawBranchPr,
  RawComment,
  RawCommit,
  RawConnection,
  RawEdit,
  RawPullRequest,
  RawReactions,
  RawRequestedReviewer,
  RawReview,
  RawReviewThread,
  RawTimelineItem,
} from './raw.ts';

/**
 * Core compares timestamps as strings, so every time must be in the same
 * form. GitHub sends "...Z" without milliseconds while the app writes
 * toISOString() with them; normalising both avoids off-by-a-second compares.
 */
export function isoTime(value: string): string {
  return new Date(value).toISOString();
}

export function isoTimeOrNull(value: string | null): string | null {
  return value === null ? null : isoTime(value);
}

const TIMELINE_KINDS: Record<string, TimelineItemKind> = {
  ReviewRequestedEvent: 'review_requested',
  ReviewRequestRemovedEvent: 'review_request_removed',
  MergedEvent: 'merged',
  ClosedEvent: 'closed',
  ReopenedEvent: 'reopened',
  ReadyForReviewEvent: 'ready_for_review',
  ConvertToDraftEvent: 'converted_to_draft',
  HeadRefForcePushedEvent: 'head_ref_force_pushed',
  AddedToMergeQueueEvent: 'added_to_merge_queue',
  RemovedFromMergeQueueEvent: 'removed_from_merge_queue',
  DeployedEvent: 'deployed',
};

const REVIEW_STATES: ReadonlySet<string> = new Set<ReviewState>([
  'APPROVED',
  'CHANGES_REQUESTED',
  'COMMENTED',
  'DISMISSED',
  'PENDING',
]);

const REVIEW_DECISIONS: ReadonlySet<string> = new Set<ReviewDecision>(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']);

/**
 * GraphQL returns bot logins without the "[bot]" suffix REST uses
 * ("github-actions" vs "github-actions[bot]"). Adding it back makes isBot()
 * reliable for any app, not just the ones on the list. Deleted users come
 * back as null and become "".
 */
export function actorLogin(actor: RawActor | null | undefined): string {
  if (!actor) {
    return '';
  }
  if (actor.__typename === 'Bot' && !actor.login.endsWith('[bot]')) {
    return `${actor.login}[bot]`;
  }
  return actor.login;
}

/** User -> login, Team -> "org/slug". Bots and mannequins are dropped. */
export function reviewerName(reviewer: RawRequestedReviewer | null | undefined): string | null {
  if (!reviewer) {
    return null;
  }
  if (reviewer.__typename === 'User' && reviewer.login) {
    return reviewer.login;
  }
  if (reviewer.__typename === 'Team' && reviewer.slug && reviewer.organization) {
    return `${reviewer.organization.login}/${reviewer.slug}`;
  }
  return null;
}

function toPrState(state: string): PrState {
  if (state === 'MERGED' || state === 'CLOSED') {
    return state;
  }
  return 'OPEN';
}

/** Former base branches, oldest first, without repeats. */
function previousBaseRefs(changes: RawBaseRefChanges | undefined): string[] {
  const refs: string[] = [];
  for (const node of changes?.nodes ?? []) {
    const ref = node?.previousRefName ?? node?.oldBase;
    if (ref && !refs.includes(ref)) {
      refs.push(ref);
    }
  }
  return refs;
}

export function toBranchPr(repo: string, raw: RawBranchPr): BranchPr {
  return {
    ref: { repo, number: raw.number },
    state: toPrState(raw.state),
    createdAt: isoTime(raw.createdAt),
    mergedAt: isoTimeOrNull(raw.mergedAt),
    updatedAt: isoTime(raw.updatedAt),
    baseRef: raw.baseRefName,
    headRef: raw.headRefName,
    previousBaseRefs: previousBaseRefs(raw.baseRefChanges),
  };
}

function toReviewDecision(decision: string | null): ReviewDecision {
  return decision && REVIEW_DECISIONS.has(decision) ? (decision as ReviewDecision) : 'NONE';
}

/**
 * Whether the viewer gave it a thumbs up, as `viewerReacted`. Left out when
 * the raw node has no reaction groups (fixtures and answers from before
 * they were asked for), so those read as false like older snapshots.
 */
function toReacted(raw: RawReactions): Pick<Comment, 'viewerReacted'> {
  if (raw.reactionGroups === undefined) {
    return {};
  }
  return { viewerReacted: raw.reactionGroups.some((group) => group.content === 'THUMBS_UP' && group.viewerHasReacted) };
}

/** Who edited a comment or review body last, null when GitHub does not say. */
function editorLogin(raw: RawEdit): string | null {
  return raw.editor ? actorLogin(raw.editor) : null;
}

/**
 * The body as PostPile stores it: a bot's long body cut to BOT_BODY_MAX
 * (`trimBotBody`, DESIGN.md "Bot bodies are cut when saved"), the same way
 * in every copy and on every path that fetches a PR.
 */
function storedBody(raw: RawEdit & { author: RawActor | null; body: string }): string {
  return trimBotBody({ author: actorLogin(raw.author), body: raw.body, editor: editorLogin(raw) });
}

function toReview(raw: RawReview): Review {
  return {
    id: raw.id,
    author: actorLogin(raw.author),
    state: REVIEW_STATES.has(raw.state) ? (raw.state as ReviewState) : 'COMMENTED',
    body: storedBody(raw),
    submittedAt: isoTime(raw.submittedAt ?? raw.createdAt),
    commitOid: raw.commit?.oid ?? null,
    ...toReacted(raw),
  };
}

/** The last edit of a comment or review body: when, by whom (null when GitHub does not say), and the comment's updatedAt. */
function toEdit(raw: RawEdit): Pick<Comment, 'lastEditedAt' | 'editor' | 'updatedAt'> {
  const edit: Pick<Comment, 'lastEditedAt' | 'editor' | 'updatedAt'> = {
    lastEditedAt: isoTimeOrNull(raw.lastEditedAt ?? null),
    editor: editorLogin(raw),
  };
  if (raw.updatedAt) {
    edit.updatedAt = isoTime(raw.updatedAt);
  }
  return edit;
}

function toIssueComment(raw: RawComment): Comment {
  return {
    id: raw.id,
    author: actorLogin(raw.author),
    body: storedBody(raw),
    createdAt: isoTime(raw.createdAt),
    kind: 'comment',
    url: raw.url,
    path: null,
    threadId: null,
    ...toEdit(raw),
    ...toReacted(raw),
  };
}

function toReviewBodyComment(raw: RawReview): Comment {
  return {
    id: raw.id,
    author: actorLogin(raw.author),
    body: storedBody(raw),
    createdAt: isoTime(raw.submittedAt ?? raw.createdAt),
    kind: 'review',
    url: raw.url,
    path: null,
    threadId: null,
    ...toEdit(raw),
    ...toReacted(raw),
  };
}

/**
 * The viewer's own unsent review and its inline comments: GitHub shows them
 * only to the viewer, as drafts. They never count as the viewer's reply,
 * touch or comment, so normalization leaves them out.
 */
function isPending(raw: { state?: string }): boolean {
  return raw.state === 'PENDING';
}

/** The review an inline comment was submitted with, as `reviewId`; left out when GitHub does not say, never guessed. */
function toReviewId(raw: RawComment): Pick<Comment, 'reviewId'> {
  const id = raw.pullRequestReview?.id;
  return id ? { reviewId: id } : {};
}

function toThread(raw: RawReviewThread): ReviewThread {
  const submitted = raw.comments.nodes.filter((c) => !isPending(c));
  const comments: Comment[] = submitted.map((c) => ({
    id: c.id,
    author: actorLogin(c.author),
    body: storedBody(c),
    createdAt: isoTime(c.createdAt),
    kind: 'review_comment',
    url: c.url,
    path: raw.path,
    threadId: raw.id,
    ...toReviewId(c),
    ...toEdit(c),
    ...toReacted(c),
  }));
  return { id: raw.id, path: raw.path, isResolved: raw.isResolved, comments };
}

/** Submitted review bodies with text, as comments. */
function reviewBodyComments(reviews: RawReview[]): Comment[] {
  return reviews.filter((review) => !isPending(review) && review.body.trim() !== '').map(toReviewBodyComment);
}

function oldestFirst(comments: Comment[]): Comment[] {
  return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * The flat list of every authored body: issue comments, non-empty submitted
 * review bodies, and inline review comments. Oldest first.
 */
function allComments(raw: RawPullRequest, threads: ReviewThread[]): Comment[] {
  return oldestFirst([...raw.comments.nodes.map(toIssueComment), ...reviewBodyComments(raw.reviews.nodes), ...threads.flatMap((thread) => thread.comments)]);
}

function toCommit(raw: RawCommit): Commit {
  const author = raw.commit.author;
  const committer = raw.commit.committer;
  return {
    oid: raw.commit.oid,
    headline: raw.commit.messageHeadline,
    author: author?.user?.login ?? author?.name ?? '',
    committer: committer?.user?.login ?? committer?.name ?? '',
    committedAt: isoTime(raw.commit.committedDate),
  };
}

function toTimelineItem(raw: RawTimelineItem): TimelineItem | null {
  const kind = TIMELINE_KINDS[raw.__typename];
  if (!kind) {
    return null;
  }
  return {
    id: raw.id,
    kind,
    actor: actorLogin(raw.actor),
    at: isoTime(raw.createdAt),
    subject: reviewerName(raw.requestedReviewer),
  };
}

function pendingReviewers(raw: RawPullRequest): { users: string[]; teams: string[] } {
  const users: string[] = [];
  const teams: string[] = [];
  for (const node of raw.reviewRequests.nodes) {
    const name = reviewerName(node.requestedReviewer);
    if (!name) {
      continue;
    }
    if (node.requestedReviewer?.__typename === 'Team') {
      teams.push(name);
    } else {
      users.push(name);
    }
  }
  return { users, teams };
}

/** More of a list on GitHub than the query took. A missing count (old fixtures) is no evidence. */
function cutOff(list: { totalCount?: number; nodes: unknown[] }): boolean {
  return list.totalCount !== undefined && list.totalCount > list.nodes.length;
}

/** The oldest of the times, null for none. */
function oldestOf(times: string[]): string | null {
  return times.length === 0 ? null : isoTime(times.toSorted()[0]!);
}

/** The list came back full at its cap with more on GitHub: the cap, not GitHub, left items out. */
function hitCap(list: { totalCount?: number; nodes: unknown[] }, cap: number): boolean {
  return list.nodes.length >= cap && cutOff(list);
}

function reviewTime(review: RawReview): string {
  return review.submittedAt ?? review.createdAt;
}

/** A newest-N list's cap hit: the oldest item it came back with, and the cursor of the page before it (only when the query asked for one). */
function olderListHit(list: CapHit['list'], connection: RawConnection<unknown>, times: string[] | null): CapHit {
  const hit: CapHit = { list, nodes: connection.nodes.length, oldestAt: times === null ? null : oldestOf(times) };
  if (connection.pageInfo !== undefined) {
    hit.cursor = connection.pageInfo.startCursor ?? null;
  }
  return hit;
}

/** The cap hits of threads whose comments came back full at the first-N cap, each with its thread and the cursor after its last comment. */
function threadCommentHits(threads: RawReviewThread[]): CapHit[] {
  return threads
    .filter((thread) => hitCap(thread.comments, QUERY_CAPS.threadComments))
    .map((thread) => {
      const hit: CapHit = { list: 'thread_comments', nodes: thread.comments.nodes.length, oldestAt: null, threadId: thread.id };
      if (thread.comments.pageInfo !== undefined) {
        hit.cursor = thread.comments.pageInfo.endCursor ?? null;
      }
      return hit;
    });
}

/**
 * Every activity list the query caps (queries.ts): the last 50 reviews, 60
 * comments, 50 review threads (and the first 30 comments of each), 50
 * commits and 60 timeline items. Past any cap an event never arrives (a
 * human comment followed by 60 bot comments). This records which lists hit
 * their cap, read from the raw answer before any node is dropped
 * (draft-only threads, draft comments, timeline items not read), with how
 * many nodes came back, the oldest of them and the cursor to page on.
 * Core decides from these how far back the snapshot reaches
 * (`snapshotCoversSince`); cap-fill.ts pages older items in.
 */
function capHits(raw: RawPullRequest): CapHit[] {
  const hits: CapHit[] = [];
  const add = (list: CapHit['list'], connection: RawConnection<unknown>, cap: number, times: string[] | null) => {
    if (hitCap(connection, cap)) {
      hits.push(olderListHit(list, connection, times));
    }
  };
  add('reviews', raw.reviews, QUERY_CAPS.reviews, raw.reviews.nodes.map(reviewTime));
  add('comments', raw.comments, QUERY_CAPS.comments, raw.comments.nodes.map((comment) => comment.createdAt));
  add('review_threads', raw.reviewThreads, QUERY_CAPS.reviewThreads, null);
  hits.push(...threadCommentHits(raw.reviewThreads.nodes));
  add('commits', raw.commits, QUERY_CAPS.commits, raw.commits.nodes.map((node) => node.commit.committedDate));
  add('timeline', raw.timelineItems, QUERY_CAPS.timeline, raw.timelineItems.nodes.map((item) => item.createdAt));
  return hits;
}

function isTruncated(raw: RawPullRequest): boolean {
  const lists = [raw.reviews, raw.comments, raw.reviewThreads, raw.commits, raw.timelineItems];
  return lists.some(cutOff) || raw.reviewThreads.nodes.some((thread) => cutOff(thread.comments));
}

export function toPr(ref: PrRef, raw: RawPullRequest): Pr {
  // A thread started in a pending review holds only drafts: not there yet for anyone else.
  const threads = raw.reviewThreads.nodes.map(toThread).filter((thread) => thread.comments.length > 0);
  const reviewers = pendingReviewers(raw);
  const timeline: TimelineItem[] = [];
  for (const item of raw.timelineItems.nodes) {
    const normalized = toTimelineItem(item);
    if (normalized) {
      timeline.push(normalized);
    }
  }

  return {
    key: prKey(ref),
    ref: { repo: ref.repo, number: ref.number },
    title: raw.title,
    url: raw.url,
    body: raw.body,
    author: actorLogin(raw.author),
    assignees: (raw.assignees?.nodes ?? []).flatMap((node) => (node ? [node.login] : [])),
    state: toPrState(raw.state),
    isDraft: raw.isDraft,
    baseRef: raw.baseRefName,
    headRef: raw.headRefName,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    files: raw.files?.nodes.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })) ?? [],
    labels: raw.labels.nodes.map((l) => l.name),
    reviewDecision: toReviewDecision(raw.reviewDecision),
    reviewerUsers: reviewers.users,
    reviewerTeams: reviewers.teams,
    reviews: raw.reviews.nodes.map(toReview),
    commits: raw.commits.nodes.map(toCommit),
    comments: allComments(raw, threads),
    threads,
    timeline,
    headOid: raw.headRefOid,
    createdAt: isoTime(raw.createdAt),
    updatedAt: isoTime(raw.updatedAt),
    mergedAt: isoTimeOrNull(raw.mergedAt),
    mergedBy: raw.mergedBy ? actorLogin(raw.mergedBy) : null,
    previousBaseRefs: previousBaseRefs(raw.baseRefChanges),
    isCrossRepository: raw.isCrossRepository ?? false,
    truncated: isTruncated(raw),
    capHits: capHits(raw),
  };
}

/**
 * One more page of a capped list (cap-fill.ts): for a newest-N list the
 * page before the oldest one the snapshot has, for a thread's comments the
 * page after its newest.
 */
export type OlderPage =
  | { list: 'reviews'; page: RawConnection<RawReview> }
  | { list: 'comments'; page: RawConnection<RawComment> }
  | { list: 'review_threads'; page: RawConnection<RawReviewThread> }
  | { list: 'commits'; page: RawConnection<RawCommit> }
  | { list: 'timeline'; page: RawConnection<RawTimelineItem> }
  | { list: 'thread_comments'; thread: RawReviewThread };

/** `added` items the list does not have yet (by id), in their order. */
function notIn<T>(list: T[], added: T[], idOf: (item: T) => string): T[] {
  const known = new Set(list.map(idOf));
  return added.filter((item) => !known.has(idOf(item)));
}

/** The snapshot's comments plus the new ones, oldest first. */
function withComments(comments: Comment[], added: Comment[]): Comment[] {
  return oldestFirst([...comments, ...notIn(comments, added, (comment) => comment.id)]);
}

/**
 * A newest-N list's hit after one more older page: its nodes added, the
 * oldest item now, the cursor before the page, and complete once GitHub
 * says there is no page before it.
 */
function olderPageHit(hit: CapHit, page: RawConnection<unknown>, times: string[] | null): CapHit {
  const oldestAt = times === null ? null : oldestOf(hit.oldestAt === null ? times : [...times, hit.oldestAt]);
  return { ...hit, nodes: hit.nodes + page.nodes.length, oldestAt, cursor: page.pageInfo?.startCursor ?? null, complete: page.pageInfo?.hasPreviousPage === false };
}

/** The snapshot's cap hits with the one `list` hit moved on by the page. */
function capHitsAfter(pr: Pr, list: CapHit['list'], page: RawConnection<unknown>, times: string[] | null): CapHit[] {
  return (pr.capHits ?? []).map((hit) => (hit.list === list ? olderPageHit(hit, page, times) : hit));
}

/** A thread's comments page added to the snapshot: new comments after the ones it has, its hit moved past them. */
function addThreadComments(pr: Pr, raw: RawReviewThread): Pr {
  const paged = toThread(raw);
  const known = pr.threads.find((thread) => thread.id === paged.id);
  const added = known === undefined ? paged.comments : notIn(known.comments, paged.comments, (comment) => comment.id);
  let threads = pr.threads;
  if (known !== undefined) {
    threads = pr.threads.map((thread) => (thread === known ? { ...thread, comments: [...thread.comments, ...added] } : thread));
  } else if (paged.comments.length > 0) {
    threads = [...pr.threads, paged];
  }
  const pageInfo = raw.comments.pageInfo;
  const capHits = (pr.capHits ?? []).map((hit) =>
    hit.list === 'thread_comments' && hit.threadId === raw.id
      ? { ...hit, nodes: hit.nodes + raw.comments.nodes.length, cursor: pageInfo?.endCursor ?? null, complete: pageInfo?.hasNextPage === false }
      : hit,
  );
  return { ...pr, threads, comments: withComments(pr.comments, added), capHits };
}

/**
 * Adds one more page of a capped list to the snapshot, normalized exactly
 * like the PR query and without repeats (by id, commits by oid), and moves
 * the list's cap hit: further back, or complete. Threads on an older page
 * whose comments hit their own cap bring new thread_comments hits.
 */
export function addOlderPage(pr: Pr, older: OlderPage): Pr {
  switch (older.list) {
    case 'reviews': {
      const nodes = older.page.nodes;
      return {
        ...pr,
        reviews: [...notIn(pr.reviews, nodes.map(toReview), (review) => review.id), ...pr.reviews],
        comments: withComments(pr.comments, reviewBodyComments(nodes)),
        capHits: capHitsAfter(pr, 'reviews', older.page, nodes.map(reviewTime)),
      };
    }
    case 'comments': {
      const nodes = older.page.nodes;
      return {
        ...pr,
        comments: withComments(pr.comments, nodes.map(toIssueComment)),
        capHits: capHitsAfter(pr, 'comments', older.page, nodes.map((comment) => comment.createdAt)),
      };
    }
    case 'review_threads': {
      const threads = notIn(pr.threads, older.page.nodes.map(toThread), (thread) => thread.id).filter((thread) => thread.comments.length > 0);
      const threadIdsWithHits = new Set((pr.capHits ?? []).map((hit) => hit.threadId));
      const newHits = threadCommentHits(older.page.nodes).filter((hit) => !threadIdsWithHits.has(hit.threadId));
      return {
        ...pr,
        threads: [...threads, ...pr.threads],
        comments: withComments(pr.comments, threads.flatMap((thread) => thread.comments)),
        capHits: [...capHitsAfter(pr, 'review_threads', older.page, null), ...newHits],
      };
    }
    case 'commits': {
      const nodes = older.page.nodes;
      return {
        ...pr,
        commits: [...notIn(pr.commits, nodes.map(toCommit), (commit) => commit.oid), ...pr.commits],
        capHits: capHitsAfter(pr, 'commits', older.page, nodes.map((node) => node.commit.committedDate)),
      };
    }
    case 'timeline': {
      const nodes = older.page.nodes;
      const items = nodes.map(toTimelineItem).filter((item) => item !== null);
      return {
        ...pr,
        timeline: [...notIn(pr.timeline, items, (item) => item.id), ...pr.timeline],
        capHits: capHitsAfter(pr, 'timeline', older.page, nodes.map((item) => item.createdAt)),
      };
    }
    case 'thread_comments':
      return addThreadComments(pr, older.thread);
  }
}
