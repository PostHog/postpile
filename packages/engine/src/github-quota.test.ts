import type { QuotaLevel, QuotaReading, QuotaResource } from '@postpile/core';
import { FakeTimers } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { GitHubQuota, quotaFetch } from './github-quota.ts';

const MINUTE = 60 * 1000;

function setup() {
  const timers = new FakeTimers();
  const worse: [QuotaResource, QuotaLevel][] = [];
  const quota = new GitHubQuota(
    () => timers.now(),
    (resource, level) => worse.push([resource, level]),
  );
  const reading = (remaining: number, overrides: Partial<QuotaReading> = {}): QuotaReading => ({
    resource: 'graphql',
    limit: 5000,
    remaining,
    resetAtMs: timers.now() + 40 * MINUTE,
    ...overrides,
  });
  return { timers, worse, quota, reading };
}

describe('GitHubQuota', () => {
  it('lets background work run until half the limit is used', () => {
    const { quota, reading } = setup();
    expect(quota.allowsBackground()).toBe(true);
    quota.note(reading(2501));
    expect(quota.allowsBackground()).toBe(true);
    quota.note(reading(2500));
    expect(quota.allowsBackground()).toBe(false);
    expect(quota.pollPausedUntil()).toBeNull();
    expect(quota.pollSeconds(10)).toBe(60);
  });

  it('pauses the poll at a fifth left, and resumes everything at the reset', () => {
    const { timers, quota, reading } = setup();
    const resetAt = timers.now() + 40 * MINUTE;
    quota.note(reading(1000));
    expect(quota.pollPausedUntil()).toBe(resetAt);
    expect(quota.backgroundPausedUntil()).toBe(resetAt);

    timers.advance(40 * MINUTE);
    expect(quota.allowsBackground()).toBe(true);
    expect(quota.pollPausedUntil()).toBeNull();
    expect(quota.pollSeconds(10)).toBe(10);
  });

  it('reports each drop into a worse level once, not every request', () => {
    const { worse, quota, reading } = setup();
    quota.note(reading(3000));
    quota.note(reading(2400));
    quota.note(reading(2300));
    // An answer that was on the way before the last one does not flip it back.
    quota.note(reading(2600));
    quota.note(reading(2200));
    quota.note(reading(900));
    quota.note(reading(800));
    quota.note(reading(2000, { resource: 'core' }));

    expect(worse).toEqual([
      ['graphql', 'low'],
      ['graphql', 'critical'],
      ['core', 'low'],
    ]);
  });

  it('reports again in the next window', () => {
    const { timers, worse, quota, reading } = setup();
    quota.note(reading(2000));
    timers.advance(41 * MINUTE);
    quota.note(reading(2000));
    expect(worse).toEqual([
      ['graphql', 'low'],
      ['graphql', 'low'],
    ]);
  });

  it('counts requests since start and per run, with the lowest share seen in the run', () => {
    const { quota, reading } = setup();
    quota.note(null);
    quota.startRun();
    quota.note(reading(4000));
    quota.note(reading(3500));
    quota.note(null);

    expect(quota.requestsSinceStart()).toBe(4);
    expect(quota.runStats()).toEqual({ requests: 3, lowestPercent: { graphql: 70 } });
    quota.startRun();
    expect(quota.runStats()).toEqual({ requests: 0, lowestPercent: {} });
  });

  it('shows nothing while ok and the reset time while low', () => {
    const { timers, quota, reading } = setup();
    expect(quota.view(10)).toBeNull();
    quota.note(reading(2000));
    expect(quota.view(10)).toEqual({
      level: 'low',
      resource: 'graphql',
      remainingPercent: 40,
      resumeAt: new Date(timers.now() + 40 * MINUTE).toISOString(),
      pollSeconds: 60,
    });
  });
});

describe('quotaFetch', () => {
  it('notes every answer with its rate-limit headers', async () => {
    const { quota } = setup();
    const answers = [
      new Response('{}', {
        status: 200,
        headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '1800', 'x-ratelimit-reset': '4000', 'x-ratelimit-resource': 'core' },
      }),
      new Response(null, { status: 304 }),
    ];
    const fetchFn = quotaFetch(quota, async () => answers.shift()!);

    await fetchFn('https://api.github.com/notifications', {});
    await fetchFn('https://api.github.com/notifications', {});

    expect(quota.requestsSinceStart()).toBe(2);
    expect(quota.describe()).toBe('core 36% left');
  });
});
