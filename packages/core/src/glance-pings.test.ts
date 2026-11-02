import { describe, expect, it } from 'vitest';
import { lookCloserFoldedBy, lookCloserFoldReason, type LookCloserSeriesPr } from './glance-pings.ts';

const NOW = '2026-11-02T12:00:00.000Z';

function minutesAgo(minutes: number): string {
  return new Date(new Date(NOW).getTime() - minutes * 60_000).toISOString();
}

function seriesPr(number: number, overrides: Partial<LookCloserSeriesPr> = {}): LookCloserSeriesPr {
  return { prKey: `acme/app#${number}`, topicId: 'frontend-perf', author: 'alice', at: NOW, ...overrides };
}

describe('lookCloserFoldedBy', () => {
  it('folds into a ping for the same topic and author within the hour', () => {
    const earlier = seriesPr(12, { at: minutesAgo(14) });
    expect(lookCloserFoldedBy(seriesPr(13), [earlier])).toEqual(earlier);
  });

  it('matches the author whatever the case', () => {
    expect(lookCloserFoldedBy(seriesPr(13, { author: 'Alice' }), [seriesPr(12, { at: minutesAgo(5) })])).not.toBeNull();
  });

  it('picks the newest ping it folds into', () => {
    const older = seriesPr(11, { at: minutesAgo(40) });
    const newer = seriesPr(12, { at: minutesAgo(10) });
    expect(lookCloserFoldedBy(seriesPr(13), [newer, older])).toEqual(newer);
  });

  it('pings for the first PR of a series', () => {
    expect(lookCloserFoldedBy(seriesPr(12), [])).toBeNull();
  });

  it('pings for a different author, a different topic or after an hour', () => {
    expect(lookCloserFoldedBy(seriesPr(13), [seriesPr(12, { author: 'bob', at: minutesAgo(5) })])).toBeNull();
    expect(lookCloserFoldedBy(seriesPr(13), [seriesPr(12, { topicId: 'billing', at: minutesAgo(5) })])).toBeNull();
    expect(lookCloserFoldedBy(seriesPr(13), [seriesPr(12, { at: minutesAgo(61) })])).toBeNull();
    expect(lookCloserFoldedBy(seriesPr(13), [seriesPr(12, { at: minutesAgo(60) })])).toBeNull();
  });

  it('never folds a PR without a topic', () => {
    expect(lookCloserFoldedBy(seriesPr(13, { topicId: null }), [seriesPr(12, { topicId: null, at: minutesAgo(5) })])).toBeNull();
  });

  it('does not fold a PR into its own earlier ping', () => {
    expect(lookCloserFoldedBy(seriesPr(12), [seriesPr(12, { at: minutesAgo(5) })])).toBeNull();
  });

  it('folds a batch at startup after its first ping', () => {
    const pinged: LookCloserSeriesPr[] = [];
    const outcomes = [1, 2, 3, 4, 5, 6, 7].map((number) => {
      const candidate = seriesPr(number);
      const foldedBy = lookCloserFoldedBy(candidate, pinged);
      if (foldedBy === null) {
        pinged.push(candidate);
      }
      return foldedBy?.prKey ?? 'ping';
    });
    expect(outcomes).toEqual(['ping', 'acme/app#1', 'acme/app#1', 'acme/app#1', 'acme/app#1', 'acme/app#1', 'acme/app#1']);
  });
});

describe('lookCloserFoldReason', () => {
  it('names the PR, its author and how long ago it pinged', () => {
    expect(lookCloserFoldReason(seriesPr(12, { at: minutesAgo(14) }), NOW)).toBe('Look closer folded: acme/app#12 by alice in this topic pinged 14 min ago');
  });
});
