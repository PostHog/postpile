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

export interface RawComment {
  id: string;
  author: RawActor | null;
  body: string;
  createdAt: string;
  url: string;
  /** Review-thread comments only: PENDING or SUBMITTED. Missing in fixtures written before it was asked for. */
  state?: string;
}

export interface RawReview {
  id: string;
  author: RawActor | null;
  state: string;
  body: string;
  url: string;
  submittedAt: string | null;
  createdAt: string;
  commit: { oid: string } | null;
}

export interface RawReviewThread {
  id: string;
  path: string;
  isResolved: boolean;
  /** Missing in fixtures written before it was asked for. */
  comments: { totalCount?: number; nodes: RawComment[] };
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
  // totalCount on the capped activity lists is missing in fixtures written before it was asked for.
  reviews: { totalCount?: number; nodes: RawReview[] };
  comments: { totalCount?: number; nodes: RawComment[] };
  /** totalCount is missing in fixtures written before it was asked for. */
  reviewThreads: { totalCount?: number; nodes: RawReviewThread[] };
  commits: { totalCount?: number; nodes: RawCommit[] };
  /** commits(last: 1) again, only for the head commit's check rollup. */
  headCommit: { nodes: { commit: { statusCheckRollup: RawStatusCheckRollup | null } }[] };
  timelineItems: { totalCount?: number; nodes: RawTimelineItem[] };
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
