import { describe, expect, it } from 'vitest';
import { at, makeEvent } from './fixtures.ts';
import { eventsReadOnGitHub, seenBoundary } from './github-read.ts';

describe('eventsReadOnGitHub', () => {
  it('picks unseen events at or before the last read', () => {
    const events = [
      makeEvent({ id: 'old', at: at(1) }),
      makeEvent({ id: 'edge', at: at(2) }),
      makeEvent({ id: 'seen', at: at(1), seenAt: at(1) }),
      makeEvent({ id: 'new', at: at(3) }),
    ];
    expect(eventsReadOnGitHub(events, at(2))).toEqual(['old', 'edge']);
  });

  it('picks nothing for a thread never read', () => {
    expect(eventsReadOnGitHub([makeEvent({ at: at(1) })], null)).toEqual([]);
  });
});

describe('seenBoundary', () => {
  it('moves up to the event before the first unseen one', () => {
    const logged = [
      { seq: 12, seen: false },
      { seq: 10, seen: true },
      { seq: 11, seen: true },
      { seq: 13, seen: true },
    ];
    expect(seenBoundary(logged, 9)).toEqual({ seq: 11, caughtUp: false });
  });

  it('is caught up when everything after the cursor is seen', () => {
    expect(seenBoundary([{ seq: 4, seen: true }, { seq: 5, seen: true }], 3)).toEqual({ seq: 5, caughtUp: true });
    expect(seenBoundary([], 3)).toEqual({ seq: 3, caughtUp: true });
  });

  it('ignores entries at or below the cursor', () => {
    expect(seenBoundary([{ seq: 2, seen: false }, { seq: 4, seen: true }], 3)).toEqual({ seq: 4, caughtUp: true });
  });
});
