/** How long a "no mismatch" answer counts, like the running check: the lock is read with ps, and a busy agent may call several tools a second. */
export const UPDATE_CHECK_MS = 5000;

/** What the check looks at. Everything is local and cheap: no network. */
export interface UpdateSignals {
  /** This process's own version (the app version it shipped with). */
  ownVersion: string;
  /** The schema version this build's code expects. */
  expectedSchema: number;
  /** The schema version the open database has now; null when unknown. */
  databaseSchema: () => Promise<number | null>;
  /** The version the running app wrote into postpile.lock; null when no app runs or an old lock has none. */
  appVersion: () => string | null;
  /** Defaults to the system clock, in ms. */
  now?: () => number;
}

function known(version: string | null): version is string {
  return version !== null && version !== 'unknown';
}

/**
 * Whether the app was updated underneath this process: the database has
 * another schema than this build expects, or the running app has another
 * version. A version that is not known on both sides never counts. Only a
 * "no mismatch" is kept (for UPDATE_CHECK_MS); a mismatch is permanent for
 * this process, since only a reconnect loads the new code.
 */
export function updateCheck(signals: UpdateSignals): () => Promise<boolean> {
  const now = signals.now ?? Date.now;
  let updated = false;
  let freshUntil = 0;
  return async () => {
    if (updated) {
      return true;
    }
    if (now() < freshUntil) {
      return false;
    }
    const schema = await signals.databaseSchema();
    const app = signals.appVersion();
    updated = (schema !== null && schema !== signals.expectedSchema) || (known(app) && known(signals.ownVersion) && app !== signals.ownVersion);
    if (!updated) {
      freshUntil = now() + UPDATE_CHECK_MS;
    }
    return updated;
  };
}
