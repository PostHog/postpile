import { FakeTimers } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { AutoSyncSchedule } from './auto-sync.ts';

const MINUTE = 60 * 1000;

function schedule(minutes: number, isSyncing: () => boolean = () => false) {
  const timers = new FakeTimers();
  const syncs: number[] = [];
  const lines: string[] = [];
  const auto = new AutoSyncSchedule(
    {
      isSyncing,
      sync: async (maxAgentCalls) => {
        syncs.push(maxAgentCalls);
      },
    },
    timers,
    { minutes, maxAgentCalls: 150 },
    (line) => lines.push(line),
  );
  return { timers, syncs, lines, auto };
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

  it('skips when a sync is running at the due time', () => {
    const { timers, syncs, lines, auto } = schedule(60, () => true);
    auto.start();

    timers.advance(60 * MINUTE);

    expect(syncs).toEqual([]);
    expect(lines).toEqual(['auto sync: skipped, a sync is running']);
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
