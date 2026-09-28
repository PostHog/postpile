import { describe, expect, it } from 'vitest';
import type { RepoOverview } from '@postpile/core';
import { scopeLabel, shortRepo, toggledScope } from './repos.ts';

function overview(scope: string[] | null): RepoOverview {
  const repos = ['a/one', 'a/two', 'b/three'];
  return {
    scope,
    repos: repos.map((repo) => ({ repo, prs: 1, quiet: false, inScope: scope === null || scope.includes(repo) })),
  };
}

describe('repo menu', () => {
  it('labels the button', () => {
    expect(scopeLabel(undefined)).toBe('All repos');
    expect(scopeLabel(overview(null))).toBe('All repos');
    expect(scopeLabel(overview(['a/two']))).toBe('two');
    expect(scopeLabel(overview(['a/one', 'a/two']))).toBe('2 repos');
    expect(shortRepo('PostHog/posthog')).toBe('posthog');
  });

  it('unchecks one repo out of all', () => {
    expect(toggledScope(overview(null), 'a/two')).toEqual(['a/one', 'b/three']);
  });

  it('goes back to all when every repo is checked or none is', () => {
    expect(toggledScope(overview(['a/one', 'a/two']), 'b/three')).toBeNull();
    expect(toggledScope(overview(['a/one']), 'a/one')).toBeNull();
  });

  it('adds a repo to a narrow scope', () => {
    expect(toggledScope(overview(['a/one']), 'a/two')).toEqual(['a/one', 'a/two']);
  });
});
