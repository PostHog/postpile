import type { NotificationThread, Provenance } from './types.ts';

/**
 * A PR is pinged whenever GitHub notified the user about it, no matter how it
 * got into the tile. So a pulled-in PR that later gets a mention flips to
 * pinged without anyone having to update it.
 */
export function provenanceFor(thread: NotificationThread | null, pulledInReason: string): Provenance {
  if (thread) {
    return { kind: 'pinged', reason: thread.reason };
  }
  return { kind: 'pulled_in', reason: pulledInReason };
}
