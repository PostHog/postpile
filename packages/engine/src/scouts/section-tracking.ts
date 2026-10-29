import { stackByPrKey, type PrKey, type Stack } from '@postpile/core';
import type { Store } from '@postpile/store';
import { readStoreShape, threadsByPrKey } from '../hot-set.ts';

/**
 * Which scouted PRs PostPile tracks by itself, as the Scouted section reads
 * it (DESIGN.md "Scouts"): a PR with a notification thread, a found row
 * (followed ones included) or a topic, and every layer of a stack that has
 * such a PR. A tracked PR shows its whole stack in its normal place, so
 * those layers are off the section. One rule for the sidebar's counts and
 * for telemetry's scout_pr_closed, so they never disagree.
 */
export class ScoutSectionTracking {
  private constructor(
    private readonly trackedKeys: ReadonlySet<PrKey>,
    private readonly stackOf: ReadonlyMap<PrKey, Stack>,
  ) {}

  /** Reads threads, found rows, topic memberships and the stacks over every stored header. */
  static load(store: Store): ScoutSectionTracking {
    const tracked = new Set<PrKey>([
      ...threadsByPrKey(store.notifications.list()).keys(),
      ...store.foundPrs.listAll().keys(),
      ...store.memberships.listAll().map((membership) => membership.prKey),
    ]);
    return new ScoutSectionTracking(tracked, stackByPrKey(readStoreShape(store).stacks));
  }

  /** The PR, or a layer of its stack, is tracked: it shows in the inbox's place, not on the Scouted section. */
  tracks(prKey: PrKey): boolean {
    if (this.trackedKeys.has(prKey)) {
      return true;
    }
    const layers = this.stackOf.get(prKey)?.prKeys ?? [];
    return layers.some((key) => this.trackedKeys.has(key));
  }
}
