import { describe, expect, it } from 'vitest';
import { caresAboutUnreviewedMerges } from './instructions.ts';

describe('caresAboutUnreviewedMerges', () => {
  it('matches the phrases in any of the texts', () => {
    expect(caresAboutUnreviewedMerges('', 'Tell me when something is merged without my review.')).toBe(true);
    expect(caresAboutUnreviewedMerges('Flag unreviewed merges')).toBe(true);
    expect(caresAboutUnreviewedMerges('Only frontend PRs', '')).toBe(false);
  });
});
