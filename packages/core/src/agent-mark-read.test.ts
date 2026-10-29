import { describe, expect, it } from 'vitest';
import { AgentReadNotices, agentMarkReadCheck, newActivityReason, parseSeenThrough, seenThroughToken, unreadIdsHash, type AgentMarkReadInput } from './agent-mark-read.ts';
import { parseAgentRequest } from './agent-requests.ts';

const UNREAD = unreadIdsHash(['e1', 'e2']);
const BASE: AgentMarkReadInput = {
  stored: true,
  tracked: true,
  seenThrough: { seq: 40, unreadHash: UNREAD },
  unreadHashNow: UNREAD,
  newestSeq: 40,
  newer: [],
  snapshotBehind: false,
  alreadyQueued: false,
  changesAnything: true,
};

describe('agentMarkReadCheck', () => {
  it('marks a tracked PR with nothing logged after seen_through', () => {
    expect(agentMarkReadCheck(BASE)).toEqual({ kind: 'mark' });
  });

  it('refuses a PR with newer activity, saying how much and from whom', () => {
    const newer = [
      { actor: 'bob', at: '2026-10-29T10:00:00Z' },
      { actor: 'alice', at: '2026-10-29T11:00:00Z' },
    ];
    expect(agentMarkReadCheck({ ...BASE, newestSeq: 42, newer })).toEqual({
      kind: 'refused',
      reason: 'new activity since you read it: 2 events; read it again with pr_context',
    });
  });

  it('marks when the only events logged since are gone (a deleted comment)', () => {
    expect(agentMarkReadCheck({ ...BASE, newestSeq: 41 })).toEqual({ kind: 'mark' });
  });

  it('refuses a seen_through ahead of the log and a PR PostPile does not store', () => {
    expect(agentMarkReadCheck({ ...BASE, seenThrough: { seq: 99, unreadHash: UNREAD } })).toMatchObject({ kind: 'refused', reason: expect.stringContaining('not one pr_context printed') });
    expect(agentMarkReadCheck({ ...BASE, seenThrough: null })).toMatchObject({ kind: 'refused', reason: expect.stringContaining('not one pr_context printed') });
    expect(agentMarkReadCheck({ ...BASE, stored: false })).toEqual({ kind: 'refused', reason: 'PostPile does not track this PR' });
  });

  it('skips a pulled-in stack layer and a PR already read', () => {
    expect(agentMarkReadCheck({ ...BASE, tracked: false })).toMatchObject({ kind: 'skipped', reason: expect.stringContaining('stack layer') });
    expect(agentMarkReadCheck({ ...BASE, changesAnything: false })).toEqual({ kind: 'skipped', reason: 'already read' });
  });

  it('refuses a PR whose notification moved past the stored snapshot', () => {
    expect(agentMarkReadCheck({ ...BASE, snapshotBehind: true })).toEqual({
      kind: 'refused',
      reason: 'PostPile has newer activity than it fetched; call refresh_from_github, then read it again',
    });
  });

  it('skips a PR whose mark-read already waits, so a retry adds no second batch', () => {
    expect(agentMarkReadCheck({ ...BASE, alreadyQueued: true })).toEqual({ kind: 'skipped', reason: 'already queued to mark read' });
  });

  it('refuses when the unread list changed under the token, e.g. an Undo brought events back unseen', () => {
    expect(agentMarkReadCheck({ ...BASE, unreadHashNow: unreadIdsHash(['e1', 'e2', 'e0']) })).toEqual({ kind: 'refused', reason: 'the unread list changed since you read it; read it again' });
  });

  it('words one event in the singular', () => {
    expect(newActivityReason([{ actor: 'bob', at: '2026-10-29T10:00:00Z' }])).toBe('new activity since you read it: 1 event; read it again with pr_context');
  });
});

describe('parseAgentRequest: mark_read', () => {
  function request(payload: unknown): string {
    return JSON.stringify({ v: 1, kind: 'mark_read', createdAt: '2026-10-29T10:00:00Z', expiresAt: '2026-10-29T10:02:00Z', client: 'claude-code', payload });
  }

  it('takes one to 20 PRs with a seen_through each', () => {
    const check = parseAgentRequest(request({ prs: [{ prKey: 'acme/app#1902', seenThrough: '12-abc' }] }));
    expect(check).toMatchObject({ ok: true, request: { kind: 'mark_read', payload: { prs: [{ prKey: 'acme/app#1902', seenThrough: '12-abc' }] } } });
  });

  it('refuses an empty list, more than 20 PRs, a missing, numeric or empty seen_through and extra fields', () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ prKey: `acme/app#${index + 1}`, seenThrough: 1 }));
    for (const payload of [
      { prs: [] },
      { prs: many },
      { prs: [{ prKey: 'acme/app#1902' }] },
      { prs: [{ prKey: 'acme/app#1902', seenThrough: 12 }] },
      { prs: [{ prKey: 'acme/app#1902', seenThrough: '' }] },
      { prs: [{ prKey: 'not a key', seenThrough: 1 }] },
      { prs: [{ prKey: 'acme/app#1902', seenThrough: 1 }], everything: true },
    ]) {
      expect(parseAgentRequest(request(payload))).toMatchObject({ ok: false, error: expect.stringContaining('bad mark_read payload') });
    }
  });
});

describe('seen_through tokens', () => {
  it('round-trips the seq and the unread hash, order of ids aside', () => {
    const token = seenThroughToken(4127, ['e2', 'e1']);
    expect(token).toMatch(/^4127-[0-9a-z]+$/);
    expect(parseSeenThrough(token)).toEqual({ seq: 4127, unreadHash: unreadIdsHash(['e1', 'e2']) });
  });

  it('reads nothing else as a token', () => {
    for (const text of ['4127', 'abc-def', '-x', '12-ABC', '1-a b']) {
      expect(parseSeenThrough(text)).toBeNull();
    }
  });
});

describe('AgentReadNotices', () => {
  const result = { marked: ['acme/app#1'], refused: [], skipped: [], writesLocked: false, undoUntil: '2026-10-29T12:00:06Z' };

  it('keeps notices past their undo window for an hour, at most 20, saying whether each can still be undone', () => {
    let now = new Date('2026-10-29T12:00:00Z');
    const undoable = new Set(['t1']);
    const notices = new AgentReadNotices((token) => undoable.has(token), () => now);
    notices.add('claude-code', result, 't1', result.undoUntil);
    expect(notices.recent().map((notice) => [notice.id, notice.undoable])).toEqual([[1, true]]);

    undoable.clear();
    now = new Date('2026-10-29T12:30:00Z');
    expect(notices.recent().map((notice) => [notice.id, notice.undoable])).toEqual([[1, false]]);

    for (let index = 0; index < 25; index += 1) {
      notices.add('claude-code', result, `t${index + 2}`, result.undoUntil);
    }
    expect(notices.recent().map((notice) => notice.id)).toEqual(Array.from({ length: 20 }, (_, index) => index + 7));

    now = new Date('2026-10-29T13:31:00Z');
    expect(notices.recent()).toEqual([]);
  });
});
