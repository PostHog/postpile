import { describe, expect, it } from 'vitest';
import { OFF_POLL_STATUS, type LivePollStatus } from '@postpile/core';
import { liveLabel, quotaLabel } from './live.ts';

const now = new Date('2026-09-28T10:00:00Z');
const running: LivePollStatus = { ...OFF_POLL_STATUS, state: 'waiting', intervalSeconds: 60, githubPollIntervalSeconds: 60, everySeconds: 60 };

describe('liveLabel', () => {
  it('says off when the poll never started', () => {
    expect(liveLabel(undefined, now).text).toBe('live poll off');
    expect(liveLabel(OFF_POLL_STATUS, now).text).toBe('live poll off');
  });

  it('shows the interval and GitHub’s X-Poll-Interval in the tooltip', () => {
    const label = liveLabel(running, now);
    expect(label).toMatchObject({ text: 'live · every 60s', warn: false });
    expect(label.title).toContain('GitHub asks for 60s (X-Poll-Interval)');
  });

  it('shows the effective interval when GitHub asks for more than the configured one', () => {
    const status: LivePollStatus = { ...running, intervalSeconds: 10, githubPollIntervalSeconds: 90, everySeconds: 90 };
    expect(liveLabel(status, now).text).toBe('live · every 90s');
    expect(liveLabel(status, now).title).toMatch(/^Polling every 90s \(set to 10s, GitHub asks for 90s/);
  });

  it('warns while backing off, with the seconds left', () => {
    const status: LivePollStatus = { ...running, state: 'backoff', backoffUntil: '2026-09-28T10:01:30Z', note: 'rate limited (403), next try in 90s' };
    expect(liveLabel(status, now)).toMatchObject({ text: 'live · backing off, retry in 90s', warn: true });
    expect(liveLabel(status, now).title).toMatch(/^rate limited \(403\)/);
  });

  it('says why it is paused', () => {
    expect(liveLabel({ ...running, state: 'blocked', note: 'full sync running' }, now).text).toBe('live · paused while syncing');
    expect(liveLabel({ ...running, state: 'blocked', note: 'consolidating' }, now).text).toBe('live · paused: consolidating');
  });
});

describe('quotaLabel', () => {
  const resumeAt = new Date(2026, 8, 28, 14, 5).toISOString();

  it('stays quiet while the quota is fine', () => {
    expect(quotaLabel(undefined)).toBeNull();
    expect(quotaLabel(running)).toBeNull();
  });

  it('says background sync waits until the reset, and the poll slows', () => {
    const quota = { level: 'low' as const, resource: 'graphql' as const, remainingPercent: 40, resumeAt, pollSeconds: 60 };
    const status: LivePollStatus = { ...running, intervalSeconds: 30, githubPollIntervalSeconds: null, everySeconds: 30, githubQuota: quota };
    expect(quotaLabel(status)).toMatchObject({ text: 'GitHub quota low: background sync paused until 14:05', warn: true });
    expect(quotaLabel(status)?.title).toMatch(/^GraphQL: 40% of the hourly limit left/);
    expect(liveLabel(status, now).text).toBe('live · every 60s');
  });

  it('says the live poll waits too when the quota is nearly used', () => {
    const status: LivePollStatus = { ...running, githubQuota: { level: 'critical', resource: 'core', remainingPercent: 12, resumeAt, pollSeconds: null } };
    expect(quotaLabel(status)?.text).toBe('GitHub quota nearly used: background sync and live poll paused until 14:05');
    expect(quotaLabel(status)?.title).toMatch(/^REST: 12%/);
  });
});
