import type { MacNotification, Ping } from '@postpile/core';
import { FakeTimers } from '@postpile/core/fixtures';
import { GitHubError } from '@postpile/github';
import { describe, expect, it } from 'vitest';
import { LivePoller } from './live-poller.ts';
import type { PollCycle } from './poll-cycle.ts';

function done(overrides: Partial<Extract<PollCycle, { kind: 'done' }>> = {}): PollCycle {
  return { kind: 'done', notModified: true, githubPollIntervalSeconds: 60, prsUpdated: 0, decisions: [], pings: [], errors: [], ...overrides };
}

function ping(n: number): Ping {
  return { title: `ping ${n}`, body: 'body', target: { topicId: 'topic-1', tileId: `pr:acme/app#${n}`, prKey: `acme/app#${n}` } };
}

/** A poll function answering from a script, recording how often it ran. */
class ScriptedPoll {
  calls = 0;
  private readonly script: (() => Promise<PollCycle>)[] = [];

  then(answer: () => Promise<PollCycle>): this {
    this.script.push(answer);
    return this;
  }

  readonly fn = (): Promise<PollCycle> => {
    this.calls += 1;
    return (this.script.shift() ?? (() => Promise.resolve(done())))();
  };
}

function setup(poll: ScriptedPoll, intervalSeconds = 10) {
  const timers = new FakeTimers();
  const shown: MacNotification[][] = [];
  const logs: string[] = [];
  const poller = new LivePoller(poll.fn, timers, {
    intervalSeconds,
    onNotify: (notifications) => shown.push(notifications),
    log: (message) => logs.push(message),
  });
  return { timers, shown, logs, poller };
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
    expect(poller.currentStatus()).toMatchObject({ state: 'waiting', intervalSeconds: 10 });

    timers.advance(9_999);
    expect(poll.calls).toBe(0);
    await tick(timers, poller, 1);
    expect(poll.calls).toBe(1);
    await tick(timers, poller, 10_000);
    expect(poll.calls).toBe(2);

    expect(poller.currentStatus()).toMatchObject({ state: 'waiting', githubPollIntervalSeconds: 60, changeCount: 0 });
    expect(logs.filter((line) => line.includes('X-Poll-Interval'))).toHaveLength(1);
  });

  it('keeps its own interval when GitHub asks for a longer one', async () => {
    const poll = new ScriptedPoll().then(() => Promise.resolve(done({ githubPollIntervalSeconds: 120 })));
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 10_000);
    expect(poller.currentStatus().githubPollIntervalSeconds).toBe(120);
    await tick(timers, poller, 10_000);
    expect(poll.calls).toBe(2);
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
    await tick(timers, poller, 10_000);
    expect(poller.currentStatus()).toMatchObject({ state: 'blocked', note: 'full sync running' });
    await tick(timers, poller, 10_000);
    expect(poll.calls).toBe(2);
    expect(poller.currentStatus()).toMatchObject({ state: 'waiting', note: null });
  });

  it('backs off for Retry-After on a secondary rate limit', async () => {
    const limited = new GitHubError('secondary rate limit', 403, { rateLimited: true, retryAfterSeconds: 90 });
    const poll = new ScriptedPoll().then(() => Promise.reject(limited));
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 10_000);

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
    await tick(timers, poller, 10_000);
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const status = poller.currentStatus();
      const wait = Date.parse(status.backoffUntil!) - Date.parse(status.lastPollAt!);
      waits.push(wait / 1000);
      await tick(timers, poller, wait);
    }
    expect(waits).toEqual([60, 120, 240, 480, 900]);
  });

  it('backs off on other errors from the interval up to five minutes', async () => {
    const poll = new ScriptedPoll()
      .then(() => Promise.reject(new Error('socket hang up')))
      .then(() => Promise.reject(new Error('socket hang up')));
    const { timers, poller } = setup(poll);
    poller.start();
    await tick(timers, poller, 10_000);
    expect(poller.currentStatus()).toMatchObject({ state: 'backoff', note: 'error: socket hang up' });
    await tick(timers, poller, 20_000);
    expect(poll.calls).toBe(2);
    const status = poller.currentStatus();
    expect(Date.parse(status.backoffUntil!) - Date.parse(status.lastPollAt!)).toBe(40_000);
  });

  it('hands pings to onNotify grouped, counts changes, and survives a failing onNotify', async () => {
    const poll = new ScriptedPoll()
      .then(() => Promise.resolve(done({ notModified: false, prsUpdated: 1, pings: [ping(1)] })))
      .then(() => Promise.resolve(done({ notModified: false, prsUpdated: 4, pings: [ping(2), ping(3), ping(4), ping(5)] })));
    const { timers, poller, shown } = setup(poll);
    poller.start();
    await tick(timers, poller, 10_000);
    await tick(timers, poller, 10_000);

    expect(shown.map((batch) => batch.map((n) => [n.title, n.count]))).toEqual([[['ping 1', 1]], [['4 PRs need you', 4]]]);
    expect(poller.currentStatus()).toMatchObject({ changeCount: 2, notificationsShown: 2 });
  });

  it('stops scheduling after stop() and does not start with interval 0', async () => {
    const poll = new ScriptedPoll();
    const { timers, poller } = setup(poll);
    poller.start();
    poller.stop();
    timers.advance(60_000);
    expect(poll.calls).toBe(0);
    expect(poller.currentStatus().state).toBe('off');

    const off = setup(poll, 0);
    off.poller.start();
    expect(off.poller.currentStatus().state).toBe('off');
  });
});
