// Inbox catch-up (DESIGN.md "Inbox cleanup"). Unread GitHub threads on
// merged PRs keep tiles from being done and topics from archiving, and old
// notifications pile up after a vacation or on a first run. The dialog offers
// to clear both on GitHub, before the start sync spends agent work on PRs
// that are over. Rules only, no IO; the engine and FakeEngine call the same
// functions.
import type { IsoTime } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The "everything else, no activity for" cutoffs. */
export type CleanupAge = 14 | 30;

/** Which merged PRs: quiet (no activity) for 7 or 14 days, or all of them. */
export type MergedPick = 'quiet7' | 'quiet14' | 'all';

export const MERGED_PICKS: MergedPick[] = ['quiet7', 'quiet14', 'all'];
export const OLDER_PICKS: CleanupAge[] = [14, 30];

/** The start dialog shows only with at least this many unread merged PRs. */
export const CATCH_UP_MERGED_THRESHOLD = 20;
/** First-run load: fewer unread threads than this is light. */
export const CATCH_UP_BUSY_LOAD = 50;
/** First-run load: more unread threads than this is full. */
export const CATCH_UP_FULL_LOAD = 300;
/** A sync this many days after the previous one counts as coming back. */
export const CATCH_UP_BACK_DAYS = 2;
/** A gap this long (vacation) preselects more and ignores an earlier "Start as usual". */
export const CLEANUP_GAP_DAYS = 5;
/** Pause between two per-thread mark-reads: GitHub asks for about one write per second. */
export const CATCH_UP_PACE_MS = 1000;

/** What the dialog's two rows ask for; null leaves a row out. */
export interface CleanupPicks {
  merged: MergedPick | null;
  older: CleanupAge | null;
}

/** An unread GitHub thread as the catch-up sees it. */
export interface CleanupThread {
  id: string;
  /** owner/name. */
  repo: string;
  /** Last activity on the thread. */
  updatedAt: IsoTime;
  /** A PR PostPile fetched and knows is merged. A merged PR it never fetched (PR cap) does not count as merged. */
  merged: boolean;
  /** Merged with an unseen merged_without_review event ("Merged without your review"). */
  withoutReview: boolean;
  /** The coming sync would glance this PR. Clearing a merged one ends that; an open one is glanced anyway. */
  glanced: boolean;
}

export interface CleanupCounts {
  /** Every unread thread: the inbox load. */
  unread: number;
  mergedQuiet7: number;
  mergedQuiet14: number;
  mergedAll: number;
  /** Merged PRs among mergedAll still holding an unseen merge without the user's review. */
  mergedWithoutReview: number;
  /** Unread threads that are not merged PRs, with no activity for 14 / 30 days. */
  olderThan14: number;
  olderThan30: number;
}

/**
 * The GitHub calls for one set of picks (no batch endpoint exists):
 * - `readBefore`: one PUT /notifications with that last_read_at;
 * - `repos`: one PUT /repos/{repo}/notifications each, last_read_at = `at`,
 *   for repos whose every unread thread is in the selection;
 * - `threadIds`: one PATCH per thread for the rest, oldest first.
 */
export interface CleanupPlan {
  /** When the dialog counted: no thread with later activity is selected, and repo calls never read past it. */
  at: IsoTime;
  readBefore: IsoTime | null;
  /** Selected threads the older-than PUT covers. */
  readBeforeCovers: number;
  repos: { repo: string; covers: number }[];
  threadIds: string[];
  /** Every thread the plan marks read on GitHub. */
  selectedIds: string[];
  /** How many that is. */
  clears: number;
  /** Merged PRs among them. */
  mergedClears: number;
  /** Glances the coming sync no longer needs: merged PRs it would have glanced. */
  glancesSaved: number;
}

/** One combination of picks with what it clears, for the button, the timing line and the saving line. */
export interface CleanupOption extends CleanupPicks {
  clears: number;
  /** PUT calls: everything older plus one per repo. */
  bulkCalls: number;
  /** PATCH calls, sent one per CATCH_UP_PACE_MS. */
  threadCalls: number;
  glancesSaved: number;
}

/** Why the start dialog may be due, kept from the sync start until it is answered. */
export type CatchUpReason = { kind: 'first_run' } | { kind: 'away'; since: IsoTime };

