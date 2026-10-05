/** Minutes between two catch-up runs of one topic for news that is not loud. */
export const QUIET_CATCH_UP_MINUTES = 15;

const QUIET_CATCH_UP_MS = QUIET_CATCH_UP_MINUTES * 60_000;

/** Map key for a topic; Unsorted gets one no real topic id can have. */
function keyOf(topicId: string | null): string {
  return topicId ?? '\u0000unsorted';
}

/**
 * Spaces out catch-up runs for news that is not loud: a teammate's push or
 * comment, a bot pushing or approving. Loud news still runs right away. A
 * topic's first quiet news runs at once; more within QUIET_CATCH_UP_MINUTES
 * of its last run waits, and one run then covers all of it. An agent pushing
 * 27 times an hour into one topic costs a few runs, not one per push.
 * Kept in memory: a restart only lets one run through early. A full sync
 * does not clear the waiting list: it may never digest (gh off, a crash),
 * and a run after a sync that covered the topic finds nothing to do and
 * makes no agent call.
 */
export class QuietCatchUps {
  private readonly lastRunAt = new Map<string, number>();
  private readonly waiting = new Map<string, string | null>();

  constructor(private readonly now: () => Date) {}

  /** A catch-up run for the topic was asked for, loud or quiet: the next quiet one waits from here. */
  noteRun(topicId: string | null): void {
    this.lastRunAt.set(keyOf(topicId), this.now().getTime());
  }

  /** Quiet news for these topics: they run once their wait is over (`due`). */
  add(topicIds: (string | null)[]): void {
    for (const topicId of topicIds) {
      this.waiting.set(keyOf(topicId), topicId);
    }
  }

  /** The waiting topics whose last run is long enough ago, taken off the list. */
  due(): (string | null)[] {
    const since = this.now().getTime() - QUIET_CATCH_UP_MS;
    const ready: (string | null)[] = [];
    for (const [key, topicId] of this.waiting) {
      const last = this.lastRunAt.get(key);
      if (last === undefined || last <= since) {
        ready.push(topicId);
        this.waiting.delete(key);
      }
    }
    return ready;
  }
}
