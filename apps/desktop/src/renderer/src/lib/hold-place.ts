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

/** One item to hold, by its selection key (a new key takes the item's current place). */
export interface HoldRequest {
  key: string;
  itemId: string;
}

/** A held item: the key it was held under and the place it had then (null while it was not in the buckets). */
export interface HeldEntry {
  key: string;
  itemId: string;
  place: HeldPlace | null;
}

/**
 * The held entries for `requests`, from the `previous` ones: an item still
 * requested under the same key keeps the place it had (the same object, so
 * nothing changed reads as nothing changed); a new item or key takes its
 * place on screen, with the items before it already held; an item no
 * longer requested is let go. Several items can be held at once (the
 * sidebar's kept rows, owner 2026-10-11).
 */
export function nextHeldEntries<T>(previous: HeldEntry[], requests: HoldRequest[], buckets: Bucket<T>[], idOf: (item: T) => string): HeldEntry[] {
  let layout = buckets;
  const entries: HeldEntry[] = [];
  for (const request of requests) {
    const before = previous.find((entry) => entry.itemId === request.itemId && entry.key === request.key);
    const keep = before !== undefined && (before.place !== null || placeIn(layout, request.itemId, idOf) === null);
    const entry = keep ? before : { key: request.key, itemId: request.itemId, place: placeIn(layout, request.itemId, idOf) };
    entries.push(entry);
    layout = holdPlace(layout, entry.place, idOf);
  }
  return entries;
}

/** The buckets with every held item moved back to its place, in the order given (`holdPlace` for each). */
export function holdPlaces<T>(buckets: Bucket<T>[], entries: HeldEntry[], idOf: (item: T) => string): Bucket<T>[] {
  return entries.reduce((layout, entry) => holdPlace(layout, entry.place, idOf), buckets);
}
