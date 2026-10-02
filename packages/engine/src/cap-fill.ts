import { capHitCoversSince, needsOlderPages, type IsoTime, type NotificationThread, type Pr, type PrKey } from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { errorText } from './errors.ts';
import type { GitHubQuota } from './github-quota.ts';

/** Older pages per capped list per PR, and over all of one PR's threads' comments. Enough for every capped list but one on real data (2026-10-02). */
export const CAP_FILL_PAGES = 5;
/** PRs paged per full sync. */
export const CAP_FILL_SYNC_PRS = 10;
/** PRs paged per live poll: it runs every minute, so it takes fewer. */
export const CAP_FILL_POLL_PRS = 3;

interface Wanted {
  pr: Pr;
  thread: NotificationThread;
}

/** The capped lists that still stop short of `since`, each named once. */
function shortLists(pr: Pr, since: IsoTime | null): string[] {
  return [...new Set((pr.capHits ?? []).filter((hit) => !capHitCoversSince(hit, since)).map((hit) => hit.list))];
}

/**
 * Pages older items into freshly fetched PRs whose snapshot stops short of
 * their unread thread's last read (`needsOlderPages`), so the quiet reads can
 * trust them (DESIGN.md "Handled quietly" › Capped snapshots, 2026-10-02).
 * Runs between the fetch and storing, so the stored snapshot and its events
 * include what it paged in. One instance per sync or poll: at most `budget`
 * PRs, newest thread first, and nothing while the GitHub quota is low.
 * Skips are logged; a failed request ends the pass and the PR keeps the
 * snapshot it had.
 */
export class CapFiller {
  private left: number;

  constructor(
    private readonly reader: GitHubReader,
    private readonly store: Store,
    private readonly quota: GitHubQuota,
    private readonly origin: 'sync' | 'poll',
    budget: number,
    private readonly textLog: (line: string) => void,
  ) {
    this.left = budget;
  }

  /** The fetched PRs that need older pages, newest thread first. */
  private wanted(fetched: Map<PrKey, Pr>): Wanted[] {
    const threads = this.store.notifications.getByPrKeys([...fetched.keys()]);
    const wanted: Wanted[] = [];
    for (const pr of fetched.values()) {
      const thread = threads.get(pr.key);
      if (thread !== undefined && needsOlderPages(thread, pr)) {
        wanted.push({ pr, thread });
      }
    }
    return wanted.sort((a, b) => b.thread.updatedAt.localeCompare(a.thread.updatedAt));
  }

  /** The fetched PRs, the ones that needed it with their older pages merged in. */
  async fill(fetched: Map<PrKey, Pr>): Promise<Map<PrKey, Pr>> {
    const wanted = this.wanted(fetched);
    if (wanted.length === 0) {
      return fetched;
    }
    const keys = (items: Wanted[]) => items.map((item) => item.pr.key).join(', ');
    const picked = wanted.slice(0, this.left);
    const skipped = wanted.slice(picked.length);
    this.left -= picked.length;
    if (skipped.length > 0) {
      this.textLog(`${this.origin}: older pages skipped for ${skipped.length} PRs over the budget: ${keys(skipped)}`);
    }
    const filled = new Map(fetched);
    for (const [index, { pr, thread }] of picked.entries()) {
      // Checked before each PR: the pages of the ones before may have used up the quota.
      if (!this.quota.allowsBackground()) {
        this.textLog(`${this.origin}: older pages skipped, GitHub quota low: ${keys(picked.slice(index))}`);
        break;
      }
      const since = thread.lastReadAt ?? 'the start';
      try {
        const fill = await this.reader.fillCappedLists(pr, thread.lastReadAt, CAP_FILL_PAGES);
        filled.set(pr.key, fill.pr);
        const short = shortLists(fill.pr, thread.lastReadAt);
        const outcome = short.length === 0 ? `covers since ${since}` : `still short of ${since}: ${short.join(', ')}`;
        this.textLog(`${this.origin}: ${pr.key} paged ${fill.pages} older pages, ${outcome}`);
      } catch (error) {
        this.textLog(`${this.origin}: older pages for ${pr.key} failed, the rest wait for the next fetch: ${errorText(error)}`);
        break;
      }
    }
    return filled;
  }
}
