import type { Store } from '@postpile/store';

const FIRST_SYNC_KEY = 'telemetry_first_sync_done';

/** Whether any sync has ever finished for this database (across restarts): first_sync_completed fires exactly once. */
export function hasCompletedFirstSync(store: Store): boolean {
  return store.meta.get(FIRST_SYNC_KEY) !== null;
}

export function markFirstSyncCompleted(store: Store): void {
  store.meta.set(FIRST_SYNC_KEY, '1');
}