export type InboxLoad = 'light' | 'busy' | 'full';

/** The start dialog's case. */
export type StartCase =
  | { kind: 'weekend'; since: IsoTime }
  | { kind: 'vacation'; since: IsoTime; awayDays: number }
  | { kind: 'first_run'; load: InboxLoad };

/** Where the dialog opened: on start (one of the cases) or from the sidebar line. */
export type CleanupDialogMode = StartCase | { kind: 'sidebar' };

/** Preselection and buttons for one dialog mode. */
export interface CleanupDialogSetup {
  picks: CleanupPicks;
  /** Which button is primary and gets Enter. */
  main: 'clear' | 'start';
  /** Clear carries a Recommended tag. */
  recommended: boolean;
  /** The green "Clearing first means the agent reads N PRs instead of M" line may show. */
  saving: boolean;
}

/** The background run while it clears. */
export interface CleanupProgress {
  done: number;
  total: number;
  /** The run clears merged PRs ("Clearing merged PRs"), else only old notifications. */
  merged: boolean;
}

/** The last run that ended, for the done toast. */
export interface CleanupRunResult {
  id: string;
  marked: number;
  failed: number;
  at: IsoTime;
}

/** GET /api/inbox-cleanup. */
export interface InboxCleanupView {
  /** When this was counted; a clear sends it back so nothing newer is read. */
  countedAt: IsoTime;
  counts: CleanupCounts;
  /** PRs the coming sync would glance: M of the saving line. */
  glances: number;
  /** Every combination of picks (merged row off or one of MERGED_PICKS, times older row off, 14 or 30). */
  options: CleanupOption[];
  /** The start dialog is due, and why. Null otherwise. */
  start: StartCase | null;
  running: CleanupProgress | null;
  lastRun: CleanupRunResult | null;
  /** A cleanup waits in the writes lock. */
  pending: boolean;
}

/** POST /api/inbox-cleanup/clear. */
export interface CleanupRequest extends CleanupPicks {
  countedAt: IsoTime;
  from: 'start' | 'sidebar';
}

export function daysBefore(now: IsoTime, days: number): IsoTime {
  return new Date(new Date(now).getTime() - days * DAY_MS).toISOString();
}

/** The last_read_at a "no activity for N days" pick sends. */
export function cleanupCutoff(now: IsoTime, age: CleanupAge): IsoTime {
  return daysBefore(now, age);
}

/** Unread threads with no activity since `cutoff`. */
export function unreadOlderThan(threads: { unread: boolean; updatedAt: IsoTime }[], cutoff: IsoTime): number {
  return threads.filter((thread) => thread.unread && thread.updatedAt < cutoff).length;
}

function mergedQuietDays(pick: MergedPick): number | null {
  if (pick === 'quiet7') {
    return 7;
  }
  return pick === 'quiet14' ? 14 : null;
}

/** Quiet means no activity on the thread for that long, not the merge date. */
function isMergedPicked(thread: CleanupThread, pick: MergedPick, at: IsoTime): boolean {
  const days = mergedQuietDays(pick);
  return thread.merged && (days === null || thread.updatedAt < daysBefore(at, days));
}

export function cleanupCounts(threads: CleanupThread[], at: IsoTime): CleanupCounts {
  const merged = threads.filter((thread) => thread.merged);
  const others = threads.filter((thread) => !thread.merged);
  return {
    unread: threads.length,
    mergedQuiet7: merged.filter((thread) => isMergedPicked(thread, 'quiet7', at)).length,
    mergedQuiet14: merged.filter((thread) => isMergedPicked(thread, 'quiet14', at)).length,
    mergedAll: merged.length,
    mergedWithoutReview: merged.filter((thread) => thread.withoutReview).length,
    olderThan14: others.filter((thread) => thread.updatedAt < cleanupCutoff(at, 14)).length,
    olderThan30: others.filter((thread) => thread.updatedAt < cleanupCutoff(at, 30)).length,
  };
}

/**
 * The threads a set of picks marks read: the picked merged PRs, plus every
 * thread older than the "everything else" cutoff. The PUT for that cutoff
 * reads merged threads that old too, whatever the merged row says, so they
 * count. Nothing with activity after `at`.
 */
