import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** In the app's userData folder: there while PostPile runs, removed by a clean quit. */
export const RUN_MARKER_FILE = 'running.json';

/** The last run ended without a clean quit. */
export interface UncleanExit {
  /** That run was another version, e.g. it went down around an update. */
  versionChanged: boolean;
}

/** What the last run left behind: null without a marker; a marker that does not parse still counts, without a version. */
function readLastRun(file: string): { version: string | null } | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const marker = JSON.parse(text) as { version?: unknown };
    return { version: typeof marker.version === 'string' ? marker.version : null };
  } catch {
    return { version: null };
  }
}

/**
 * Tells whether the last run ended without a clean quit: a crash, an
 * out-of-memory abort, a force quit, power loss. Every start writes a
 * marker, and only the clean quit path removes it (Cmd+Q, SIGTERM or
 * SIGINT, "Restart to update", all through main's shutdown). A marker still
 * there at the next start means the last run never got that far. Never
 * throws: a full disk must not stop the app from starting.
 */
export class RunMarker {
  private readonly file: string;
  private written = false;

  constructor(private readonly userDataDir: string) {
    this.file = join(userDataDir, RUN_MARKER_FILE);
  }

  /** Once at start: how the last run ended (null after a clean quit or on a first launch), then marks this run. */
  start(version: string, now: Date = new Date(), pid: number = process.pid): UncleanExit | null {
    const lastRun = readLastRun(this.file);
    const unclean = lastRun ? { versionChanged: lastRun.version !== null && lastRun.version !== version } : null;
    try {
      mkdirSync(this.userDataDir, { recursive: true });
      writeFileSync(this.file, `${JSON.stringify({ pid, version, startedAt: now.toISOString() })}\n`);
      this.written = true;
    } catch (error) {
      console.error('could not write the run marker:', error);
    }
    return unclean;
  }

  /** On a clean quit. Only the run that wrote the marker removes it. */
  clear(): void {
    if (!this.written) {
      return;
    }
    try {
      rmSync(this.file, { force: true });
      this.written = false;
    } catch (error) {
      console.error('could not remove the run marker:', error);
    }
  }
}
