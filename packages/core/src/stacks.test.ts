import { describe, expect, it } from 'vitest';
import { makePr } from './fixtures.ts';
import { buildStacks } from './stacks.ts';

describe('buildStacks', () => {
  it('chains PRs whose base is another PR head, bottom first', () => {
    const prs = [
      makePr({ number: 3, baseRef: 'b2', headRef: 'b3' }),
      makePr({ number: 1, baseRef: 'master', headRef: 'b1' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2' }),
    ];
    expect(buildStacks(prs)).toEqual([
      {
        id: 'stack:PostHog/posthog#1',
        repo: 'PostHog/posthog',
        prKeys: ['PostHog/posthog#1', 'PostHog/posthog#2', 'PostHog/posthog#3'],
      },
    ]);
  });

  it('ignores lone PRs', () => {
    expect(buildStacks([makePr({ number: 1 }), makePr({ number: 2 })])).toEqual([]);
  });

  it('does not chain across repos', () => {
    const prs = [
      makePr({ number: 1, repo: 'PostHog/a', headRef: 'feat' }),
      makePr({ number: 2, repo: 'PostHog/b', baseRef: 'feat', headRef: 'feat-2' }),
    ];
    expect(buildStacks(prs)).toEqual([]);
  });

  it('breaks the chain at merged or closed PRs', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1', state: 'MERGED' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2' }),
      makePr({ number: 3, baseRef: 'b2', headRef: 'b3' }),
    ];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([['PostHog/posthog#2', 'PostHog/posthog#3']]);
  });

  it('keeps recently merged layers when given the time, but never a stack without an open PR', () => {
    const now = '2026-09-20T00:00:00.000Z';
    const prs = [
      makePr({ number: 1, headRef: 'b1', state: 'MERGED', mergedAt: '2026-09-01T00:00:00.000Z' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2', state: 'MERGED', mergedAt: '2026-09-18T00:00:00.000Z' }),
      makePr({ number: 3, baseRef: 'b2', headRef: 'b3' }),
      makePr({ number: 7, headRef: 'b7', state: 'MERGED', mergedAt: '2026-09-18T00:00:00.000Z' }),
      makePr({ number: 8, baseRef: 'b7', headRef: 'b8', state: 'MERGED', mergedAt: '2026-09-19T00:00:00.000Z' }),
    ];
    expect(buildStacks(prs, now).map((s) => s.prKeys)).toEqual([['PostHog/posthog#2', 'PostHog/posthog#3']]);
  });

  it('continues a fork with the lowest number; the other branch stands alone', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1' }),
      makePr({ number: 5, baseRef: 'b1', headRef: 'b5' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2' }),
      makePr({ number: 6, baseRef: 'b5', headRef: 'b6' }),
    ];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([
      ['PostHog/posthog#1', 'PostHog/posthog#2'],
      ['PostHog/posthog#5', 'PostHog/posthog#6'],
    ]);
  });

  it('survives a base/head cycle', () => {
    const prs = [makePr({ number: 1, baseRef: 'b2', headRef: 'b1' }), makePr({ number: 2, baseRef: 'b1', headRef: 'b2' })];
    expect(buildStacks(prs)).toEqual([]);
  });
});