function selectedThreads(threads: CleanupThread[], picks: CleanupPicks, at: IsoTime): CleanupThread[] {
  const readBefore = picks.older === null ? null : cleanupCutoff(at, picks.older);
  return threads.filter((thread) => {
    if (thread.updatedAt > at) {
      return false;
    }
    const merged = picks.merged !== null && isMergedPicked(thread, picks.merged, at);
    return merged || (readBefore !== null && thread.updatedAt < readBefore);
  });
}

/** Repos whose every unread thread up to `at` is selected: one repo-wide PUT covers them. */
function fullySelectedRepos(threads: CleanupThread[], selected: Set<string>, at: IsoTime): Set<string> {
  const repos = new Set<string>();
  const partial = new Set<string>();
  for (const thread of threads) {
    if (thread.updatedAt > at) {
      continue;
    }
    if (selected.has(thread.id)) {
      repos.add(thread.repo);
    } else {
      partial.add(thread.repo);
    }
  }
  return new Set([...repos].filter((repo) => !partial.has(repo)));
}

/**
 * The write plan for a set of picks over the unread threads (DESIGN.md
 * "Inbox cleanup" › Writes): the older-than PUT first, then repo PUTs where
 * a repo holds nothing else, then one PATCH per remaining thread.
 */
export function planCleanup(threads: CleanupThread[], picks: CleanupPicks, at: IsoTime): CleanupPlan {
  const selected = selectedThreads(threads, picks, at);
  const readBefore = picks.older === null ? null : cleanupCutoff(at, picks.older);
  const remaining = selected.filter((thread) => readBefore === null || thread.updatedAt >= readBefore);
  const wholeRepos = fullySelectedRepos(threads, new Set(selected.map((thread) => thread.id)), at);
  const repoNames = [...new Set(remaining.map((thread) => thread.repo))].filter((repo) => wholeRepos.has(repo)).sort();
  const threadIds = remaining
    .filter((thread) => !wholeRepos.has(thread.repo))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((thread) => thread.id);
  return {
    at,
    readBefore,
    readBeforeCovers: selected.length - remaining.length,
    repos: repoNames.map((repo) => ({ repo, covers: remaining.filter((thread) => thread.repo === repo).length })),
    threadIds,
    selectedIds: selected.map((thread) => thread.id),
    clears: selected.length,
    mergedClears: selected.filter((thread) => thread.merged).length,
    glancesSaved: selected.filter((thread) => thread.merged && thread.glanced).length,
  };
}

/** Every combination of picks, in a fixed order: merged off, quiet7, quiet14, all; within each older off, 14, 30. */
export function cleanupOptions(threads: CleanupThread[], at: IsoTime): CleanupOption[] {
  const options: CleanupOption[] = [];
  for (const merged of [null, ...MERGED_PICKS]) {
    for (const older of [null, ...OLDER_PICKS]) {
      const plan = planCleanup(threads, { merged, older }, at);
      options.push({
        merged,
        older,
        clears: plan.clears,
        bulkCalls: (plan.readBefore === null ? 0 : 1) + plan.repos.length,
        threadCalls: plan.threadIds.length,
        glancesSaved: plan.glancesSaved,
      });
    }
  }
  return options;
}

/** "merged PRs and everything older than 14 days", for the lock's list and the log. */
export function cleanupPicksWords(picks: CleanupPicks): string {
  const merged = picks.merged === null ? null : picks.merged === 'all' ? 'merged PRs' : `merged PRs quiet ${mergedQuietDays(picks.merged)}+ days`;
  const older = picks.older === null ? null : `everything older than ${picks.older} days`;
  return [merged, older].filter((part) => part !== null).join(' and ');
}

/** The option for these picks. */
export function cleanupOption(options: CleanupOption[], picks: CleanupPicks): CleanupOption | null {
  return options.find((option) => option.merged === picks.merged && option.older === picks.older) ?? null;
}

/** A merged option holding nothing, or the same as All, is disabled. All never is. */
export function mergedPickEnabled(pick: MergedPick, counts: CleanupCounts): boolean {
  if (pick === 'all') {
    return true;
  }
  const count = pick === 'quiet7' ? counts.mergedQuiet7 : counts.mergedQuiet14;
  return count > 0 && count !== counts.mergedAll;
}

