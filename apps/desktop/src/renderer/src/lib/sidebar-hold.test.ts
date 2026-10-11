import { describe, expect, it } from 'vitest';
import { holdPlaces, nextHeldEntries, type Bucket, type HeldEntry } from './hold-place.ts';
import { heldRows, keptTopicIds, nextKeptHolds, type SidebarHold } from './sidebar-hold.ts';

const A = { key: 'tile-a#0', topicId: 'a' };
const B = { key: 'tile-b#0', topicId: 'b' };
const C = { key: 'tile-c#0', topicId: 'c' };

// Owner, 2026-10-11 (B-A-16): the held row goes when the pointer leaves the sidebar, not on the click.
describe('nextKeptHolds', () => {
  it('keeps the row a click inside the sidebar leaves', () => {
    expect(nextKeptHolds([], A, B, true)).toEqual([A]);
  });

  it('keeps every row left while the pointer clicks on through, and drops the one picked again', () => {
    expect(nextKeptHolds([A], B, C, true)).toEqual([A, B]);
    expect(nextKeptHolds([A, B], C, A, true)).toEqual([B, C]);
  });

  it('keeps nothing when the selection changes from outside the sidebar', () => {
    expect(nextKeptHolds([], A, B, false)).toEqual([]);
    expect(nextKeptHolds([A], B, C, false)).toEqual([]);
  });

  it('keeps nothing new when the selection did not change, or only the tile inside the topic did', () => {
    expect(nextKeptHolds([], A, A, true)).toEqual([]);
    expect(nextKeptHolds([], A, { key: 'tile-a2#0', topicId: 'a' }, true)).toEqual([]);
  });
});

describe('heldRows and keptTopicIds', () => {
  it('hold every kept row in place, oldest first, and keep every kept row on screen', () => {
    expect(heldRows(C, [A, B])).toEqual([
      { key: 'tile-a#0', itemId: 'a' },
      { key: 'tile-b#0', itemId: 'b' },
      { key: 'tile-c#0', itemId: 'c' },
    ]);
    expect(heldRows({ key: null, topicId: 'c' }, [])).toEqual([]);
    expect(keptTopicIds(C, [A, B])).toEqual(['c', 'a', 'b']);
    expect(keptTopicIds({ key: null, topicId: null }, [])).toEqual([]);
  });
});

// PR #182 review: A turns dealt with while selected, then A -> B -> C without leaving the sidebar. A must keep its place the whole time.
describe('the sidebar held rows over A -> B -> C', () => {
  const id = (item: string) => item;
  const live = (items: string[], dealt: string[] = []): Bucket<string>[] => [
    { key: 'team_owns', items },
    { key: 'dealt:team_owns', items: dealt },
  ];

  it('keeps A where it was until the pointer leaves', () => {
    let entries: HeldEntry[] = [];
    let kept: SidebarHold[] = [];
    let last: SidebarHold = A;
    const step = (current: SidebarHold, buckets: Bucket<string>[]) => {
      kept = nextKeptHolds(kept, last, current, true);
      last = current;
      entries = nextHeldEntries(entries, heldRows(current, kept), buckets, id);
      return holdPlaces(buckets, entries, id);
    };
    // A is selected in its live place, then turns dealt with and leaves for the dealt-with bucket.
    expect(step(A, live(['x', 'a', 'b', 'c']))).toEqual(live(['x', 'a', 'b', 'c']));
    expect(step(A, live(['x', 'b', 'c'], ['a']))).toEqual(live(['x', 'a', 'b', 'c'], []));
    expect(step(B, live(['x', 'b', 'c'], ['a']))).toEqual(live(['x', 'a', 'b', 'c'], []));
    expect(step(C, live(['x', 'b', 'c'], ['a']))).toEqual(live(['x', 'a', 'b', 'c'], []));
    // The pointer leaves: nothing is kept, A goes to its new place.
    kept = [];
    entries = nextHeldEntries(entries, heldRows(C, kept), live(['x', 'b', 'c'], ['a']), id);
    expect(holdPlaces(live(['x', 'b', 'c'], ['a']), entries, id)).toEqual(live(['x', 'b', 'c'], ['a']));
  });
});
