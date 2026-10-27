import { describe, expect, it } from 'vitest';
import { makePr, makeTimelineItem } from './fixtures.ts';
import { SET_MAX_MEMBERS, setCloseReason, setFinishedAt, setIsFull, setShownKeys } from './set-lifecycle.ts';
import type { Pr, PrSet, Stack } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days after a fixed base time, as ISO. */
function day(days: number): string {
  return new Date(Date.UTC(2026, 9, 1, 9, 0) + days * DAY_MS).toISOString();
}

function makeSet(keys: string[], overrides: Partial<PrSet> = {}): PrSet {
  return {
    id: 's1',
    topicId: 't1',
    title: 'Same cap',
    take: '',
    members: keys.map((prKey) => ({ prKey, reason: 'same cap' })),
    removedKeys: [],
    status: 'active',
    inputHash: '',
    createdAt: day(0),
    updatedAt: day(0),
    ...overrides,
  };
}

function merged(number: number, at: string): Pr {
  return makePr({ number, state: 'MERGED', mergedAt: at, updatedAt: at });
}

/** The close rule over the set's own members, no stacks. */
function closeReason(set: PrSet, prs: Map<string, Pr>, now: string): string | null {
  return setCloseReason(set, setShownKeys(set.members, new Map()), prs, now);
}

function finishedAt(set: PrSet, prs: Map<string, Pr>): string | null {
  return setFinishedAt(setShownKeys(set.members, new Map()), prs);
}

function byKey(prs: Pr[]): Map<string, Pr> {
  return new Map(prs.map((pr) => [pr.key, pr]));
}

describe('setCloseReason', () => {
  it('keeps a set open while one member is open', () => {
    const prs = byKey([merged(1, day(1)), makePr({ number: 2 })]);
    expect(finishedAt(makeSet(['acme/app#1', 'acme/app#2']), prs)).toBeNull();
    expect(closeReason(makeSet(['acme/app#1', 'acme/app#2']), prs, day(30))).toBeNull();
  });

  it('keeps a set open for two days after its last merge, then closes it', () => {
    const prs = byKey([merged(1, day(1)), merged(2, day(3))]);
    const set = makeSet(['acme/app#1', 'acme/app#2']);
    expect(finishedAt(set, prs)).toBe(day(3));
    expect(closeReason(set, prs, day(4.9))).toBeNull();
    expect(closeReason(set, prs, day(5))).toBe('every PR merged or closed 2 days ago');
    expect(closeReason(set, prs, day(23))).toBe('every PR merged or closed 20 days ago');
  });

  it('counts a member closed without merging, at its last close', () => {
    const closed = makePr({
      number: 2,
      state: 'CLOSED',
      updatedAt: day(9),
      timeline: [makeTimelineItem({ id: 'c1', kind: 'closed', at: day(1) }), makeTimelineItem({ id: 'c2', kind: 'closed', at: day(2) })],
    });
    const set = makeSet(['acme/app#1', 'acme/app#2']);
    const prs = byKey([merged(1, day(1)), closed]);
    expect(finishedAt(set, prs)).toBe(day(2));
    expect(closeReason(set, prs, day(4))).toBe('every PR merged or closed 2 days ago');
  });

  it('falls back to updatedAt for a close the timeline does not hold', () => {
    const closed = makePr({ number: 2, state: 'CLOSED', updatedAt: day(6), timeline: [] });
    expect(finishedAt(makeSet(['acme/app#1', 'acme/app#2']), byKey([merged(1, day(1)), closed]))).toBe(day(6));
  });

  it('ignores members the user removed, even open ones', () => {
    const prs = byKey([merged(1, day(1)), merged(2, day(1)), makePr({ number: 3 })]);
    const set = makeSet(['acme/app#1', 'acme/app#2'], { removedKeys: ['acme/app#3'] });
    expect(closeReason(set, prs, day(4))).toBe('every PR merged or closed 3 days ago');
  });

  it('keeps a set open while a layer stacked onto a member later is open', () => {
    const stack: Stack = { id: 'stack:acme/app#2', repo: 'acme/app', prKeys: ['acme/app#2', 'acme/app#3'] };
    const set = makeSet(['acme/app#1', 'acme/app#2']);
    const shown = setShownKeys(set.members, new Map([['acme/app#2', stack], ['acme/app#3', stack]]));
    expect(shown).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#3']);
    const prs = byKey([merged(1, day(1)), merged(2, day(1)), makePr({ number: 3 })]);
    expect(setCloseReason(set, shown, prs, day(30))).toBeNull();
    expect(setCloseReason(set, shown, byKey([merged(1, day(1)), merged(2, day(1)), merged(3, day(2))]), day(4))).toBe('every PR merged or closed 2 days ago');
  });

  it('keeps a set open when a member is not loaded', () => {
    expect(closeReason(makeSet(['acme/app#1', 'acme/app#2']), byKey([merged(1, day(1))]), day(30))).toBeNull();
  });

  it('never closes a set twice, or a dissolved one', () => {
    const prs = byKey([merged(1, day(1)), merged(2, day(1))]);
    expect(closeReason(makeSet(['acme/app#1', 'acme/app#2'], { closedAt: day(4) }), prs, day(30))).toBeNull();
    expect(closeReason(makeSet(['acme/app#1', 'acme/app#2'], { status: 'dissolved' }), prs, day(30))).toBeNull();
  });
});

describe('setIsFull', () => {
  it('is full at the cap and past it', () => {
    expect(setIsFull(SET_MAX_MEMBERS - 1)).toBe(false);
    expect(setIsFull(SET_MAX_MEMBERS)).toBe(true);
    expect(setIsFull(SET_MAX_MEMBERS + 3)).toBe(true);
  });
});
