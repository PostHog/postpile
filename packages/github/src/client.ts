import type { NotificationThread, Pr, PrKey, PrRef, Viewer } from '@code-manager/core';
import { GitHubError, GitHubHttp, type FetchFn } from './http.ts';
import { toBranchPr, toPr } from './normalize.ts';
import { getThread, listNotifications } from './notifications.ts';
import { listTeamMembers } from './teams.ts';
import { batchAlias, branchAlias, buildBranchQuery, buildPrBatchQuery, VIEWER_LOGIN_QUERY, VIEWER_TEAMS_QUERY } from './queries.ts';
import type { RawBatchResponse, RawBranchResponse, RawViewerTeams } from './raw.ts';
import {
  BRANCH_BATCH_SIZE,
  PR_BATCH_SIZE,
  type BranchLookup,
  type BranchPr,
  type GitHubReader,
  type NotificationConditions,
  type NotificationsResult,
  type TeamMembersResult,
} from './reader.ts';
import type { TokenSource } from './token.ts';

// GitHub's secondary rate limiter cares about burst concurrency more than
// total volume. 6 parallel batches worked well in ghatchup.
const MAX_PARALLEL_BATCHES = 6;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Runs fn over every batch, at most MAX_PARALLEL_BATCHES at a time. Results keep the batch order. */
async function inParallel<T, R>(batches: T[], fn: (batch: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(batches.length);
  let next = 0;
  // A tiny worker pool: each worker takes the next batch until none are left.
  const worker = async (): Promise<void> => {
    while (next < batches.length) {
      const index = next++;
      results[index] = await fn(batches[index]!);
    }
  };
  const workers = Math.min(MAX_PARALLEL_BATCHES, batches.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** Real reader over REST (notifications) and GraphQL (viewer, PRs). */
export class GitHubClient implements GitHubReader {
  private readonly http: GitHubHttp;

  constructor(tokens: TokenSource, fetchFn?: FetchFn) {
    this.http = new GitHubHttp(tokens, fetchFn);
  }

  async viewer(): Promise<Viewer> {
    const who = await this.http.graphql<{ viewer: { login: string } }>(VIEWER_LOGIN_QUERY);
    if (!who.data) {
      throw new GitHubError(`GitHub viewer query failed: ${who.errors[0]?.message ?? 'no data'}`, 200);
    }
    const login = who.data.viewer.login;
    return { login, teams: await this.viewerTeams(login) };
  }

  /**
   * Orgs behind SAML SSO answer with an error for their slice but the rest
   * still resolves, so partial data is used as is. A token without read:org
   * gets no teams at all rather than a failed sync.
   */
  private async viewerTeams(login: string): Promise<string[]> {
    const result = await this.http.graphql<RawViewerTeams>(VIEWER_TEAMS_QUERY, { login });
    const teams: string[] = [];
    for (const org of result.data?.viewer.organizations.nodes ?? []) {
      if (!org) {
        continue;
      }
      for (const team of org.teams.nodes) {
        teams.push(`${org.login}/${team.slug}`);
      }
    }
    return teams;
  }

  teamMembers(team: string, etag: string | null): Promise<TeamMembersResult> {
    return listTeamMembers(this.http, team, etag);
  }

  listNotifications(conditions: NotificationConditions): Promise<NotificationsResult> {
    return listNotifications(this.http, conditions);
  }

  getThread(threadId: string): Promise<NotificationThread | null> {
    return getThread(this.http, threadId);
  }

  async fetchPrs(refs: PrRef[]): Promise<Map<PrKey, Pr>> {
    const batches = await inParallel(chunk(refs, PR_BATCH_SIZE), (batch) => this.fetchBatch(batch));
    return new Map(batches.flat().map((pr) => [pr.key, pr]));
  }

  /**
   * One aliased branch query. A repo the token cannot see answers nothing
   * for its lookups; forks are left out (their branch names say nothing
   * about this repo's stacks).
   */
  private async findBranchBatch(batch: BranchLookup[]): Promise<BranchPr[][]> {
    const response = await this.http.graphql<RawBranchResponse>(buildBranchQuery(batch));
    if (!response.data) {
      const message = response.errors[0]?.message ?? 'no data';
      throw new GitHubError(`GitHub branch query failed: ${message}`, 200);
    }
    return batch.map((lookup, index) => {
      const repo = response.data?.[branchAlias(index)];
      if (!repo || (lookup.side === 'head' && repo.defaultBranchRef?.name === lookup.branch)) {
        return [];
      }
      return repo.pullRequests.nodes
        .filter((node) => node !== null && !node.isCrossRepository)
        .map((node) => toBranchPr(lookup.repo, node!));
    });
  }

  async findPrsByBranch(lookups: BranchLookup[]): Promise<BranchPr[][]> {
    const batches = await inParallel(chunk(lookups, BRANCH_BATCH_SIZE), (batch) => this.findBranchBatch(batch));
    return batches.flat();
  }

  /**
   * One aliased query. A repo the token cannot see nulls its own alias and
   * comes back as an error next to the data; the other PRs still count.
   * No data at all (auth, bad query) fails the whole call.
   */
  private async fetchBatch(batch: PrRef[]): Promise<Pr[]> {
    const response = await this.http.graphql<RawBatchResponse>(buildPrBatchQuery(batch));
    if (!response.data) {
      const message = response.errors[0]?.message ?? 'no data';
      throw new GitHubError(`GitHub PR batch query failed: ${message}`, 200);
    }
    const prs: Pr[] = [];
    batch.forEach((ref, index) => {
      const raw = response.data?.[batchAlias(index)]?.pullRequest;
      if (raw) {
        prs.push(toPr(ref, raw));
      }
    });
    return prs;
  }
}
