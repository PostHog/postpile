import { describe, expect, it } from 'vitest';
import { glanceClaim, glanceGapText } from './glance.ts';

describe('glanceGapText', () => {
  it('tells a capped PR from a failed one and from a new one', () => {
    const at = '2026-09-27T10:00:00.000Z';
    expect(glanceGapText({ reason: 'call_cap', detail: '', at }).pill).toBe('Not read yet (call cap)');
    expect(glanceGapText({ reason: 'failed', detail: 'timeout', at }).card).toContain('(timeout)');
    expect(glanceGapText(null).pill).toBe('No glance yet');
  });
});

describe('glanceClaim', () => {
  it('joins the whole glance into one claim', () => {
    const glance = {
      prKey: 'o/r#1',
      verdict: 'LOOK_CLOSER' as const,
      forYou: 'Changes cache keys.',
      does: 'Moves the cache.',
      risk: 'medium - cold runs',
      othersSaid: '',
      keyFiles: [],
      pullInReason: null,
      dossierVersion: null,
      inputHash: 'h',
      model: 'sonnet',
      createdAt: '2026-09-27T10:00:00.000Z',
    };
    expect(glanceClaim(glance)).toBe('Look closer. Changes cache keys. Does: Moves the cache. Risk: medium - cold runs');
  });
});
