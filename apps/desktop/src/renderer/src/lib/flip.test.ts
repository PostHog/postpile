import { describe, expect, it } from 'vitest';
import { flipMoves, sameOrder, type FlipPlace } from './flip.ts';

function places(entries: [string, number, string | null][]): Map<string, FlipPlace> {
  return new Map(entries.map(([key, top, group]) => [key, { top, group }]));
}

describe('flipMoves', () => {
  it('slides a tile that changed group and the ones it passed, and marks only the mover as landed', () => {
    const before = places([
      ['group:unread', 0, null],
      ['tile:a', 20, 'unread'],
      ['group:open', 120, null],
      ['tile:b', 140, 'open'],
    ]);
    const after = places([
      ['group:open', 0, null],
      ['tile:b', 20, 'open'],
      ['tile:a', 120, 'open'],
    ]);

    expect(flipMoves(before, after)).toEqual([
      { key: 'group:open', dy: 120, landed: false },
      { key: 'tile:b', dy: 120, landed: false },
      { key: 'tile:a', dy: -100, landed: true },
    ]);
  });

  it('slides nothing when only sizes changed (new text, a resize): same keys, order and groups', () => {
    const before = places([
      ['tile:a', 0, 'open'],
      ['tile:b', 100, 'open'],
    ]);
    const after = places([
      ['tile:a', 0, 'open'],
      ['tile:b', 160, 'open'],
    ]);

    expect(sameOrder(before, after)).toBe(true);
    expect(flipMoves(before, after)).toEqual([]);
  });

  it('slides nothing for a whole new list, and new elements just appear', () => {
    const before = places([['tile:a', 0, 'open']]);
    expect(flipMoves(before, places([['tile:z', 0, 'open']]))).toEqual([]);
    expect(
      flipMoves(
        before,
        places([
          ['tile:new', 0, 'unread'],
          ['tile:a', 100, 'open'],
        ]),
      ),
    ).toEqual([{ key: 'tile:a', dy: -100, landed: false }]);
  });
});
