// The tile order in a topic (2026-10-27, stability over recency): the list
// rank, then the newest PR first by when it was opened, then the PR key.
import { describe, expect, it } from 'vitest';
import { at } from './fixtures.ts';
import { compareTileViews, newestPrOf } from './tile-view.ts';
import type { TileState } from './types.ts';
import type { NewestPr } from './views.ts';
import { NO_TURN, type WhoseTurn } from './whose-turn.ts';

const open: TileState = { kind: 'open', unreadBecause: [], unreadOnGitHub: false, loud: false };
const done: TileState = { ...open, kind: 'done' };
const yourMove: WhoseTurn = { kind: 'you', move: 'review', who: null, what: 'Review', prKey: 'acme/app#1' };

function tile(id: string, newestPr: NewestPr | null, state: TileState = open, turn: WhoseTurn = NO_TURN) {
  return { tile: { id }, state, turn, newestPr };
}

type OrderedTile = ReturnType<typeof tile>;

function ids(tiles: OrderedTile[]): string[] {
  return tiles.toSorted(compareTileViews).map((entry) => entry.tile.id);
}

describe('newestPrOf', () => {
  it('picks the most recently opened PR, the higher key on a tie', () => {
    const prs = [
      { key: 'acme/app#1', createdAt: at(5) },
      { key: 'acme/app#3', createdAt: at(9) },
      { key: 'acme/app#2', createdAt: at(9) },
    ];
    expect(newestPrOf(prs)).toEqual({ key: 'acme/app#3', createdAt: at(9) });
    expect(newestPrOf([])).toBeNull();
  });
});

describe('compareTileViews', () => {
  it('sorts newest PR first; a stack or set by its newest member', () => {
    const old = tile('pr:acme/app#1', { key: 'acme/app#1', createdAt: at(1) });
    const stack = tile('stack:acme/app#2', { key: 'acme/app#4', createdAt: at(30) });
    const fresh = tile('pr:acme/app#5', { key: 'acme/app#5', createdAt: at(20) });
    expect(ids([old, fresh, stack])).toEqual(['stack:acme/app#2', 'pr:acme/app#5', 'pr:acme/app#1']);
  });

  it('keeps the list rank first: your move before a newer tile, dealt with last', () => {
    const doneNew = tile('pr:acme/app#9', { key: 'acme/app#9', createdAt: at(90) }, done);
    const mine = tile('pr:acme/app#1', { key: 'acme/app#1', createdAt: at(1) }, open, yourMove);
    const newer = tile('pr:acme/app#5', { key: 'acme/app#5', createdAt: at(50) });
    expect(ids([doneNew, newer, mine])).toEqual(['pr:acme/app#1', 'pr:acme/app#5', 'pr:acme/app#9']);
  });

  it('breaks a tie by PR key, then tile id, so the order is fully deterministic', () => {
    const a = tile('pr:acme/app#1', { key: 'acme/app#1', createdAt: at(5) });
    const b = tile('pr:acme/app#2', { key: 'acme/app#2', createdAt: at(5) });
    const setB = tile('set:s2', { key: 'acme/app#2', createdAt: at(5) });
    expect(ids([a, setB, b])).toEqual(['pr:acme/app#2', 'set:s2', 'pr:acme/app#1']);
    expect(ids([b, a, setB])).toEqual(ids([setB, b, a]));
  });

  it('puts a tile without PRs last', () => {
    expect(ids([tile('set:empty', null), tile('pr:acme/app#1', { key: 'acme/app#1', createdAt: at(1) })])).toEqual(['pr:acme/app#1', 'set:empty']);
  });
});
