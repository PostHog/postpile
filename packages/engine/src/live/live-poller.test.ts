import type { MacNotification, Ping } from '@postpile/core';
import { FakeTimers } from '@postpile/core/fixtures';
import { GitHubError } from '@postpile/github';
import { describe, expect, it } from 'vitest';
import { GitHubQuota } from '../github-quota.ts';
import { FOCUS_DEBOUNCE_SECONDS, LivePoller, QUOTA_PAUSE_NOTE } from './live-poller.ts';
import type { PollCycle } from './poll-cycle.ts';

function done(overrides: Partial<Extract<PollCycle, { kind: 'done' }>> = {}): PollCycle {
  return { kind: 'done', notModified: true, githubPollIntervalSeconds: 60, prsUpdated: 0, decisions: [], pings: [], errors: [], ...overrides };
}

function ping(n: number): Ping {
  return { title: `ping ${n}`, body: 'body', target: { topicId: 'topic-1', tileId: `pr:acme/app#${n}`, prKey: `acme/app#${n}` }, personal: false };
}

/** A poll function answering from a script, recording how often it ran. */
class ScriptedPoll {
  calls = 0;
  private readonly script: (() => Promise<PollCycle>)[] = [];

  // oxlint-disable-next-line unicorn/no-thenable -- fluent script API: poll.then(a).then(b)
  then(answer: () => Promise<PollCycle>): this {
    this.script.push(answer);
    return this;
  }

  readonly fn = (): Promise<PollCycle> => {
    this.calls += 1;
    return (this.script.shift() ?? (() => Promise.resolve(done())))();
  };
}

function setup(poll: ScriptedPoll, intervalSeconds = 60) {
  const timers = new FakeTimers();
  const shown: MacNotification[][] = [];
  const logs: string[] = [];
  const quota = new GitHubQuota(() => timers.now());
  const poller = new LivePoller(
    poll.fn,
    timers,
    {
      intervalSeconds,
      onNotify: (notifications) => shown.push(notifications),
      log: (message) => logs.push(message),
    },
    quota,
  );
  return { timers, shown, logs, poller, quota };
}

/** Moves the clock and lets the cycle the timer started finish. */
async function tick(timers: FakeTimers, poller: LivePoller, ms: number): Promise<void> {
  timers.advance(ms);
  await poller.runCycle();
}

