import type { IsoTime, SetupFlag } from '@postpile/core';
import type { Store } from '@postpile/store';

/** Meta key: {flag: 'done' | 'skipped', at}. Missing until setup was accepted or skipped once. */
export const SETUP_FLAG_KEY = 'setup_state';

export interface StoredSetupFlag {
  flag: SetupFlag;
  at: IsoTime;
}

export function loadSetupFlag(store: Store): StoredSetupFlag | null {
  const raw = store.meta.get(SETUP_FLAG_KEY);
  return raw ? (JSON.parse(raw) as StoredSetupFlag) : null;
}

export function saveSetupFlag(store: Store, flag: SetupFlag, at: IsoTime): void {
  store.meta.set(SETUP_FLAG_KEY, JSON.stringify({ flag, at } satisfies StoredSetupFlag));
}
