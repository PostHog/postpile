// Which notification threads a sync fetches and digests. Rules only, no IO.
// A user who reads GitHub notifications by email can have a year of unread
// threads; digesting all of them made the first sync take 20+ minutes
// (2026-09-29). Old threads are left alone, and one full sync takes a
// bounded batch, newest first; the rest follow on later syncs.
import type { IsoTime, PrKey } from './types.ts';

/** Threads last updated longer ago than this are never fetched or digested. */
export const SYNC_MAX_AGE_DAYS = 30;

/**
 * PRs one full sync fetches and digests at most; the rest carry over to the
 * next sync. 68 PRs took about a minute on a real first sync, 530 took 8.
 */
export const SYNC_MAX_PRS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SyncThread {
  key: PrKey;
  unread: boolean;
  updatedAt: IsoTime;
}

/** The oldest updatedAt a thread may have and still be picked. */
export function syncCutoff(now: IsoTime, maxAgeDays: number = SYNC_MAX_AGE_DAYS): IsoTime {
  return new Date(new Date(now).getTime() - maxAgeDays * DAY_MS).toISOString();
}

/**
 * The threads worth fetching, in the order to fetch them: one per PR,
 * updated within `maxAgeDays`, with activity after the PR's last fetch
 * (`fetchedAt`), unread first and newest first inside each. A thread that
 * moves again later comes back in on its own.
 */
export function selectSyncThreads<T extends SyncThread>(
  threads: T[],
  fetchedAt: Map<PrKey, IsoTime>,
  now: IsoTime,
  maxAgeDays: number = SYNC_MAX_AGE_DAYS,
): T[] {
  const cutoff = syncCutoff(now, maxAgeDays);
  const byNewest = [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const ordered = [...byNewest.filter((thread) => thread.unread), ...byNewest.filter((thread) => !thread.unread)];
  const seen = new Set<PrKey>();
  const result: T[] = [];
  for (const thread of ordered) {
    if (seen.has(thread.key)) {
      continue;
    }
    seen.add(thread.key);
    if (thread.updatedAt < cutoff) {
      continue;
    }
    const lastFetch = fetchedAt.get(thread.key);
    if (lastFetch !== undefined && lastFetch >= thread.updatedAt) {
      continue;
    }
    result.push(thread);
  }
  return result;
}
