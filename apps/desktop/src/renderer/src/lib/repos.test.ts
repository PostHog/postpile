import { describe, expect, it } from 'vitest';
import type { RepoOverview } from '@postpile/core';
import { countTitle, scopeLabel, shortRepo, topicCount } from './repos.ts';

function overview(scope: string | null): RepoOverview {
  const repos = ['a/one', 'a/two'];
  return {
    scope,
    topics: 2,
    repos: repos.map((repo) => ({ repo, topics: 1, prs: 1, quiet: false, selected: repo === scope })),
  };
}

describe('repo menu', () => {
  it('labels the button', () => {
    expect(scopeLabel(undefined)).toBe('All repos');
    expect(scopeLabel(overview(null))).toBe('All repos');
    expect(scopeLabel(overview('a/two'))).toBe('two');
    expect(shortRepo('acme/app')).toBe('app');
  });

  it('words the counts', () => {
    expect(countTitle(1, 1)).toBe('1 topic, 1 PR');
    expect(countTitle(3, 5)).toBe('3 topics, 5 PRs');
    expect(countTitle(2, null)).toBe('2 topics');
    expect(topicCount(1)).toBe('1 topic');
    expect(topicCount(6)).toBe('6 topics');
  });
});
