import { OFF_POLL_STATUS, type LivePollStatus, type Timers } from '@postpile/core';
import { GitHubError } from '@postpile/github';
import { errorText } from '../errors.ts';
import type { GitHubQuota } from '../github-quota.ts';
import type { LivePollOptions, PollCycle } from './poll-cycle.ts';
import { PingThrottle } from './ping-throttle.ts';

/** First wait after a rate limit without Retry-After; doubles per failure. */
export const RATE_LIMIT_BACKOFF_SECONDS = 60;
export const MAX_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60;
/** Other failures (network, 5xx) back off from the interval up to this. */
export const MAX_ERROR_BACKOFF_SECONDS = 5 * 60;
/** The footer's "live · paused: ..." while the GitHub quota is nearly used. */
export const QUOTA_PAUSE_NOTE = 'GitHub quota nearly used';
/** Window focus runs no cycle when the last one started less than this ago. */
export const FOCUS_DEBOUNCE_SECONDS = 15;

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Runs the fast notification poll on a timer: one cycle at a time, the next
 * one scheduled when the last one is done. Backs off on rate limits (Retry-
 * After or X-RateLimit-Reset when GitHub says, doubling from a minute when
 * not) and on errors, waits while a full sync runs, and hands grouped pings
 * to onNotify. GitHub's X-Poll-Interval is obeyed: the next cycle waits the
 * configured interval or the last X-Poll-Interval, whichever is longer. The
 * GitHub quota slows it to once a minute when low and pauses it until the
 * reset when critical (DESIGN.md "GitHub quota"); the slower rule wins.
 * Window focus runs one cycle right away (runOnFocus), debounced.
 */
export class LivePoller {
  private readonly throttle = new PingThrottle();
  private readonly log: (message: string) => void;
  private readonly status: LivePollStatus;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private failures = 0;
  /** Seconds between cycles last time, header and quota applied; logged when it changes. */
  private pace: number;
  /** Epoch ms when the last cycle started, for the focus debounce. */
  private lastStartMs: number | null = null;

  constructor(
    private readonly poll: () => Promise<PollCycle>,
    private readonly timers: Timers,
    private readonly options: LivePollOptions,
    /** Null: no quota rules, e.g. in tests that do not care. */
    private readonly quota: GitHubQuota | null = null,
  ) {
    this.log = options.log ?? ((message) => console.log(message));
    this.status = { ...OFF_POLL_STATUS, intervalSeconds: options.intervalSeconds, everySeconds: options.intervalSeconds };
    this.pace = options.intervalSeconds;
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

  /**
   * The window got focus: one cycle now, so what happened while the user was
   * away shows up without waiting for the timer. Skipped while the poll is
   * off, the quota pauses it or a backoff runs (the retry timer stays),
   * before the first cycle (the app's start sync goes first), and when a
   * cycle started less than FOCUS_DEBOUNCE_SECONDS ago, so switching windows
   * back and forth does not hammer GitHub.
   */
  runOnFocus(): Promise<void> {
    const pausedUntil = this.quota?.pollPausedUntil() ?? null;
    if (this.stopped || pausedUntil !== null || this.status.state === 'backoff' || this.lastStartMs === null) {
      return Promise.resolve();
    }
    if (this.timers.now() - this.lastStartMs < FOCUS_DEBOUNCE_SECONDS * 1000) {
      return Promise.resolve();
    }
    return this.runCycle();
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

  /** The quota is nearly used: no request until it resets. Logged once per pause. */
  private waitForQuota(untilMs: number): void {
    const seconds = Math.max(this.status.everySeconds, Math.ceil((untilMs - this.timers.now()) / 1000));
    if (this.status.note !== QUOTA_PAUSE_NOTE) {
      this.log(`live poll: paused until ${isoAt(untilMs)}, GitHub quota nearly used (${this.quota?.describe() ?? 'unknown'})`);
    }
    this.status.state = 'blocked';
    this.status.note = QUOTA_PAUSE_NOTE;
    if (!this.stopped) {
      this.schedule(seconds);
    } else {
      this.status.state = 'off';
    }
  }

  /** Seconds to the next cycle when nothing failed: interval or X-Poll-Interval, or longer while the quota is low. */
  private nextDelay(): number {
    const every = this.status.everySeconds;
    const seconds = this.quota?.pollSeconds(every) ?? every;
    if (seconds !== this.pace) {
      const github = this.status.githubPollIntervalSeconds === null ? 'none' : `${this.status.githubPollIntervalSeconds}s`;
      const quota = this.quota?.describe() ?? 'unknown';
      this.log(`live poll: every ${seconds}s (interval ${this.options.intervalSeconds}s, X-Poll-Interval ${github}, GitHub quota ${quota})`);
      this.pace = seconds;
    }
    return seconds;
  }

  private async cycle(): Promise<void> {
    this.clearTimer();
    const pausedUntil = this.quota?.pollPausedUntil() ?? null;
    if (pausedUntil !== null) {
      this.waitForQuota(pausedUntil);
      return;
    }
    this.status.state = 'polling';
    this.status.nextPollAt = null;
    const startedMs = this.timers.now();
    this.lastStartMs = startedMs;
    let delay: number;
    try {
      this.record(await this.poll(), startedMs);
      delay = this.nextDelay();
    } catch (error) {
      delay = this.backOff(error);
    }
    if (!this.stopped) {
      this.schedule(delay);
    } else {
      this.status.state = 'off';
    }
  }

  private record(result: PollCycle, startedMs: number): void {
    const now = this.timers.now();
    this.status.lastPollAt = isoAt(now);
    if (result.kind === 'blocked') {
      this.status.state = 'blocked';
      this.status.note = result.reason;
      return;
    }
    this.failures = 0;
    // The cycle's start, not its end: agent work after the fetch can take minutes, and the data is as old as the request.
    this.status.lastAnsweredAt = isoAt(startedMs);
    this.status.state = 'waiting';
    this.status.backoffUntil = null;
    this.status.note = null;
    // An answer without the header keeps the last one: never poll faster than GitHub asked.
    const github = result.githubPollIntervalSeconds;
    if (github !== null && github !== this.status.githubPollIntervalSeconds) {
      this.log(`live poll: GitHub sent X-Poll-Interval ${github}s`);
      this.status.githubPollIntervalSeconds = github;
      this.status.everySeconds = Math.max(this.options.intervalSeconds, github);
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

  /** Returns the delay before the next try, in seconds: never shorter than the interval, X-Poll-Interval included. */
  private backOff(error: unknown): number {
    this.failures += 1;
    const interval = this.status.everySeconds;
    let delay: number;
    let note: string;
    if (error instanceof GitHubError && error.rateLimited) {
      const doubling = Math.min(RATE_LIMIT_BACKOFF_SECONDS * 2 ** (this.failures - 1), MAX_RATE_LIMIT_BACKOFF_SECONDS);
      delay = Math.max(error.retryAfterSeconds ?? doubling, interval);
      note = `rate limited (${error.status}), next try in ${delay}s`;
    } else {
      delay = Math.max(Math.min(interval * 2 ** this.failures, MAX_ERROR_BACKOFF_SECONDS), interval);
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
