// Which notification threads a sync fetches and digests. Rules only, no IO.
// A user who reads GitHub notifications by email can have a year of unread
// threads; digesting all of them made the first sync take 20+ minutes
// (2026-09-29). Old threads are left alone, and one full sync takes a
// bounded batch, newest first; the rest follow on later syncs.
import { compareHotRank, hotRank, settledSince, wouldKeep, type HotFacts, type HotRank, type HotSelection } from './hot-board.ts';
import { isPrOwner } from './pr-owners.ts';
import type { IsoTime, PrKey, Viewer } from './types.ts';

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

/** A sync candidate with what the hot rules read of its PR: its stored facts, or its thread alone (`threadOnlyFacts`). */
export interface HotSyncThread extends SyncThread {
  facts: HotFacts;
}

export interface HotSyncOptions {
  now: IsoTime;
  viewer: Viewer | null;
  /** The hot set as the store stands: what is on the board, and the busy rule. */
  selection: Pick<HotSelection, 'busy' | 'weakestKept' | 'keys'>;
}

/**
 * Worth a fetch at all: activity in the last SETTLED_DAYS, or, older than
 * that, unread and aimed at the user, or the user's own open PR (stored as
 * theirs, or a thread GitHub gives them as its author). A read thread from
 * three weeks ago on someone else's PR would only go cold again.
 */
function worthFetching(thread: HotSyncThread, rank: HotRank, since: IsoTime, viewer: Viewer | null): boolean {
  const own = thread.facts.thread?.reason === 'author' || (viewer !== null && isPrOwner(thread.facts, viewer.login));
  const ownOpen = own && thread.facts.state === 'OPEN';
  return thread.updatedAt >= since || (thread.unread && rank.tier === 'you') || ownOpen;
}

/**
 * The hot slice of the candidates `selectSyncThreads` picked (DESIGN.md
 * "Big inboxes: what PostPile loads and works on"): every PR on the board
 * (its tile shows the snapshot, so a moved thread is fetched), and of the
 * others only what would be hot (`worthFetching`) and, while the inbox is
 * busy, would make the board (`wouldKeep`: tiers you and team, ranked). In
 * board order: tier, unread first, newest activity first. `shed` are the
 * keys left out, for the log and telemetry.
 */
export function hotSyncThreads<T extends HotSyncThread>(threads: T[], options: HotSyncOptions): { picked: T[]; shed: PrKey[] } {
  const since = settledSince(options.now);
  const ranked: Array<{ thread: T; rank: HotRank }> = [];
  const shed: PrKey[] = [];
  for (const thread of threads) {
    const facts = { ...thread.facts, activityAt: thread.updatedAt > thread.facts.activityAt ? thread.updatedAt : thread.facts.activityAt };
    const rank = hotRank(facts, options.viewer);
    const onBoard = options.selection.keys.has(thread.key);
    if (onBoard || (worthFetching(thread, rank, since, options.viewer) && wouldKeep(options.selection, rank))) {
      ranked.push({ thread, rank });
    } else {
      shed.push(thread.key);
    }
  }
  const picked = ranked.sort((a, b) => compareHotRank(a.rank, b.rank)).map((entry) => entry.thread);
  return { picked, shed };
}
