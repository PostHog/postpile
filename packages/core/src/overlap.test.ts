import { describe, expect, it } from 'vitest';
import { changedRanges, findOverlaps, type PrEdits } from './overlap.ts';

const never = () => false;

function edits(prKey: string, ranges: [number, number][], overrides: Partial<PrEdits> = {}): PrEdits {
  return {
    prKey,
    repo: 'acme/app',
    baseRef: 'main',
    files: [{ path: '.github/workflows/ci.yml', ranges: ranges.map(([start, end]) => ({ start, end })) }],
    capped: false,
    ...overrides,
  };
}

describe('changedRanges', () => {
  it('reads removed and replaced lines, not the context around them', () => {
    const patch = ['@@ -10,7 +10,7 @@ jobs:', ' a', ' b', ' c', '-old one', '-old two', '+new', ' d', ' e', ' f'].join('\n');
    expect(changedRanges(patch)).toEqual([{ start: 13, end: 14 }]);
  });

  it('writes a pure insertion as the two old lines around the gap', () => {
    const patch = ['@@ -20,3 +20,4 @@', ' a', ' b', '+added', ' c'].join('\n');
    expect(changedRanges(patch)).toEqual([{ start: 21, end: 22 }]);
  });

  it('reads a hunk with no old lines as the line before it', () => {
    expect(changedRanges(['@@ -0,0 +1,2 @@', '+x', '+y'].join('\n'))).toEqual([{ start: 1, end: 1 }]);
    expect(changedRanges(['@@ -5,0 +6,1 @@', '+x'].join('\n'))).toEqual([{ start: 5, end: 6 }]);
  });

  it('keeps the old line count across several hunks and a missing count', () => {
    const patch = ['@@ -1 +1 @@', '-a', '+b', '@@ -50,3 +50,2 @@', ' x', '-gone', ' y', '\\ No newline at end of file'].join('\n');
    expect(changedRanges(patch)).toEqual([
      { start: 1, end: 1 },
      { start: 51, end: 51 },
    ]);
  });

  it('answers nothing for an empty patch', () => {
    expect(changedRanges('')).toEqual([]);
  });
});

describe('findOverlaps', () => {
  it('reports PRs that edit the same lines, both ways', () => {
    const result = findOverlaps([edits('acme/app#1', [[600, 620]]), edits('acme/app#2', [[610, 640]])], never);
    expect(result.get('acme/app#1')).toEqual([
      { other: 'acme/app#2', files: [{ path: '.github/workflows/ci.yml', regions: [{ start: 600, end: 640 }] }], otherCapped: false },
    ]);
    expect(result.get('acme/app#2')?.[0]?.other).toBe('acme/app#1');
  });

  it('counts edits within the margin, not further away', () => {
    expect(findOverlaps([edits('acme/app#1', [[10, 12]]), edits('acme/app#2', [[15, 16]])], never).size).toBe(2);
    expect(findOverlaps([edits('acme/app#1', [[10, 12]]), edits('acme/app#2', [[16, 17]])], never).size).toBe(0);
  });

  it('ignores the same file in different places', () => {
    expect(findOverlaps([edits('acme/app#1', [[1, 5]]), edits('acme/app#2', [[400, 410]])], never).size).toBe(0);
  });

  it('skips stack mates, other repos and other base branches', () => {
    const prs = [
      edits('acme/app#1', [[1, 5]]),
      edits('acme/app#2', [[1, 5]]),
      edits('acme/other#3', [[1, 5]], { repo: 'acme/other' }),
      edits('acme/app#4', [[1, 5]], { baseRef: 'release' }),
    ];
    expect(findOverlaps(prs, (a, b) => [a, b].sort().join() === 'acme/app#1,acme/app#2').size).toBe(0);
  });

  it('ignores PRs that share no file', () => {
    const other = edits('acme/app#2', [[1, 5]]);
    other.files[0]!.path = 'src/main.ts';
    expect(findOverlaps([edits('acme/app#1', [[1, 5]]), other], never).size).toBe(0);
  });

  it('passes on that the other PR was capped', () => {
    const result = findOverlaps([edits('acme/app#1', [[1, 5]]), edits('acme/app#2', [[2, 3]], { capped: true })], never);
    expect(result.get('acme/app#1')?.[0]?.otherCapped).toBe(true);
    expect(result.get('acme/app#2')?.[0]?.otherCapped).toBe(false);
  });
});
