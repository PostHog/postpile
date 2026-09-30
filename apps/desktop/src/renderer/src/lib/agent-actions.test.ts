import { describe, expect, it } from 'vitest';
import { batchMarkReadMessage, pillWord } from './agent-actions.ts';

describe('pillWord', () => {
  it('says the risk when active and the reason when greyed', () => {
    expect(pillWord({ state: 'active', risk: 'medium', reason: null })).toBe('medium');
    expect(pillWord({ state: 'greyed', risk: null, reason: 'rechecking' })).toBe('rechecking…');
    expect(pillWord({ state: 'greyed', risk: null, reason: 'asks_for_you' })).toBe('asks for you');
  });
});

describe('batchMarkReadMessage', () => {
  it('names what was skipped and why', () => {
    const skipped = [{ tileId: 'a', reason: 'asks_for_you' as const }];
    expect(batchMarkReadMessage(3, skipped, 'x', true)).toBe('Marked 3 read · 1 skipped (asks for you)');
    expect(batchMarkReadMessage(3, [], 'x', true)).toBe('Marked 3 read');
  });
});
