import { describe, expect, it } from 'vitest';
import { makeFact } from './fixtures.ts';
import { emptyDossier } from './dossier.ts';
import type { DossierView } from './memory-views.ts';
import { formatDossier, formatFacts } from './memory-text.ts';

describe('memory text', () => {
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
        timeline: [{ prKey: 'acme/app#1', role: 'base image' }],
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
    expect(lines).toEqual(['facts:', '  alice works on acme/app#1  (works_on, since 2026-09-01, stale: head_moved)']);
  });
});
