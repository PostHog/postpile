import type { CatchUpRunState, PrKey } from '@postpile/core';

/** What a request did: started a run, queued the one follow-up, or was skipped (a sync covers it). */
export type CatchUpRequest = 'started' | 'queued' | 'skipped';

/** What a glance request did: as a topic request, or covered (a run going or queued for the topic writes it anyway). */
export type GlanceRequest = CatchUpRequest | 'covered';

/** The two kinds of run the queue starts. */
export interface CatchUpRunners {
  /** The topic's whole catch-up: dossier, events, glances, facts. */
  topic(topicId: string | null): Promise<void>;
  /** Only the glances of these PRs, from the topic's dossier as it is (refresh on look). */
  glances(topicId: string | null, prKeys: PrKey[]): Promise<void>;
}

interface RunningTopic {
  topicId: string | null;
  /** Null for a whole-topic run; the PRs of a glance-only run. */
  prKeys: PrKey[] | null;
  done: Promise<void>;
}

/**
 * Catch-up runs going at once, across topics. Each run holds a board (all
 * PRs and events, hundreds of MB on a heavy install) across its agent
 * calls; a poll with news in many topics started a run per topic and ran
 * the main process out of memory (2026-10-05).
 */
export const MAX_RUNNING_CATCH_UPS = 2;

/** Map key for a topic; Unsorted gets one no real topic id can have. */
function keyOf(topicId: string | null): string {
  return topicId ?? '\u0000unsorted';
}

/**
 * Coalesces glance catch-up runs per topic: at most one run per topic at a
 * time, whole-topic or glance-only. While one runs, at most ONE queued
 * whole-topic follow-up, however many requests arrive (a burst of poll
 * cycles never piles up runs), plus the PRs whose glance alone was asked
 * for meanwhile. The follow-up starts when the run ends, so it sees
 * everything that arrived meanwhile; a whole-topic follow-up also covers
 * the queued glances. canStart() says no while a full sync or a
 * consolidation runs: the request is skipped, the sync covers it.
 * At most MAX_RUNNING_CATCH_UPS runs go at once: a request for another
 * topic beyond that waits its turn, first come first served, and a topic's
 * follow-up goes to the back of that line so one busy topic cannot keep
 * the others waiting. changes() grows on every queue, start and end, so
 * the renderer knows when to refetch.
 */
export class CatchUpQueue {
  private readonly running = new Map<string, RunningTopic>();
  private readonly queued = new Set<string>();
  private readonly queuedGlances = new Map<string, Set<PrKey>>();
  /** Topics with a queued run and no run going, in the order they get a free slot. */
  private readonly waiting = new Map<string, string | null>();
  private changeCount = 0;

  constructor(
    private readonly runners: CatchUpRunners,
    private readonly canStart: () => boolean,
    private readonly log: (line: string) => void = (line) => console.log(line),
    private readonly maxRunning: number = MAX_RUNNING_CATCH_UPS,
  ) {}

  private isFull(): boolean {
    return this.running.size >= this.maxRunning;
  }

  /** A topic's queued run waits for a free slot, behind the ones already waiting; one already waiting keeps its place. */
  private wait(topicId: string | null): void {
    const key = keyOf(topicId);
    if (!this.waiting.has(key)) {
      this.waiting.set(key, topicId);
    }
  }

  /** Queues the PR's glance for the topic's next run. */
  private queueGlance(key: string, prKey: PrKey): void {
    const glances = this.queuedGlances.get(key) ?? new Set<PrKey>();
    glances.add(prKey);
    this.queuedGlances.set(key, glances);
    this.changeCount += 1;
  }

  private start(topicId: string | null, prKeys: PrKey[] | null): void {
    const key = keyOf(topicId);
    this.changeCount += 1;
    const run = prKeys === null ? this.runners.topic(topicId) : this.runners.glances(topicId, prKeys);
    const done = run
      .catch((error: unknown) => {
        this.log(`catch-up ${topicId ?? 'unsorted'}: failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        this.running.delete(key);
        this.changeCount += 1;
        if (this.queued.has(key) || this.queuedGlances.has(key)) {
          this.wait(topicId);
        }
        this.startWaiting();
      });
    this.running.set(key, { topicId, prKeys, done });
  }

  /** Fills the free slots from the line of waiting topics. */
  private startWaiting(): void {
    while (!this.isFull() && this.waiting.size > 0) {
      const [key, topicId] = this.waiting.entries().next().value!;
      this.waiting.delete(key);
      this.startFollowUp(topicId);
    }
  }

  /** The queued follow-up, if any: a whole-topic run wins over (and covers) queued glances. */
  private startFollowUp(topicId: string | null): void {
    const key = keyOf(topicId);
    const whole = this.queued.delete(key);
    const glances = this.queuedGlances.get(key);
    this.queuedGlances.delete(key);
    if (!this.canStart()) {
      return;
    }
    if (whole) {
      this.start(topicId, null);
    } else if (glances) {
      this.start(topicId, [...glances]);
    }
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
    if (this.isFull()) {
      if (!this.queued.has(key)) {
        this.queued.add(key);
        this.changeCount += 1;
      }
      this.wait(topicId);
      return 'queued';
    }
    this.start(topicId, null);
    return 'started';
  }

  /**
   * One PR's glance only (refresh on look). Covered when a run for its topic
   * is queued (whole-topic, or a glance run for this PR): that run starts
   * later and sees the PR as it is now. A run already going may have read
   * its inputs before the PR changed, so the PR is queued behind it; the
   * follow-up checks the input hash again and makes no call when the going
   * run wrote a current glance.
   */
  requestGlance(topicId: string | null, prKey: PrKey): GlanceRequest {
    const key = keyOf(topicId);
    if (this.queued.has(key) || this.queuedGlances.get(key)?.has(prKey)) {
      return 'covered';
    }
    if (this.running.has(key)) {
      this.queueGlance(key, prKey);
      return 'queued';
    }
    if (!this.canStart()) {
      return 'skipped';
    }
    if (this.isFull()) {
      this.queueGlance(key, prKey);
      this.wait(topicId);
      return 'queued';
    }
    this.start(topicId, [prKey]);
    return 'started';
  }

  /**
   * Running wins over queued. A whole-topic run counts for every PR of the
   * topic, a glance-only run only for its own PRs. Without a prKey: the
   * topic's whole-topic state, the one that rewrites its dossier and facts.
   */
  stateOf(topicId: string | null, prKey: PrKey | null = null): CatchUpRunState {
    const key = keyOf(topicId);
    const run = this.running.get(key);
    if (run && (run.prKeys === null || (prKey !== null && run.prKeys.includes(prKey)))) {
      return 'running';
    }
    if (this.queued.has(key) || (prKey !== null && this.queuedGlances.get(key)?.has(prKey) === true)) {
      return 'queued';
    }
    return null;
  }

  /** Settles once every run going now has ended. Follow-ups started later are not waited for. */
  settled(): Promise<void> {
    return Promise.all([...this.running.values()].map((run) => run.done)).then(() => {});
  }

  /** A full sync is about to start and covers every topic: forget the follow-ups. */
  dropQueued(): void {
    if (this.queued.size > 0 || this.queuedGlances.size > 0) {
      this.queued.clear();
      this.queuedGlances.clear();
      this.waiting.clear();
      this.changeCount += 1;
    }
  }

  changes(): number {
    return this.changeCount;
  }
}
