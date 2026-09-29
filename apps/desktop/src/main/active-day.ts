import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The local calendar day, e.g. "2026-09-29". Active days follow the user's clock, not UTC. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function readDay(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Sends `app_active` once per local calendar day while the app runs: the
 * daily and weekly active users and the retention insights count it. The
 * last reported day lives in a small file in the data folder, so a restart
 * on the same day does not count twice.
 */
export class ActiveDayReporter {
  private lastDay: string | null;

  constructor(
    private readonly file: string,
    private readonly send: () => void,
  ) {
    this.lastDay = readDay(file);
  }

  /** Call at start and on a timer; sends only when the day changed. */
  check(now: Date): void {
    const today = localDay(now);
    if (today === this.lastDay) {
      return;
    }
    this.lastDay = today;
    this.send();
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, today, 'utf8');
    } catch (error) {
      console.error('could not store the active day:', error);
    }
  }
}
