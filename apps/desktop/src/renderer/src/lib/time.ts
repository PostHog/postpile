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
