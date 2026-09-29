import type { PrRef } from '@postpile/core';
import type { BranchLookup } from './reader.ts';

// Limits per PR. Picked so 12 aliased PRs stay well inside GitHub's node
// limit even when every PR drags in its full conversation.
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

/** Former base branches, so a PR GitHub moved down after the layer below merged still finds that layer. */
const BASE_REF_CHANGES =
  'baseRefChanges: timelineItems(last: 10, itemTypes: [BASE_REF_CHANGED_EVENT]) { nodes { ... on BaseRefChangedEvent { previousRefName } } }';

const FRAGMENTS = `
fragment actor on Actor { __typename login }

fragment reviewer on RequestedReviewer {
  __typename
  ... on User { login }
  ... on Team { slug organization { login } }
}

fragment comment on Comment { author { ...actor } body createdAt }

fragment prData on PullRequest {
  number title url body state isDraft
  baseRefName headRefName headRefOid
  additions deletions changedFiles reviewDecision
  createdAt updatedAt mergedAt
  ${BASE_REF_CHANGES}
  author { ...actor }
  mergedBy { ...actor }
  labels(first: 20) { nodes { name } }
  files(first: 100) { nodes { path additions deletions } }
  reviewRequests(first: 30) { nodes { requestedReviewer { ...reviewer } } }
  reviews(last: 50) {
    nodes { id state url submittedAt createdAt ...comment commit { oid } }
  }
  comments(last: 60) { nodes { id url ...comment } }
  reviewThreads(last: 50) {
    nodes { id path isResolved comments(first: 30) { nodes { id url ...comment } } }
  }
  commits(last: 50) {
    nodes { commit { oid messageHeadline committedDate author { name user { login } } } }
  }
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
  timelineItems(last: 60, itemTypes: [${TIMELINE_TYPES.join(', ')}]) {
    nodes {
      __typename
      ... on ReviewRequestedEvent { id createdAt actor { ...actor } requestedReviewer { ...reviewer } }
      ... on ReviewRequestRemovedEvent { id createdAt actor { ...actor } requestedReviewer { ...reviewer } }
      ${simpleTimelineSelections}
    }
  }
}`;

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
