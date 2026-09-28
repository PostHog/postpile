import { describe, expect, it } from 'vitest';
import { BIG_FACT_PREDICATES, isBigClaim, TRIVIAL_FACT_PREDICATES } from './big-claims.ts';
import type { FactPredicate } from './memory.ts';

const ALL: FactPredicate[] = ['drives', 'works_on', 'reviews', 'owns', 'part_of', 'depends_on', 'blocked_by', 'decided', 'status', 'user_cares', 'note'];

describe('big claims', () => {
  it('puts every fact predicate on exactly one list', () => {
    for (const predicate of ALL) {
      expect(BIG_FACT_PREDICATES.includes(predicate) !== TRIVIAL_FACT_PREDICATES.includes(predicate)).toBe(true);
    }
    expect(BIG_FACT_PREDICATES.length + TRIVIAL_FACT_PREDICATES.length).toBe(ALL.length);
  });

  it('rechecks roles, decisions, blockers and cares, not reviewers or CI status', () => {
    expect(isBigClaim('drives')).toBe(true);
    expect(isBigClaim('owns')).toBe(true);
    expect(isBigClaim('decided')).toBe(true);
    expect(isBigClaim('blocked_by')).toBe(true);
    expect(isBigClaim('user_cares')).toBe(true);
    expect(isBigClaim('reviews')).toBe(false);
    expect(isBigClaim('status')).toBe(false);
    expect(isBigClaim('part_of')).toBe(false);
  });
});
