import type { ActivityPr, IsoTime, NotificationThread, Pr, PrKey, PrRef, PrState, Viewer } from '@postpile/core';
import type { FoundRef } from './found.ts';

export interface PartialPrs {
  prs: Map<PrKey, Pr>;
  /** One line per failed batch. */
  errors: string[];
}

export interface NotificationConditions {
  etag: string | null;
  lastModified: string | null;
}

/**
 * pollIntervalSeconds is GitHub's X-Poll-Interval header: how often it would
 * like the inbox polled (usually 60). Null when the header is missing.
 */
export type NotificationsResult =
  | { notModified: true; pollIntervalSeconds: number | null }
  | {
      notModified: false;
      threads: NotificationThread[];
      etag: string | null;
      lastModified: string | null;
      pollIntervalSeconds: number | null;
    };

/** GET /notifications?all=true&since=: read and unread threads updated since then. */
export type ThreadsSinceResult = { notModified: true } | { notModified: false; threads: NotificationThread[]; etag: string | null };

export type TeamMembersResult = { notModified: true } | { notModified: false; logins: string[]; etag: string | null };

/**
 * PRs to look up by branch, for completing stacks. side head: PRs whose head
 * branch is `branch` (the layer below a PR based on it). side base: PRs whose
 * base branch is `branch` (the layer above a PR with that head).
 */
export interface BranchLookup {
  repo: string;
  branch: string;
  side: 'head' | 'base';
}

/** Just enough of a PR to walk a stack and decide whether to fetch it. */
export interface BranchPr {
  ref: PrRef;
  state: PrState;
  createdAt: IsoTime;
  mergedAt: IsoTime | null;
  updatedAt: IsoTime;
  baseRef: string;
  headRef: string;
  /** Base branches it had before, oldest first (GitHub moves a PR down when the layer below merges). */
  previousBaseRefs: string[];
}

/** Every read GitHub call the app makes. Safe to use against the real API in smoke tests. */
export interface GitHubReader {
  viewer(): Promise<Viewer>;

  /**
   * Logins on one team ("org/slug"), all pages. Sends the previous ETag so an
   * unchanged team answers 304. A team the token cannot read answers an empty list.
   */
  teamMembers(team: string, etag: string | null): Promise<TeamMembersResult>;

  /**
   * Walks the whole unread inbox (all pages). Sends the previous ETag and
   * Last-Modified so an unchanged inbox returns 304 and costs nothing.
   */
  listNotifications(conditions: NotificationConditions): Promise<NotificationsResult>;

  /**
   * Read and unread threads updated since `since` (all=true), all pages.
   * Sends the previous ETag, which only matches for the same `since`.
   * Never marks anything read.
   */
  listThreadsSince(since: IsoTime, etag: string | null): Promise<ThreadsSinceResult>;

  /**
   * PRs the inbox may not show, in one GraphQL request: the viewer's own
   * open PRs, reviews asked of them or of `teams`, and PRs involving them
   * merged since `mergedSince` (YYYY-MM-DD). Ids and updatedAt only.
   */
  findPrs(teams: string[], mergedSince: string): Promise<FoundRef[]>;

  /** One thread by id, read or unread. Null when GitHub answers 404. */
  getThread(threadId: string): Promise<NotificationThread | null>;

  /**
   * updatedAt per PR, UPDATED_AT_BATCH_SIZE aliased per GraphQL query (one
   * query for a normal board). Cheap: no connections, one point per query.
   * PRs GitHub does not answer for are left out.
   */
  prUpdatedAts(refs: PrRef[]): Promise<Map<PrKey, IsoTime>>;

  /** Batched GraphQL enrichment, PR_BATCH_SIZE PRs aliased per query. Missing PRs are left out. */
  fetchPrs(refs: PrRef[]): Promise<Map<PrKey, Pr>>;

  /**
   * Like fetchPrs, but a failed batch (GitHub's "Something went wrong"
   * timeout on a heavy query, a 502) only loses its own PRs: its error is
   * listed and the other batches still count.
   */
  fetchPrsPartial(refs: PrRef[]): Promise<PartialPrs>;

  /**
   * Open and merged same-repo PRs per lookup (a few newest each), answers in
   * lookup order. Batched GraphQL, BRANCH_BATCH_SIZE lookups per query. A
   * head lookup on the repo's default branch answers nothing: that is where
   * a stack ends, not a layer.
   */
  findPrsByBranch(lookups: BranchLookup[]): Promise<BranchPr[][]>;

  /**
   * Setup sweep: the viewer's PRs since `since` (YYYY-MM-DD) in one GraphQL
   * request: written by them, reviewed by them, and open review requests.
   * Titles and top-level folders only, about 100 at most.
   */
  recentActivity(since: string): Promise<ActivityPr[]>;

  /** One file's text from a repo's default branch. Null when it is missing or the repo is not visible. */
  readRepoFile(repo: string, path: string): Promise<string | null>;

  /** Setup check: null when the token can read notifications, else why not. Marks nothing read. */
  probeNotifications(): Promise<string | null>;
}

/** PRs aliased per GraphQL query. 12 kept ghatchup well inside the node limit. */
export const PR_BATCH_SIZE = 12;

/** PRs aliased per updatedAt query. Each is a single scalar, so a board's worth fits in one. */
export const UPDATED_AT_BATCH_SIZE = 100;

/** Branch lookups aliased per GraphQL query. Each answers a handful of small nodes. */
export const BRANCH_BATCH_SIZE = 30;
