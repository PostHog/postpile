import { describe, expect, it } from 'vitest';
import { glanceGapText } from './glance.ts';

describe('glanceGapText', () => {
  it('tells a capped PR from a failed one and from a new one', () => {
    const at = '2026-09-27T10:00:00.000Z';
    expect(glanceGapText({ reason: 'call_cap', detail: '', at }).pill).toBe('Not read yet (call cap)');
    expect(glanceGapText({ reason: 'failed', detail: 'timeout', at }).card).toContain('(timeout)');
    expect(glanceGapText(null).pill).toBe('No glance yet');
  });
});
