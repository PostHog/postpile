import { describe, expect, it } from 'vitest';
import { holdPlace, holdPlaces, nextHeldEntries, placeIn, type Bucket } from './hold-place.ts';

const id = (item: string) => item;

function layout(live: string[], done: string[] = []): Bucket<string>[] {
  return [
    { key: 'live', items: live },
    { key: 'snoozed', items: [] },
    { key: 'done', items: done },
  ];
}

describe('holdPlace', () => {
  it('finds where the selected item sits', () => {
    expect(placeIn(layout(['a', 'b', 'c']), 'b', id)).toEqual({ id: 'b', bucket: 'live', index: 1 });
    expect(placeIn(layout(['a']), 'z', id)).toBeNull();
  });

  it('keeps the selected tile where it was when it turned done and moved to the Done fold', () => {
    const held = placeIn(layout(['a', 'b', 'c']), 'b', id);
    const after = layout(['a', 'c'], ['x', 'b']);
    expect(holdPlace(after, held, id)).toEqual(layout(['a', 'b', 'c'], ['x']));
  });

  it('keeps its index when it would re-sort inside the same list', () => {
    const held = placeIn(layout(['a', 'b', 'c']), 'a', id);
    expect(holdPlace(layout(['b', 'c', 'a']), held, id)).toEqual(layout(['a', 'b', 'c']));
  });

  it('caps the index when the list got shorter, and changes nothing for the others', () => {
    const held = placeIn(layout(['a', 'b', 'c']), 'c', id);
    expect(holdPlace(layout(['c'], ['a', 'b']), held, id)).toEqual(layout(['c'], ['a', 'b']));
  });

  it('leaves the layout alone without a held place, when the item is gone or its list is not there', () => {
    const buckets = layout(['a', 'b']);
    expect(holdPlace(buckets, null, id)).toBe(buckets);
    expect(holdPlace(buckets, { id: 'z', bucket: 'live', index: 0 }, id)).toBe(buckets);
    expect(holdPlace(buckets, { id: 'a', bucket: 'nope', index: 0 }, id)).toBe(buckets);
  });
});

describe('nextHeldEntries and holdPlaces', () => {
  it('keeps each held item at the place it had under its key, and lets go of the ones no longer asked for', () => {
    const first = nextHeldEntries([], [{ key: 'k1', itemId: 'a' }], layout(['a', 'b', 'c']), id);
    const second = nextHeldEntries(first, [{ key: 'k1', itemId: 'a' }, { key: 'k2', itemId: 'c' }], layout(['b', 'c'], ['a']), id);
    expect(second[0]).toBe(first[0]);
    expect(holdPlaces(layout(['b'], ['a', 'c']), second, id)).toEqual(layout(['a', 'b', 'c']));
    expect(nextHeldEntries(second, [{ key: 'k2', itemId: 'c' }], layout(['b'], ['a', 'c']), id)).toEqual([second[1]]);
  });

  it('takes the current place when the key changes', () => {
    const first = nextHeldEntries([], [{ key: 'k1', itemId: 'a' }], layout(['a', 'b']), id);
    expect(nextHeldEntries(first, [{ key: 'k2', itemId: 'a' }], layout(['b', 'a']), id)[0]?.place).toEqual({ id: 'a', bucket: 'live', index: 1 });
  });
});
