import { describe, expect, it } from 'vitest';
import { keptTopicIds, nextKeptHolds, placeHold } from './sidebar-hold.ts';

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

describe('placeHold and keptTopicIds', () => {
  it('hold the row left last in place and keep every kept row on screen', () => {
    expect(placeHold(C, [A, B])).toEqual(B);
    expect(placeHold(C, [])).toEqual(C);
    expect(keptTopicIds(C, [A, B])).toEqual(['c', 'a', 'b']);
    expect(keptTopicIds({ key: null, topicId: null }, [])).toEqual([]);
  });
});
