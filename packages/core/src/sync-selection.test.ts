import { describe, expect, it } from 'vitest';
import type { HotFacts } from './hot-board.ts';
import { hotTier, threadNewsFacts, threadOnlyFacts } from './hot-board.ts';
import { hotSyncThreads, selectSyncThreads, syncCutoff, type HotSyncThread, type SyncThread } from './sync-selection.ts';
import type { NotificationReason, Viewer } from './types.ts';

const NOW = '2026-09-29T12:00:00.000Z';

function thread(key: string, updatedAt: string, unread = true): SyncThread {
  return { key, unread, updatedAt };
}

describe('selectSyncThreads', () => {
  it('puts unread first, newest first inside each, one per PR', () => {
    const picked = selectSyncThreads(
      [
        thread('acme/app#1', '2026-09-20T00:00:00Z'),
        thread('acme/app#2', '2026-09-28T00:00:00Z', false),
        thread('acme/app#3', '2026-09-27T00:00:00Z'),
        thread('acme/app#3', '2026-09-10T00:00:00Z'),
      ],
      new Map(),
      NOW,
    );
    expect(picked.map((t) => t.key)).toEqual(['acme/app#3', 'acme/app#1', 'acme/app#2']);
  });

  it('skips threads older than 30 days and PRs fetched since their last activity', () => {
    const picked = selectSyncThreads(
      [thread('acme/app#1', '2026-08-01T00:00:00Z'), thread('acme/app#2', '2026-09-20T00:00:00Z'), thread('acme/app#3', '2026-09-21T00:00:00Z')],
      new Map([['acme/app#2', '2026-09-25T00:00:00Z']]),
      NOW,
    );
    expect(picked.map((t) => t.key)).toEqual(['acme/app#3']);
  });

  it('cuts off exactly 30 days back', () => {
    expect(syncCutoff(NOW)).toBe('2026-08-30T12:00:00.000Z');
  });
});

