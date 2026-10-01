import type { PrSetChange } from './types.ts';

/** Set history lines a topic's detail carries, newest first. */
export const SET_CHANGES_SHOWN = 20;

/** One readable line: "2026-10-01 acme/app#2 joined (agent): same cap in the secrets repo". */
export function setChangeText(change: PrSetChange): string {
  const subject = change.prKey ? `${change.prKey} ${change.kind}` : `set ${change.kind}`;
  return `${change.at.slice(0, 10)} ${subject} (${change.by}): ${change.reason}`;
}
