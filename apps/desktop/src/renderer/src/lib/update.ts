import type { AppInstall } from '@postpile/core';

export interface UpgradeSteps {
  command: string;
  afterwards: string;
}

/** What the reminder tells the user to run, for the way this copy was installed. */
export function upgradeSteps(install: AppInstall): UpgradeSteps {
  switch (install) {
    case 'brew-service':
      return { command: 'brew upgrade postpile-server && brew services restart postpile-server', afterwards: 'Then reload this page.' };
    case 'source':
      return { command: 'git pull && pnpm install && pnpm build:web', afterwards: 'Then restart pnpm server and reload this page.' };
    case 'app':
      return { command: 'brew upgrade --cask postpile', afterwards: 'Then quit and reopen PostPile.' };
  }
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

/** "Mon, Sep 29" in the user's time zone; '' when unknown. */
export function behindSinceDate(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "3 releases", "1 release", "10+ releases" (the list may be cut short, see AvailableUpdate.moreBehind). */
export function releasesBehindText(count: number, more: boolean): string {
  return `${count}${more ? '+' : ''} ${count === 1 && !more ? 'release' : 'releases'}`;
}
