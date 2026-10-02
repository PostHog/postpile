import type { CappedList, PrRef } from '@postpile/core';
import type { BranchLookup } from './reader.ts';

// Limits per PR. Picked so 12 aliased PRs stay well inside GitHub's node
// limit even when every PR drags in its full conversation.

/**
 * The caps on the activity lists: the last N reviews, comments, review
 * threads, commits and timeline items, the first N comments of a thread.
 * Normalizing records which ones came back full (`Pr.capHits`).
 */
export const QUERY_CAPS = { reviews: 50, comments: 60, reviewThreads: 50, threadComments: 30, commits: 50, timeline: 60 } as const;

const TIMELINE_TYPES = [
  'REVIEW_REQUESTED_EVENT',
  'REVIEW_REQUEST_REMOVED_EVENT',
  'MERGED_EVENT',
  'CLOSED_EVENT',
  'REOPENED_EVENT',
  'READY_FOR_REVIEW_EVENT',
  'CONVERT_TO_DRAFT_EVENT',
  'HEAD_REF_FORCE_PUSHED_EVENT',
  'ADDED_TO_MERGE_QUEUE_EVENT',
  'REMOVED_FROM_MERGE_QUEUE_EVENT',
  'DEPLOYED_EVENT',
];

// Timeline events that only need who and when.
const SIMPLE_TIMELINE_EVENTS = [
  'MergedEvent',
  'ClosedEvent',
  'ReopenedEvent',
  'ReadyForReviewEvent',
  'ConvertToDraftEvent',
  'HeadRefForcePushedEvent',
  'AddedToMergeQueueEvent',
  'RemovedFromMergeQueueEvent',
  'DeployedEvent',
];

const simpleTimelineSelections = SIMPLE_TIMELINE_EVENTS.map(
  (type) => `... on ${type} { id createdAt actor { ...actor } }`,
).join('\n        ');

/**
 * Former base branches, so a PR GitHub moved down after the layer below
 * merged still finds that layer. A base changed by hand is a
 * BaseRefChangedEvent; the move GitHub makes itself when the layer below
 * merges and its branch goes away is an AutomaticBaseChangeSucceededEvent.
 */
const BASE_REF_CHANGES =
  'baseRefChanges: timelineItems(last: 10, itemTypes: [BASE_REF_CHANGED_EVENT, AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT]) { nodes { ' +
  '... on BaseRefChangedEvent { previousRefName } ... on AutomaticBaseChangeSucceededEvent { oldBase } } }';

const ACTOR_FRAGMENT = 'fragment actor on Actor { __typename login }';

const REVIEWER_FRAGMENT = `fragment reviewer on RequestedReviewer {
  __typename
  ... on User { login }
  ... on Team { slug organization { login } }
}`;

const COMMENT_FRAGMENT = 'fragment comment on Comment { author { ...actor } body createdAt lastEditedAt updatedAt editor { ...actor } }';

// The node selections of the capped lists, shared by the PR query and the
// older-page queries (cap-fill.ts), so paged-in items normalize the same.
const REVIEW_NODE = 'id state url submittedAt createdAt ...comment commit { oid }';
const COMMENT_NODE = 'id url ...comment';
const THREAD_COMMENT_NODE = 'id url state ...comment';
/** A thread's first comments; the end cursor lets cap-fill.ts page on past the cap. */
const THREAD_COMMENTS = `comments(first: ${QUERY_CAPS.threadComments}) { totalCount pageInfo { hasNextPage endCursor } nodes { ${THREAD_COMMENT_NODE} } }`;
const THREAD_NODE = `id path isResolved ${THREAD_COMMENTS}`;
const COMMIT_NODE = 'commit { oid messageHeadline committedDate author { name user { login } } committer { name user { login } } }';
const TIMELINE_NODE = `__typename
      ... on ReviewRequestedEvent { id createdAt actor { ...actor } requestedReviewer { ...reviewer } }
      ... on ReviewRequestRemovedEvent { id createdAt actor { ...actor } requestedReviewer { ...reviewer } }
      ${simpleTimelineSelections}`;
/** Where the newest-N page starts, so cap-fill.ts can ask for the page before it. */
const OLDER_PAGE_INFO = 'pageInfo { hasPreviousPage startCursor }';

const FRAGMENTS = `
${ACTOR_FRAGMENT}

${REVIEWER_FRAGMENT}

${COMMENT_FRAGMENT}

fragment prData on PullRequest {
  number title url body state isDraft
  baseRefName headRefName headRefOid isCrossRepository
  additions deletions changedFiles reviewDecision
  createdAt updatedAt mergedAt
  ${BASE_REF_CHANGES}
  author { ...actor }
  assignees(first: 10) { nodes { login } }
  mergedBy { ...actor }
  labels(first: 20) { nodes { name } }
  files(first: 100) { nodes { path additions deletions } }
  reviewRequests(first: 30) { nodes { requestedReviewer { ...reviewer } } }
  reviews(last: ${QUERY_CAPS.reviews}) { totalCount ${OLDER_PAGE_INFO} nodes { ${REVIEW_NODE} } }
  comments(last: ${QUERY_CAPS.comments}) { totalCount ${OLDER_PAGE_INFO} nodes { ${COMMENT_NODE} } }
  reviewThreads(last: ${QUERY_CAPS.reviewThreads}) { totalCount ${OLDER_PAGE_INFO} nodes { ${THREAD_NODE} } }
  commits(last: ${QUERY_CAPS.commits}) { totalCount ${OLDER_PAGE_INFO} nodes { ${COMMIT_NODE} } }
  headCommit: commits(last: 1) {
    nodes { commit { statusCheckRollup {
      state
      contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name conclusion completedAt }
        ... on StatusContext { context state createdAt }
      } }
    } } }
  }
  timelineItems(last: ${QUERY_CAPS.timeline}, itemTypes: [${TIMELINE_TYPES.join(', ')}]) {
    totalCount
    ${OLDER_PAGE_INFO}
    nodes {
      ${TIMELINE_NODE}
    }
  }
}`;

