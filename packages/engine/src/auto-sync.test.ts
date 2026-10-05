import { FakeTimers } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { AutoSyncSchedule, WAKE_SYNC_DELAY_MINUTES } from './auto-sync.ts';
import { GitHubQuota } from './github-quota.ts';

const MINUTE = 60 * 1000;

/** Fake timers whose wall clock can jump ahead without firing anything: a Mac asleep, with its timers stood still. */
class SleepyTimers extends FakeTimers {
  private slept = 0;

  override now(): number {
    return super.now() + this.slept;
  }

  sleep(ms: number): void {
    this.slept += ms;
  }
}

function schedule(minutes: number, isSyncing: () => boolean = () => false) {
  const timers = new SleepyTimers();
  const syncs: number[] = [];
  const lines: string[] = [];
  const quota = new GitHubQuota(() => timers.now());
  const auto = new AutoSyncSchedule(
    {
      isSyncing,
      pausedUntil: () => quota.backgroundPausedUntil(),
      sync: async (maxAgentCalls) => {
        syncs.push(maxAgentCalls);
      },
    },
    timers,
    { minutes, maxAgentCalls: 150 },
    (line) => lines.push(line),
  );
  return { timers, syncs, lines, auto, quota };
}

describe('AutoSyncSchedule', () => {
  it('syncs every N minutes with the sync cap, and says when the next one is due', async () => {
    const { timers, syncs, auto } = schedule(60);
    auto.start();
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + 60 * MINUTE).toISOString());

    timers.advance(59 * MINUTE);
    expect(syncs).toEqual([]);
    timers.advance(MINUTE);
    await Promise.resolve();
    await Promise.resolve();
    expect(syncs).toEqual([150]);

    timers.advance(60 * MINUTE);
    await Promise.resolve();
    await Promise.resolve();
    expect(syncs).toEqual([150, 150]);
  });

  it('counts from the end of the last sync, whoever started it', () => {
    const { timers, syncs, auto } = schedule(60);
    auto.start();

    timers.advance(50 * MINUTE);
    auto.reschedule();
    timers.advance(50 * MINUTE);

    expect(syncs).toEqual([]);
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + 10 * MINUTE).toISOString());
  });

  it('comes back in a few minutes when the last sync left PRs over', () => {
    const { timers, auto } = schedule(60);
    auto.start();

    auto.reschedule(true);
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + 2 * MINUTE).toISOString());
    auto.reschedule(false);
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + 60 * MINUTE).toISOString());
  });

  it('skips when a sync is running at the due time', () => {
    const { timers, syncs, lines, auto } = schedule(60, () => true);
    auto.start();

    timers.advance(60 * MINUTE);

    expect(syncs).toEqual([]);
    expect(lines).toEqual(['auto sync: skipped, a sync is running']);
  });

  it('waits for the reset while the GitHub quota is low, then syncs', async () => {
    const { timers, syncs, lines, auto, quota } = schedule(60);
    auto.start();
    const resetAt = timers.now() + 75 * MINUTE;
    quota.note({ resource: 'graphql', limit: 5000, remaining: 2400, resetAtMs: resetAt });

    timers.advance(60 * MINUTE);
    await Promise.resolve();
    expect(syncs).toEqual([]);
    expect(lines).toEqual([`auto sync: GitHub quota low, waiting until ${new Date(resetAt).toISOString()}`]);
    expect(auto.nextSyncAt()).toBe(new Date(resetAt).toISOString());

    timers.advance(15 * MINUTE);
    await Promise.resolve();
    await Promise.resolve();
    expect(syncs).toEqual([150]);
  });

  it('holds the backlog follow-up too', async () => {
    const { timers, syncs, auto, quota } = schedule(60);
    auto.start();
    quota.note({ resource: 'core', limit: 5000, remaining: 900, resetAtMs: timers.now() + 30 * MINUTE });

    auto.reschedule(true);
    timers.advance(2 * MINUTE);
    await Promise.resolve();

    expect(syncs).toEqual([]);
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + 28 * MINUTE).toISOString());
  });

  it('stays off at 0 minutes and after stop', () => {
    const off = schedule(0);
    off.auto.start();
    off.timers.advance(24 * 60 * MINUTE);
    expect(off.syncs).toEqual([]);
    expect(off.auto.nextSyncAt()).toBeNull();

    const stopped = schedule(60);
    stopped.auto.start();
    stopped.auto.stop();
    stopped.timers.advance(120 * MINUTE);
    expect(stopped.syncs).toEqual([]);
    expect(stopped.auto.nextSyncAt()).toBeNull();
  });

  it('holds an overdue sync back for a few minutes after a wake', async () => {
    const { timers, syncs, lines, auto } = schedule(60);
    auto.start();
    timers.advance(50 * MINUTE);
    timers.sleep(8 * 60 * MINUTE);

    auto.wake();
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + WAKE_SYNC_DELAY_MINUTES * MINUTE).toISOString());
    expect(lines).toEqual([`auto sync: woke from sleep, next one at ${auto.nextSyncAt()}`]);

    timers.advance(WAKE_SYNC_DELAY_MINUTES * MINUTE - 1);
    expect(syncs).toEqual([]);
    timers.advance(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(syncs).toEqual([150]);
  });

  it('keeps a later due time, counted on the wall clock across the sleep', () => {
    const { timers, syncs, auto } = schedule(60);
    auto.start();
    timers.advance(10 * MINUTE);
    timers.sleep(20 * MINUTE);

    auto.wake();
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + 30 * MINUTE).toISOString());

    timers.advance(30 * MINUTE - 1);
    expect(syncs).toEqual([]);
    timers.advance(1);
    expect(syncs).toEqual([150]);
    // The timer from before the sleep is gone: no second sync where it would have fired.
    timers.advance(25 * MINUTE);
    expect(syncs).toEqual([150]);
  });

  it('fires nothing while suspended, even when the due time passes on the timer clock', async () => {
    const { timers, syncs, auto } = schedule(60);
    auto.start();
    timers.advance(50 * MINUTE);

    auto.suspend();
    // The due time passes during sleep, and here the timer clock runs on (as it may right at the wake).
    timers.advance(30 * MINUTE);
    await Promise.resolve();
    expect(syncs).toEqual([]);

    auto.wake();
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + WAKE_SYNC_DELAY_MINUTES * MINUTE).toISOString());
    timers.advance(WAKE_SYNC_DELAY_MINUTES * MINUTE);
    await Promise.resolve();
    await Promise.resolve();
    expect(syncs).toEqual([150]);
  });

  it('keeps a due time that is still ahead after a suspend and wake', () => {
    const { timers, syncs, auto } = schedule(60);
    auto.start();
    timers.advance(10 * MINUTE);

    auto.suspend();
    timers.sleep(20 * MINUTE);
    auto.wake();

    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + 30 * MINUTE).toISOString());
    timers.advance(30 * MINUTE - 1);
    expect(syncs).toEqual([]);
    timers.advance(1);
    expect(syncs).toEqual([150]);
  });

  it('keeps a due time set during sleep and arms it only on the wake', () => {
    const { timers, syncs, auto } = schedule(60);
    auto.start();

    auto.suspend();
    // A sync that ran into the sleep ends: the next due time is set, no timer yet.
    auto.reschedule(true);
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + 2 * MINUTE).toISOString());
    timers.advance(10 * MINUTE);
    expect(syncs).toEqual([]);

    auto.wake();
    expect(auto.nextSyncAt()).toBe(new Date(timers.now() + WAKE_SYNC_DELAY_MINUTES * MINUTE).toISOString());
  });

  it('leaves a stopped schedule alone on a wake', () => {
    const { auto, lines } = schedule(60);
    auto.start();
    auto.stop();

    auto.wake();

    expect(auto.nextSyncAt()).toBeNull();
    expect(lines).toEqual([]);
  });

  it('leaves the auto sync alone on a wake while it runs: its end sets the next one', () => {
    const timers = new SleepyTimers();
    const lines: string[] = [];
    let syncs = 0;
    const auto = new AutoSyncSchedule(
      {
        isSyncing: () => false,
        pausedUntil: () => null,
        // Never ends, like a sync still running at the wake.
        sync: () => {
          syncs += 1;
          return new Promise(() => {});
        },
      },
      timers,
      { minutes: 60, maxAgentCalls: 150 },
      (line) => lines.push(line),
    );
    auto.start();
    timers.advance(60 * MINUTE);
    expect(syncs).toBe(1);

    auto.wake();
    timers.advance(60 * MINUTE);

    expect(syncs).toBe(1);
    expect(lines.filter((line) => line.includes('woke'))).toEqual([]);
  });
});
