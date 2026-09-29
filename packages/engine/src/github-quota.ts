import {
  mergeQuotaReading,
  quotaPercent,
  quotaPollSeconds,
  quotaReadingOf,
  quotaState,
  quotaView,
  quotaWorsened,
  type GitHubQuotaView,
  type QuotaLevel,
  type QuotaReading,
  type QuotaResource,
  type QuotaState,
} from '@postpile/core';
import type { FetchFn } from '@postpile/github';

/** What one sync (or any run) did to the quota: requests made, and the lowest share of each limit seen meanwhile. */
export interface QuotaRunStats {
  requests: number;
  /** Whole percent; a resource is missing when no answer during the run carried it. */
  lowestPercent: Partial<Record<QuotaResource, number>>;
}

function emptyRunStats(): QuotaRunStats {
  return { requests: 0, lowestPercent: {} };
}

/**
 * The GitHub quota as PostPile last saw it (DESIGN.md "GitHub quota"): the
 * newest X-RateLimit-* reading per limit, kept in memory, and the one place
 * that answers "may background GitHub work run now?". Every GitHub answer
 * reports here through quotaFetch. The rules live in core (github-quota.ts);
 * this class only holds the readings and counts requests since start and
 * per run. `onWorse` is called once per drop into a worse level within a
 * rate-limit window (telemetry), never per request.
 */
export class GitHubQuota {
  private readonly readings = new Map<QuotaResource, QuotaReading>();
  private totalRequests = 0;
  private run = emptyRunStats();

  constructor(
    private readonly now: () => number,
    private readonly onWorse: (resource: QuotaResource, level: Exclude<QuotaLevel, 'ok'>) => void = () => {},
  ) {}

  /** One GitHub answer: counts the request and keeps its reading, if it carried one. */
  note(reading: QuotaReading | null): void {
    this.totalRequests += 1;
    this.run.requests += 1;
    if (reading === null) {
      return;
    }
    const last = this.readings.get(reading.resource);
    const kept = mergeQuotaReading(last, reading);
    this.readings.set(reading.resource, kept);
    const percent = quotaPercent(kept.remaining, kept.limit);
    this.run.lowestPercent[reading.resource] = Math.min(this.run.lowestPercent[reading.resource] ?? 100, percent);
    const worse = quotaWorsened(last, kept, this.now());
    if (worse === 'low' || worse === 'critical') {
      this.onWorse(reading.resource, worse);
    }
  }

  state(): QuotaState {
    return quotaState([...this.readings.values()], this.now());
  }

  /** Optional background GitHub work (the hourly auto sync, its backlog follow-ups) runs only while more than half of every limit is left. */
  allowsBackground(): boolean {
    return this.state().level === 'ok';
  }

  /** Epoch ms until which optional background work waits, null while it may run. */
  backgroundPausedUntil(): number | null {
    return this.state().backgroundResumeAtMs;
  }

  /** Epoch ms until which the live poll waits (critical), null while it may run. */
  pollPausedUntil(): number | null {
    return this.state().pollResumeAtMs;
  }

  /** How long the live poll waits between cycles at this level; its own interval while ok. */
  pollSeconds(intervalSeconds: number): number {
    return quotaPollSeconds(this.state(), intervalSeconds) ?? intervalSeconds;
  }

  /** For the status footer; null while ok. */
  view(intervalSeconds: number): GitHubQuotaView | null {
    return quotaView(this.state(), intervalSeconds);
  }

  /** A short "graphql 40% left" for log lines. */
  describe(): string {
    const worst = this.state().worst;
    return worst ? `${worst.resource} ${quotaPercent(worst.remaining, worst.limit)}% left` : 'ok';
  }

  requestsSinceStart(): number {
    return this.totalRequests;
  }

  /** A sync starts: its request count and lowest shares start over. Syncs never overlap. */
  startRun(): void {
    this.run = emptyRunStats();
  }

  runStats(): QuotaRunStats {
    return { requests: this.run.requests, lowestPercent: { ...this.run.lowestPercent } };
  }
}

/** Calls the global fetch without binding it to our object. */
const globalFetch: FetchFn = (url, init) => fetch(url, init);

/** fetch that reports every GitHub answer's rate-limit headers to the quota. A thrown fetch made no answer and counts nothing. */
export function quotaFetch(quota: GitHubQuota, inner: FetchFn = globalFetch): FetchFn {
  return async (url, init) => {
    const response = await inner(url, init);
    quota.note(quotaReadingOf((name) => response.headers.get(name)));
    return response;
  };
}
