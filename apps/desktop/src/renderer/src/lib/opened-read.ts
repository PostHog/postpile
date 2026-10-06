// Opening a PR in the detail pane marks its GitHub thread read, like a visit
// on github.com, and handles it in PostPile, when that cannot hide a to-do
// (DESIGN.md "You already dealt with it", part 3). Each row carries the
// server's verdict (`PrSummary.openedRead`), so the button never promises a
// mark the server then refuses; the server checks again when asked.
import type { GitHubWritesStatus, OpenedReadResult, PrKey, PrSummary } from '@postpile/core';
import { UNDO_WINDOW_MS } from './undo-window.ts';

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

/** The timer functions the wait needs; the window's timers and `Date.now` in the app, a fake in tests. */
export interface OpenedReadClock {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  now(): number;
}

/**
 * Where the open stands, for the mark button:
 * - idle: not counting (hidden during the dwell, or the server marked nothing).
 * - filling: the dwell runs, the button fills.
 * - sending: the dwell ended and the mark is on its way; the fill stays full.
 * - marked: "✓ Marked read" with Undo, inside the undo window.
 * - settled: still "✓ Marked read", the undo window is over.
 * - undone: Undo took the mark back; this open does not arm again.
 */
export type OpenedReadPhase = 'idle' | 'filling' | 'sending' | 'marked' | 'settled' | 'undone';

/**
 * One open of a PR in the detail pane (2026-10-01, "Marked when the dwell
 * ends"). The PR has to stay OPENED_READ_DELAY_MS on screen while the
 * document is visible; when that dwell ends, the mark (`onOpened`) fires
 * right away, if `setWanted(true)` (`opensMarkRead`) holds then, or as soon
 * as it does while the PR stays open. Clicking through PRs faster than the
 * delay marks nothing; hidden before the delay, the wait starts over once
 * visible again (Codex review on PR #10). Hiding the window after that
 * changes nothing. Once per open: Undo (`undo()`) hands back the server's
 * token inside the undo window and the open stays spent. `leave()` drops
 * the open: its timers stop and a late answer is ignored.
 */
export class OpenedReadTimer {
  private dwell: number | null = null;
  private undoWindow: number | null = null;
  private armed = false;
  private fired = false;
  private left = false;
  private wanted = false;
  private undoToken: string | null = null;
  private current: OpenedReadPhase = 'idle';

  constructor(
    private readonly onOpened: () => Promise<OpenedReadResult | null>,
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

  private stopDwell(): void {
    if (this.dwell !== null) {
      this.clock.clearTimeout(this.dwell);
      this.dwell = null;
      this.setPhase('idle');
    }
  }

  private stopUndoWindow(): void {
    if (this.undoWindow !== null) {
      this.clock.clearTimeout(this.undoWindow);
      this.undoWindow = null;
    }
  }

  /** What the server answered: marked with a token opens the undo window, anything else leaves the button as it was. */
  private answered(result: OpenedReadResult | null): void {
    if (this.left) {
      return;
    }
    if (!result?.marked) {
      this.setPhase('idle');
      return;
    }
    if (result.undoToken === null) {
      this.setPhase('settled');
      return;
    }
    // The engine's window started when it queued the mark; Undo ends with it, not a fresh window from now.
    const until = result.undoUntil === null ? this.clock.now() + UNDO_WINDOW_MS : Date.parse(result.undoUntil);
    const left = until - this.clock.now();
    if (left <= 0) {
      this.setPhase('settled');
      return;
    }
    this.undoToken = result.undoToken;
    this.setPhase('marked');
    this.undoWindow = this.clock.setTimeout(() => {
      this.undoWindow = null;
      this.undoToken = null;
      this.setPhase('settled');
    }, left);
  }

  /** Fires once, when the dwell is over and a mark is wanted. */
  private fireIfArmed(): void {
    if (!this.armed || !this.wanted || this.fired || this.left) {
      return;
    }
    this.fired = true;
    this.setPhase('sending');
    void this.onOpened().then(
      (result) => this.answered(result),
      () => this.answered(null),
    );
  }

  /** Whether a mark-read of the PR is wanted right now (`opensMarkRead`), kept up to date while it is open. */
  setWanted(wanted: boolean): void {
    this.wanted = wanted;
    this.fireIfArmed();
  }

  /** The document is visible: start the dwell, unless one runs or it is over already. */
  visible(): void {
    if (this.left || this.armed || this.dwell !== null) {
      return;
    }
    this.setPhase('filling');
    this.dwell = this.clock.setTimeout(() => {
      this.dwell = null;
      this.armed = true;
      if (this.wanted) {
        this.fireIfArmed();
      } else {
        this.setPhase('idle');
      }
    }, OPENED_READ_DELAY_MS);
  }

  /** The window was hidden or lost focus: a running dwell stops and starts over once visible. A finished dwell stays finished. */
  hidden(): void {
    this.stopDwell();
  }

  /** "Undo" next to "✓ Marked read": the token to undo with, or null when the window is over. Final for this open. */
  undo(): string | null {
    const token = this.undoToken;
    if (token === null || this.current !== 'marked') {
      return null;
    }
    this.undoToken = null;
    this.stopUndoWindow();
    this.setPhase('undone');
    return token;
  }

  /** The user moved on to another PR or tile, or closed the pane: the open ends. The mark, if any, already went out. */
  leave(): void {
    this.left = true;
    this.stopDwell();
    this.stopUndoWindow();
  }
}

/** The unread dot's countdown (UnreadDot): draining over the dwell, held empty once the dwell marked the PR, else none. */
export type DotCountdown = 'draining' | 'drained' | null;

/**
 * The countdown of `prKey`'s unread dot in its tile row (2026-10-06): the
 * pie drains while the PR in the pane waits out the dwell (and while its mark
 * is on the way) and stays empty once the open marked it, until the dot
 * leaves with the refetch. Cancelled or undone it is null, and the dot is
 * full again. Other PRs never count down.
 */
export function dotCountdown(opened: { prKey: PrKey | null; filling: boolean; marked: unknown }, prKey: PrKey): DotCountdown {
  if (opened.prKey !== prKey) {
    return null;
  }
  if (opened.filling) {
    return 'draining';
  }
  return opened.marked === null ? null : 'drained';
}
