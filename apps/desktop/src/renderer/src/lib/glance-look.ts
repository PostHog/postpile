// Refresh on look (DESIGN.md "Glance refresh on look", 2026-10-01): a PR
// that stays open in the detail pane with a stale glance asks the server to
// write a new one. The server decides whether a call is due (input hash,
// caps, runs going); the renderer only asks, once per open.
import type { PrDetail } from '@postpile/core';
import { OPENED_READ_DELAY_MS } from './opened-read.ts';

/** The same dwell as the opened mark: clicking through PRs asks nothing. */
export const GLANCE_LOOK_DELAY_MS = OPENED_READ_DELAY_MS;

/**
 * Whether looking at the PR should ask for a new glance: the glance is
 * stale, the server says a refresh can run (`glanceRefreshBlock`), and no
 * run for it is queued or writing already.
 */
export function wantsGlanceRefresh(detail: Pick<PrDetail, 'glanceStale' | 'glanceRefreshBlock' | 'glanceState'> | null): boolean {
  if (detail === null || !detail.glanceStale || detail.glanceRefreshBlock !== null) {
    return false;
  }
  return detail.glanceState !== 'writing' && detail.glanceState !== 'queued';
}

/** The timer functions the dwell needs; `window` in the app, a fake in tests. */
export interface GlanceLookClock {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

/**
 * One open of a PR in the detail pane. The dwell runs while the window is
 * visible; hidden before it ends, it starts over once visible again. Once
 * the dwell is done, `onLooked` fires as soon as a refresh is wanted (right
 * away, or later in the same open when the glance turns stale), at most
 * once per open. A new open is a new timer.
 */
export class GlanceLookTimer {
  private handle: number | null = null;
  private armed = false;
  private fired = false;
  private wanted = false;
  private shown = false;

  constructor(
    private readonly onLooked: () => void,
    private readonly clock: GlanceLookClock,
  ) {}

  private fireIfDue(): void {
    if (this.armed && this.wanted && this.shown && !this.fired) {
      this.fired = true;
      this.onLooked();
    }
  }

  private stopWait(): void {
    if (this.handle !== null) {
      this.clock.clearTimeout(this.handle);
      this.handle = null;
    }
  }

  /** Whether the PR wants a new glance right now (`wantsGlanceRefresh`), kept up to date while it is open. */
  setWanted(wanted: boolean): void {
    this.wanted = wanted;
    this.fireIfDue();
  }

  /** The window is visible: start the dwell, unless it runs or is done already. */
  visible(): void {
    this.shown = true;
    if (this.armed) {
      this.fireIfDue();
      return;
    }
    if (this.handle !== null) {
      return;
    }
    this.handle = this.clock.setTimeout(() => {
      this.handle = null;
      this.armed = true;
      this.fireIfDue();
    }, GLANCE_LOOK_DELAY_MS);
  }

  /** The window was hidden or lost focus: a running dwell stops. */
  hidden(): void {
    this.shown = false;
    this.stopWait();
  }

  /** The user moved on to another PR or closed the pane: nothing more for this open. */
  leave(): void {
    this.stopWait();
    this.fired = true;
  }
}
