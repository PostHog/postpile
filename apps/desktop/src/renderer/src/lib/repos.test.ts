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

  it('words the topic repo hover as counts', () => {
    const line: TopicRepoLine = {
      label: 'app',
      repos: [
        { repo: 'acme/app', prs: 3 },
        { repo: 'acme/infra', prs: 1 },
        { repo: 'acme/docs', prs: 1 },
      ],
      offScope: null,
    };
    expect(topicRepoTitle(line)).toBe('PRs: 3 in app, 1 in infra, 1 in docs');
    expect(topicRepoTitle({ ...line, repos: [{ repo: 'acme/app', prs: 3 }] })).toBe('3 PRs, all in app');
    expect(topicRepoTitle({ ...line, repos: [{ repo: 'acme/app', prs: 1 }] })).toBe('1 PR, in app');
  });

  it('does not claim a majority when repos tie', () => {
    const tie: TopicRepoLine = {
      label: 'app',
      repos: [
        { repo: 'acme/app', prs: 1 },
        { repo: 'acme/infra', prs: 1 },
      ],
      offScope: null,
    };
    expect(topicRepoTitle(tie)).toBe('PRs: 1 in app, 1 in infra');
    expect(topicRepoTitle(tie).toLowerCase()).not.toContain('most');
  });

  it('words the off scope hover', () => {
    const line: TopicRepoLine = {
      label: 'app',
      repos: [
        { repo: 'acme/app', prs: 3 },
        { repo: 'acme/infra', prs: 1 },
      ],
      offScope: { pickedLabel: 'infra', pickedPrs: 1 },
    };
    expect(topicRepoTitle(line)).toBe('Listed because 1 PR is in infra; 3 PRs are in app');
    expect(topicRepoTitle({ ...line, offScope: { pickedLabel: 'infra', pickedPrs: 2 }, repos: [{ repo: 'acme/app', prs: 1 }, line.repos[1]!] })).toBe(
      'Listed because 2 PRs are in infra; 1 PR is in app',
    );
    const more = { ...line, repos: [...line.repos, { repo: 'acme/docs', prs: 1 }] };
    expect(topicRepoTitle(more)).toBe('Listed because 1 PR is in infra; 3 PRs are in app; also in docs');
  });
});
