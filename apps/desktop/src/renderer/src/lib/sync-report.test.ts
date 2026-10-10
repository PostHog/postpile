import { describe, expect, it } from 'vitest';
import type { SyncReport } from '@postpile/core';
import { durationLabel, newerReport, phaseTimingsLine, syncReportDetail } from './sync-report.ts';

function report(overrides: Partial<SyncReport>): SyncReport {
  return {
    startedAt: '2026-09-28T10:00:00.000Z',
    finishedAt: '2026-09-28T10:00:12.300Z',
    notificationsNotModified: false,
    threads: 180,
    prsFetched: 160,
    prsSkipped: 0,
    prsPulledIn: 13,
    prsFound: 4,
    newEvents: 6373,
    agentCalls: 0,
    agentCallStats: { total: 0, byKind: {} },
    dossiersUpdated: 0,
    facts: { added: 0, updated: 0, invalidated: 0, confirmed: 0, stale: 0 },
    errors: [],
    ...overrides,
  };
}

describe('durationLabel', () => {
  it('shows seconds, and minutes once past one', () => {
    expect(durationLabel(report({}))).toBe('12.3s');
    expect(durationLabel(report({ finishedAt: '2026-09-28T10:02:05.000Z' }))).toBe('2m 05s');
  });
});

describe('syncReportDetail', () => {
  it('lists counts, agent calls, cap skips and every error', () => {
    const detail = syncReportDetail(
      report({
        agentCallStats: {
          total: 2,
          byKind: {
            topic_assignment: { calls: 2, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 0, durationMs: 0, costUsd: null },
            dossier_update: { calls: 0, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 29, durationMs: 0, costUsd: null },
          },
        },
        errors: ['sync: gh auth token failed', 'found PRs: timeout'],
      }),
    );
    expect(detail).toContain('took 12.3s');
    expect(detail).toContain('Threads in last fetch 180 · PRs fetched 160 · found 4 · pulled in 13 · waiting 0');
    expect(detail).toContain('Agent calls 2:\ntopic_assignment: 2 calls\ndossier_update: 0 calls, 29 skipped by the cap');
    expect(detail).toContain('Skipped by the call cap: 29');
    expect(detail).toContain('Errors (2):\n- sync: gh auth token failed\n- found PRs: timeout');
  });

  it('says so when there were no agent calls and no errors', () => {
    const detail = syncReportDetail(report({ notificationsNotModified: true }));
    expect(detail).toContain('(inbox unchanged)');
    expect(detail).toContain('No agent calls');
    expect(detail).not.toContain('Errors');
  });

  it('says once that the agent was off instead of an error per call', () => {
    const detail = syncReportDetail(report({ agentOff: 'Agent features are off: claude not found' }));
    expect(detail).toContain('Rules only: Agent features are off: claude not found');
    expect(detail).not.toContain('Errors');
  });
});

describe('phaseTimingsLine', () => {
  it('lists phases in sync order and shows up in the detail', () => {
    const phaseMs = { glances: 95_000, fetch: 12_340, topics: 8_000 };
    expect(phaseTimingsLine(phaseMs)).toBe('fetch 12.3s · topics 8.0s · glances 95.0s');
    expect(phaseTimingsLine(undefined)).toBe('');
    expect(syncReportDetail(report({ phaseMs }))).toContain('Phases (overlapping): fetch 12.3s · topics 8.0s · glances 95.0s');
  });
});

describe('newerReport', () => {
  it('takes the later finished report, or whichever exists', () => {
    const early = { finishedAt: '2026-09-29T08:00:00.000Z' } as SyncReport;
    const late = { finishedAt: '2026-09-29T09:00:00.000Z' } as SyncReport;
    expect(newerReport(early, late)).toBe(late);
    expect(newerReport(late, early)).toBe(late);
    expect(newerReport(null, early)).toBe(early);
    expect(newerReport(null, null)).toBeNull();
  });
});