/** Noted at each sync start: a first run, or the first sync after CATCH_UP_BACK_DAYS or more. */
export function catchUpReason(previousSyncAt: IsoTime | null, now: IsoTime): CatchUpReason | null {
  if (previousSyncAt === null) {
    return { kind: 'first_run' };
  }
  const gap = new Date(now).getTime() - new Date(previousSyncAt).getTime();
  return gap >= CATCH_UP_BACK_DAYS * DAY_MS ? { kind: 'away', since: previousSyncAt } : null;
}

export function inboxLoad(unread: number): InboxLoad {
  if (unread < CATCH_UP_BUSY_LOAD) {
    return 'light';
  }
  return unread > CATCH_UP_FULL_LOAD ? 'full' : 'busy';
}

export interface StartCaseInput {
  reason: CatchUpReason | null;
  now: IsoTime;
  unread: number;
  mergedUnread: number;
  /** Unread merged PRs left when the start dialog was last answered; null when it never was. */
  answeredMerged: number | null;
}

/**
 * Whether the start dialog shows, and as which case. Never below
 * CATCH_UP_MERGED_THRESHOLD merged PRs. After a "Start as usual" a short
 * absence asks again only once that many more merged PRs piled up; a
 * vacation or a first run asks anyway.
 */
export function startCase(input: StartCaseInput): StartCase | null {
  const { reason } = input;
  if (reason === null || input.mergedUnread < CATCH_UP_MERGED_THRESHOLD) {
    return null;
  }
  if (reason.kind === 'first_run') {
    return { kind: 'first_run', load: inboxLoad(input.unread) };
  }
  const awayDays = Math.floor((new Date(input.now).getTime() - new Date(reason.since).getTime()) / DAY_MS);
  if (awayDays >= CLEANUP_GAP_DAYS) {
    return { kind: 'vacation', since: reason.since, awayDays };
  }
  if (input.answeredMerged !== null && input.mergedUnread < input.answeredMerged + CATCH_UP_MERGED_THRESHOLD) {
    return null;
  }
  return { kind: 'weekend', since: reason.since };
}

/** The preferred merged pick, or the smallest enabled one that holds something (All otherwise). */
function mergedPickFor(preferred: MergedPick, counts: CleanupCounts): MergedPick {
  if (mergedPickEnabled(preferred, counts)) {
    return preferred;
  }
  const fallback = (['quiet14', 'quiet7'] as const).find((pick) => mergedPickEnabled(pick, counts));
  return fallback ?? 'all';
}

function setup(picks: CleanupPicks, main: 'clear' | 'start', options: { recommended?: boolean; saving?: boolean } = {}): CleanupDialogSetup {
  return { picks, main, recommended: options.recommended ?? false, saving: options.saving ?? false };
}

function setupForMode(mode: CleanupDialogMode, counts: CleanupCounts): CleanupDialogSetup {
  switch (mode.kind) {
    case 'weekend':
      return setup({ merged: mergedPickFor('quiet7', counts), older: null }, 'start');
    case 'vacation':
      return setup({ merged: 'all', older: 14 }, 'clear', { saving: true });
    case 'first_run':
      if (mode.load === 'light') {
        return setup({ merged: mergedPickFor('quiet14', counts), older: null }, 'start');
      }
      if (mode.load === 'busy') {
        return setup({ merged: 'all', older: null }, 'clear', { saving: true });
      }
      return setup({ merged: 'all', older: 30 }, 'clear', { recommended: true, saving: true });
    case 'sidebar':
      return setup({ merged: 'all', older: 14 }, 'clear');
    default: {
      const never: never = mode;
      return never;
    }
  }
}

/** Preselection and main button per case (DESIGN.md "Inbox cleanup" › Cases). A row with nothing in it starts unticked. */
export function cleanupDialogSetup(mode: CleanupDialogMode, counts: CleanupCounts): CleanupDialogSetup {
  const result = setupForMode(mode, counts);
  const olderCount = result.picks.older === 30 ? counts.olderThan30 : counts.olderThan14;
  return {
    ...result,
    picks: {
      merged: counts.mergedAll === 0 ? null : result.picks.merged,
      older: result.picks.older !== null && olderCount === 0 ? null : result.picks.older,
    },
  };
}
