// Opening a PR in the detail pane marks its GitHub thread read, like a visit
// on github.com, and handles it in PostPile, when that cannot hide a to-do
// (DESIGN.md "You already dealt with it", part 3). Each row carries the
// server's verdict (`PrSummary.openedRead`), so the button never promises a
// mark the server then refuses; the server checks again when asked.
import type { GitHubWritesStatus, PrKey, PrSummary } from '@postpile/core';

/** How long a PR stays open in the detail pane before it counts as opened; clicking through tiles marks nothing. */
export const OPENED_READ_DELAY_MS = 1500;

/** What the check reads of a tile. */
export type OpenedTileView = { prs: Pick<PrSummary, 'key' | 'openedRead'>[] };

/**
 * Whether opening `prKey` in `view` should ask the server to mark it read:
 * the row's verdict from the server is not a skip (that PR done after a
 * mark-read, no tile holding it snoozed, a fresh enough snapshot; other PRs
 * of a set don't matter) and GitHub writes are unlocked.
 */
export function opensMarkRead(view: OpenedTileView | null, prKey: PrKey | null, writes: GitHubWritesStatus | undefined): boolean {
  if (view === null || prKey === null || !writes?.enabled) {
    return false;
  }
  const pr = view.prs.find((candidate) => candidate.key === prKey);
  if (!pr) {
    return false;
  }
  return pr.openedRead.kind !== 'skip';
}

/** The timer functions the wait needs; `window` in the app, a fake in tests. */
export interface OpenedReadClock {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

/**
 * Where the open stands, for the mark button's fill: idle (not counting),
 * filling (the dwell runs), ready (armed, marks when the user leaves),
 * cancelled ("Keep unread"), done (the mark was sent).
 */
export type OpenedReadPhase = 'idle' | 'filling' | 'ready' | 'cancelled' | 'done';

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
  private cancelled = false;
  private wanted = false;
  private current: OpenedReadPhase = 'idle';

  constructor(
    private readonly onOpened: () => void,
    private readonly clock: OpenedReadClock,
    private readonly onPhase: (phase: OpenedReadPhase) => void = () => {},
  ) {}

  private setPhase(phase: OpenedReadPhase): void {
    if (phase !== this.current) {
      this.current = phase;
      this.onPhase(phase);
    }
  }

  get phase(): OpenedReadPhase {
    return this.current;
  }

  private stopWait(): void {
    if (this.handle !== null) {
      this.clock.clearTimeout(this.handle);
      this.handle = null;
      this.setPhase('idle');
    }
  }

  /** Fires once, when armed and wanted. */
  private fireIfArmed(): void {
    if (this.armed && this.wanted && !this.fired && !this.cancelled) {
      this.fired = true;
      this.setPhase('done');
      this.onOpened();
    }
  }

  /** Whether a mark-read of the PR is wanted right now (`opensMarkRead`), kept up to date while it is open. */
  setWanted(wanted: boolean): void {
    this.wanted = wanted;
  }

  /** The document is visible: start the wait, unless one runs or the open is armed already. */
  visible(): void {
    if (this.fired || this.cancelled || this.armed || this.handle !== null) {
      return;
    }
    this.setPhase('filling');
    this.handle = this.clock.setTimeout(() => {
      this.handle = null;
      this.armed = true;
      this.setPhase('ready');
    }, OPENED_READ_DELAY_MS);
  }

  /** "Keep unread": leaving no longer marks this open. Final for this open. */
  cancel(): void {
    this.cancelled = true;
    this.stopWait();
    this.setPhase('cancelled');
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
