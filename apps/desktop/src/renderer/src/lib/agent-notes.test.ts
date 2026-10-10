import type { PrNoteView } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { agentNoteLines } from './agent-notes.ts';

const NOW = new Date('2026-10-08T12:00:00Z');

function note(overrides: Partial<PrNoteView> = {}): PrNoteView {
  return {
    id: 'n1',
    kind: 'covered',
    by: 'ph3 session',
    client: 'claude-code',
    note: 'reviewed with the parent',
    coveredBy: 'acme/app#1851',
    coverFetchedAt: '2026-10-08T11:50:00Z',
    coverReviewed: true,
    createdAt: '2026-10-08T11:20:00Z',
    expiresAt: null,
    status: 'live',
    staleReasons: [],
    ...overrides,
  };
}

describe('agentNoteLines', () => {
  it('words the durable note and the lease, and says why one is out of date', () => {
    const lines = agentNoteLines(
      {
        prKey: 'acme/app#1902',
        token: 't',
        durable: note({ status: 'stale', staleReasons: ['head changed'] }),
        lease: note({ id: 'l1', kind: 'in_progress', coveredBy: null, note: 'reviewing', expiresAt: '2026-10-08T13:00:00Z' }),
        replaced: null,
      },
      NOW,
    );
    expect(lines).toMatchObject([
      { noteId: 'n1', text: 'covered by acme/app#1851 · ph3 session · 40m: reviewed with the parent', stale: 'head changed' },
      { noteId: 'l1', text: 'on it now · ph3 session · 40m: reviewing', stale: null },
    ]);
    expect(lines[0]?.title).toBe('Agent note: covered by acme/app#1851 · ph3 session · 40m: reviewed with the parent\nOut of date: head changed');
    expect(lines[1]?.title).toMatch(/^Agent note: on it now · ph3 session · 40m: reviewing\nLease ends at \d\d:\d\d$/);
  });

  it('says a covering PR has no review yet, and that a stale lease was on it', () => {
    const lines = agentNoteLines(
      {
        prKey: 'acme/app#1902',
        token: 't',
        durable: note({ coverReviewed: false }),
        lease: note({ id: 'l1', kind: 'in_progress', coveredBy: null, coverReviewed: null, note: 'reviewing', status: 'stale', staleReasons: ['new review from alice'], expiresAt: '2026-10-08T13:00:00Z' }),
        replaced: null,
      },
      NOW,
    );
    expect(lines.map((line) => line.text)).toEqual(['covered by acme/app#1851 (no review yet) · ph3 session · 40m: reviewed with the parent', 'was on it · ph3 session · 40m: reviewing']);
  });

  it('leaves out an ended lease', () => {
    const lines = agentNoteLines({ prKey: 'acme/app#1902', token: 't', durable: null, lease: note({ kind: 'in_progress', status: 'expired' }), replaced: null }, NOW);
    expect(lines).toEqual([]);
  });
});
