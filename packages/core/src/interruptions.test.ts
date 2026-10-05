import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERRUPTIONS, interruptionsModeOf, interruptionsView, latestRoundup, roundupNotification } from './interruptions.ts';
import type { Ping } from './pings.ts';

function ping(n: number, personal = false): Ping {
  return { title: `ping ${n}`, body: `body ${n}`, target: { topicId: 'topic-1', tileId: `pr:acme/app#${n}`, prKey: `acme/app#${n}` }, personal };
}

/** Local time; 2026-10-05 is a Monday. */
function local(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 9, day, hour, minute);
}

describe('interruptionsModeOf', () => {
  it('reads a stored mode and falls back to never', () => {
    expect(interruptionsModeOf('batches')).toBe('batches');
    expect(interruptionsModeOf(null)).toBe('never');
    expect(interruptionsModeOf('loud')).toBe('never');
    expect(DEFAULT_INTERRUPTIONS).toBe('never');
  });

  it('shows the roundup times as words', () => {
    expect(interruptionsView('asap')).toEqual({ mode: 'asap', roundupTimes: ['9:30', '13:30', '16:30'] });
  });
});

describe('latestRoundup', () => {
  it('finds the last roundup of the day', () => {
    expect(latestRoundup(local(5, 9, 30))).toEqual(local(5, 9, 30));
    expect(latestRoundup(local(5, 12))).toEqual(local(5, 9, 30));
    expect(latestRoundup(local(5, 17))).toEqual(local(5, 16, 30));
  });

  it('goes back to the day before in the early morning', () => {
    expect(latestRoundup(local(6, 8))).toEqual(local(5, 16, 30));
  });

  it('skips the weekend', () => {
    // Saturday 10th and Sunday 11th: Friday 9th's last roundup, also on Monday before 9:30.
    expect(latestRoundup(local(10, 12))).toEqual(local(9, 16, 30));
    expect(latestRoundup(local(12, 9))).toEqual(local(9, 16, 30));
  });
});

describe('roundupNotification', () => {
  it('shows a single ping as it is, without a Dock bounce', () => {
    expect(roundupNotification([ping(1, true)])).toEqual({
      title: 'ping 1',
      body: 'body 1',
      target: ping(1).target,
      prKeys: ['acme/app#1'],
      count: 1,
      personal: false,
    });
  });

  it('sums up several, personal asks first', () => {
    const notification = roundupNotification([ping(1), ping(2), ping(3, true), ping(4), ping(5)]);
    expect(notification.title).toBe('5 things need you');
    expect(notification.body).toBe('ping 3\nping 1\nping 2\nand 2 more');
    expect(notification.target?.prKey).toBe('acme/app#3');
    expect(notification.prKeys).toHaveLength(5);
    expect(notification.personal).toBe(false);
  });
});
