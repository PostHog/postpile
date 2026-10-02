// "Marked when you move on" (DESIGN.md "Actions act on what you look at",
// 2026-09-29, kept by "Marked when the dwell ends", 2026-10-01): while a tile
// is selected it keeps its place, and so does the topic row it sits in, even
// when its state changed (a mark, the opened mark, a sync). Only the selected
// item is held; everything else sorts as usual. The held place applies until
// the selection moves; then `useFlip` slides it to its new place.

/** A list the item can sit in: a tile section (live, snoozed, done) or a sidebar section. */
export interface Bucket<T> {
  key: string;
  items: T[];
}

/** Where the held item sat when it was selected. */
export interface HeldPlace {
  id: string;
  bucket: string;
  index: number;
}

/** The item's place in `buckets`, or null when it is not there. */
export function placeIn<T>(buckets: Bucket<T>[], id: string, idOf: (item: T) => string): HeldPlace | null {
  for (const bucket of buckets) {
    const index = bucket.items.findIndex((item) => idOf(item) === id);
    if (index >= 0) {
      return { id, bucket: bucket.key, index };
    }
  }
  return null;
}

/**
 * The buckets with the held item moved back to its held place (the index
 * capped at the bucket's length). Unchanged without a held place, when the
 * item is gone, or when its held bucket is not in the list.
 */
export function holdPlace<T>(buckets: Bucket<T>[], held: HeldPlace | null, idOf: (item: T) => string): Bucket<T>[] {
  if (held === null || !buckets.some((bucket) => bucket.key === held.bucket)) {
    return buckets;
  }
  const item = buckets.flatMap((bucket) => bucket.items).find((candidate) => idOf(candidate) === held.id);
  if (item === undefined) {
    return buckets;
  }
  return buckets.map((bucket) => {
    const rest = bucket.items.filter((candidate) => idOf(candidate) !== held.id);
    if (bucket.key !== held.bucket) {
      return { key: bucket.key, items: rest };
    }
    const index = Math.min(held.index, rest.length);
    return { key: bucket.key, items: [...rest.slice(0, index), item, ...rest.slice(index)] };
  });
}
