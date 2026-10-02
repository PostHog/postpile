// FLIP slides for lists that re-sort ("Marked when the dwell ends",
// 2026-10-01): when a tile or a topic row takes a new place, every element
// that moved slides from where it was to where it is now, and an item that
// changed group can get a brief "landed" highlight. The pure part lives here;
// `useFlip` measures the DOM and runs the animations.

/** Where one keyed element sat: its top inside the container, and the group (section) it sat in, if any. */
export interface FlipPlace {
  top: number;
  group: string | null;
}

/** One element to slide: from `dy` px off back to its place. `landed` when it changed group. */
export interface FlipMove {
  key: string;
  dy: number;
  landed: boolean;
}

/** The same keys in the same order and groups: nothing was re-sorted, so nothing slides (a resize or new text only). */
export function sameOrder(before: Map<string, FlipPlace>, after: Map<string, FlipPlace>): boolean {
  if (before.size !== after.size) {
    return false;
  }
  const beforeKeys = [...before.entries()];
  const afterKeys = [...after.entries()];
  return beforeKeys.every(([key, place], index) => {
    const other = afterKeys[index];
    return other !== undefined && other[0] === key && other[1].group === place.group;
  });
}

/**
 * The slides from `before` to `after`: elements present in both that moved
 * at least a pixel. Elements that are new or gone just appear or vanish; a
 * whole new list (another topic) shares no keys, so nothing slides.
 */
export function flipMoves(before: Map<string, FlipPlace>, after: Map<string, FlipPlace>): FlipMove[] {
  if (sameOrder(before, after)) {
    return [];
  }
  const moves: FlipMove[] = [];
  for (const [key, place] of after) {
    const was = before.get(key);
    if (was === undefined) {
      continue;
    }
    const dy = was.top - place.top;
    const landed = was.group !== place.group;
    if (Math.abs(dy) >= 1 || landed) {
      moves.push({ key, dy, landed });
    }
  }
  return moves;
}
