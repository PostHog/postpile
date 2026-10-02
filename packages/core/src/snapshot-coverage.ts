// How far back a PR snapshot reaches when the PR query's caps cut it
// (DESIGN.md "Handled quietly" › Capped snapshots). The quiet reads and the
// "opened in PostPile" rule ask this before they trust a snapshot; the
// engine asks it to pick the PRs whose older pages are worth fetching.
// Rules only, no IO.

import type { CapHit, CappedList, IsoTime, NotificationThread, Pr } from './types.ts';

/** Capped lists that keep the newest N items: what falls off is older than what came back. */
const NEWEST_N_LISTS: readonly CappedList[] = ['reviews', 'comments', 'commits', 'timeline'];

/**
 * One capped list holds everything since `since`: paging reached its end
 * (`complete`), or it keeps the newest N and reaches back to an item at or
 * before `since`, so what fell off is older. Review threads and a thread's
 * comments count only when complete: the query keeps the newest threads by
 * creation and each thread's first comments, so a reply past either cap can
 * come at any time. `since` null means from the start: complete only.
 */
export function capHitCoversSince(hit: CapHit, since: IsoTime | null): boolean {
  if (hit.complete === true) {
    return true;
  }
  return since !== null && NEWEST_N_LISTS.includes(hit.list) && hit.oldestAt !== null && hit.oldestAt <= since;
}

/**
 * The snapshot holds everything that happened on the PR since `since`
 * (null: from the start), as far as the query's caps go. A snapshot that
 * was not cut off holds everything; one cut off only by GitHub's counts (no
 * list hit our caps) too. Otherwise every list that hit its cap has to
 * reach back to `since` or be complete (`capHitCoversSince`). A cut snapshot
 * stored before the cap evidence was recorded never vouches. Each rule
 * passes the start of the interval it reads: GitHub's read time, the last
 * reading touch, the newest review request of the viewer.
 */
export function snapshotCoversSince(pr: Pr, since: IsoTime | null): boolean {
  if (pr.truncated !== true) {
    return true;
  }
  if (pr.capHits === undefined) {
    return false;
  }
  return pr.capHits.every((hit) => capHitCoversSince(hit, since));
}

/**
 * Older pages of the PR's capped lists are worth fetching (DESIGN.md
 * "Handled quietly" › Capped snapshots, 2026-10-02): the thread is unread
 * and the snapshot does not reach back to GitHub's read time (to the start
 * for a thread never read).
 */
export function needsOlderPages(thread: NotificationThread, pr: Pr): boolean {
  return thread.unread && !snapshotCoversSince(pr, thread.lastReadAt);
}
