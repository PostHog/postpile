import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** In the app's userData folder: the welcome notification was shown there once. */
export const WELCOME_FLAG_FILE = 'welcome-notification.json';

/** In the app's userData folder: the app was launched there before. */
export const LAUNCHED_FLAG_FILE = 'launched.json';

function writeFlag(userDataDir: string, file: string, at: Date): void {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(join(userDataDir, file), `${JSON.stringify({ at: at.toISOString() })}\n`);
}

/**
 * The very first launch in `userDataDir`, and marks it launched. Before
 * 0.18 the welcome flag doubled as this mark, so an install with only that
 * file was launched before too.
 */
export function firstLaunchOnce(userDataDir: string, now: Date = new Date()): boolean {
  const launched = existsSync(join(userDataDir, LAUNCHED_FLAG_FILE)) || existsSync(join(userDataDir, WELCOME_FLAG_FILE));
  if (!existsSync(join(userDataDir, LAUNCHED_FLAG_FILE))) {
    writeFlag(userDataDir, LAUNCHED_FLAG_FILE, now);
  }
  return !launched;
}

/**
 * Once the user lets PostPile interrupt them (in batches or as soon as it
 * matters), shows the welcome notification once, so macOS asks for the
 * permission right after the choice and not in the middle of a real ping.
 * Nothing is stored when notifications are off or unsupported, so the
 * welcome comes once they work. Returns whether it showed now.
 */
export function welcomeOnce(userDataDir: string, show: () => 'shown' | 'off' | 'unsupported', now: Date = new Date()): boolean {
  if (existsSync(join(userDataDir, WELCOME_FLAG_FILE)) || show() !== 'shown') {
    return false;
  }
  writeFlag(userDataDir, WELCOME_FLAG_FILE, now);
  return true;
}
