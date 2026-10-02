// Shapes of what GitHub actually returns, trimmed to the fields we read.
// Only this package sees them; everything else gets normalized core types.
// The GraphQL shapes mirror the selections in queries.ts.

/** One item from GET /notifications. */
export interface RawNotification {
  id: string;
  reason: string;
  unread: boolean;
  updated_at: string;
  last_read_at: string | null;
  subject: {
    title: string;
    /** API URL, e.g. https://api.github.com/repos/o/r/pulls/123. Null for some subject types. */
    url: string | null;
    type: string;
  };
  repository: {
    full_name: string;
  };
}

/** Selected through the `actor` fragment. __typename tells bots apart. */
export interface RawActor {
  __typename?: string;
  login: string;
}

/** User, Team, Bot or Mannequin. Only users and teams carry the fields we read. */
export interface RawRequestedReviewer {
  __typename: string;
  login?: string;
  slug?: string;
  organization?: { login: string };
}

/** What the `comment` fragment adds about edits. Missing in fixtures written before it was asked for. */
export interface RawEdit {
  lastEditedAt?: string | null;
  updatedAt?: string;
  editor?: RawActor | null;
}

export interface RawComment extends RawEdit {
  id: string;
  author: RawActor | null;
  body: string;
  createdAt: string;
  url: string;
  /** Review-thread comments only: PENDING or SUBMITTED. Missing in fixtures written before it was asked for. */
  state?: string;
}

export interface RawReview extends RawEdit {
  id: string;
  author: RawActor | null;
  state: string;
  body: string;
  url: string;
  submittedAt: string | null;
  createdAt: string;
  commit: { oid: string } | null;
}

/**
 * Where a page of a connection starts and ends. The newest-N lists ask for
 * the start (hasPreviousPage, startCursor), a thread's comments for the end
 * (hasNextPage, endCursor). Missing in fixtures written before it was asked for.
 */
export interface RawPageInfo {
  hasPreviousPage?: boolean;
  startCursor?: string | null;
  hasNextPage?: boolean;
  endCursor?: string | null;
}

/** A capped connection. totalCount and pageInfo are missing in fixtures written before they were asked for. */
export interface RawConnection<T> {
  totalCount?: number;
  pageInfo?: RawPageInfo;
  nodes: T[];
}

export interface RawReviewThread {
  id: string;
  path: string;
  isResolved: boolean;
  comments: RawConnection<RawComment>;
}

export interface RawCommit {
  commit: {
    oid: string;
    messageHeadline: string;
    committedDate: string;
    author: { user: { login: string } | null; name: string | null } | null;
    committer?: { user: { login: string } | null; name: string | null } | null;
  };
}

/** A timeline node. __typename picks which optional fields are present. */
export interface RawTimelineItem {
  __typename: string;
  id: string;
  createdAt: string;
  actor: RawActor | null;
  requestedReviewer?: RawRequestedReviewer | null;
}

export interface RawCheckContext {
  __typename: 'CheckRun' | 'StatusContext';
  /** CheckRun */
  name?: string;
  conclusion?: string | null;
  completedAt?: string | null;
  /** StatusContext */
  context?: string;
  state?: string;
  createdAt?: string;
}

export interface RawStatusCheckRollup {
  state: string;
  contexts: { nodes: RawCheckContext[] };
}

/** One aliased pullRequest node from the batched GraphQL query. */
export interface RawPullRequest {
  number: number;
  title: string;
  url: string;
  body: string;
  state: string;
  isDraft: boolean;
  author: RawActor | null;
  /** Assigned users. Missing in fixtures written before it was asked for. */
  assignees?: { nodes: ({ login: string } | null)[] };
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  /** Missing in fixtures written before it was asked for. */
  isCrossRepository?: boolean;
  baseRefChanges?: RawBaseRefChanges;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  mergedBy: RawActor | null;
  labels: { nodes: { name: string }[] };
  files: { nodes: { path: string; additions: number; deletions: number }[] } | null;
  reviewRequests: { nodes: { requestedReviewer: RawRequestedReviewer | null }[] };
  reviews: RawConnection<RawReview>;
  comments: RawConnection<RawComment>;
  reviewThreads: RawConnection<RawReviewThread>;
  commits: RawConnection<RawCommit>;
  /** commits(last: 1) again, only for the head commit's check rollup. */
  headCommit: { nodes: { commit: { statusCheckRollup: RawStatusCheckRollup | null } }[] };
  timelineItems: RawConnection<RawTimelineItem>;
}

/** A PR node from a branch lookup (queries.ts buildBranchQuery). */
/**
 * timelineItems filtered to BaseRefChangedEvent (previousRefName) and
 * AutomaticBaseChangeSucceededEvent (oldBase); missing in fixtures written
 * before it was asked for.
 */
export interface RawBaseRefChanges {
  nodes: ({ previousRefName?: string; oldBase?: string } | null)[];
}

export interface RawBranchPr {
  number: number;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  updatedAt: string;
  baseRefName: string;
  headRefName: string;
  isCrossRepository: boolean;
  baseRefChanges?: RawBaseRefChanges;
}

/** Response of the branch query: b0, b1, ... one per lookup. Null when the repo is not visible. */
export type RawBranchResponse = Record<
  string,
  { defaultBranchRef: { name: string } | null; pullRequests: { nodes: (RawBranchPr | null)[] } } | null
>;

/** Response of the batched query: p0, p1, ... one per PR. Null when the repo is not visible. */
export type RawBatchResponse = Record<string, { pullRequest: RawPullRequest | null } | null>;

export interface RawViewerTeams {
  viewer: {
    login: string;
    organizations: {
      nodes: ({ login: string; teams: { nodes: { slug: string }[] } } | null)[];
    };
  };
}

/** The freshness check: updatedAt per aliased PR, null where the token cannot see the repo or the PR is gone. */
export type RawUpdatedAtResponse = Record<string, { pullRequest: { updatedAt: string } | null } | null>;

/** An older-page query's answer (queries.ts buildOlderPageQuery): the page of one list, null where the PR is not visible. */
export interface RawOlderPageResponse<T> {
  repository: { pullRequest: { page: RawConnection<T> } | null } | null;
}

/** The thread-comments page query's answer: null when the thread is gone or not visible. */
export interface RawThreadCommentsResponse {
  node: RawReviewThread | null;
}
