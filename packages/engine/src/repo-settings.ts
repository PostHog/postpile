import { DEFAULT_REPO_SETTINGS, type RepoSettings } from '@postpile/core';
import type { Store } from '@postpile/store';

const REPO_SETTINGS_KEY = 'repo_settings';

/** The repo menu's scope and quiet repos. "All repos" and nothing quiet until the user picks. */
export function loadRepoSettings(store: Store): RepoSettings {
  const raw = store.meta.get(REPO_SETTINGS_KEY);
  if (!raw) {
    return DEFAULT_REPO_SETTINGS;
  }
  const stored = JSON.parse(raw) as Partial<RepoSettings>;
  return { scope: stored.scope ?? null, quiet: stored.quiet ?? [] };
}

export function saveRepoSettings(store: Store, settings: RepoSettings): void {
  store.meta.set(REPO_SETTINGS_KEY, JSON.stringify(settings));
}
