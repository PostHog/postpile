import { describe, expect, it } from 'vitest';
import type { SyncProgress } from '@postpile/core';
import { elapsedLabel, syncProgressDetail, syncProgressText } from './sync-progress.ts';

const STARTED = '2026-09-28T10:00:00.000Z';

function progress(overrides: Partial<SyncProgress>): SyncProgress {
  return { startedAt: STARTED, running: ['dossiers', 'glances'], agentCallsDone: 34, agentCallsPlanned: 82, ...overrides };
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

  it('shows calls done over calls planned so far, and the time', () => {
    expect(syncProgressText(progress({}), now)).toBe('syncing · agent 34/82 · 2m');
  });

  it('names the phase before any call is planned', () => {
    expect(syncProgressText(progress({ running: ['fetch'], agentCallsDone: 0, agentCallsPlanned: 0 }), now)).toBe(
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
  });
});
