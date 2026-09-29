import { describe, expect, it } from 'vitest';
import { glanceBatchItemOutput, repairVerdict } from './schemas.ts';

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

describe('glanceBatchItemOutput keyFiles', () => {
  const entry = { prKey: 'acme/app#1', verdict: 'LOOKS_SAFE', forYou: 'Approve.', does: 'Moves CI.', risk: 'low', othersSaid: 'nobody yet' };

  it('defaults to none when the answer leaves them out', () => {
    expect(glanceBatchItemOutput.parse(entry).keyFiles).toEqual([]);
  });

  it('reads path and why, why optional', () => {
    const parsed = glanceBatchItemOutput.parse({ ...entry, keyFiles: [{ path: ' ci.yml ', why: 'new secret' }, { path: 'a.ts' }] });
    expect(parsed.keyFiles).toEqual([
      { path: 'ci.yml', why: 'new secret' },
      { path: 'a.ts', why: '' },
    ]);
  });

  it('rejects an entry without a path', () => {
    expect(glanceBatchItemOutput.safeParse({ ...entry, keyFiles: [{ why: 'x' }] }).success).toBe(false);
  });
});
