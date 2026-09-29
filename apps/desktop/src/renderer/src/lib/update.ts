import type { UpdateView } from '@postpile/core';

/** What the reminder tells the user to run. The app is installed as a Homebrew cask. */
export const UPGRADE_COMMAND = 'brew upgrade --cask postpile';

/** localStorage key for "Later" on one version: a newer release shows the pill again. */
export function laterKey(version: string): string {
  return `postpile.update.later.${version}`;
}

/** The version the pill shows, or null: no update, or the user said "Later" to this one. */
export function pillVersion(update: UpdateView | undefined, laterVersions: ReadonlySet<string>): string | null {
  const version = update?.latest?.version ?? null;
  if (version === null || laterVersions.has(version)) {
    return null;
  }
  return version;
}

/** "Sep 29, 2026" in the user's time zone; '' when unknown. */
export function releaseDate(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
