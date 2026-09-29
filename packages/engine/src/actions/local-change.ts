import { planRead, type PendingThread, type PrKey, type ReadCause, type ReadChange, type ReadPlan, type ReadScope } from '@postpile/core';
import type { Store } from '@postpile/store';

/** Writes a read plan to the store: its events seen, its PRs handled. Returns what changed, for undo. */
export function writeReadPlan(store: Store, plan: ReadPlan): ReadChange {
  store.transaction(() => {
    store.events.markSeen(plan.change.eventIds, plan.seenAt);
    for (const key of plan.change.handledKeys) {
      store.userPrStates.markHandled(key, plan.handledAt);
    }
  });
  return plan.change;
}

/**
 * The one "apply a read locally" of the engine: plans the read over what the
 * store holds now (`planRead`) and writes it. Every cause's own checks and
 * GitHub write happen in its caller.
 */
export function readLocally(store: Store, scope: ReadScope, cause: ReadCause, at: string): ReadChange {
  return store.transaction(() => {
    const plan = planRead({
      scope,
      cause,
      events: store.events.listForPrs(scope.prKeys),
      userStates: store.userPrStates.getMany(scope.prKeys),
      at,
    });
    return writeReadPlan(store, plan);
  });
}

/** Puts back what a mark-read changed in the app: its events turn unseen, its PRs lose handled. */
export function putBackLocalChange(store: Store, change: ReadChange): void {
  store.transaction(() => {
    store.events.clearSeen(change.eventIds);
    for (const key of change.handledKeys) {
      store.userPrStates.clearHandled(key);
    }
  });
}

/** The part of a batch's local change that belongs to one PR. */
export function localChangeForPr(store: Store, change: ReadChange, key: PrKey): ReadChange {
  const prEventIds = new Set((store.events.listForPrs([key]).get(key) ?? []).map((event) => event.id));
  return {
    eventIds: change.eventIds.filter((id) => prEventIds.has(id)),
    handledKeys: change.handledKeys.filter((candidate) => candidate === key),
  };
}

/** GitHub did not take this thread's mark-read: its PR goes back to how it was before the click. */
export function putBackNotTaken(store: Store, thread: PendingThread, change: ReadChange): void {
  if (thread.prKey !== null) {
    putBackLocalChange(store, localChangeForPr(store, change, thread.prKey));
  }
}
