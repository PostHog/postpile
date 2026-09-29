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
 * One open of a PR in the detail pane (2026-09-29, "Marked when you move
 * on"). The PR has to stay OPENED_READ_DELAY_MS on screen while the document
 * is visible: that arms the open, the proof the user looked. The mark itself
 * (`onOpened`) only fires when the user moves on: `leave()` (another PR or
 * tile, the detail pane closed) or `hidden()` (the window hidden or blurred:
 * leaving the app counts too). Marking while the PR is still on screen
 * changed its status under the user's eyes. Clicking through PRs faster
 * than the delay marks nothing; hidden before the delay, the wait starts
 * over once visible again (Codex review on PR #10). Once per open, and only
 * while `setWanted(true)` (`opensMarkRead`) holds at that moment.
 */
export class OpenedReadTimer {
  private handle: number | null = null;
  private armed = false;
  private fired = false;
  private wanted = false;

  constructor(
    private readonly onOpened: () => void,
    private readonly clock: OpenedReadClock,
  ) {}

  private stopWait(): void {
    if (this.handle !== null) {
      this.clock.clearTimeout(this.handle);
      this.handle = null;
    }
  }

  /** Fires once, when armed and wanted. */
  private fireIfArmed(): void {
    if (this.armed && this.wanted && !this.fired) {
      this.fired = true;
      this.onOpened();
    }
  }

  /** Whether a mark-read of the PR is wanted right now (`opensMarkRead`), kept up to date while it is open. */
  setWanted(wanted: boolean): void {
    this.wanted = wanted;
  }

  /** The document is visible: start the wait, unless one runs or the open is armed already. */
  visible(): void {
    if (this.fired || this.armed || this.handle !== null) {
      return;
    }
    this.handle = this.clock.setTimeout(() => {
      this.handle = null;
      this.armed = true;
    }, OPENED_READ_DELAY_MS);
  }

  /** The window was hidden or lost focus: an armed open fires, a running wait stops. */
  hidden(): void {
    this.stopWait();
    this.fireIfArmed();
  }

  /** The user moved on to another PR or tile, or closed the pane: an armed open fires. */
  leave(): void {
    this.stopWait();
    this.fireIfArmed();
  }
}
