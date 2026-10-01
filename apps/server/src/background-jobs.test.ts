import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@postpile/core';
import type { EngineService } from '@postpile/engine';
import { startBackgroundJobs } from './background-jobs.ts';
import { CONSOLIDATION_CHECK_MS } from './consolidation-schedule.ts';

const CONFIG: AppConfig = { fake: false, syncCallCap: 40, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 15 };

function recordingEngine(calls: string[]): EngineService {
  const record = (name: string) => (options?: unknown) => {
    calls.push(options === undefined ? name : `${name} ${JSON.stringify(options)}`);
  };
  return {
    startLivePoll: record('startLivePoll'),
    stopLivePoll: record('stopLivePoll'),
    startAgentRequests: record('startAgentRequests'),
    stopAgentRequests: record('stopAgentRequests'),
    startAutoSync: record('startAutoSync'),
    stopAutoSync: record('stopAutoSync'),
    startWorkContextSchedule: record('startWorkContextSchedule'),
    stopWorkContextSchedule: record('stopWorkContextSchedule'),
    consolidate: async (options: unknown) => {
      calls.push(`consolidate ${JSON.stringify(options)}`);
      return { skipped: 'not_due' };
    },
  } as unknown as EngineService;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('startBackgroundJobs', () => {
  it('starts what the desktop main process runs, with the config caps, and stops all of it', async () => {
    vi.useFakeTimers();
    vi.stubEnv('POSTPILE_POLL_SECONDS', '90');
    const calls: string[] = [];

    const jobs = startBackgroundJobs(recordingEngine(calls), CONFIG);

    expect(calls).toEqual(['startLivePoll {"intervalSeconds":90}', 'startAgentRequests', 'startAutoSync {"minutes":15,"maxAgentCalls":40}', 'startWorkContextSchedule']);
    await vi.advanceTimersByTimeAsync(CONSOLIDATION_CHECK_MS);
    expect(calls.at(-1)).toBe('consolidate {"onlyIfDue":true,"maxAgentCalls":40}');

    calls.length = 0;
    jobs.stop();
    await vi.advanceTimersByTimeAsync(CONSOLIDATION_CHECK_MS);
    expect(calls).toEqual(['stopAgentRequests', 'stopLivePoll', 'stopAutoSync', 'stopWorkContextSchedule']);
  });

  it('passes poll notifications to the host, and drops them when it has none', () => {
    let pollOptions: { onNotify: (notifications: never[]) => void } | undefined;
    const engine = { ...recordingEngine([]), startLivePoll: (options: typeof pollOptions) => (pollOptions = options) } as unknown as EngineService;
    const notified: unknown[] = [];

    startBackgroundJobs(engine, CONFIG, { onNotify: (notifications) => notified.push(notifications) }).stop();
    pollOptions?.onNotify([]);
    expect(notified).toEqual([[]]);

    startBackgroundJobs(engine, CONFIG).stop();
    expect(() => pollOptions?.onNotify([])).not.toThrow();
  });
});
