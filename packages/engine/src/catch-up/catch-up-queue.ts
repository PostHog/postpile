import type { CatchUpRunState } from '@postpile/core';

/** What a request did: started a run, queued the one follow-up, or was skipped (a sync covers it). */
export type CatchUpRequest = 'started' | 'queued' | 'skipped';

interface RunningTopic {
  topicId: string | null;
  done: Promise<void>;
}

/** Map key for a topic; Unsorted gets one no real topic id can have. */
function keyOf(topicId: string | null): string {
  return topicId ?? '\u0000unsorted';
}

/**
 * Coalesces glance catch-up runs per topic: at most one run per topic at a
 * time, and while it runs, at most ONE queued follow-up, however many
 * requests arrive (a burst of poll cycles never piles up runs). The
 * follow-up starts when the run ends, so it sees everything that arrived
 * meanwhile. canStart() says no while a full sync or a consolidation runs:
 * the request is skipped, the sync covers it. changes() grows on every
 * queue, start and end, so the renderer knows when to refetch.
 */
export class CatchUpQueue {
  private readonly running = new Map<string, RunningTopic>();
  private readonly queued = new Set<string>();
  private changeCount = 0;

  constructor(
    private readonly runTopic: (topicId: string | null) => Promise<void>,
    private readonly canStart: () => boolean,
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  private start(topicId: string | null): void {
    const key = keyOf(topicId);
    this.changeCount += 1;
    const done = this.runTopic(topicId)
      .catch((error: unknown) => {
        this.log(`catch-up ${topicId ?? 'unsorted'}: failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        this.running.delete(key);
        this.changeCount += 1;
        if (this.queued.delete(key) && this.canStart()) {
          this.start(topicId);
        }
      });
    this.running.set(key, { topicId, done });
  }

  request(topicId: string | null): CatchUpRequest {
    const key = keyOf(topicId);
    if (this.running.has(key)) {
      if (!this.queued.has(key)) {
        this.queued.add(key);
        this.changeCount += 1;
      }
      return 'queued';
    }
    if (!this.canStart()) {
      return 'skipped';
    }
    this.start(topicId);
    return 'started';
  }

  /** Running wins over queued: a PR whose topic runs is being written. */
  stateOf(topicId: string | null): CatchUpRunState {
    const key = keyOf(topicId);
    if (this.running.has(key)) {
      return 'running';
    }
    return this.queued.has(key) ? 'queued' : null;
  }

  /** Settles once every run going now has ended. Follow-ups started later are not waited for. */
  settled(): Promise<void> {
    return Promise.all([...this.running.values()].map((run) => run.done)).then(() => {});
  }

  /** A full sync is about to start and covers every topic: forget the follow-ups. */
  dropQueued(): void {
    if (this.queued.size > 0) {
      this.queued.clear();
      this.changeCount += 1;
    }
  }

  changes(): number {
    return this.changeCount;
  }
}
