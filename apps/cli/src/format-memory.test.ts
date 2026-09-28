import { describe, expect, it } from 'vitest';
import { emptyAgentCallStats, emptyDossier, recordAgentCall, type DossierView } from '@postpile/core';
import { makeFact } from '@postpile/core/fixtures';
import { formatCallStats, formatDossier, formatFacts } from './format-memory.ts';

describe('memory formatting', () => {
  it('prints call stats per kind with skips, retries and cost', () => {
    const stats = emptyAgentCallStats();
    recordAgentCall(stats, { kind: 'glance_batch', outcome: 'ok', costUsd: 0.05 });
    recordAgentCall(stats, { kind: 'glance_batch', outcome: 'ok', attempt: 2, costUsd: 0.02 });
    recordAgentCall(stats, { kind: 'dossier_update', outcome: 'ok', costUsd: 0.05 });
    recordAgentCall(stats, { kind: 'dossier_update', outcome: 'skipped_unchanged' });

    expect(formatCallStats(stats)).toBe('dossier_update 1 (1 skipped unchanged)  glance_batch 2 (1 retry)  total 3, $0.12');
    expect(formatCallStats(emptyAgentCallStats())).toBe('total 0');
  });

  it('prints a dossier with stale claims and changes since seen', () => {
    const view: DossierView = {
      version: 3,
      createdAt: '2026-09-20T10:00:00.000Z',
      dossier: {
        ...emptyDossier(),
        goal: 'Run CI on Depot',
        status: 'blocked',
        statusNote: 'waiting on the runner image',
        people: [{ login: 'alice', role: 'driver', note: 'owns the rollout' }],
        openQuestions: [{ text: 'Keep GitHub runners for releases?', askedBy: 'carol', refs: [] }],
        timeline: [{ prKey: 'PostHog/posthog#1', role: 'base image' }],
      },
      flags: [{ kind: 'needs_user', text: 'Your review blocks the image PR', prKey: null }],
      staleClaims: [{ path: 'openQuestions[0]', reason: 'thread_resolved' }],
      changesSinceSeen: {
        since: '2026-09-18T00:00:00.000Z',
        fromVersion: 2,
        changes: [{ at: '2026-09-19T00:00:00.000Z', text: 'image PR opened', refs: [] }],
        factsAdded: [],
        factsClosed: [],
        newEvents: 4,
      },
      eventsBehind: 2,
      history: [],
      correctedClaims: [],
      fixedClaims: [],
    };

    const text = formatDossier(view).join('\n');

    expect(text).toContain('dossier v3 (2026-09-20, 2 events not read yet)');
    expect(text).toContain('status: blocked - waiting on the runner image');
    expect(text).toContain('people: @alice driver (owns the rollout)');
    expect(text).toContain('? Keep GitHub runners for releases? (asked by @carol)  [stale: thread_resolved]');
    expect(text).toContain('! needs_user: Your review blocks the image PR');
    expect(text).toContain('since you last looked (2026-09-18): 4 new events');
    expect(text).toContain('  - 2026-09-19 image PR opened');
  });

  it('prints facts with their staleness', () => {
    const lines = formatFacts([{ fact: makeFact(), stale: 'head_moved', recheckable: false }]);
    expect(lines).toEqual(['facts:', '  alice works on PostHog/posthog#1  (works_on, since 2026-09-01, stale: head_moved)']);
  });
});
