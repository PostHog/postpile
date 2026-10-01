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
}

function known(version: string | null): version is string {
  return version !== null && version !== 'unknown';
}

/**
 * Whether the app was updated underneath this process: the database has
 * another schema than this build expects, or the running app has another
 * version. A version that is not known on both sides never counts. Both
 * signals are cheap (one SQL query, one small file read) and read on every
 * call: a kept "no mismatch" would let calls through right after an upgrade.
 * Only a mismatch is kept, since only a reconnect loads the new code.
 */
export function updateCheck(signals: UpdateSignals): () => Promise<boolean> {
  let updated = false;
  return async () => {
    if (updated) {
      return true;
    }
    const schema = await signals.databaseSchema();
    const app = signals.appVersion();
    updated = (schema !== null && schema !== signals.expectedSchema) || (known(app) && known(signals.ownVersion) && app !== signals.ownVersion);
    return updated;
  };
}