/** The capped lists that keep the newest N, paged backwards from the oldest page's start cursor. */
export type OlderList = Exclude<CappedList, 'thread_comments'>;

/** Per list: the connection with its page size and `before:` cursor, the node selection, the fragments it uses (GitHub rejects unused ones). */
const OLDER_LISTS: Record<OlderList, { connection: string; node: string; fragments: string[] }> = {
  reviews: { connection: `reviews(last: ${QUERY_CAPS.reviews}, before: $cursor)`, node: REVIEW_NODE, fragments: [ACTOR_FRAGMENT, COMMENT_FRAGMENT] },
  comments: { connection: `comments(last: ${QUERY_CAPS.comments}, before: $cursor)`, node: COMMENT_NODE, fragments: [ACTOR_FRAGMENT, COMMENT_FRAGMENT] },
  review_threads: {
    connection: `reviewThreads(last: ${QUERY_CAPS.reviewThreads}, before: $cursor)`,
    node: THREAD_NODE,
    fragments: [ACTOR_FRAGMENT, COMMENT_FRAGMENT],
  },
  commits: { connection: `commits(last: ${QUERY_CAPS.commits}, before: $cursor)`, node: COMMIT_NODE, fragments: [] },
  timeline: {
    connection: `timelineItems(last: ${QUERY_CAPS.timeline}, before: $cursor, itemTypes: [${TIMELINE_TYPES.join(', ')}])`,
    node: TIMELINE_NODE,
    fragments: [ACTOR_FRAGMENT, REVIEWER_FRAGMENT],
  },
};

/** One older page of one capped list of one PR, aliased `page`, selected exactly like the PR query. Variables: owner, name, number, cursor. */
export function buildOlderPageQuery(list: OlderList): string {
  const spec = OLDER_LISTS[list];
  return `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    page: ${spec.connection} { ${OLDER_PAGE_INFO} nodes { ${spec.node} } }
  } }
}
${spec.fragments.join('\n')}`;
}

/** The next page of one review thread's comments, after its end cursor. Variables: id, cursor. */
export const THREAD_COMMENTS_PAGE_QUERY = `query($id: ID!, $cursor: String) {
  node(id: $id) { ... on PullRequestReviewThread {
    id path isResolved
    comments(first: ${QUERY_CAPS.threadComments}, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${THREAD_COMMENT_NODE} } }
  } }
}
${ACTOR_FRAGMENT}
${COMMENT_FRAGMENT}`;

export function batchAlias(index: number): string {
  return `p${index}`;
}

/** One aliased repository lookup per PR (p0, p1, ...), all sharing the prData fragment. */
export function buildPrBatchQuery(refs: PrRef[]): string {
  const lines = refs.map((ref, index) => {
    const [owner, name] = ref.repo.split('/');
    return `  ${batchAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { ...prData } }`;
  });
  return `query {\n${lines.join('\n')}\n}\n${FRAGMENTS}`;
}

/** One aliased lookup per PR (p0, p1, ...) for updatedAt alone: the freshness check. */
export function buildUpdatedAtQuery(refs: PrRef[]): string {
  const lines = refs.map((ref, index) => {
    const [owner, name] = ref.repo.split('/');
    return `  ${batchAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { updatedAt } }`;
  });
  return `query {\n${lines.join('\n')}\n}`;
}

export function branchAlias(index: number): string {
  return `b${index}`;
}

/** Newest PRs per branch lookup, in any state: open, merged and closed layers all belong to a stack. */
const BRANCH_PRS_PER_LOOKUP = 10;

/** One aliased repository lookup per branch (b0, b1, ...): the repo's default branch plus matching PRs. */
export function buildBranchQuery(lookups: BranchLookup[]): string {
  const lines = lookups.map((lookup, index) => {
    const [owner, name] = lookup.repo.split('/');
    const filter = lookup.side === 'head' ? 'headRefName' : 'baseRefName';
    const prs =
      `pullRequests(${filter}: ${JSON.stringify(lookup.branch)}, first: ${BRANCH_PRS_PER_LOOKUP}, states: [OPEN, MERGED, CLOSED], ` +
      'orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { number state createdAt mergedAt updatedAt baseRefName headRefName isCrossRepository ' +
      `${BASE_REF_CHANGES} } }`;
    return `  ${branchAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { defaultBranchRef { name } ${prs} }`;
  });
  return `query {\n${lines.join('\n')}\n}`;
}

// databaseId is the viewer's numeric GitHub user id, the input to the
// telemetry identity hash (never the login itself).
export const VIEWER_LOGIN_QUERY = 'query { viewer { login databaseId } }';

// Teams need the login first: `userLogins` filters each org's teams to the viewer's.
export const VIEWER_TEAMS_QUERY = `query($login: String!) {
  viewer {
    login
    organizations(first: 50) { nodes { login teams(first: 100, userLogins: [$login]) { nodes { slug } } } }
  }
}`;
