import { describe, expect, it } from 'vitest';
import { fixedClaimNote, parseFixedClaimNote } from './memory-views.ts';

describe('fixed claim notes', () => {
  it('round-trips both lines', () => {
    const note = fixedClaimNote({ text: 'alice drives it', fixed: 'bob drives it' });
    expect(note).toBe('alice drives it\n→ bob drives it');
    expect(parseFixedClaimNote(note)).toEqual({ text: 'alice drives it', fixed: 'bob drives it' });
  });

  it('ignores other notes', () => {
    expect(parseFixedClaimNote('just a line')).toBeNull();
  });
});
