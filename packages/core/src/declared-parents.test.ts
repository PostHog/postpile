import { describe, expect, it } from 'vitest';
import { declaredParentNote, declaredParentOf, declaredParents, dependsOnNote } from './declared-parents.ts';
import { makeCommit, makePr } from './fixtures.ts';

const REF = { repo: 'acme/app', number: 20 };

/** The PR numbers a body names, whatever the kind. */
function numbers(body: string): number[] {
  return declaredParents(body, REF).map((declared) => declared.number);
}

describe('declaredParents', () => {
  it('tells a stack from a merge order', () => {
    expect(declaredParents('Stacked on #12', REF)).toEqual([{ number: 12, kind: 'stack' }]);
    expect(declaredParents('Stacked on top of #12', REF)).toEqual([{ number: 12, kind: 'stack' }]);
    expect(declaredParents('Based on #12', REF)).toEqual([{ number: 12, kind: 'stack' }]);
    expect(declaredParents('Depends on #12', REF)).toEqual([{ number: 12, kind: 'depends' }]);
    expect(declaredParents('DEPENDS ON #12, stacked on #12', REF)).toEqual([{ number: 12, kind: 'depends' }]);
  });

  it('reads the usual phrases in any case', () => {
    expect(numbers('Stacked on #12')).toEqual([12]);
    expect(numbers('stacked on top of #12')).toEqual([12]);
    expect(numbers('DEPENDS ON #12')).toEqual([12]);
    expect(numbers('Based on #12; the GitHub diff includes its ancestors.')).toEqual([12]);
  });

  it('reads the markdown link form a stacking tool writes', () => {
    const line = 'Stacked on [#112316](https://github.com/acme/app/pull/112316); the GitHub diff includes its ancestors.';
    expect(declaredParents(line, { repo: 'acme/app', number: 112400 })).toEqual([{ number: 112316, kind: 'stack' }]);
    expect(declaredParents('Stacked on [the cache PR](https://github.com/acme/app/pull/12)', REF)).toEqual([]);
  });

  it('reads repo references and pull URLs to the same repo', () => {
    expect(numbers('Stacked on acme/app#12')).toEqual([12]);
    expect(numbers('Stacked on ACME/App#12')).toEqual([12]);
    expect(numbers('Depends on https://github.com/acme/app/pull/12/files')).toEqual([12]);
    expect(numbers('Stacked on [#12](https://github.com/acme/app/pull/12)')).toEqual([12]);
    expect(numbers('**Stacked on:** #12')).toEqual([12]);
  });

  it('ignores other repos and the PR itself', () => {
    expect(numbers('Depends on acme/infra#12')).toEqual([]);
    expect(numbers('Depends on https://github.com/acme/infra/pull/12')).toEqual([]);
    expect(numbers('Stacked on #20')).toEqual([]);
  });

  it('keeps the order and drops repeats', () => {
    expect(numbers('Stacked on #12. Also depends on #9 and, again, stacked on #12.')).toEqual([12, 9]);
  });

  it('needs the reference right after the phrase', () => {
    expect(numbers('Depends on the fix in #12')).toEqual([]);
    expect(numbers('Rebased on #12')).toEqual([]);
    expect(numbers('Fixes #12')).toEqual([]);
  });

  it('skips code spans of any backtick count, and only closes on the same count', () => {
    expect(numbers('Write ``depends on #3`` to link.')).toEqual([]);
    expect(numbers('Write ```stacked on `#3` too``` to link.')).toEqual([]);
    expect(numbers('A ``span with ` inside`` and then stacked on #5')).toEqual([5]);
    expect(numbers('A lone `` before stacked on #6')).toEqual([6]);
    expect(numbers('Spans `can\ncross lines: depends on #3` too')).toEqual([]);
  });

  it('skips code, HTML comments and quotes', () => {
    const body = [
      '<!-- If this PR is stacked, write: Stacked on #1 -->',
      '```',
      'stacked on #2',
      '```',
      'Run `depends on #3` to check.',
      '> Based on #4, said someone',
      'Nothing declared here.',
    ].join('\n');
    expect(numbers(body)).toEqual([]);
    expect(numbers(`${body}\nStacked on #5`)).toEqual([5]);
  });
});

describe('declaredParents on hostile bodies', () => {
  it('stays fast on many unclosed comments, fences and phrases', () => {
    const started = performance.now();
    expect(numbers('<!--'.repeat(50_000))).toEqual([]);
    expect(numbers('```\n'.repeat(50_000))).toEqual([]);
    expect(numbers(`${'stacked on '.repeat(20_000)}#12`)).toEqual([12]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('stays fast on many backtick runs that never close', () => {
    const started = performance.now();
    const runs = Array.from({ length: 2_000 }, (_, index) => '`'.repeat(index + 1)).join(' x ');
    expect(numbers(`${runs} stacked on #12`)).toEqual([12]);
    expect(numbers(`${'` '.repeat(50_001)}stacked on #12`)).toEqual([12]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('hides the rest of the body after an unclosed comment or fence', () => {
    expect(numbers('Stacked on #3\n<!-- Stacked on #4')).toEqual([3]);
    expect(numbers('```\nStacked on #4')).toEqual([]);
  });
});

describe('declaredParentOf', () => {
  it('takes the first declared parent of an open PR, a stack over a merge order', () => {
    expect(declaredParentOf({ ref: REF, state: 'OPEN', body: 'Stacked on #12, stacked on #9' })).toEqual({ number: 12, kind: 'stack' });
    expect(declaredParentOf({ ref: REF, state: 'OPEN', body: 'Depends on #9. Stacked on #12.' })).toEqual({ number: 12, kind: 'stack' });
    expect(declaredParentOf({ ref: REF, state: 'OPEN', body: 'Depends on #9 and depends on #7' })).toEqual({ number: 9, kind: 'depends' });
  });

  it('is null for merged and closed PRs and bodies without one', () => {
    expect(declaredParentOf({ ref: REF, state: 'MERGED', body: 'Stacked on #12' })).toBeNull();
    expect(declaredParentOf({ ref: REF, state: 'CLOSED', body: 'Stacked on #12' })).toBeNull();
    expect(declaredParentOf({ ref: REF, state: 'OPEN', body: 'A plain fix.' })).toBeNull();
  });
});

describe('dependsOnNote', () => {
  it('names the state of a stored dependency, null while it is not fetched', () => {
    expect(dependsOnNote(12, makePr({ number: 12, isDraft: true }))).toEqual({ number: 12, state: 'draft' });
    expect(dependsOnNote(12, undefined)).toEqual({ number: 12, state: null });
  });
});

describe('declaredParentNote', () => {
  it('counts the commits and files the child shares with its parent', () => {
    const parent = makePr({
      number: 12,
      isDraft: true,
      commits: [makeCommit({ oid: 'a1' }), makeCommit({ oid: 'a2' })],
      files: [{ path: '.github/workflows/ci.yml', additions: 3, deletions: 1 }],
    });
    const child = makePr({
      number: 20,
      commits: [makeCommit({ oid: 'a1' }), makeCommit({ oid: 'a2' }), makeCommit({ oid: 'b1' })],
      files: [
        { path: 'src/app.ts', additions: 5, deletions: 0 },
        { path: '.github/workflows/ci.yml', additions: 3, deletions: 1 },
      ],
    });
    expect(declaredParentNote(child, parent)).toEqual({
      number: 12,
      state: 'draft',
      commits: 3,
      sharedCommits: 2,
      sharedFiles: ['.github/workflows/ci.yml'],
    });
  });
});
