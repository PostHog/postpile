// Opening a PR in the detail pane marks its GitHub thread read, like a visit
// on github.com, and handles it in PostPile, when that cannot hide a to-do
// (DESIGN.md "You already dealt with it", part 3). The server checks the
// same again; this only keeps the renderer from asking when it knows the
// answer is no.
import type { GitHubWritesStatus, PrKey, PrSummary, TileView } from '@postpile/core';

/** How long a PR stays open in the detail pane before it counts as opened; clicking through tiles marks nothing. */
export const OPENED_READ_DELAY_MS = 1500;

/** What the check reads of a tile. */
export type OpenedTileView = Pick<TileView, 'state'> & { prs: Pick<PrSummary, 'key' | 'afterRead'>[] };

/**
 * Whether opening `prKey` in `view` should ask the server to mark it read:
 * a mark-read of that PR would leave it done (nothing asked of the user;
 * checked per PR since 2026-09-29, other PRs of a set don't matter), the
 * tile is not snoozed and GitHub writes are unlocked.
 */
export function opensMarkRead(view: OpenedTileView | null, prKey: PrKey | null, writes: GitHubWritesStatus | undefined): boolean {
  if (view === null || prKey === null || !writes?.enabled) {
    return false;
  }
  const pr = view.prs.find((candidate) => candidate.key === prKey);
  if (!pr) {
    return false;
  }
  return pr.afterRead.done && view.state.kind !== 'snoozed';
}

/** The timer functions the wait needs; `window` in the app, a fake in tests. */
export interface OpenedReadClock {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

/**
 * One open of a PR in the detail pane: calls `onOpened` once, after the PR
 * stayed OPENED_READ_DELAY_MS on screen while the document was visible.
 * Hidden before that, the wait starts over once it is visible again, so a
 * window put away right after a click does not drop the open (Codex review
 * on PR #10).
 */
export class OpenedReadTimer {
  private handle: number | null = null;
  private fired = false;

  constructor(
    private readonly onOpened: () => void,
    private readonly clock: OpenedReadClock,
  ) {}

  /** Stops a running wait; a later `visible()` starts a full one again. */
  stop(): void {
    if (this.handle !== null) {
      this.clock.clearTimeout(this.handle);
      this.handle = null;
    }
  }

  /** The document is visible: start the wait, unless one runs or the open already counted. */
  visible(): void {
    if (this.fired || this.handle !== null) {
      return;
    }
    this.handle = this.clock.setTimeout(() => {
      this.handle = null;
      this.fired = true;
      this.onOpened();
    }, OPENED_READ_DELAY_MS);
  }

  hidden(): void {
    this.stop();
  }
}
