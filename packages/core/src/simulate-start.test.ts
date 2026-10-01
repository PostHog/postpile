import { describe, expect, it } from 'vitest';
import { planRounds, roundPrKeys, simulationNow, windowPrKeys, type SimulationInput } from './simulate-start.ts';
import type { SyncThread } from './sync-selection.ts';

const NOW = '2026-09-29T12:00:00.000Z';

function thread(key: string, updatedAt: string, unread = true): SyncThread {
  return { key, unread, updatedAt };
}

function input(overrides: Partial<SimulationInput>): SimulationInput {
  const threads = overrides.threads ?? [];
  const keys = [...threads.map((t) => t.key), ...(overrides.found ?? []), ...(overrides.pullIns ?? []).map((p) => p.prKey)];
  return { threads, found: [], pullIns: [], stored: new Set(keys), now: NOW, days: 7, roundSize: 2, ...overrides };
}

describe('simulationNow', () => {
  it('is the newest time, null for none', () => {
    expect(simulationNow(['2026-09-20T00:00:00Z', '2026-09-28T00:00:00Z', '2026-09-21T00:00:00Z'])).toBe('2026-09-28T00:00:00.000Z');
    expect(simulationNow([])).toBeNull();
  });

  it('compares times with and without milliseconds by when they are', () => {
    // As plain strings "...00Z" sorts after "...00.500Z" ('Z' > '.'), though it is earlier.
    expect(simulationNow(['2026-09-28T00:00:00Z', '2026-09-28T00:00:00.500Z'])).toBe('2026-09-28T00:00:00.500Z');
  });
});

describe('windowPrKeys', () => {
  it('keeps threads of the last N days, unread first, newest first', () => {
    const keys = windowPrKeys(
      [
        thread('acme/app#1', '2026-09-20T00:00:00Z'),
        thread('acme/app#2', '2026-09-28T00:00:00Z', false),
        thread('acme/app#3', '2026-09-27T00:00:00Z'),
        thread('acme/app#4', '2026-09-10T00:00:00Z'),
      ],
      NOW,
      14,
    );
    expect(keys).toEqual(['acme/app#3', 'acme/app#1', 'acme/app#2']);
    expect(windowPrKeys([thread('acme/app#1', '2026-09-20T00:00:00Z')], NOW, 7)).toEqual([]);
  });
});

describe('planRounds', () => {
  it('drains pinged PRs in rounds of round size, found PRs in round one', () => {
    const rounds = planRounds(
      input({
        threads: [
          thread('acme/app#1', '2026-09-29T10:00:00Z'),
          thread('acme/app#2', '2026-09-29T09:00:00Z'),
          thread('acme/app#3', '2026-09-29T08:00:00Z', false),
          thread('acme/app#4', '2026-09-29T11:00:00Z', false),
          thread('acme/app#5', '2026-09-01T11:00:00Z'),
        ],
        found: ['acme/app#9', 'acme/app#2'],
      }),
    );
    expect(rounds).toEqual([
      { pinged: ['acme/app#1', 'acme/app#2'], found: ['acme/app#9'], pulledIn: [] },
      { pinged: ['acme/app#4', 'acme/app#3'], found: [], pulledIn: [] },
    ]);
  });

  it('does not pick a PR again that came in as found or as a stack layer', () => {
    const rounds = planRounds(
      input({
        threads: [
          thread('acme/app#1', '2026-09-29T10:00:00Z'),
          thread('acme/app#2', '2026-09-29T09:00:00Z'),
          thread('acme/app#3', '2026-09-29T08:00:00Z'),
          thread('acme/app#4', '2026-09-29T07:00:00Z'),
        ],
        found: ['acme/app#4'],
        pullIns: [{ prKey: 'acme/app#3', anchorPrKey: 'acme/app#1' }],
      }),
    );
    expect(rounds).toEqual([{ pinged: ['acme/app#1', 'acme/app#2'], found: ['acme/app#4'], pulledIn: ['acme/app#3'] }]);
  });

  it('brings stack layers in with their anchor, also through another layer', () => {
    const rounds = planRounds(
      input({
        threads: [thread('acme/app#1', '2026-09-29T10:00:00Z'), thread('acme/app#2', '2026-09-29T09:00:00Z'), thread('acme/app#3', '2026-09-29T08:00:00Z')],
        pullIns: [
          { prKey: 'acme/app#11', anchorPrKey: 'acme/app#3' },
          { prKey: 'acme/app#12', anchorPrKey: 'acme/app#11' },
          { prKey: 'acme/app#20', anchorPrKey: 'acme/app#99' },
        ],
      }),
    );
    expect(rounds.map(roundPrKeys)).toEqual([['acme/app#1', 'acme/app#2'], ['acme/app#3', 'acme/app#11', 'acme/app#12']]);
  });

  it('skips PRs without a stored snapshot', () => {
    const rounds = planRounds({
      ...input({ threads: [thread('acme/app#1', '2026-09-29T10:00:00Z'), thread('acme/app#2', '2026-09-29T09:00:00Z')], found: ['acme/app#3'] }),
      stored: new Set(['acme/app#2']),
    });
    expect(rounds).toEqual([{ pinged: ['acme/app#2'], found: [], pulledIn: [] }]);
  });

  it('plans nothing for an empty window', () => {
    expect(planRounds(input({ threads: [thread('acme/app#1', '2026-08-01T00:00:00Z')] }))).toEqual([]);
  });
});
