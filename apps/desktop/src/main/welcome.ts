import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** In the app's userData folder: the welcome notification was shown there once. */
export const WELCOME_FLAG_FILE = 'welcome-notification.json';

/**
 * On the first launch (no flag in `userDataDir`), shows the welcome
 * notification and stores the flag. Nothing is stored when notifications
 * are off or unsupported, so the welcome comes once they work. Returns
 * whether it showed now.
 */
export function welcomeOnce(userDataDir: string, show: () => 'shown' | 'off' | 'unsupported', now: Date = new Date()): boolean {
  const flag = join(userDataDir, WELCOME_FLAG_FILE);
  if (existsSync(flag) || show() !== 'shown') {
    return false;
  }
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(flag, `${JSON.stringify({ shownAt: now.toISOString() })}\n`);
  return true;
}
