// Opening a PR in the detail pane marks its GitHub thread read, like a visit
// on github.com, when that cannot hide a to-do (DESIGN.md "You already dealt
// with it", part 3). The server checks the same again; this only keeps the
// renderer from asking when it knows the answer is no.
import type { GitHubWritesStatus, PrKey, PrSummary, TileView } from '@postpile/core';

/** How long a PR stays open in the detail pane before it counts as opened; clicking through tiles marks nothing. */
export const OPENED_READ_DELAY_MS = 1500;

/** What the check reads of a tile. */
export type OpenedTileView = Pick<TileView, 'state' | 'afterRead'> & { prs: Pick<PrSummary, 'key'>[] };

/**
 * Whether opening `prKey` in `view` should ask the server to mark it read:
 * a mark-read would leave the tile done (nothing asked of the user), the
 * tile is not snoozed and GitHub writes are unlocked.
 */
export function opensMarkRead(view: OpenedTileView | null, prKey: PrKey | null, writes: GitHubWritesStatus | undefined): boolean {
  if (view === null || prKey === null || !writes?.enabled) {
    return false;
  }
  if (!view.prs.some((pr) => pr.key === prKey)) {
    return false;
  }
  return view.afterRead.done && view.state.kind !== 'snoozed';
}
