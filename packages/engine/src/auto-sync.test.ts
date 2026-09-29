import { FakeTimers } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { AutoSyncSchedule } from './auto-sync.ts';
import { GitHubQuota } from './github-quota.ts';

const MINUTE = 60 * 1000;

function schedule(minutes: number, isSyncing: () => boolean = () => false) {
  const timers = new FakeTimers();
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
});
