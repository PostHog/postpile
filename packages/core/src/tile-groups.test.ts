import { describe, expect, it } from 'vitest';
import { groupTiles, tileGroup } from './tile-groups.ts';
import type { TileStateKind } from './types.ts';

function state(kind: TileStateKind, unreadOnGitHub = false) {
  return { kind, unreadOnGitHub };
}

describe('tileGroup', () => {
  it('puts unread tiles and snoozed ones with an unread thread in Unread', () => {
    expect(tileGroup(state('unread', true))).toBe('unread');
    expect(tileGroup(state('unread', false))).toBe('unread');
    expect(tileGroup(state('snoozed', true))).toBe('unread');
  });

  it('puts read tiles that are not done in Open, snoozed ones too', () => {
    expect(tileGroup(state('open'))).toBe('open');
    expect(tileGroup(state('snoozed'))).toBe('open');
  });

  it('puts done tiles in Dealt with', () => {
    expect(tileGroup(state('done'))).toBe('dealt_with');
  });
});

describe('groupTiles', () => {
  it('orders the groups Unread, Open, Dealt with, keeps the tile order and leaves empty groups out', () => {
    const tiles = [
      { id: 'a', group: 'dealt_with' as const },
      { id: 'b', group: 'unread' as const },
      { id: 'c', group: 'dealt_with' as const },
      { id: 'd', group: 'unread' as const },
    ];
    expect(groupTiles(tiles).map((entry) => [entry.group, entry.tiles.map((tile) => tile.id)])).toEqual([
      ['unread', ['b', 'd']],
      ['dealt_with', ['a', 'c']],
    ]);
    expect(groupTiles([])).toEqual([]);
  });
});
