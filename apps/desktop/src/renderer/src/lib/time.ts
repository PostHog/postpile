const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Short age like the mockup: "now", "20m", "5h", "3d", "2w". */
export function ageLabel(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(elapsed)) {
    return '';
  }
  if (elapsed < MINUTE) {
    return 'now';
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h`;
  }
  if (elapsed < WEEK) {
    return `${Math.floor(elapsed / DAY)}d`;
  }
  return `${Math.floor(elapsed / WEEK)}w`;
}

/** The newest of a list of ISO times; ISO strings compare correctly as text. */
export function newest(times: string[]): string | null {
  let result: string | null = null;
  for (const time of times) {
    if (result === null || time > result) {
      result = time;
    }
  }
  return result;
}

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** For running text: "just now", "5m ago", "3h ago" (same day), "yesterday", "3 days ago", "2w ago". */
export function whenLabel(iso: string, now: Date): string {
  const then = new Date(iso);
  const elapsed = now.getTime() - then.getTime();
  if (Number.isNaN(elapsed)) {
    return '';
  }
  if (elapsed < MINUTE) {
    return 'just now';
  }
  const days = Math.round((dayStart(now) - dayStart(then)) / DAY);
  if (days <= 0) {
    return `${ageLabel(iso, now)} ago`;
  }
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return `${ageLabel(iso, now)} ago`;
}
