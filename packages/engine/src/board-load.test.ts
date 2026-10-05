import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { at, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { Board, BOARD_REUSE_MS } from './board.ts';

function later(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

describe('Board.load', () => {
  let store: Store;

  beforeEach(() => {
    store = Store.open(':memory:');
    const pr = makePr({ number: 1 });
    store.prs.upsert(pr, at(0));
    store.notifications.upsertMany([makeThreadFor(pr)]);
  });

  afterEach(() => {
    store.close();
  });

  it('hands out the same Board while nothing changed and it is fresh', () => {
    const first = Board.load(store, at(1));
    expect(Board.load(store, at(1))).toBe(first);
    expect(Board.load(store, later(at(1), BOARD_REUSE_MS))).toBe(first);
  });

  it('loads again once a row changed', () => {
    const first = Board.load(store, at(1));
    store.prs.upsert(makePr({ number: 2 }), at(1));
    const second = Board.load(store, at(1));
    expect(second).not.toBe(first);
    expect([...second.prs.keys()]).toEqual(['acme/app#1', 'acme/app#2']);
  });

  it('loads again when the time moved past the reuse window or back', () => {
    const first = Board.load(store, at(1));
    const afterWindow = Board.load(store, later(at(1), BOARD_REUSE_MS + 1));
    expect(afterWindow).not.toBe(first);
    expect(afterWindow.now).toBe(later(at(1), BOARD_REUSE_MS + 1));
    expect(Board.load(store, at(1))).not.toBe(afterWindow);
  });

  it('keeps a Board per store', () => {
    const other = Store.open(':memory:');
    try {
      expect(Board.load(other, at(1))).not.toBe(Board.load(store, at(1)));
      expect(Board.load(other, at(1)).prs.size).toBe(0);
    } finally {
      other.close();
    }
  });
});
