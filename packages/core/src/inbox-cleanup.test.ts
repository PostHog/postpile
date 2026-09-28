import { describe, expect, it } from 'vitest';
import { makeEvent, makePr, makeThreadFor } from './fixtures.ts';
import { applyBaseline, cleanupCutoff, cleanupLook, isLongSyncGap, seenSinceBaseline, unreadOlderThan } from './inbox-cleanup.ts';

const NOW = '2026-09-28T12:00:00.000Z';

function thread(number: number, updatedAt: string, unread = true) {
  return makeThreadFor(makePr({ number }), { updatedAt, unread });
}

describe('inbox cleanup', () => {
  it('counts unread threads older than the cutoff, after the baseline', () => {
    const threads = [
      thread(1, '2026-08-01T00:00:00.000Z'),
      thread(2, '2026-09-10T00:00:00.000Z'),
      thread(3, '2026-09-27T00:00:00.000Z'),
      thread(4, '2026-08-01T00:00:00.000Z', false),
    ];
    expect(unreadOlderThan(threads, cleanupCutoff(NOW, 14), null)).toBe(2);
    expect(unreadOlderThan(threads, cleanupCutoff(NOW, 30), null)).toBe(1);
    expect(unreadOlderThan(threads, cleanupCutoff(NOW, 14), '2026-09-01T00:00:00.000Z')).toBe(1);
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

describe('applyBaseline', () => {
  it('treats unseen events before the baseline as seen, and leaves the rest', () => {
    const events = [
      makeEvent({ id: 'old', at: '2026-09-01T00:00:00.000Z' }),
      makeEvent({ id: 'seen', at: '2026-09-01T00:00:00.000Z', seenAt: '2026-09-02T00:00:00.000Z' }),
      makeEvent({ id: 'new', at: '2026-09-20T00:00:00.000Z' }),
    ];
    const baseline = '2026-09-10T00:00:00.000Z';
    expect(applyBaseline(events, baseline).map((event) => [event.id, event.seenAt])).toEqual([
      ['old', baseline],
      ['seen', '2026-09-02T00:00:00.000Z'],
      ['new', null],
    ]);
    expect(applyBaseline(events, null)).toBe(events);
  });
});

describe('seenSinceBaseline', () => {
  const baseline = '2026-09-10T00:00:00.000Z';
  const cursor = { kind: 'seen' as const, scope: 't', seq: 5, dossierVersion: 2, updatedAt: '2026-09-01T00:00:00.000Z' };

  it('never starts "since you last looked" before the baseline', () => {
    expect(seenSinceBaseline(cursor, 't', baseline)).toEqual({ ...cursor, updatedAt: baseline });
    expect(seenSinceBaseline({ ...cursor, updatedAt: '2026-09-20T00:00:00.000Z' }, 't', baseline)?.updatedAt).toBe('2026-09-20T00:00:00.000Z');
    expect(seenSinceBaseline(null, 't', baseline)).toEqual({ kind: 'seen', scope: 't', seq: 0, dossierVersion: null, updatedAt: baseline });
    expect(seenSinceBaseline(cursor, 't', null)).toBe(cursor);
  });
});
