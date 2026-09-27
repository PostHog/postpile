import type { GlanceBatch } from './memory.ts';
import type { PrKey } from './types.ts';

/** PRs per glance call. Big enough to cut calls ~15x, small enough for a quick answer. */
export const GLANCE_BATCH_SIZE = 18;

/**
 * Splits one topic's PRs that need a glance into batches, keeping the given
 * order (callers put PRs in unread tiles first, so a capped budget is spent
 * where the user looks first).
 */
export function planGlanceBatches(
  topicId: string | null,
  dossierVersion: number | null,
  prKeys: PrKey[],
  size: number = GLANCE_BATCH_SIZE,
): GlanceBatch[] {
  const batches: GlanceBatch[] = [];
  for (let i = 0; i < prKeys.length; i += size) {
    batches.push({ topicId, dossierVersion, prKeys: prKeys.slice(i, i + size), attempt: 1 });
  }
  return batches;
}

/** One retry for everything a batch left out or answered badly. Empty when nothing is missing. */
export function retryBatch(batch: GlanceBatch, missing: PrKey[]): GlanceBatch | null {
  if (missing.length === 0 || batch.attempt === 2) {
    return null;
  }
  return { ...batch, prKeys: missing, attempt: 2 };
}
