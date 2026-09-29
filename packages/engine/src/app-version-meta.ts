import type { Store } from '@postpile/store';

const APP_VERSION_KEY = 'app_version';

/**
 * The version of the app that last opened the database for writing. The
 * MCP server runs as long as its Claude session and keeps its old code after
 * an app update; it compares its own version with this one and asks for a
 * reconnect when they differ (DESIGN.md "Rules layer: one home per fact").
 */
export function loadAppVersion(store: Store): string | null {
  return store.meta.get(APP_VERSION_KEY);
}

export function saveAppVersion(store: Store, version: string): void {
  store.meta.set(APP_VERSION_KEY, version);
}
