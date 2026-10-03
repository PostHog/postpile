import { describe, expect, it } from 'vitest';
import {
  catchUpReason,
  cleanupCounts,
  cleanupDialogSetup,
  cleanupOption,
  cleanupOptions,
  planCleanup,
  startCase,
  type CleanupThread,
  type StartCaseInput,
} from './inbox-cleanup.ts';

const NOW = '2026-09-28T12:00:00.000Z';

function daysAgo(days: number): string {
  return new Date(new Date(NOW).getTime() - days * 24 * 3_600_000).toISOString();
}

function thread(id: string, days: number, overrides: Partial<CleanupThread> = {}): CleanupThread {
  return { id, repo: 'acme/app', updatedAt: daysAgo(days), merged: false, withoutReview: false, glanced: false, ...overrides };
}

function merged(id: string, days: number, overrides: Partial<CleanupThread> = {}): CleanupThread {
  return thread(id, days, { merged: true, ...overrides });
}

describe('inbox cleanup counts', () => {
  it('counts merged PRs by last activity and everything else by age, without overlap', () => {
    const threads = [
      merged('m1', 1),
      merged('m2', 9, { withoutReview: true }),
      merged('m3', 20),
      thread('open-old', 20),
      thread('issue-older', 40, { repo: 'acme/docs' }),
      thread('fresh', 2),
    ];
    expect(cleanupCounts(threads, NOW)).toEqual({
      unread: 6,
      mergedQuiet7: 2,
      mergedQuiet14: 1,
      mergedAll: 3,
      mergedWithoutReview: 1,
      olderThan14: 2,
      olderThan30: 1,
    });
  });
});

describe('inbox cleanup write plan', () => {
  it('sends the older-than PUT, a repo PUT where the repo holds nothing else, and PATCHes for the rest', () => {
    const threads = [
      // acme/app: merged and old ones only, all selected below.
      merged('a1', 3),
      merged('a2', 4),
      thread('a3', 40),
      // acme/web: one merged PR next to an open one that stays.
      merged('w1', 3, { repo: 'acme/web' }),
      thread('w2', 1, { repo: 'acme/web' }),
      // An old merged PR: the older-than PUT covers it.
      merged('w3', 50, { repo: 'acme/web', glanced: true }),
    ];
    const plan = planCleanup(threads, { merged: 'all', older: 30 }, NOW);
    expect(plan).toMatchObject({
      readBefore: daysAgo(30),
      readBeforeCovers: 2,
      repos: [{ repo: 'acme/app', covers: 2 }],
      threadIds: ['w1'],
      clears: 5,
      mergedClears: 4,
      glancesSaved: 1,
    });
  });

  it('leaves threads with activity after the count out, and a repo-wide PUT up to the count leaves them unread', () => {
    const later = new Date(new Date(NOW).getTime() + 60_000).toISOString();
    const threads = [merged('a1', 3), merged('a2', 4), { ...merged('a3', 0), updatedAt: later }];
    const plan = planCleanup(threads, { merged: 'all', older: null }, NOW);
    expect(plan).toMatchObject({ readBefore: null, repos: [{ repo: 'acme/app', covers: 2 }], threadIds: [], clears: 2 });
  });

  it('counts the merged threads the older-than PUT reads even when the merged row is off', () => {
    const threads = [merged('m1', 20), merged('m2', 2), thread('t1', 20), thread('t2', 1)];
    const options = cleanupOptions(threads, NOW);
    expect(cleanupOption(options, { merged: null, older: 14 })).toMatchObject({ clears: 2, bulkCalls: 1, threadCalls: 0 });
    expect(cleanupOption(options, { merged: 'quiet7', older: null })).toMatchObject({ clears: 1, bulkCalls: 0, threadCalls: 1 });
  });
});

describe('inbox cleanup cases', () => {
  const base: StartCaseInput = { reason: null, now: NOW, unread: 120, mergedUnread: 40, answeredMerged: null };

  it('notes a first run and a gap of two days or more', () => {
    expect(catchUpReason(null, NOW)).toEqual({ kind: 'first_run' });
    expect(catchUpReason(daysAgo(2), NOW)).toEqual({ kind: 'away', since: daysAgo(2) });
    expect(catchUpReason(daysAgo(1.5), NOW)).toBeNull();
  });

  it('picks the case from the reason, the load and the merged count', () => {
    expect(startCase(base)).toBeNull();
    expect(startCase({ ...base, reason: { kind: 'first_run' }, mergedUnread: 19 })).toBeNull();
    expect(startCase({ ...base, reason: { kind: 'first_run' }, unread: 38, mergedUnread: 24 })).toEqual({ kind: 'first_run', load: 'light' });
    expect(startCase({ ...base, reason: { kind: 'first_run' } })).toEqual({ kind: 'first_run', load: 'busy' });
    expect(startCase({ ...base, reason: { kind: 'first_run' }, unread: 640 })).toEqual({ kind: 'first_run', load: 'full' });
    expect(startCase({ ...base, reason: { kind: 'away', since: daysAgo(3) } })).toEqual({ kind: 'weekend', since: daysAgo(3) });
    expect(startCase({ ...base, reason: { kind: 'away', since: daysAgo(12) } })).toEqual({ kind: 'vacation', since: daysAgo(12), awayDays: 12 });
  });

  it('asks again after "Start as usual" only once 20 more merged PRs piled up, or after a vacation', () => {
    const weekend = { ...base, reason: { kind: 'away' as const, since: daysAgo(3) }, answeredMerged: 30 };
    expect(startCase({ ...weekend, mergedUnread: 49 })).toBeNull();
    expect(startCase({ ...weekend, mergedUnread: 50 })).toMatchObject({ kind: 'weekend' });
    expect(startCase({ ...weekend, reason: { kind: 'away', since: daysAgo(6) }, mergedUnread: 31 })).toMatchObject({ kind: 'vacation' });
  });

  it('preselects per case and falls back when a merged option is empty or the same as All', () => {
    const counts = cleanupCounts([merged('m1', 1), merged('m2', 9), merged('m3', 20), thread('t1', 20), thread('t2', 40)], NOW);
    expect(cleanupDialogSetup({ kind: 'weekend', since: daysAgo(3) }, counts)).toEqual({
      picks: { merged: 'quiet7', older: null },
      main: 'start',
      recommended: false,
      saving: false,
    });
    expect(cleanupDialogSetup({ kind: 'first_run', load: 'full' }, counts)).toEqual({
      picks: { merged: 'all', older: 30 },
      main: 'clear',
      recommended: true,
      saving: true,
    });
    expect(cleanupDialogSetup({ kind: 'sidebar' }, counts)).toMatchObject({ picks: { merged: 'all', older: 14 }, main: 'clear' });
    // Every merged PR quiet 7+ days: that option equals All, so the smallest one with something in it wins.
    const allQuiet = cleanupCounts([merged('m1', 9), merged('m2', 20)], NOW);
    expect(cleanupDialogSetup({ kind: 'weekend', since: daysAgo(3) }, allQuiet).picks).toEqual({ merged: 'quiet14', older: null });
    // Nothing old outside merged PRs: the older row starts unticked.
    expect(cleanupDialogSetup({ kind: 'vacation', since: daysAgo(9), awayDays: 9 }, allQuiet).picks).toEqual({ merged: 'all', older: null });
  });
});
