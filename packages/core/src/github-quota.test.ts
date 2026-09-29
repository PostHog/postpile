import { describe, expect, it } from 'vitest';
import {
  mergeQuotaReading,
  quotaLevel,
  quotaPercent,
  quotaPollSeconds,
  quotaReadingOf,
  quotaState,
  quotaView,
  quotaWorsened,
  type QuotaReading,
} from './github-quota.ts';

const NOW = Date.parse('2026-09-29T13:30:00Z');
const RESET = Date.parse('2026-09-29T14:05:00Z');

function reading(overrides: Partial<QuotaReading> = {}): QuotaReading {
  return { resource: 'graphql', limit: 5000, remaining: 4000, resetAtMs: RESET, ...overrides };
}

function headers(values: Record<string, string>): (name: string) => string | null {
  return (name) => values[name] ?? null;
}

describe('quotaReadingOf', () => {
  it('reads limit, remaining, reset and resource', () => {
    const header = headers({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '1234',
      'x-ratelimit-reset': String(RESET / 1000),
      'x-ratelimit-resource': 'core',
    });
    expect(quotaReadingOf(header)).toEqual({ resource: 'core', limit: 5000, remaining: 1234, resetAtMs: RESET });
  });

  it('ignores answers without the headers and limits PostPile does not budget', () => {
    expect(quotaReadingOf(headers({}))).toBeNull();
    const search = headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': '1', 'x-ratelimit-resource': 'search' });
    expect(quotaReadingOf(search)).toBeNull();
    const broken = headers({ 'x-ratelimit-limit': 'many', 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': '1', 'x-ratelimit-resource': 'core' });
    expect(quotaReadingOf(broken)).toBeNull();
  });
});

describe('quotaLevel', () => {
  it('is ok above half, low at half or less, critical at a fifth or less', () => {
    expect(quotaLevel(2501, 5000)).toBe('ok');
    expect(quotaLevel(2500, 5000)).toBe('low');
    expect(quotaLevel(1001, 5000)).toBe('low');
    expect(quotaLevel(1000, 5000)).toBe('critical');
    expect(quotaLevel(0, 5000)).toBe('critical');
  });

  it('uses the share, whatever the limit', () => {
    expect(quotaLevel(7000, 15000)).toBe('low');
    expect(quotaLevel(8000, 15000)).toBe('ok');
  });
});

describe('quotaPercent', () => {
  it('rounds down to whole percent within 0 to 100', () => {
    expect(quotaPercent(2499, 5000)).toBe(49);
    expect(quotaPercent(5000, 5000)).toBe(100);
    expect(quotaPercent(0, 5000)).toBe(0);
    expect(quotaPercent(10, 0)).toBe(0);
  });
});

describe('mergeQuotaReading', () => {
  it('keeps the lower remaining within one window, so late answers do not raise it', () => {
    const lower = reading({ remaining: 2400 });
    expect(mergeQuotaReading(lower, reading({ remaining: 2600 }))).toBe(lower);
    expect(mergeQuotaReading(lower, reading({ remaining: 2300 })).remaining).toBe(2300);
  });

  it('takes a new window as it is', () => {
    const next = reading({ remaining: 4999, resetAtMs: RESET + 3600_000 });
    expect(mergeQuotaReading(reading({ remaining: 100 }), next)).toBe(next);
  });
});

describe('quotaWorsened', () => {
  it('says the level reached when it got worse, else null', () => {
    expect(quotaWorsened(undefined, reading({ remaining: 2500 }), NOW)).toBe('low');
    expect(quotaWorsened(reading({ remaining: 2500 }), reading({ remaining: 2400 }), NOW)).toBeNull();
    expect(quotaWorsened(reading({ remaining: 2400 }), reading({ remaining: 900 }), NOW)).toBe('critical');
    expect(quotaWorsened(undefined, reading({ remaining: 4000 }), NOW)).toBeNull();
  });

  it('counts a last reading past its reset as ok, so a new window reports again', () => {
    const lastWindow = reading({ remaining: 2000, resetAtMs: NOW - 1000 });
    expect(quotaWorsened(lastWindow, reading({ remaining: 2000 }), NOW)).toBe('low');
  });
});

describe('quotaState', () => {
  it('is ok without readings or with plenty left', () => {
    expect(quotaState([], NOW)).toEqual({ level: 'ok', worst: null, backgroundResumeAtMs: null, pollResumeAtMs: null });
    expect(quotaState([reading()], NOW).level).toBe('ok');
  });

  it('takes the limit with the smallest share and waits for the latest reset among the low ones', () => {
    const core = reading({ resource: 'core', remaining: 2000, resetAtMs: RESET + 600_000 });
    const graphql = reading({ remaining: 900 });
    const state = quotaState([core, graphql], NOW);
    expect(state).toEqual({ level: 'critical', worst: graphql, backgroundResumeAtMs: RESET + 600_000, pollResumeAtMs: RESET });
  });

  it('ignores readings whose reset has passed: everything resumes then', () => {
    const state = quotaState([reading({ remaining: 100 })], RESET);
    expect(state.level).toBe('ok');
  });
});

describe('quotaPollSeconds and quotaView', () => {
  it('polls at the interval when ok, once a minute when low, not at all when critical', () => {
    expect(quotaPollSeconds(quotaState([], NOW), 10)).toBe(10);
    expect(quotaPollSeconds(quotaState([reading({ remaining: 2000 })], NOW), 10)).toBe(60);
    expect(quotaPollSeconds(quotaState([reading({ remaining: 2000 })], NOW), 120)).toBe(120);
    expect(quotaPollSeconds(quotaState([reading({ remaining: 500 })], NOW), 10)).toBeNull();
  });

  it('shows nothing at ok and the reset time otherwise', () => {
    expect(quotaView(quotaState([reading()], NOW), 10)).toBeNull();
    expect(quotaView(quotaState([reading({ remaining: 2000 })], NOW), 10)).toEqual({
      level: 'low',
      resource: 'graphql',
      remainingPercent: 40,
      resumeAt: '2026-09-29T14:05:00.000Z',
      pollSeconds: 60,
    });
  });
});
