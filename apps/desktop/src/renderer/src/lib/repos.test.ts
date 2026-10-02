import { describe, expect, it } from 'vitest';
import type { RepoOverview, TopicRepoLine } from '@postpile/core';
import { countTitle, scopeLabel, shortRepo, topicCount, topicRepoTitle } from './repos.ts';

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
    expect(scopeLabel(overview('a/two'))).toBe('Only two');
    expect(shortRepo('acme/app')).toBe('app');
  });

  it('words the counts', () => {
    expect(countTitle(1, 1)).toBe('1 topic, 1 PR');
    expect(countTitle(3, 5)).toBe('3 topics, 5 PRs');
    expect(countTitle(2, null)).toBe('2 topics');
    expect(topicCount(1)).toBe('1 topic');
    expect(topicCount(6)).toBe('6 topics');
  });

  it('words the topic repo hover', () => {
    const line: TopicRepoLine = { label: 'infra', repos: ['acme/infra', 'acme/app'], offScope: null };
    expect(topicRepoTitle(line)).toBe('Most of its PRs are in acme/infra; also in acme/app');
    expect(topicRepoTitle({ ...line, repos: ['acme/infra'] })).toBe('Most of its PRs are in acme/infra');
    expect(topicRepoTitle({ ...line, offScope: { pickedLabel: 'app', pickedPrs: 1 } })).toBe('Listed because 1 PR is in app; most of its PRs are in infra');
    expect(topicRepoTitle({ ...line, offScope: { pickedLabel: 'app', pickedPrs: 2 } })).toBe('Listed because 2 PRs are in app; most of its PRs are in infra');
  });
});
