import type { HotSelection, PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { Telemetry } from './telemetry.ts';

/** At most one report (log lines, board_trimmed, work_shed) per this long. */
export const SHED_REPORT_EVERY_MS = 60 * 60_000;

/** Meta key: when the last report went out (ISO). */
export const SHED_REPORT_META_KEY = 'shed_reported_at';

/** Where the report reads from: what picked the last hot Board, and the PRs the fetch left alone since the last report. */
export interface ShedSource {
  selection(): HotSelection | null;
  /** Taken: the next call starts from none. */
  takeShed(): PrKey[];
}

/**
 * Says when PostPile sheds work on a big inbox (DESIGN.md "Big inboxes:
 * what PostPile loads and works on"), at most once an hour: while the
 * board cap cut the hot set, a log line and board_trimmed { kept, dropped };
 * when syncs or polls left PRs with news alone because they are outside
 * the hot slice, work_shed { skipped_prs } (each PR once). Reads what the
 * last load picked, so it costs no load of its own. An hour with nothing to
 * say sends nothing and keeps the clock where it was.
 */
export class ShedReport {
  constructor(
    private readonly store: Store,
    private readonly telemetry: Telemetry,
    private readonly now: () => Date,
    private readonly source: ShedSource,
    private readonly log: (line: string) => void,
  ) {}

  sendIfDue(): void {
    const at = this.now().toISOString();
    const last = this.store.meta.get(SHED_REPORT_META_KEY);
    if (last !== null && Date.parse(at) - Date.parse(last) < SHED_REPORT_EVERY_MS) {
      return;
    }
    const selection = this.source.selection();
    const busy = selection?.busy === true;
    const shed = this.source.takeShed();
    if (!busy && shed.length === 0) {
      return;
    }
    this.store.meta.set(SHED_REPORT_META_KEY, at);
    if (selection !== null && busy) {
      const kept = selection.keys.size;
      const dropped = Math.max(0, selection.inboxPrs - kept);
      const { you, team, others } = selection.keptByTier;
      this.log(`board: busy inbox, kept ${kept} of ${selection.inboxPrs} hot PRs (you ${you}, team ${team}, others ${others}), ${dropped} left quiet`);
      this.telemetry.capture('board_trimmed', { kept, dropped });
    }
    if (shed.length > 0) {
      this.log(`sync: ${shed.length} PRs with news left alone in the last hour, outside the hot slice`);
      this.telemetry.capture('work_shed', { skipped_prs: shed.length });
    }
  }
}
