import { describe, expect, it } from 'vitest';
import { at, makeEvent, makePr, makeThreadFor } from './fixtures.ts';
import { eventsReadOnGitHub, nextWatchSince, ownEventsOnReadThread, seenBoundary } from './github-read.ts';

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

describe('ownEventsOnReadThread', () => {
  it('picks unseen events by the viewer, whatever the case of the login', () => {
    const events = [
      makeEvent({ id: 'merge', actor: 'Me', at: at(3) }),
      makeEvent({ id: 'bob', actor: 'bob', at: at(3) }),
      makeEvent({ id: 'seen', actor: 'me', at: at(1), seenAt: at(1) }),
      makeEvent({ id: 'nobody', actor: '', at: at(2) }),
    ];
    expect(ownEventsOnReadThread(events, 'me').map((event) => event.id)).toEqual(['merge']);
  });
});

describe('nextWatchSince', () => {
  const since = '2026-09-28T12:00:00.000Z';

  it('moves to the newest update less the overlap', () => {
    const threads = [makeThreadFor(makePr(), { updatedAt: '2026-09-28T12:20:07.000Z' }), makeThreadFor(makePr(), { updatedAt: '2026-09-28T12:10:00.000Z' })];
    expect(nextWatchSince(since, threads)).toBe('2026-09-28T12:19:07.000Z');
  });

  it('stays put on an empty answer or one inside the overlap', () => {
    expect(nextWatchSince(since, [])).toBe(since);
    expect(nextWatchSince(since, [makeThreadFor(makePr(), { updatedAt: '2026-09-28T12:00:30.000Z' })])).toBe(since);
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
