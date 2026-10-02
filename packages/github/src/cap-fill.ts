// Older pages of a PR's capped activity lists (DESIGN.md "Handled quietly" ›
// Capped snapshots, 2026-10-02). The PR query takes the newest N of each list
// (queries.ts QUERY_CAPS), so on a bot-heavy PR the snapshot may not reach
// back to the user's last read, and no quiet read trusts it. This pages each
// capped list back with `before:` cursors until it reaches `since` or GitHub
// has no more, one GraphQL request per page, and merges the items in
// normalized like the PR query.

import { capHitCoversSince, type CapHit, type CappedList, type IsoTime, type Pr, type PrRef } from '@postpile/core';
import { graphqlFailure, type GitHubHttp } from './http.ts';
import { addOlderPage, type OlderPage } from './normalize.ts';
import { buildOlderPageQuery, THREAD_COMMENTS_PAGE_QUERY, type OlderList } from './queries.ts';
import type { RawOlderPageResponse, RawThreadCommentsResponse } from './raw.ts';
import type { CapFill } from './reader.ts';

/** The newest-N lists, in the order they are paged. A thread's comments come after: paging threads can add more of them. */
const OLDER_LISTS: OlderList[] = ['reviews', 'comments', 'review_threads', 'commits', 'timeline'];

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

function hitOf(pr: Pr, list: OlderList): CapHit | undefined {
  return pr.capHits?.find((hit) => hit.list === list);
}

/** The next thread whose comments still need paging; old snapshots without a thread id cannot be paged. */
function threadHitToPage(pr: Pr, since: IsoTime | null, gone: Set<string>): CapHit | undefined {
  return pr.capHits?.find((hit) => hit.list === 'thread_comments' && hit.threadId !== undefined && !gone.has(hit.threadId) && !capHitCoversSince(hit, since));
}

/**
 * Pages every capped list of `pr` until it reaches back to `since` (null:
 * to its end; review threads and a thread's comments always to their end),
 * at most `maxPages` pages per list and `maxPages` over all threads'
 * comments. A failed request throws; the caller keeps the snapshot it had.
 */
export async function fillCappedLists(http: GitHubHttp, pr: Pr, since: IsoTime | null, maxPages: number): Promise<CapFill> {
  let filled = pr;
  let pages = 0;
  for (const list of OLDER_LISTS) {
    for (let page = 0; page < maxPages; page += 1) {
      const hit = hitOf(filled, list);
      if (hit === undefined || capHitCoversSince(hit, since)) {
        break;
      }
      filled = addOlderPage(filled, await fetchOlderPage(http, pr.ref, list, hit.cursor ?? null));
      pages += 1;
    }
  }
  const gone = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const hit = threadHitToPage(filled, since, gone);
    if (hit === undefined) {
      break;
    }
    const comments = await fetchThreadComments(http, hit.threadId!, hit.cursor ?? null);
    pages += 1;
    if (comments === null) {
      gone.add(hit.threadId!);
    } else {
      filled = addOlderPage(filled, comments);
    }
  }
  const short = (filled.capHits ?? []).filter((hit) => !capHitCoversSince(hit, since)).map((hit) => hit.list);
  return { pr: filled, pages, short: [...new Set<CappedList>(short)] };
}
