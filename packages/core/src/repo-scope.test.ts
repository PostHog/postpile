import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPO_SETTINGS,
  isPrInQuietRepo,
  isPrInScope,
  isQuietTile,
  isTileInScope,
  normalizeRepoScope,
  repoOfPr,
  repoOverview,
  withQuietRepo,
  type RepoSettings,
} from './repo-scope.ts';

const settings: RepoSettings = { scope: ['PostHog/posthog'], quiet: ['PostHog/example-infra'] };

describe('repo scope', () => {
  it('reads the repo from a PR key', () => {
    expect(repoOfPr('PostHog/posthog#12')).toBe('PostHog/posthog');
  });

  it('shows every repo without a scope', () => {
    expect(isPrInScope('any/repo#1', DEFAULT_REPO_SETTINGS)).toBe(true);
  });

  it('narrows to the scoped repos, ignoring case', () => {
    expect(isPrInScope('posthog/PostHog#1', settings)).toBe(true);
    expect(isPrInScope('PostHog/example-infra#1', settings)).toBe(false);
  });

  it('keeps a tile when one of its PRs is in scope', () => {
    expect(isTileInScope(['PostHog/example-infra#1', 'PostHog/posthog#2'], settings)).toBe(true);
    expect(isTileInScope(['PostHog/example-infra#1'], settings)).toBe(false);
  });

  it('treats an empty selection as all repos and drops duplicates', () => {
    expect(normalizeRepoScope([])).toBeNull();
    expect(normalizeRepoScope([' a/b ', 'A/B', 'c/d'])).toEqual(['a/b', 'c/d']);
  });
});

describe('quiet repos', () => {
  it('marks PRs of a quiet repo', () => {
    expect(isPrInQuietRepo('PostHog/example-infra#3', settings)).toBe(true);
    expect(isPrInQuietRepo('PostHog/posthog#3', settings)).toBe(false);
  });

  it('calls a tile quiet only when every PR is in a quiet repo', () => {
    expect(isQuietTile(['PostHog/example-infra#1', 'postHog/Example-Infra#2'], settings)).toBe(true);
    expect(isQuietTile(['PostHog/example-infra#1', 'PostHog/posthog#2'], settings)).toBe(false);
    expect(isQuietTile([], settings)).toBe(false);
  });

  it('switches a repo on and off', () => {
    const on = withQuietRepo(DEFAULT_REPO_SETTINGS, 'a/b', true);
    expect(on.quiet).toEqual(['a/b']);
    expect(withQuietRepo(on, 'A/B', false).quiet).toEqual([]);
    expect(withQuietRepo(on, 'a/b', true).quiet).toEqual(['a/b']);
  });
});

describe('repoOverview', () => {
  it('counts each PR once per repo, most PRs first', () => {
    const overview = repoOverview(['a/x#1', 'a/x#1', 'a/x#2', 'b/y#1'], DEFAULT_REPO_SETTINGS);
    expect(overview).toEqual({
      scope: null,
      repos: [
        { repo: 'a/x', prs: 2, quiet: false, inScope: true },
        { repo: 'b/y', prs: 1, quiet: false, inScope: true },
      ],
    });
  });

  it('keeps repos the settings name even when they have no PRs left', () => {
    const overview = repoOverview(['PostHog/posthog#1'], settings);
    expect(overview.repos).toEqual([
      { repo: 'PostHog/posthog', prs: 1, quiet: false, inScope: true },
      { repo: 'PostHog/example-infra', prs: 0, quiet: true, inScope: false },
    ]);
  });
});
