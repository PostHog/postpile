import { describe, expect, it } from 'vitest';
import { repairVerdict } from './schemas.ts';

describe('repairVerdict', () => {
  it('repairs the misspellings seen on real answers', () => {
    expect(repairVerdict('LOOKS_SASAFE')).toBe('LOOKS_SAFE');
    expect(repairVerdict('LOOKS_SASE')).toBe('LOOKS_SAFE');
    expect(repairVerdict('looks safe')).toBe('LOOKS_SAFE');
    expect(repairVerdict('Look closer')).toBe('LOOK_CLOSER');
    expect(repairVerdict('not-yours')).toBe('NOT_YOURS');
  });

  it('never turns a closer look into safe', () => {
    expect(repairVerdict('LOOKS_CLOSER')).toBe('LOOK_CLOSER');
    expect(repairVerdict('LOOKS_SAFE_BUT_CLOSER')).toBe('LOOK_CLOSER');
  });

  it('leaves anything else alone, so the enum rejects it', () => {
    expect(repairVerdict('SHIP_IT')).toBe('SHIP_IT');
    expect(repairVerdict('LOOKS')).toBe('LOOKS');
    expect(repairVerdict(3)).toBe(3);
    expect(repairVerdict(null)).toBeNull();
  });
});
