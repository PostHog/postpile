import type { HotSelection } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { Telemetry } from './telemetry.ts';

/** At most one board_trimmed event, and one log line, per this long. */
export const BUSY_BOARD_REPORT_EVERY_MS = 60 * 60_000;

/** Meta key: when the last board_trimmed went out (ISO). */
export const BUSY_BOARD_META_KEY = 'board_trimmed_at';

/**
 * Says when the board cap cut the hot set, so the inbox is busy (DESIGN.md
 * "Big inboxes: what PostPile loads and works on"): one log line and
 * board_trimmed { kept, dropped }, at most once an hour. Reads what picked
 * the last hot Board (`selection`), so it costs no load of its own.
 */
export class BusyBoardReport {
  constructor(
    private readonly store: Store,
    private readonly telemetry: Telemetry,
    private readonly now: () => Date,
    private readonly selection: () => HotSelection | null,
    private readonly log: (line: string) => void,
  ) {}

  sendIfDue(): void {
    const selection = this.selection();
    if (!selection?.busy) {
      return;
    }
    const at = this.now().toISOString();
    const last = this.store.meta.get(BUSY_BOARD_META_KEY);
    if (last !== null && Date.parse(at) - Date.parse(last) < BUSY_BOARD_REPORT_EVERY_MS) {
      return;
    }
    this.store.meta.set(BUSY_BOARD_META_KEY, at);
    const kept = selection.keys.size;
    const dropped = Math.max(0, selection.inboxPrs - kept);
    const { you, team, others } = selection.keptByTier;
    this.log(`board: busy inbox, kept ${kept} of ${selection.inboxPrs} hot PRs (you ${you}, team ${team}, others ${others}), ${dropped} left quiet`);
    this.telemetry.capture('board_trimmed', { kept, dropped });
  }
}
