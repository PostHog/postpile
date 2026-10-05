import {
  buildStacks,
  hotFactsOf,
  prKey,
  selectHotBoard,
  type HotFacts,
  type HotSelection,
  type PrHeader,
  type NotificationThread,
  type PrKey,
  type Stack,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { loadViewer } from './viewer-meta.ts';

/** The PR threads by PR key; threads come newest first, so the newest one per PR wins. */
export function threadsByPrKey(threads: NotificationThread[]): Map<PrKey, NotificationThread> {
  const result = new Map<PrKey, NotificationThread>();
  for (const thread of threads) {
    if (thread.subjectType !== 'PullRequest' || thread.number === null) {
      continue;
    }
    const key = prKey({ repo: thread.repo, number: thread.number });
    if (!result.has(key)) {
      result.set(key, thread);
    }
  }
  return result;
}

/**
 * Every stored PR without its snapshot, and what only loads together:
 * stacks over every stored PR (so a stack is the same whichever board
 * reads it) and the active sets. Short rows only: tens of milliseconds for
 * 11k PRs, where parsing their snapshots took seconds.
 */
export interface StoreShape {
  headers: PrHeader[];
  stacks: Stack[];
  /** Each stack's layers and each active set's members. */
  groups: PrKey[][];
}

export function readStoreShape(store: Store): StoreShape {
  const headers = store.prs.listHeaders();
  const stacks = buildStacks(headers);
  return { headers, stacks, groups: [...stacks.map((stack) => stack.prKeys), ...store.sets.activeMemberGroups()] };
}

export interface HotSet {
  selection: HotSelection;
  shape: StoreShape;
  /** What the hot rules read of each stored PR, by key. */
  facts: Map<PrKey, HotFacts>;
}

/** The hot PRs as the store stands (`selectHotBoard`), from PR headers, threads, found PRs and personal asks. */
export function readHotSet(store: Store, now: string, threads: Map<PrKey, NotificationThread>): HotSet {
  const shape = readStoreShape(store);
  const found = store.foundPrs.listAll();
  const asks = store.events.prKeysWithPersonalAsks();
  const facts = shape.headers.map((pr) =>
    hotFactsOf(pr, { thread: threads.get(pr.key) ?? null, found: found.get(pr.key)?.via ?? null, personalAsk: asks.has(pr.key) }),
  );
  const selection = selectHotBoard({ facts, groups: shape.groups, viewer: loadViewer(store), now });
  return { selection, shape, facts: new Map(facts.map((entry) => [entry.key, entry])) };
}
