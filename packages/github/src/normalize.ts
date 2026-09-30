import {
  prKey,
  type CapHit,
  type CheckContext,
  type CheckRollup,
  type Checks,
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
  RawCheckContext,
  RawComment,
  RawCommit,
  RawEdit,
  RawPullRequest,
  RawRequestedReviewer,
  RawReview,
  RawReviewThread,
  RawStatusCheckRollup,
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

function toReview(raw: RawReview): Review {
  return {
    id: raw.id,
    author: actorLogin(raw.author),
    state: REVIEW_STATES.has(raw.state) ? (raw.state as ReviewState) : 'COMMENTED',
    body: raw.body,
    submittedAt: isoTime(raw.submittedAt ?? raw.createdAt),
    commitOid: raw.commit?.oid ?? null,
  };
}

/** The last edit of a comment or review body: when, by whom (null when GitHub does not say), and the comment's updatedAt. */
function toEdit(raw: RawEdit): Pick<Comment, 'lastEditedAt' | 'editor' | 'updatedAt'> {
  const edit: Pick<Comment, 'lastEditedAt' | 'editor' | 'updatedAt'> = {
    lastEditedAt: isoTimeOrNull(raw.lastEditedAt ?? null),
    editor: raw.editor ? actorLogin(raw.editor) : null,
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
    body: raw.body,
    createdAt: isoTime(raw.createdAt),
    kind: 'comment',
    url: raw.url,
    path: null,
    threadId: null,
    ...toEdit(raw),
  };
}

function toReviewBodyComment(raw: RawReview): Comment {
  return {
    id: raw.id,
    author: actorLogin(raw.author),
    body: raw.body,
    createdAt: isoTime(raw.submittedAt ?? raw.createdAt),
    kind: 'review',
    url: raw.url,
    path: null,
    threadId: null,
    ...toEdit(raw),
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

function toThread(raw: RawReviewThread): ReviewThread {
  const submitted = raw.comments.nodes.filter((c) => !isPending(c));
  const comments: Comment[] = submitted.map((c) => ({
    id: c.id,
    author: actorLogin(c.author),
    body: c.body,
    createdAt: isoTime(c.createdAt),
    kind: 'review_comment',
    url: c.url,
    path: raw.path,
    threadId: raw.id,
    ...toEdit(c),
  }));
  return { id: raw.id, path: raw.path, isResolved: raw.isResolved, comments };
}

/**
 * The flat list of every authored body: issue comments, non-empty submitted
 * review bodies, and inline review comments. Oldest first.
 */
function allComments(raw: RawPullRequest, threads: ReviewThread[]): Comment[] {
  const comments = raw.comments.nodes.map(toIssueComment);
  for (const review of raw.reviews.nodes) {
    if (!isPending(review) && review.body.trim() !== '') {
      comments.push(toReviewBodyComment(review));
    }
  }
  for (const thread of threads) {
    comments.push(...thread.comments);
  }
  return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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

function toCheckRollup(state: string | undefined): CheckRollup {
  switch (state) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
    case 'ERROR':
      return 'FAILURE';
    case 'PENDING':
    case 'EXPECTED':
      return 'PENDING';
    default:
      return 'NONE';
  }
}

/** Old-style commit statuses have a state instead of a conclusion; map them onto check-run terms. */
function toCheckContext(raw: RawCheckContext): CheckContext {
  if (raw.__typename === 'CheckRun') {
    return { name: raw.name ?? '', conclusion: raw.conclusion ?? null, completedAt: isoTimeOrNull(raw.completedAt ?? null) };
  }
  const rollup = toCheckRollup(raw.state);
  if (rollup === 'PENDING' || rollup === 'NONE') {
    return { name: raw.context ?? '', conclusion: null, completedAt: null };
  }
  return { name: raw.context ?? '', conclusion: rollup, completedAt: isoTimeOrNull(raw.createdAt ?? null) };
}

function toChecks(raw: RawStatusCheckRollup | null | undefined): Checks {
  if (!raw) {
    return { rollup: 'NONE', contexts: [] };
  }
  return { rollup: toCheckRollup(raw.state), contexts: raw.contexts.nodes.map(toCheckContext) };
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

/**
 * Every activity list the query caps (queries.ts): the last 50 reviews, 60
 * comments, 50 review threads (and the first 30 comments of each), 50
 * commits and 60 timeline items. Past any cap an event never arrives (a
 * human comment followed by 60 bot comments), so the snapshot is flagged
 * and no quiet mark-read trusts it.
 */
/** The oldest of the times, null for none. */
function oldestOf(times: string[]): string | null {
  return times.length === 0 ? null : isoTime(times.toSorted()[0]!);
}

/** The list came back full at its cap with more on GitHub: the cap, not GitHub, left items out. */
function hitCap(list: { totalCount?: number; nodes: unknown[] }, cap: number): boolean {
  return list.nodes.length >= cap && cutOff(list);
}

/**
 * The capped lists that hit their cap, read from the raw answer before any
 * node is dropped (draft-only threads, draft comments, timeline items not
 * read), with how many nodes came back and the oldest of them. Core decides
 * from these whether a cut snapshot still covers an unread interval
 * (`cutSnapshotCovers`).
 */
function capHits(raw: RawPullRequest): CapHit[] {
  const hits: CapHit[] = [];
  const add = (list: CapHit['list'], connection: { totalCount?: number; nodes: unknown[] }, cap: number, times: string[] | null) => {
    if (hitCap(connection, cap)) {
      hits.push({ list, nodes: connection.nodes.length, oldestAt: times === null ? null : oldestOf(times) });
    }
  };
  add('reviews', raw.reviews, QUERY_CAPS.reviews, raw.reviews.nodes.map((review) => review.submittedAt ?? review.createdAt));
  add('comments', raw.comments, QUERY_CAPS.comments, raw.comments.nodes.map((comment) => comment.createdAt));
  add('review_threads', raw.reviewThreads, QUERY_CAPS.reviewThreads, null);
  for (const thread of raw.reviewThreads.nodes) {
    add('thread_comments', thread.comments, QUERY_CAPS.threadComments, null);
  }
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
    checks: toChecks(raw.headCommit.nodes[0]?.commit.statusCheckRollup),
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
