import { describe, expect, it } from 'vitest';
import { declaredParentNote, declaredParentOf, declaredParents } from './declared-parents.ts';
import { makeCommit, makePr } from './fixtures.ts';

const REF = { repo: 'acme/app', number: 20 };

describe('declaredParents', () => {
  it('reads the usual phrases in any case', () => {
    expect(declaredParents('Stacked on #12', REF)).toEqual([12]);
    expect(declaredParents('stacked on top of #12', REF)).toEqual([12]);
    expect(declaredParents('DEPENDS ON #12', REF)).toEqual([12]);
    expect(declaredParents('Based on #12; the GitHub diff includes its ancestors.', REF)).toEqual([12]);
  });

  it('reads repo references and pull URLs to the same repo', () => {
    expect(declaredParents('Stacked on acme/app#12', REF)).toEqual([12]);
    expect(declaredParents('Stacked on ACME/App#12', REF)).toEqual([12]);
    expect(declaredParents('Depends on https://github.com/acme/app/pull/12/files', REF)).toEqual([12]);
    expect(declaredParents('Stacked on [#12](https://github.com/acme/app/pull/12)', REF)).toEqual([12]);
    expect(declaredParents('**Stacked on:** #12', REF)).toEqual([12]);
  });

  it('ignores other repos and the PR itself', () => {
    expect(declaredParents('Depends on acme/infra#12', REF)).toEqual([]);
    expect(declaredParents('Depends on https://github.com/acme/infra/pull/12', REF)).toEqual([]);
    expect(declaredParents('Stacked on #20', REF)).toEqual([]);
  });

  it('keeps the order and drops repeats', () => {
    expect(declaredParents('Stacked on #12. Also depends on #9 and, again, stacked on #12.', REF)).toEqual([12, 9]);
  });

  it('needs the reference right after the phrase', () => {
    expect(declaredParents('Depends on the fix in #12', REF)).toEqual([]);
    expect(declaredParents('Rebased on #12', REF)).toEqual([]);
    expect(declaredParents('Fixes #12', REF)).toEqual([]);
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
    expect(declaredParents(body, REF)).toEqual([]);
    expect(declaredParents(`${body}\nStacked on #5`, REF)).toEqual([5]);
  });
});

describe('declaredParentOf', () => {
  it('takes the first declared parent of an open PR', () => {
    expect(declaredParentOf({ ref: REF, state: 'OPEN', body: 'Stacked on #12, depends on #9' })).toBe(12);
  });

  it('is null for merged and closed PRs and bodies without one', () => {
    expect(declaredParentOf({ ref: REF, state: 'MERGED', body: 'Stacked on #12' })).toBeNull();
    expect(declaredParentOf({ ref: REF, state: 'CLOSED', body: 'Stacked on #12' })).toBeNull();
    expect(declaredParentOf({ ref: REF, state: 'OPEN', body: 'A plain fix.' })).toBeNull();
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
