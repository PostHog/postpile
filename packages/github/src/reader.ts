import type { ActivityPr, IsoTime, NotificationThread, FullPr, PrKey, PrRef, PrState, ReviewedPr, Viewer, ViewerTeamSize } from '@postpile/core';
import type { CodeOwnersFile } from './code-owners.ts';
import type { FoundRef } from './found.ts';
import type { PrDiffRead } from './pr-diff.ts';

export interface PartialPrs {
  prs: Map<PrKey, FullPr>;
  /** One line per failed batch. */
  errors: string[];
}

/** What paging one PR's capped lists back brought (`GitHubReader.fillCappedLists`). */
export interface CapFill {
  /** The snapshot with the older items merged in and its cap hits moved on. */
  pr: FullPr;
  /** Pages fetched, all lists together. */
  pages: number;
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
  /** From a fork. Branch lookups leave forks out; a lookup by number (`findPrsByNumber`) says so here. */
  isCrossRepository?: boolean;
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
  fetchPrs(refs: PrRef[]): Promise<Map<PrKey, FullPr>>;

  /**
   * Like fetchPrs, but a failed batch (GitHub's "Something went wrong"
   * timeout on a heavy query, a 502) only loses its own PRs: its error is
   * listed and the other batches still count. `onBatch` hears how many
   * PRs each batch brought as it lands (0 for a failed one), for the sync's
   * progress.
   */
  fetchPrsPartial(refs: PrRef[], onBatch?: (prs: number) => void): Promise<PartialPrs>;

  /**
   * Older pages of a fetched PR's capped lists (`Pr.capHits`), one GraphQL
   * request per page, until each list reaches back to `since` (null: its
   * end; review threads and a thread's comments always to their end) or ran
   * `maxPages` pages (`maxPages` over all threads' comments); once a list
   * stays short the rest is left. The items are normalized like fetchPrs
   * and merged in without repeats. Throws on a failed request.
   */
  fillCappedLists(pr: FullPr, since: IsoTime | null, maxPages: number): Promise<CapFill>;

  /**
   * Open and merged same-repo PRs per lookup (a few newest each), answers in
   * lookup order. Batched GraphQL, BRANCH_BATCH_SIZE lookups per query. A
   * head lookup on the repo's default branch answers nothing: that is where
   * a stack ends, not a layer.
   */
  findPrsByBranch(lookups: BranchLookup[]): Promise<BranchPr[][]>;

  /**
   * The same shape as findPrsByBranch, for PRs known by number: the layer
   * below a PR body declares ("Stacked on #12"). Answers in ref order;
   * null for a PR the token cannot see. A fork PR counts (a number names it
   * whatever its branch) and carries `isCrossRepository`.
   * BRANCH_BATCH_SIZE PRs per query.
   */
  findPrsByNumber(refs: PrRef[]): Promise<(BranchPr | null)[]>;

  /**
   * Setup sweep: the viewer's PRs since `since` (YYYY-MM-DD) in one GraphQL
   * request: written by them, reviewed by them, and open review requests.
   * Titles and top-level folders only, about 100 at most.
   */
  recentActivity(since: string): Promise<ActivityPr[]>;

  /**
   * The base-side line ranges a PR edits (REST file list; GraphQL has no
   * patches). Ranges only, no patch text. Throws on a failed request.
   */
  readPrDiff(ref: PrRef): Promise<PrDiffRead>;

  /** One file's text from a repo's default branch. Null when it is missing or the repo is not visible. */
  readRepoFile(repo: string, path: string): Promise<string | null>;

  /**
   * Each repo's CODEOWNERS from its default branch: the first of
   * .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS, as GitHub looks. One
   * GraphQL query per CODE_OWNERS_BATCH_SIZE repos. Null: the repo has
   * none. A repo the token cannot see is left out of the map.
   */
  codeOwnersFiles(repos: string[]): Promise<Map<string, CodeOwnersFile | null>>;

  /** Team roles: the viewer's teams ("org/slug") with member counts, one GraphQL request. */
  teamSizes(login: string): Promise<ViewerTeamSize[]>;

  /**
   * Team roles: PRs by others the viewer reviewed, updated since `since`
   * (YYYY-MM-DD), in `orgs`, each with every reviewer requested on it
   * (users and "org/slug" teams, bot-made requests included). Pages of 50,
   * at most `cap` PRs.
   */
  reviewedPrRequests(login: string, orgs: string[], since: string, cap: number): Promise<ReviewedPr[]>;

  /** Setup check: null when the token can read notifications, else why not. Marks nothing read. */
  probeNotifications(): Promise<string | null>;
}

/** PRs aliased per GraphQL query. 12 kept ghatchup well inside the node limit. */
export const PR_BATCH_SIZE = 12;

/** PRs aliased per updatedAt query. Each is a single scalar, so a board's worth fits in one. */
export const UPDATED_AT_BATCH_SIZE = 100;

/** Branch lookups aliased per GraphQL query. Each answers a handful of small nodes. */
export const BRANCH_BATCH_SIZE = 30;
