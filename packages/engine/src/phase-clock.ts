import { SYNC_PHASES, type SyncPhase, type SyncPhaseTimings } from '@postpile/core';

/**
 * Wall time per sync phase. Phases overlap after topic assignment, so a
 * timing is how long that phase took from its start to its end.
 */
export class PhaseClock {
  private readonly startedAt = new Map<SyncPhase, number>();
  private readonly durations: SyncPhaseTimings = {};
  private changed: () => void = () => {};

  constructor(private readonly now: () => Date) {}

  /** Told whenever a phase starts or ends (the stored sync progress). One listener; a later call replaces it. */
  onChange(listener: () => void): void {
    this.changed = listener;
  }

  /**
   * Runs work as the given phase. work() is called synchronously, so a job
   * that takes its budget before its first await still does so in order.
   */
  async time<T>(phase: SyncPhase, work: () => Promise<T>): Promise<T> {
    this.startedAt.set(phase, this.now().getTime());
    this.changed();
    try {
      return await work();
    } finally {
      this.durations[phase] = this.now().getTime() - (this.startedAt.get(phase) ?? 0);
      this.changed();
    }
  }

  /** Phases started and not finished yet, in sync order. */
  running(): SyncPhase[] {
    return SYNC_PHASES.filter((phase) => this.startedAt.has(phase) && this.durations[phase] === undefined);
  }

  timings(): SyncPhaseTimings {
    return { ...this.durations };
  }
}

/** "fetch 12.3s, topics 8.1s, dossiers 95.0s" for the sync log line. Empty when nothing ran. */
export function phaseTimingsText(timings: SyncPhaseTimings): string {
  return SYNC_PHASES.flatMap((phase) => {
    const ms = timings[phase];
    return ms === undefined ? [] : [`${phase} ${(ms / 1000).toFixed(1)}s`];
  }).join(', ');
}
