import { describe, expect, it } from 'vitest';
import { emptyAgentCallStats, type SyncProgress } from '@postpile/core';
import { elapsedLabel, syncProgressDetail, syncProgressText } from './sync-progress.ts';

const STARTED = '2026-09-28T10:00:00.000Z';

function progress(overrides: Partial<SyncProgress>): SyncProgress {
  return {
    startedAt: STARTED,
    running: ['dossiers', 'glances'],
    agentCallsDone: 34,
    agentCallsPlanned: 82,
    fromGitHub: { prsFetched: 3, newEvents: 8 },
    prsRead: null,
    agentCallStats: emptyAgentCallStats(),
    ...overrides,
  };
}

describe('elapsedLabel', () => {
  it('shows seconds, then whole minutes, then hours', () => {
    expect(elapsedLabel(STARTED, new Date('2026-09-28T10:00:45.900Z'))).toBe('45s');
    expect(elapsedLabel(STARTED, new Date('2026-09-28T10:02:59.000Z'))).toBe('2m');
    expect(elapsedLabel(STARTED, new Date('2026-09-28T11:05:00.000Z'))).toBe('1h 05m');
    expect(elapsedLabel(STARTED, new Date('2026-09-28T09:59:00.000Z'))).toBe('0s');
  });
});

describe('syncProgressText', () => {
  const now = new Date('2026-09-28T10:02:10.000Z');

  it('says what GitHub brought, then calls done over calls planned so far, and the time', () => {
    expect(syncProgressText(progress({}), now)).toBe('syncing · 8 new on GitHub · agent calls 34 of 82 so far · 2m');
  });

  it('says PRs were updated when GitHub changed them without a new event', () => {
    expect(syncProgressText(progress({ fromGitHub: { prsFetched: 2, newEvents: 0 } }), now)).toBe(
      'syncing · 2 PRs updated on GitHub · agent calls 34 of 82 so far · 2m',
    );
    expect(syncProgressDetail(progress({ fromGitHub: { prsFetched: 1, newEvents: 0 } }))).toContain('GitHub: 1 PR updated');
  });

  it('says nothing new on GitHub when the poll already stored everything', () => {
    expect(syncProgressText(progress({ fromGitHub: { prsFetched: 0, newEvents: 0 } }), now)).toBe(
      'syncing · nothing new on GitHub · agent calls 34 of 82 so far · 2m',
    );
  });

  it('names the phase before any call is planned', () => {
    expect(syncProgressText(progress({ running: ['fetch'], agentCallsDone: 0, agentCallsPlanned: 0, fromGitHub: null }), now)).toBe(
      'syncing · fetching GitHub · 2m',
    );
  });

  it('falls back to a plain label before the engine reports anything', () => {
    expect(syncProgressText(null, now)).toBe('syncing…');
    expect(syncProgressText(undefined, now)).toBe('syncing…');
  });
});

describe('syncProgressDetail', () => {
  it('lists the running phases and says the total can grow', () => {
    const detail = syncProgressDetail(progress({}));
    expect(detail).toContain('Running: dossiers, glances');
    expect(detail).toContain('34 done of 82 planned so far');
    expect(detail).toContain('GitHub: 8 new events on 3 PRs.');
  });

  it('explains agent work without news, and lists the calls per kind', () => {
    const stats = emptyAgentCallStats();
    stats.total = 5;
    stats.byKind.dossier_update = { calls: 5, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 0, durationMs: 0, costUsd: 0 };
    const detail = syncProgressDetail(progress({ fromGitHub: { prsFetched: 0, newEvents: 0 }, agentCallStats: stats }));
    expect(detail).toContain('GitHub: nothing new. The agent works on what the live poll already stored');
    expect(detail).toContain('dossier_update: 5 calls');
  });

  it('says GitHub is still being fetched', () => {
    expect(syncProgressDetail(progress({ fromGitHub: null }))).toContain('GitHub: fetching');
  });
});
