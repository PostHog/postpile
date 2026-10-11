import { useState } from 'react';
import { holdPlace, holdPlaces, nextHeldEntries, placeIn, type Bucket, type HeldEntry, type HeldPlace, type HoldRequest } from './hold-place.ts';

interface Held {
  key: string;
  place: HeldPlace | null;
}

/**
 * Holds item `itemId` where it was when the selection `holdKey` started
 * (`holdPlace`): a new key takes the item's current place, null holds
 * nothing. Only UI state: the place, never server data.
 */
export function useHeldPlace<T>(holdKey: string | null, itemId: string | null, buckets: Bucket<T>[], idOf: (item: T) => string): Bucket<T>[] {
  const [held, setHeld] = useState<Held | null>(null);
  let current = held;
  if (holdKey === null || itemId === null) {
    current = null;
  } else if (held?.key !== holdKey || (held.place === null && placeIn(buckets, itemId, idOf) !== null)) {
    current = { key: holdKey, place: placeIn(buckets, itemId, idOf) };
  }
  if (current?.key !== held?.key || current?.place !== held?.place) {
    // The documented "adjust state while rendering" pattern: React re-renders right away with it.
    setHeld(current);
  }
  return holdPlace(buckets, current?.place ?? null, idOf);
}

function sameEntries(a: HeldEntry[], b: HeldEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/**
 * `useHeldPlace` for several items at once (`nextHeldEntries`): each
 * request keeps the place its item had when its key started, until the
 * request goes. Only UI state.
 */
export function useHeldPlaces<T>(requests: HoldRequest[], buckets: Bucket<T>[], idOf: (item: T) => string): Bucket<T>[] {
  const [held, setHeld] = useState<HeldEntry[]>([]);
  const next = nextHeldEntries(held, requests, buckets, idOf);
  if (!sameEntries(next, held)) {
    // The documented "adjust state while rendering" pattern: React re-renders right away with it.
    setHeld(next);
  }
  return holdPlaces(buckets, next, idOf);
}
