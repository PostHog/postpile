import { describe, expect, it } from 'vitest';
import { scoutClosedOutcome, scoutPrClosedProps, type ScoutedLeaving } from './scout-telemetry.ts';
import { TELEMETRY_EVENTS } from './telemetry-events.ts';

const PULLED = '2026-10-29T10:00:00.000Z';
const NOW = '2026-10-30T10:20:00.000Z';

function leaving(overrides: Partial<ScoutedLeaving['scouted']> = {}, rest: Partial<Omit<ScoutedLeaving, 'scouted'>> = {}): ScoutedLeaving {
  return {
    scouted: { pulledAt: PULLED, seenUpdatedAt: null, followedAt: null, dismissedAt: null, expiredAt: null, expiryReason: null, ...overrides },
    tracked: false,
    prUpdatedAt: '2026-10-29T09:00:00.000Z',
    ...rest,
  };
}

describe('scoutClosedOutcome', () => {
  it('is null while the PR is still on the Scouted section', () => {
    expect(scoutClosedOutcome(leaving(), NOW)).toBeNull();
  });

  it('reads each stored transition with its own time', () => {
    expect(scoutClosedOutcome(leaving({ followedAt: '2026-10-29T12:00:00.000Z' }), NOW)).toEqual({ outcome: 'followed', at: '2026-10-29T12:00:00.000Z' });
    expect(scoutClosedOutcome(leaving({ dismissedAt: '2026-10-29T13:00:00.000Z' }), NOW)).toEqual({ outcome: 'dismissed', at: '2026-10-29T13:00:00.000Z' });
    for (const reason of ['merged', 'closed', 'inactive'] as const) {
      expect(scoutClosedOutcome(leaving({ expiredAt: NOW, expiryReason: reason }), NOW)?.outcome).toBe(`expired_${reason}`);
    }
  });

  it('counts a PR that became tracked by itself as reaching the inbox now', () => {
    expect(scoutClosedOutcome(leaving({}, { tracked: true }), NOW)).toEqual({ outcome: 'reached_inbox', at: NOW });
  });

  it('takes the earliest transition when a row holds two, before a tracked state', () => {
    const both = leaving({ expiredAt: '2026-10-29T11:00:00.000Z', expiryReason: 'merged', followedAt: '2026-10-29T15:00:00.000Z' }, { tracked: true });
    expect(scoutClosedOutcome(both, NOW)?.outcome).toBe('expired_merged');
  });
});

describe('scoutPrClosedProps', () => {
  it('tells opened from seen through the latest activity, and rounds the hours', () => {
    const never = scoutPrClosedProps(leaving(), 'dismissed', '2026-10-29T12:40:00.000Z');
    expect(never).toEqual({ outcome: 'dismissed', was_seen: false, was_opened: false, hours_in_section: 3 });
    const seenOld = scoutPrClosedProps(leaving({ seenUpdatedAt: '2026-10-29T08:00:00.000Z' }), 'followed', NOW);
    expect(seenOld).toMatchObject({ was_seen: false, was_opened: true, hours_in_section: 24 });
    const seen = scoutPrClosedProps(leaving({ seenUpdatedAt: '2026-10-29T09:00:00.000Z' }), 'reached_inbox', NOW);
    expect(seen).toMatchObject({ was_seen: true, was_opened: true });
  });

  it('never goes below zero hours, and always fits the catalogue', () => {
    const props = scoutPrClosedProps(leaving(), 'reached_inbox', '2026-10-29T09:00:00.000Z');
    expect(props.hours_in_section).toBe(0);
    expect(TELEMETRY_EVENTS.scout_pr_closed.safeParse(props).success).toBe(true);
  });
});
