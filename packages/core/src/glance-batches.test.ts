import { describe, expect, it } from 'vitest';
import { planGlanceBatches, retryBatch } from './glance-batches.ts';

describe('planGlanceBatches', () => {
  it('splits in order and keeps the dossier version on every batch', () => {
    const keys = ['a/b#1', 'a/b#2', 'a/b#3', 'a/b#4', 'a/b#5'];
    const batches = planGlanceBatches('ci', 4, keys, 2);
    expect(batches.map((batch) => batch.prKeys)).toEqual([['a/b#1', 'a/b#2'], ['a/b#3', 'a/b#4'], ['a/b#5']]);
    expect(batches.every((batch) => batch.dossierVersion === 4 && batch.attempt === 1)).toBe(true);
  });

  it('retries missing PRs once and never a retry', () => {
    const [first] = planGlanceBatches('ci', 4, ['a/b#1', 'a/b#2']);
    const retry = first ? retryBatch(first, ['a/b#2']) : null;
    expect(retry).toMatchObject({ prKeys: ['a/b#2'], attempt: 2 });
    expect(retry ? retryBatch(retry, ['a/b#2']) : 'none').toBeNull();
    expect(first ? retryBatch(first, []) : 'none').toBeNull();
  });
});
