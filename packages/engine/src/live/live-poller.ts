import { OFF_POLL_STATUS, type LivePollStatus, type Timers } from '@code-manager/core';
import { GitHubError } from '@code-manager/github';
import { errorText } from '../errors.ts';
import type { LivePollOptions, PollCycle } from './poll-cycle.ts';
import { PingThrottle } from './ping-throttle.ts';

/** First wait after a rate limit without Retry-After; doubles per failure. */
export const RATE_LIMIT_BACKOFF_SECONDS = 60;
export const MAX_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60;
/** Other failures (network, 5xx) back off from the interval up to this. */
export const MAX_ERROR_BACKOFF_SECONDS = 5 * 60;

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Runs the fast notification poll on a timer: one cycle at a time, the next
 * one scheduled when the last one is done. Backs off on rate limits (Retry-
 * After or X-RateLimit-Reset when GitHub says, doubling from a minute when
 * not) and on errors, waits while a full sync runs, and hands grouped pings
 * to onNotify. GitHub's X-Poll-Interval is logged and shown, not obeyed:
 * the configured interval wins (a 304 costs no rate limit).
 */
export class LivePoller {
  private readonly throttle = new PingThrottle();
  private readonly log: (message: string) => void;
  private readonly status: LivePollStatus;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private failures = 0;

  constructor(
    private readonly poll: () => Promise<PollCycle>,
    private readonly timers: Timers,
    private readonly options: LivePollOptions,
  ) {
    this.log = options.log ?? ((message) => console.log(message));
    this.status = { ...OFF_POLL_STATUS, intervalSeconds: options.intervalSeconds };
  }

  /** The first cycle runs after one interval, so the app's start sync goes first. */
  start(): void {
    if (!this.stopped || this.options.intervalSeconds <= 0) {
      return;
    }
    this.stopped = false;
    this.status.state = 'waiting';
    this.schedule(this.options.intervalSeconds);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.status.state = 'off';
    this.status.nextPollAt = null;
  }

  currentStatus(): LivePollStatus {
    return { ...this.status };
  }

  /** One cycle now. A cycle already running is joined, never doubled. */
  runCycle(): Promise<void> {
    if (!this.running) {
      this.running = this.cycle().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(seconds: number): void {
    this.clearTimer();
    this.status.nextPollAt = isoAt(this.timers.now() + seconds * 1000);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.runCycle();
    }, seconds * 1000);
  }

  private async cycle(): Promise<void> {
    this.clearTimer();
    this.status.state = 'polling';
    this.status.nextPollAt = null;
    let delay = this.options.intervalSeconds;
    try {
      this.record(await this.poll());
    } catch (error) {
      delay = this.backOff(error);
    }
    if (!this.stopped) {
      this.schedule(delay);
    } else {
      this.status.state = 'off';
    }
  }

  private record(result: PollCycle): void {
    const now = this.timers.now();
    this.status.lastPollAt = isoAt(now);
    if (result.kind === 'blocked') {
      this.status.state = 'blocked';
      this.status.note = result.reason;
      return;
    }
    this.failures = 0;
    this.status.state = 'waiting';
    this.status.backoffUntil = null;
    this.status.note = null;
    if (result.githubPollIntervalSeconds !== this.status.githubPollIntervalSeconds) {
      this.log(`live poll: GitHub asks for X-Poll-Interval ${result.githubPollIntervalSeconds ?? 'none'}s, polling every ${this.options.intervalSeconds}s`);
      this.status.githubPollIntervalSeconds = result.githubPollIntervalSeconds;
    }
    if (!result.notModified) {
      this.status.lastChangeAt = isoAt(now);
      this.status.changeCount += 1;
    }
    for (const error of result.errors) {
      this.log(`live poll: ${error}`);
    }
    this.notify(result, now);
  }

  private notify(result: Extract<PollCycle, { kind: 'done' }>, now: number): void {
    const notifications = this.throttle.plan(result.pings, now);
    if (notifications.length === 0) {
      return;
    }
    this.status.notificationsShown += notifications.length;
    try {
      this.options.onNotify(notifications);
    } catch (error) {
      this.log(`live poll: showing a notification failed: ${errorText(error)}`);
    }
  }

  /** Returns the delay before the next try, in seconds. */
  private backOff(error: unknown): number {
    this.failures += 1;
    const interval = this.options.intervalSeconds;
    let delay: number;
    let note: string;
    if (error instanceof GitHubError && error.rateLimited) {
      const doubling = Math.min(RATE_LIMIT_BACKOFF_SECONDS * 2 ** (this.failures - 1), MAX_RATE_LIMIT_BACKOFF_SECONDS);
      delay = error.retryAfterSeconds !== null ? Math.max(error.retryAfterSeconds, interval) : doubling;
      note = `rate limited (${error.status}), next try in ${delay}s`;
    } else {
      delay = Math.min(interval * 2 ** this.failures, MAX_ERROR_BACKOFF_SECONDS);
      note = `error: ${errorText(error)}`;
    }
    const now = this.timers.now();
    this.status.lastPollAt = isoAt(now);
    this.status.state = 'backoff';
    this.status.backoffUntil = isoAt(now + delay * 1000);
    this.status.note = note;
    this.log(`live poll: ${note}, backing off ${delay}s`);
    return delay;
  }
}
