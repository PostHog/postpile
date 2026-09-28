import type { IsoTime } from '@postpile/core';
import type { Store } from '@postpile/store';

export const BASELINE_KEY = 'start_fresh_baseline';

/** "Start fresh here": threads and events before it are background. Null when not set. */
export function loadBaseline(store: Store): IsoTime | null {
  return store.meta.get(BASELINE_KEY);
}
