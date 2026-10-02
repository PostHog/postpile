// Older pages of a PR's capped activity lists (DESIGN.md "Handled quietly" ›
// Capped snapshots, 2026-10-02). The PR query takes the newest N of each list
// (queries.ts QUERY_CAPS), so on a bot-heavy PR the snapshot may not reach
// back to the user's last read, and no quiet read trusts it. This pages each
// capped list back with `before:` cursors until it reaches `since` or GitHub
// has no more, one GraphQL request per page, and merges the items in
// normalized like the PR query.

import { capHitCoversSince, type CapHit, type IsoTime, type Pr, type PrRef } from '@postpile/core';
import { graphqlFailure, type GitHubHttp } from './http.ts';
import { addOlderPage, type OlderPage } from './normalize.ts';
import { buildOlderPageQuery, OLDER_LIST_ORDER, THREAD_COMMENTS_PAGE_QUERY, type OlderList } from './queries.ts';
import type { RawOlderPageResponse, RawThreadCommentsResponse } from './raw.ts';
import type { CapFill } from './reader.ts';

/** The page of `list` before `cursor` (the newest page for a null cursor). Throws when the PR is not visible. */
async function fetchOlderPage(http: GitHubHttp, ref: PrRef, list: OlderList, cursor: string | null): Promise<OlderPage> {
  const [owner, name] = ref.repo.split('/');
  const response = await http.graphql<RawOlderPageResponse<never>>(buildOlderPageQuery(list), { owner, name, number: ref.number, cursor });
  const page = response.data?.repository?.pullRequest?.page;
  if (!page) {
    throw graphqlFailure(`older ${list} page`, response.errors);
  }
  return { list, page } as OlderPage;
}

/** The comments of one thread after `cursor`. Null when the thread is gone. */
async function fetchThreadComments(http: GitHubHttp, threadId: string, cursor: string | null): Promise<OlderPage | null> {
  const response = await http.graphql<RawThreadCommentsResponse>(THREAD_COMMENTS_PAGE_QUERY, { id: threadId, cursor });
  if (!response.data) {
    throw graphqlFailure('thread comments page', response.errors);
  }
  return response.data.node ? { list: 'thread_comments', thread: response.data.node } : null;
}

/** The next thread whose comments still need paging, with its id; old snapshots without a thread id cannot be paged. */
function threadToPage(pr: Pr, since: IsoTime | null, gone: Set<string>): { hit: CapHit; threadId: string } | undefined {
  for (const hit of pr.capHits ?? []) {
    if (hit.list === 'thread_comments' && hit.threadId !== undefined && !gone.has(hit.threadId) && !capHitCoversSince(hit, since)) {
      return { hit, threadId: hit.threadId };
    }
  }
  return undefined;
}

/** Progress of one fill: the snapshot so far and the pages it took. */
interface Filling {
  pr: Pr;
  pages: number;
}

/** Pages one newest-N list back until it covers `since` or ran `maxPages` pages. True when it covers (or never hit its cap). */
async function fillList(http: GitHubHttp, filling: Filling, list: OlderList, since: IsoTime | null, maxPages: number): Promise<boolean> {
  for (let page = 0; ; page += 1) {
    const hit = filling.pr.capHits?.find((candidate) => candidate.list === list);
    if (hit === undefined || capHitCoversSince(hit, since)) {
      return true;
    }
    if (page === maxPages) {
      return false;
    }
    filling.pr = addOlderPage(filling.pr, await fetchOlderPage(http, filling.pr.ref, list, hit.cursor ?? null));
    filling.pages += 1;
  }
}

/** Pages the threads' comments forward, `maxPages` requests over all threads. */
async function fillThreadComments(http: GitHubHttp, filling: Filling, since: IsoTime | null, maxPages: number): Promise<void> {
  const gone = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const next = threadToPage(filling.pr, since, gone);
    if (next === undefined) {
      return;
    }
    const comments = await fetchThreadComments(http, next.threadId, next.hit.cursor ?? null);
    filling.pages += 1;
    if (comments === null) {
      gone.add(next.threadId);
    } else {
      filling.pr = addOlderPage(filling.pr, comments);
    }
  }
}

/**
 * Pages every capped list of `pr` until it reaches back to `since` (null:
 * to its end; review threads and a thread's comments always to their end),
 * at most `maxPages` pages per list and `maxPages` over all threads'
 * comments. A list still short after its pages means the snapshot cannot
 * cover `since` this time, so the rest is not paged. A failed request
 * throws; the caller keeps the snapshot it had.
 */
export async function fillCappedLists(http: GitHubHttp, pr: Pr, since: IsoTime | null, maxPages: number): Promise<CapFill> {
  const filling: Filling = { pr, pages: 0 };
  for (const list of OLDER_LIST_ORDER) {
    if (!(await fillList(http, filling, list, since, maxPages))) {
      return filling;
    }
  }
  // After the threads: older thread pages can bring more threads whose comments hit their cap.
  await fillThreadComments(http, filling, since, maxPages);
  return filling;
}
