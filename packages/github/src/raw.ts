// Shapes of what GitHub actually returns, trimmed to the fields we read.
// Only this package sees them; everything else gets normalized core types.

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

export interface RawActor {
  login: string;
}

export interface RawComment {
  id: string;
  author: RawActor | null;
  body: string;
  createdAt: string;
  url: string;
}

export interface RawReview {
  id: string;
  author: RawActor | null;
  state: string;
  body: string;
  submittedAt: string | null;
  commit: { oid: string } | null;
}

export interface RawReviewThread {
  id: string;
  path: string;
  isResolved: boolean;
  comments: { nodes: RawComment[] };
}

export interface RawCommit {
  commit: {
    oid: string;
    messageHeadline: string;
    committedDate: string;
    author: { user: RawActor | null; name: string | null } | null;
  };
}

/** A timeline node. __typename picks which optional fields are present. */
export interface RawTimelineItem {
  __typename: string;
  id: string;
  createdAt: string;
  actor: RawActor | null;
  requestedReviewer?: { login?: string; slug?: string; organization?: { login: string } } | null;
}

export interface RawCheckContext {
  __typename: 'CheckRun' | 'StatusContext';
  name?: string;
  context?: string;
  conclusion?: string | null;
  state?: string;
  completedAt?: string | null;
  createdAt?: string;
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
  reviewRequests: {
    nodes: { requestedReviewer: { login?: string; slug?: string; organization?: { login: string } } | null }[];
  };
  reviews: { nodes: RawReview[] };
  comments: { nodes: RawComment[] };
  reviewThreads: { nodes: RawReviewThread[] };
  commits: { nodes: RawCommit[] };
  timelineItems: { nodes: RawTimelineItem[] };
  statusCheckRollup: {
    state: string;
    contexts: { nodes: RawCheckContext[] };
  } | null;
}
