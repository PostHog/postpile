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

  it('writes a pure insertion as a zero-width position before the old line', () => {
    const patch = ['@@ -20,3 +20,4 @@', ' a', ' b', '+added', ' c'].join('\n');
    expect(changedRanges(patch)).toEqual([{ start: 22, end: 21 }]);
  });

  it('reads a hunk with no old lines as an insertion after the line it names', () => {
    expect(changedRanges(['@@ -0,0 +1,2 @@', '+x', '+y'].join('\n'))).toEqual([{ start: 1, end: 0 }]);
    expect(changedRanges(['@@ -5,0 +6,1 @@', '+x'].join('\n'))).toEqual([{ start: 6, end: 5 }]);
  });

  it('keeps every insertion of a patch, once each', () => {
    const patch = ['@@ -619,6 +619,9 @@', '-gone', '+a', ' b', '+c', ' d', '+e', ' f', ' g', '+h', ' i'].join('\n');
    expect(changedRanges(patch)).toEqual([
      { start: 619, end: 619 },
      { start: 621, end: 620 },
      { start: 622, end: 621 },
      { start: 624, end: 623 },
    ]);
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
      { other: 'acme/app#2', files: [{ path: '.github/workflows/ci.yml', regions: [{ start: 600, end: 640 }] }], nearby: [], otherCapped: false },
    ]);
    expect(result.get('acme/app#2')?.[0]?.other).toBe('acme/app#1');
  });

  it('counts edits within the margin as the same lines, not further away', () => {
    const sameLines = (second: [number, number]) => findOverlaps([edits('acme/app#1', [[10, 12]]), edits('acme/app#2', [second])], never).get('acme/app#1')?.[0]?.files;
    expect(sameLines([15, 16])).toHaveLength(1);
    expect(sameLines([16, 17])).toEqual([]);
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

  it('counts an insertion as a position next to the lines before and after it', () => {
    const insertion = (n: number) => edits('acme/app#1', [[n, n - 1]]);
    expect(findOverlaps([insertion(627), edits('acme/app#2', [[624, 624]])], never).size).toBe(2);
    expect(findOverlaps([insertion(627), edits('acme/app#2', [[626, 626]])], never).size).toBe(2);
    expect(findOverlaps([insertion(627), edits('acme/app#2', [[627, 630]])], never).size).toBe(2);
    expect(findOverlaps([insertion(627), edits('acme/app#2', [[620, 620]])], never).get('acme/app#1')?.[0]?.files).toEqual([]);
    expect(findOverlaps([insertion(627), edits('acme/app#2', [[620, 620]])], never).get('acme/app#1')?.[0]?.nearby).toHaveLength(1);
  });

  it('reports interleaved edits in one block as nearby, not as the same lines', () => {
    // PR 1: an insertion before old line 627, and old line 1351 replaced.
    // PR 2: old line 619 removed, and insertions before 620, 621, 632 and 633.
    const path = '.github/workflows/container-images-cd.yml';
    const x: PrEdits = { prKey: 'acme/app#1', repo: 'acme/app', baseRef: 'main', capped: false, files: [{ path, ranges: [{ start: 627, end: 626 }, { start: 1351, end: 1351 }] }] };
    const y: PrEdits = {
      prKey: 'acme/app#2',
      repo: 'acme/app',
      baseRef: 'main',
      capped: false,
      files: [{ path, ranges: [{ start: 619, end: 619 }, { start: 620, end: 619 }, { start: 621, end: 620 }, { start: 632, end: 631 }, { start: 633, end: 632 }] }],
    };

    const result = findOverlaps([x, y], never);

    expect(result.get('acme/app#1')).toEqual([
      { other: 'acme/app#2', files: [], nearby: [{ path, theirs: { start: 619, end: 633 }, mine: { start: 627, end: 627 } }], otherCapped: false },
    ]);
    expect(result.get('acme/app#2')?.[0]?.nearby[0]).toEqual({ path, theirs: { start: 627, end: 627 }, mine: { start: 619, end: 633 } });
  });

  it('keeps the nearby level for edits within 10 lines only', () => {
    expect(findOverlaps([edits('acme/app#1', [[10, 10]]), edits('acme/app#2', [[20, 20]])], never).get('acme/app#1')?.[0]?.nearby).toHaveLength(1);
    expect(findOverlaps([edits('acme/app#1', [[10, 10]]), edits('acme/app#2', [[21, 21]])], never).size).toBe(0);
  });

  it('skips lockfiles, changelogs, snapshots and generated files at the nearby level, not at the same lines', () => {
    const noisy = ['pnpm-lock.yaml', 'apps/web/package-lock.json', 'CHANGELOG.md', 'docs/CHANGELOG-2026.md', 'src/__snapshots__/a.test.ts.snap', 'src/a.snap', 'src/api/generated/types.ts', 'api/user.pb.go'];
    for (const path of noisy) {
      const near = [edits('acme/app#1', [[10, 10]]), edits('acme/app#2', [[15, 15]])];
      near[0]!.files[0]!.path = path;
      near[1]!.files[0]!.path = path;
      expect(findOverlaps(near, never).size, path).toBe(0);
      const same = [edits('acme/app#1', [[10, 10]]), edits('acme/app#2', [[10, 10]])];
      same[0]!.files[0]!.path = path;
      same[1]!.files[0]!.path = path;
      expect(findOverlaps(same, never).get('acme/app#1')?.[0]?.files, path).toHaveLength(1);
    }
  });

  it('keeps every shared file of a pair', () => {
    const a = edits('acme/app#1', [[1, 2]]);
    const b = edits('acme/app#2', [[1, 2]]);
    a.files.push({ path: 'src/b.ts', ranges: [{ start: 5, end: 6 }] });
    b.files.push({ path: 'src/b.ts', ranges: [{ start: 5, end: 6 }] });
    expect(findOverlaps([a, b], never).get('acme/app#1')?.[0]?.files.map((file) => file.path).sort()).toEqual(['.github/workflows/ci.yml', 'src/b.ts']);
  });

  it('lists same-line overlaps before nearby ones, and handles odd paths', () => {
    const odd = 'dir/we\nird.yml';
    const mk = (key: string, ranges: [number, number][]) => ({ ...edits(key, ranges), files: [{ path: odd, ranges: ranges.map(([start, end]) => ({ start, end })) }] });
    const result = findOverlaps([mk('acme/app#1', [[50, 50]]), mk('acme/app#2', [[58, 58]]), mk('acme/app#3', [[50, 50]])], never);
    expect(result.get('acme/app#1')?.map((overlap) => overlap.other)).toEqual(['acme/app#3', 'acme/app#2']);
  });
});
