import { describe, expect, it } from 'vitest';
import { OFF_POLL_STATUS, type LivePollStatus } from '@code-manager/core';
import { liveLabel } from './live.ts';

const now = new Date('2026-09-28T10:00:00Z');
const running: LivePollStatus = { ...OFF_POLL_STATUS, state: 'waiting', intervalSeconds: 10, githubPollIntervalSeconds: 60 };

describe('liveLabel', () => {
  it('says off when the poll never started', () => {
    expect(liveLabel(undefined, now).text).toBe('live poll off');
    expect(liveLabel(OFF_POLL_STATUS, now).text).toBe('live poll off');
  });

  it('shows the interval and GitHub’s X-Poll-Interval in the tooltip', () => {
    const label = liveLabel(running, now);
    expect(label).toMatchObject({ text: 'live · every 10s', warn: false });
    expect(label.title).toContain('GitHub asks for 60s (X-Poll-Interval)');
  });

  it('warns while backing off, with the seconds left', () => {
    const status: LivePollStatus = { ...running, state: 'backoff', backoffUntil: '2026-09-28T10:01:30Z', note: 'rate limited (403), next try in 90s' };
    expect(liveLabel(status, now)).toMatchObject({ text: 'live · backing off, retry in 90s', warn: true });
    expect(liveLabel(status, now).title).toMatch(/^rate limited \(403\)/);
  });

  it('says why it is paused', () => {
    expect(liveLabel({ ...running, state: 'blocked', note: 'full sync running' }, now).text).toBe('live · paused: full sync running');
  });
});
