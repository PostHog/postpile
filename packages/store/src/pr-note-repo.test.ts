import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noteAnchor, type PrNote } from '@postpile/core';
import { at, makePr } from '@postpile/core/fixtures';
import { Store } from './index.ts';

let store: Store;

beforeEach(() => {
  store = Store.open(':memory:');
});

afterEach(() => {
  store.close();
});

function note(overrides: Partial<Omit<PrNote, 'seq'>> = {}): Omit<PrNote, 'seq'> {
  return {
    id: 'n1',
    prKey: 'acme/app#1',
    slot: 'durable',
    kind: 'covered',
    by: 'ph3 session',
    client: 'claude-code',
    note: 'reviewed with the parent',
    coveredByPrKey: 'acme/app#2',
    anchor: noteAnchor(makePr({ number: 1 })),
    coverAnchor: noteAnchor(makePr({ number: 2 })),
    createdAt: at(10),
    expiresAt: null,
    clearedAt: null,
    clearedBy: null,
    supersededBy: null,
    idempotencyKey: 'k1',
    ...overrides,
  };
}

describe('PrNoteRepo', () => {
  it('stores a note with its anchors and finds it by id, key and slot', () => {
    const seq = store.prNotes.insert(note());
    expect(store.prNotes.get('n1')).toEqual({ ...note(), seq });
    expect(store.prNotes.getByIdempotencyKey('k1')?.id).toBe('n1');
    expect(store.prNotes.currentIn('acme/app#1', 'durable')?.id).toBe('n1');
    expect(store.prNotes.currentIn('acme/app#1', 'lease')).toBeNull();
  });

  it('lists current notes plus the newest replaced one per PR, in insert order, in one query', () => {
    store.prNotes.insert(note({ id: 'n1', idempotencyKey: 'k1' }));
    store.prNotes.insert(note({ id: 'n2', idempotencyKey: 'k2' }));
    store.prNotes.supersede('n1', 'n2');
    store.prNotes.insert(note({ id: 'n3', idempotencyKey: 'k3' }));
    store.prNotes.supersede('n2', 'n3');
    store.prNotes.insert(note({ id: 'l1', slot: 'lease', kind: 'in_progress', coveredByPrKey: null, coverAnchor: null, expiresAt: at(100), idempotencyKey: 'k4' }));
    store.prNotes.insert(note({ id: 'o1', prKey: 'acme/app#5', idempotencyKey: 'k5' }));
    store.prNotes.clear('o1', at(20), 'user');

    expect(store.prNotes.listForPrs(['acme/app#1']).map((row) => row.id)).toEqual(['n2', 'n3', 'l1']);
    // A replaced note gives up its idempotency key, so the same request can write again.
    expect(store.prNotes.get('n1')?.idempotencyKey).toBeNull();
    expect(store.prNotes.listForPrs(['acme/app#5'])).toEqual([]);
    expect(store.prNotes.get('o1')).toMatchObject({ clearedAt: at(20), clearedBy: 'user', idempotencyKey: null });
    expect(store.prNotes.listForPrs([])).toEqual([]);
  });

  it('renews a lease and counts live notes on open PRs only, per client and in total', () => {
    store.prs.upsert(makePr({ number: 1 }), at(1));
    store.prs.upsert(makePr({ number: 3, state: 'MERGED' }), at(1));
    store.prNotes.insert(note({ id: 'a', idempotencyKey: 'a' }));
    store.prNotes.insert(note({ id: 'b', slot: 'lease', kind: 'in_progress', client: 'codex', expiresAt: at(30), idempotencyKey: 'b' }));
    store.prNotes.insert(note({ id: 'c', prKey: 'acme/app#3', idempotencyKey: 'c' }));

    expect(store.prNotes.countLiveOnOpenPrs(at(20))).toBe(2);
    expect(store.prNotes.countLiveOnOpenPrs(at(20), 'claude-code')).toBe(1);
    expect(store.prNotes.countLiveOnOpenPrs(at(30))).toBe(1);
    store.prNotes.renew('b', at(90));
    expect(store.prNotes.countLiveOnOpenPrs(at(30))).toBe(2);
  });
});
