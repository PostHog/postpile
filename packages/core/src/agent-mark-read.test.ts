import { describe, expect, it } from 'vitest';
import { agentMarkReadCheck, newActivityReason, type AgentMarkReadInput } from './agent-mark-read.ts';
import { parseAgentRequest } from './agent-requests.ts';

const BASE: AgentMarkReadInput = { stored: true, tracked: true, seenThrough: 40, newestSeq: 40, newer: [], changesAnything: true };

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
      reason: 'new activity since you read it: 2 events, newest from alice; read it again with pr_context',
    });
  });

  it('marks when the only events logged since are gone (a deleted comment)', () => {
    expect(agentMarkReadCheck({ ...BASE, newestSeq: 41 })).toEqual({ kind: 'mark' });
  });

  it('refuses a seen_through ahead of the log and a PR PostPile does not store', () => {
    expect(agentMarkReadCheck({ ...BASE, seenThrough: 99 })).toMatchObject({ kind: 'refused', reason: expect.stringContaining('seen_through 99') });
    expect(agentMarkReadCheck({ ...BASE, stored: false })).toEqual({ kind: 'refused', reason: 'PostPile does not track this PR' });
  });

  it('skips a pulled-in stack layer and a PR already read', () => {
    expect(agentMarkReadCheck({ ...BASE, tracked: false })).toMatchObject({ kind: 'skipped', reason: expect.stringContaining('stack layer') });
    expect(agentMarkReadCheck({ ...BASE, changesAnything: false })).toEqual({ kind: 'skipped', reason: 'already read' });
  });

  it('words one event in the singular', () => {
    expect(newActivityReason([{ actor: 'bob', at: '2026-10-29T10:00:00Z' }])).toContain('1 event, newest from bob');
  });
});

describe('parseAgentRequest: mark_read', () => {
  function request(payload: unknown): string {
    return JSON.stringify({ v: 1, kind: 'mark_read', createdAt: '2026-10-29T10:00:00Z', expiresAt: '2026-10-29T10:02:00Z', client: 'claude-code', payload });
  }

  it('takes one to 20 PRs with a seen_through each', () => {
    const check = parseAgentRequest(request({ prs: [{ prKey: 'acme/app#1902', seenThrough: 12 }] }));
    expect(check).toMatchObject({ ok: true, request: { kind: 'mark_read', payload: { prs: [{ prKey: 'acme/app#1902', seenThrough: 12 }] } } });
  });

  it('refuses an empty list, more than 20 PRs, a missing or negative seen_through and extra fields', () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ prKey: `acme/app#${index + 1}`, seenThrough: 1 }));
    for (const payload of [
      { prs: [] },
      { prs: many },
      { prs: [{ prKey: 'acme/app#1902' }] },
      { prs: [{ prKey: 'acme/app#1902', seenThrough: -1 }] },
      { prs: [{ prKey: 'acme/app#1902', seenThrough: 1.5 }] },
      { prs: [{ prKey: 'not a key', seenThrough: 1 }] },
      { prs: [{ prKey: 'acme/app#1902', seenThrough: 1 }], everything: true },
    ]) {
      expect(parseAgentRequest(request(payload))).toMatchObject({ ok: false, error: expect.stringContaining('bad mark_read payload') });
    }
  });
});