describe('LivePoller', () => {
  it('polls every interval after the first wait and logs X-Poll-Interval once', async () => {
    const poll = new ScriptedPoll();
    const { timers, poller, logs } = setup(poll);
    poller.start();
    expect(poller.currentStatus()).toMatchObject({ state: 'waiting', intervalSeconds: 60, everySeconds: 60 });

    timers.advance(59_999);
    expect(poll.calls).toBe(0);
    await tick(timers, poller, 1);
    expect(poll.calls).toBe(1);
    await tick(timers, poller, 60_000);
    expect(poll.calls).toBe(2);

    expect(poller.currentStatus()).toMatchObject({ state: 'waiting', githubPollIntervalSeconds: 60, everySeconds: 60, changeCount: 0 });
    expect(logs.filter((line) => line.includes('GitHub sent X-Poll-Interval'))).toHaveLength(1);
  });

  it('waits for X-Poll-Interval when GitHub asks for longer than the interval', async () => {
    const poll = new ScriptedPoll().then(() => Promise.resolve(done({ githubPollIntervalSeconds: 120 })));
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    expect(poller.currentStatus()).toMatchObject({ githubPollIntervalSeconds: 120, everySeconds: 120 });
    timers.advance(119_999);
    expect(poll.calls).toBe(1);
    await tick(timers, poller, 1);
    expect(poll.calls).toBe(2);
  });

  it('raises a shorter configured interval to X-Poll-Interval once GitHub sent one', async () => {
    const poll = new ScriptedPoll();
    const { timers, poller, logs } = setup(poll, 10);
    poller.start();
    await tick(timers, poller, 10_000);
    expect(poll.calls).toBe(1);
    expect(poller.currentStatus()).toMatchObject({ intervalSeconds: 10, everySeconds: 60 });
    timers.advance(59_999);
    expect(poll.calls).toBe(1);
    await tick(timers, poller, 1);
    expect(poll.calls).toBe(2);
    expect(logs).toContain('live poll: every 60s (interval 10s, X-Poll-Interval 60s, GitHub quota ok)');
  });

  it('keeps the last X-Poll-Interval when an answer has none', async () => {
    const poll = new ScriptedPoll().then(() => Promise.resolve(done())).then(() => Promise.resolve(done({ githubPollIntervalSeconds: null })));
    const { timers, poller } = setup(poll, 10);
    poller.start();
    await tick(timers, poller, 10_000);
    await tick(timers, poller, 60_000);
    expect(poll.calls).toBe(2);
    expect(poller.currentStatus()).toMatchObject({ githubPollIntervalSeconds: 60, everySeconds: 60 });
    timers.advance(59_999);
    expect(poll.calls).toBe(2);
    await tick(timers, poller, 1);
    expect(poll.calls).toBe(3);
  });

  it('runs one cycle at a time: a second call joins the running one', async () => {
    let release: (cycle: PollCycle) => void = () => {};
    const poll = new ScriptedPoll().then(() => new Promise((resolve) => (release = resolve)));
    const { poller } = setup(poll);

    const first = poller.runCycle();
    const second = poller.runCycle();
    expect(poller.currentStatus().state).toBe('polling');
    release(done());
    await Promise.all([first, second]);

    expect(poll.calls).toBe(1);
  });

  it('shows blocked while a full sync runs and tries again after the interval', async () => {
    const poll = new ScriptedPoll().then(() => Promise.resolve({ kind: 'blocked', reason: 'full sync running' }));
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    expect(poller.currentStatus()).toMatchObject({ state: 'blocked', note: 'full sync running' });
    await tick(timers, poller, 60_000);
    expect(poll.calls).toBe(2);
    expect(poller.currentStatus()).toMatchObject({ state: 'waiting', note: null });
  });

  it('backs off for Retry-After on a secondary rate limit', async () => {
    const limited = new GitHubError('secondary rate limit', 403, { rateLimited: true, retryAfterSeconds: 90 });
    const poll = new ScriptedPoll().then(() => Promise.reject(limited));
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);

    const status = poller.currentStatus();
    expect(status).toMatchObject({ state: 'backoff', note: 'rate limited (403), next try in 90s' });
    expect(Date.parse(status.backoffUntil!) - Date.parse(status.lastPollAt!)).toBe(90_000);
    timers.advance(89_999);
    expect(poll.calls).toBe(1);
    await tick(timers, poller, 1);
    expect(poll.calls).toBe(2);
    expect(poller.currentStatus()).toMatchObject({ state: 'waiting', backoffUntil: null, note: null });
  });

  it('doubles from a minute on rate limits without Retry-After, capped at 15 minutes', async () => {
    const limited = (): Promise<PollCycle> => Promise.reject(new GitHubError('rate limit', 429, { rateLimited: true, retryAfterSeconds: null }));
    const poll = new ScriptedPoll();
    for (let i = 0; i < 6; i++) {
      poll.then(limited);
    }
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const status = poller.currentStatus();
      const wait = Date.parse(status.backoffUntil!) - Date.parse(status.lastPollAt!);
      waits.push(wait / 1000);
      await tick(timers, poller, wait);
    }
    expect(waits).toEqual([60, 120, 240, 480, 900]);
  });

  it('never retries a rate limit without Retry-After sooner than X-Poll-Interval', async () => {
    const limited = new GitHubError('rate limit', 429, { rateLimited: true, retryAfterSeconds: null });
    const poll = new ScriptedPoll().then(() => Promise.resolve(done({ githubPollIntervalSeconds: 120 }))).then(() => Promise.reject(limited));
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    await tick(timers, poller, 120_000);

    const status = poller.currentStatus();
    expect(status).toMatchObject({ state: 'backoff', note: 'rate limited (429), next try in 120s' });
    expect(Date.parse(status.backoffUntil!) - Date.parse(status.lastPollAt!)).toBe(120_000);
  });

  it('backs off on other errors from the interval up to five minutes', async () => {
    const hangUp = (): Promise<PollCycle> => Promise.reject(new Error('socket hang up'));
    const poll = new ScriptedPoll().then(hangUp).then(hangUp).then(hangUp);
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    expect(poller.currentStatus()).toMatchObject({ state: 'backoff', note: 'error: socket hang up' });
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const status = poller.currentStatus();
      const wait = Date.parse(status.backoffUntil!) - Date.parse(status.lastPollAt!);
      waits.push(wait / 1000);
      await tick(timers, poller, wait);
    }
    expect(waits).toEqual([120, 240, 300]);
  });

  it('hands pings to onNotify grouped, counts changes, and survives a failing onNotify', async () => {
    const poll = new ScriptedPoll()
      .then(() => Promise.resolve(done({ notModified: false, prsUpdated: 1, pings: [ping(1)] })))
      .then(() => Promise.resolve(done({ notModified: false, prsUpdated: 4, pings: [ping(2), ping(3), ping(4), ping(5)] })));
    const { timers, poller, shown } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    await tick(timers, poller, 60_000);

    expect(shown.map((batch) => batch.map((n) => [n.title, n.count]))).toEqual([[['ping 1', 1]], [['4 PRs need you', 4]]]);
    expect(poller.currentStatus()).toMatchObject({ changeCount: 2, notificationsShown: 2 });
  });

  it('stops scheduling after stop() and does not start with interval 0', async () => {
    const poll = new ScriptedPoll();
    const { timers, poller } = setup(poll);
    poller.start();
    poller.stop();
    timers.advance(120_000);
    expect(poll.calls).toBe(0);
    expect(poller.currentStatus().state).toBe('off');

    const off = setup(poll, 0);
    off.poller.start();
    expect(off.poller.currentStatus().state).toBe('off');
  });

  it('slows to once a minute while the GitHub quota is low', async () => {
    const poll = new ScriptedPoll().then(() => Promise.resolve(done({ githubPollIntervalSeconds: null })));
    const { timers, poller, logs, quota } = setup(poll, 10);
    poller.start();
    quota.note({ resource: 'graphql', limit: 5000, remaining: 2000, resetAtMs: timers.now() + 30 * 60_000 });

    await tick(timers, poller, 10_000);
    expect(poll.calls).toBe(1);
    expect(poller.currentStatus().nextPollAt).toBe(new Date(timers.now() + 60_000).toISOString());
    timers.advance(59_999);
    expect(poll.calls).toBe(1);
    await tick(timers, poller, 1);
    expect(poll.calls).toBe(2);
    expect(logs).toContain('live poll: every 60s (interval 10s, X-Poll-Interval none, GitHub quota graphql 40% left)');
  });

  it('takes the slower of X-Poll-Interval and the low quota pace', async () => {
    const poll = new ScriptedPoll().then(() => Promise.resolve(done({ githubPollIntervalSeconds: 120 })));
    const { timers, poller, quota } = setup(poll);
    poller.start();
    quota.note({ resource: 'graphql', limit: 5000, remaining: 2000, resetAtMs: timers.now() + 30 * 60_000 });

    await tick(timers, poller, 60_000);
    expect(poller.currentStatus().nextPollAt).toBe(new Date(timers.now() + 120_000).toISOString());
  });

  it('pauses until the reset while the quota is nearly used, then polls again', async () => {
    const poll = new ScriptedPoll();
    const { timers, poller, logs, quota } = setup(poll);
    poller.start();
    const resetAt = timers.now() + 20 * 60_000;
    quota.note({ resource: 'core', limit: 5000, remaining: 400, resetAtMs: resetAt });

    await tick(timers, poller, 60_000);
    expect(poll.calls).toBe(0);
    expect(poller.currentStatus()).toMatchObject({ state: 'blocked', note: QUOTA_PAUSE_NOTE, nextPollAt: new Date(resetAt).toISOString() });
    // A cycle asked for meanwhile (a sync ended, the window got focus) waits too, and logs nothing new.
    await poller.runCycle();
    expect(poll.calls).toBe(0);
    expect(logs.filter((line) => line.includes('paused until'))).toHaveLength(1);

    await tick(timers, poller, resetAt - timers.now());
    expect(poll.calls).toBe(1);
    expect(poller.currentStatus()).toMatchObject({ state: 'waiting', note: null });
  });

  it('runs one cycle on focus, but not within 15s of the last one', async () => {
    const poll = new ScriptedPoll();
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    expect(poll.calls).toBe(1);

    timers.advance(FOCUS_DEBOUNCE_SECONDS * 1000 - 1);
    await poller.runOnFocus();
    expect(poll.calls).toBe(1);
    timers.advance(1);
    await poller.runOnFocus();
    expect(poll.calls).toBe(2);
    await poller.runOnFocus();
    expect(poll.calls).toBe(2);
    // The regular timer counts from the focus cycle.
    expect(poller.currentStatus().nextPollAt).toBe(new Date(timers.now() + 60_000).toISOString());
  });

  it('runs no focus cycle before the first cycle or while the poll is off', async () => {
    const poll = new ScriptedPoll();
    const { poller } = setup(poll);
    poller.start();
    await poller.runOnFocus();
    expect(poll.calls).toBe(0);

    const off = setup(poll, 0);
    off.poller.start();
    await off.poller.runOnFocus();
    expect(poll.calls).toBe(0);
  });

  it('runs no focus cycle while the quota is nearly used', async () => {
    const poll = new ScriptedPoll();
    const { timers, poller, quota } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    quota.note({ resource: 'core', limit: 5000, remaining: 400, resetAtMs: timers.now() + 20 * 60_000 });

    timers.advance(30_000);
    await poller.runOnFocus();
    expect(poll.calls).toBe(1);
    expect(poller.currentStatus().state).toBe('waiting');
  });

  it('runs no focus cycle while backing off and keeps the retry timer', async () => {
    const limited = new GitHubError('secondary rate limit', 403, { rateLimited: true, retryAfterSeconds: 600 });
    const poll = new ScriptedPoll().then(() => Promise.reject(limited));
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 60_000);
    const retryAt = poller.currentStatus().nextPollAt;

    timers.advance(30_000);
    await poller.runOnFocus();
    expect(poll.calls).toBe(1);
    expect(poller.currentStatus()).toMatchObject({ state: 'backoff', nextPollAt: retryAt });
    await tick(timers, poller, 570_000);
    expect(poll.calls).toBe(2);
  });
});
