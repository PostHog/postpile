import { describe, expect, it } from 'vitest';
import { makePr, makeThreadFor } from './fixtures.ts';
import { cleanupCutoff, cleanupLook, isLongSyncGap, unreadOlderThan } from './inbox-cleanup.ts';

const NOW = '2026-09-28T12:00:00.000Z';

function thread(number: number, updatedAt: string, unread = true) {
  return makeThreadFor(makePr({ number }), { updatedAt, unread });
}

describe('inbox cleanup', () => {
  it('counts unread threads older than the cutoff', () => {
    const threads = [
      thread(1, '2026-08-01T00:00:00.000Z'),
      thread(2, '2026-09-10T00:00:00.000Z'),
      thread(3, '2026-09-27T00:00:00.000Z'),
      thread(4, '2026-08-01T00:00:00.000Z', false),
    ];
    expect(unreadOlderThan(threads, cleanupCutoff(NOW, 14))).toBe(2);
    expect(unreadOlderThan(threads, cleanupCutoff(NOW, 30))).toBe(1);
    expect(cleanupCutoff(NOW, 14)).toBe('2026-09-14T12:00:00.000Z');
  });

  it('is prominent on the first run and after 5 days without a sync', () => {
    expect(isLongSyncGap(null, NOW)).toBe(true);
    expect(isLongSyncGap('2026-09-23T12:00:00.000Z', NOW)).toBe(true);
    expect(isLongSyncGap('2026-09-24T12:00:00.000Z', NOW)).toBe(false);
  });

  it('picks the look', () => {
    expect(cleanupLook({ unreadOlderThan14: 0, prominent: true, hiddenUntil: null }, NOW)).toBe('none');
    expect(cleanupLook({ unreadOlderThan14: 3, prominent: true, hiddenUntil: null }, NOW)).toBe('banner');
    expect(cleanupLook({ unreadOlderThan14: 3, prominent: false, hiddenUntil: null }, NOW)).toBe('line');
    expect(cleanupLook({ unreadOlderThan14: 3, prominent: true, hiddenUntil: '2026-10-01T00:00:00.000Z' }, NOW)).toBe('none');
    expect(cleanupLook({ unreadOlderThan14: 3, prominent: false, hiddenUntil: '2026-09-01T00:00:00.000Z' }, NOW)).toBe('line');
  });
});
