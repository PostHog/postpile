import { NO_READ_CHANGE, planRead, type IsoTime, type PendingThread, type ReadCause, type ReadChange, type ReadPlan, type ReadScope } from '@postpile/core';
import type { Store } from '@postpile/store';

/** A thread a click marked read here before GitHub took it, with the read time it had, so it can be put back. */
export interface LocalThreadRead {
  id: string;
  lastReadAt: IsoTime | null;
}

/**
 * What a mark-read changed in the app right away: the read plan's change,
 * plus the threads it marked read here. GitHub unread is PostPile unread
 * (DESIGN.md), so a tile only turns read with its thread; with writes on the
 * click does both at once and GitHub follows after the undo window. An undo,
 * a parked batch or a mark-read GitHub did not take puts all of it back.
 */
export interface LocalChange extends ReadChange {
  threads: LocalThreadRead[];
}

export const NO_LOCAL_CHANGE: LocalChange = { ...NO_READ_CHANGE, threads: [] };

/** Marks the threads read here at the click, up to the activity the user saw. Returns how each was, for putting it back. */
export function readThreadsLocally(store: Store, threads: PendingThread[]): LocalThreadRead[] {
  const before = threads.flatMap((thread) => {
    const stored = store.notifications.get(thread.id);
    return stored?.unread ? [{ id: thread.id, lastReadAt: stored.lastReadAt, readAt: thread.updatedAt }] : [];
  });
  for (const thread of before) {
    store.notifications.markRead(thread.id, thread.readAt);
  }
  return before.map(({ id, lastReadAt }) => ({ id, lastReadAt }));
}

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

/** Puts back what a mark-read changed in the app: its events turn unseen, its PRs lose handled, its threads turn unread again. */
export function putBackLocalChange(store: Store, change: LocalChange): void {
  store.transaction(() => {
    store.events.clearSeen(change.eventIds);
    for (const key of change.handledKeys) {
      store.userPrStates.clearHandled(key);
    }
    for (const thread of change.threads) {
      store.notifications.markUnread(thread.id, thread.lastReadAt);
    }
  });
}

/** The part of a batch's local change that belongs to one thread and its PR. */
export function localChangeForThread(store: Store, change: LocalChange, thread: PendingThread): LocalChange {
  const key = thread.prKey;
  const prEventIds = new Set(key === null ? [] : (store.events.listForPrs([key]).get(key) ?? []).map((event) => event.id));
  return {
    eventIds: change.eventIds.filter((id) => prEventIds.has(id)),
    handledKeys: change.handledKeys.filter((candidate) => candidate === key),
    threads: change.threads.filter((read) => read.id === thread.id),
  };
}

/** GitHub did not take this thread's mark-read: its thread and PR go back to how they were before the click. */
export function putBackNotTaken(store: Store, thread: PendingThread, change: LocalChange): void {
  putBackLocalChange(store, localChangeForThread(store, change, thread));
}
