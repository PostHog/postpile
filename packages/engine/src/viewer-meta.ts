import type { Viewer } from '@code-manager/core';
import type { Store } from '@code-manager/store';

const VIEWER_KEY = 'viewer';

/** The viewer is fetched on sync and kept so reads work offline and before the first sync finishes. */
export function loadViewer(store: Store): Viewer | null {
  const raw = store.meta.get(VIEWER_KEY);
  return raw ? (JSON.parse(raw) as Viewer) : null;
}

export function saveViewer(store: Store, viewer: Viewer): void {
  store.meta.set(VIEWER_KEY, JSON.stringify(viewer));
}