describe('hotSyncThreads', () => {
  const me: Viewer = { login: 'alice', teams: ['acme/team-devex'], homeTeams: ['acme/team-devex'], teamMembers: ['bob'] };
  const calm = { busy: false, weakestKept: null, keys: new Set<string>() };

  function candidate(key: string, updatedAt: string, unread: boolean, reason: NotificationReason, facts: Partial<HotFacts> = {}): HotSyncThread {
    return { key, unread, updatedAt, facts: { ...threadOnlyFacts(key, { unread, reason, updatedAt }, null), ...facts } };
  }

  it('fetches what is recent, and older threads only when unread and aimed at the user or the user own open PR', () => {
    const { picked, shed } = hotSyncThreads(
      [
        candidate('acme/app#1', '2026-09-28T00:00:00Z', false, 'subscribed'),
        candidate('acme/app#2', '2026-09-10T00:00:00Z', false, 'subscribed'),
        candidate('acme/app#3', '2026-09-10T00:00:00Z', true, 'mention'),
        candidate('acme/app#4', '2026-09-10T00:00:00Z', true, 'subscribed'),
        candidate('acme/app#5', '2026-09-10T00:00:00Z', false, 'author', { author: 'alice' }),
      ],
      { now: NOW, viewer: me, selection: calm },
    );
    expect(picked.map((t) => t.key)).toEqual(['acme/app#3', 'acme/app#5', 'acme/app#1']);
    expect(shed).toEqual(['acme/app#2', 'acme/app#4']);
  });

  it('while busy fetches nothing for others, even when recent and unread', () => {
    const { picked, shed } = hotSyncThreads(
      [
        candidate('acme/app#1', '2026-09-28T00:00:00Z', true, 'subscribed'),
        candidate('acme/app#2', '2026-09-28T00:00:00Z', false, 'subscribed', { author: 'bob', state: 'OPEN' }),
        candidate('acme/app#3', '2026-09-27T00:00:00Z', true, 'review_requested'),
      ],
      { now: NOW, viewer: me, selection: { busy: true, weakestKept: null, keys: new Set<string>() } },
    );
    expect(picked.map((t) => t.key)).toEqual(['acme/app#3', 'acme/app#2']);
    expect(shed).toEqual(['acme/app#1']);
  });

  it('fetches every PR on a full board when its thread moved, whatever its own rank or age', () => {
    const weakest = { key: 'acme/app#2', tier: 'team' as const, unread: false, activityAt: '2026-09-28T00:00:00Z' };
    const selection = { busy: true, weakestKept: weakest, keys: new Set(['acme/app#1', 'acme/app#2', 'acme/app#3']) };
    const { picked, shed } = hotSyncThreads(
      [
        // The weakest kept unit's own PR: ranks equal to the weakest.
        candidate('acme/app#2', '2026-09-28T00:00:00Z', false, 'subscribed', { author: 'bob', state: 'OPEN' }),
        // A layer of a kept stack, tier others, its thread unread and old.
        candidate('acme/app#3', '2026-09-10T00:00:00Z', true, 'subscribed', { author: 'zoe', state: 'OPEN' }),
        // Not on the board, same tier and time as the weakest, ranks after it by key.
        candidate('acme/app#4', '2026-09-28T00:00:00Z', false, 'subscribed', { author: 'bob', state: 'OPEN' }),
      ],
      { now: NOW, viewer: me, selection },
    );
    expect(picked.map((t) => t.key).sort()).toEqual(['acme/app#2', 'acme/app#3']);
    expect(shed).toEqual(['acme/app#4']);
  });

  describe('a new review request on a stored PR whose snapshot has none', () => {
    const routed: Viewer = { ...me, teams: ['acme/team-devex', 'acme/team-routing'] };
    // Fetched before the request; the thread moved since, both more than SETTLED_DAYS ago.
    const stored = { ...threadOnlyFacts('acme/app#5', { unread: false, reason: 'subscribed', updatedAt: '2026-09-12T00:00:00Z' }, null), author: 'zoe', personalAsk: false };
    const request = { unread: true, reason: 'review_requested' as const, updatedAt: '2026-09-15T00:00:00Z' };
    // A full busy board: the weakest kept unit is a read PR of the user's.
    const weakest = { key: 'acme/app#1', tier: 'you' as const, unread: false, activityAt: '2026-09-28T00:00:00Z' };
    const full = { busy: true, weakestKept: weakest, keys: new Set(['acme/app#1']) };

    function pick(facts: HotFacts) {
      return hotSyncThreads([{ key: facts.key, unread: true, updatedAt: request.updatedAt, facts }], { now: NOW, viewer: routed, selection: full });
    }

    it('is fetched as the user own ask, also past SETTLED_DAYS on a full busy board', () => {
      const facts = threadNewsFacts('acme/app#5', stored, request, null, routed);

      expect(hotTier(facts, routed)).toBe('you');
      expect(pick(facts).picked.map((t) => t.key)).toEqual(['acme/app#5']);
    });

    it('falls back to its real tier once the fetched snapshot shows a team request', () => {
      const routing = threadNewsFacts('acme/app#5', { ...stored, reviewerTeams: ['acme/team-routing'] }, request, null, routed);
      const home = threadNewsFacts('acme/app#5', { ...stored, reviewerTeams: ['acme/team-devex'] }, request, null, routed);

      expect(hotTier(routing, routed)).toBe('others');
      expect(pick(routing).shed).toEqual(['acme/app#5']);
      expect(hotTier(home, routed)).toBe('team');
    });

    it('stays the user own ask when the fetched snapshot shows the request for them', () => {
      const facts = threadNewsFacts('acme/app#5', { ...stored, reviewerUsers: ['Alice'] }, request, null, routed);

      expect(facts.personalAsk).toBe(false);
      expect(hotTier(facts, routed)).toBe('you');
    });
  });
});

