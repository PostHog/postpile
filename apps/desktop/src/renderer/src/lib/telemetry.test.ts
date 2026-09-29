import { describe, expect, it } from 'vitest';
import { queryLengthBucket, searchTelemetryDue } from './telemetry.ts';

describe('queryLengthBucket', () => {
  it('buckets by length, never the text itself', () => {
    expect(queryLengthBucket(0)).toBe('short');
    expect(queryLengthBucket(3)).toBe('short');
    expect(queryLengthBucket(4)).toBe('medium');
    expect(queryLengthBucket(10)).toBe('medium');
    expect(queryLengthBucket(11)).toBe('long');
    expect(queryLengthBucket(200)).toBe('long');
  });
});

describe('searchTelemetryDue', () => {
  it('is due right away from a zero last-sent time (module just loaded), then throttled', () => {
    expect(searchTelemetryDue(0, Date.now())).toBe(true);
    expect(searchTelemetryDue(5000, 5001)).toBe(false);
    expect(searchTelemetryDue(5000, 5000 + 10_000)).toBe(true);
  });
});
