/** What the reminder tells the user to run. The app is installed as a Homebrew cask. */
export const UPGRADE_COMMAND = 'brew upgrade --cask postpile';

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
