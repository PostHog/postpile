import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPO_SETTINGS,
  isPrInQuietRepo,
  isQuietTile,
  isTopicInScope,
  labelBaseRepo,
  mainRepoOf,
  migrateRepoScope,
  normalizeRepoScope,
  repoLabel,
  repoOfPr,
  repoOverview,
  tileRepoLabels,
  viewerOrgs,
  withQuietRepo,
  type RepoSettings,
} from './repo-scope.ts';

const settings: RepoSettings = { scope: 'PostHog/posthog', quiet: ['PostHog/example-infra'] };
const ORGS = ['PostHog'];

describe('repo scope', () => {
  it('reads the repo from a PR key', () => {
    expect(repoOfPr('PostHog/posthog#12')).toBe('PostHog/posthog');
  });

  it('lists every topic under all repos', () => {
    expect(isTopicInScope(['any/repo#1'], DEFAULT_REPO_SETTINGS)).toBe(true);
    expect(isTopicInScope([], DEFAULT_REPO_SETTINGS)).toBe(true);
  });

  it('lists a topic when one of its PRs is in the chosen repo, ignoring case', () => {
    expect(isTopicInScope(['PostHog/example-infra#1', 'posthog/PostHog#2'], settings)).toBe(true);
    expect(isTopicInScope(['PostHog/example-infra#1'], settings)).toBe(false);
    expect(isTopicInScope([], settings)).toBe(false);
  });

  it('treats a blank choice as all repos', () => {
    expect(normalizeRepoScope('  ')).toBeNull();
    expect(normalizeRepoScope(' a/b ')).toBe('a/b');
  });

  it('migrates a stored multi-selection', () => {
    expect(migrateRepoScope(['PostHog/example-infra'])).toBe('PostHog/example-infra');
    expect(migrateRepoScope(['PostHog/example-infra', 'PostHog/posthog'])).toBeNull();
    expect(migrateRepoScope([])).toBeNull();
    expect(migrateRepoScope(null)).toBeNull();
    expect(migrateRepoScope(undefined)).toBeNull();
    expect(migrateRepoScope('PostHog/posthog')).toBe('PostHog/posthog');
  });
});

describe('repo labels', () => {
  it('picks the repo with most PRs as the main one, first seen on a tie', () => {
    expect(mainRepoOf(['a/x#1', 'b/y#1', 'b/y#2', 'b/y#2'])).toBe('b/y');
    expect(mainRepoOf(['a/x#1', 'b/y#1'])).toBe('a/x');
    expect(mainRepoOf([])).toBeNull();
  });

  it('compares against the chosen repo, or the main one under all repos', () => {
    expect(labelBaseRepo(['a/x#1', 'a/x#2', 'b/y#1'], DEFAULT_REPO_SETTINGS)).toBe('a/x');
    expect(labelBaseRepo(['a/x#1', 'a/x#2', 'b/y#1'], { scope: 'b/y', quiet: [] })).toBe('b/y');
  });

  it('drops the org when it is one of the viewer orgs', () => {
    expect(viewerOrgs(['PostHog/team-devex', 'posthog/infra', 'Other/x'])).toEqual(['PostHog', 'Other']);
    expect(repoLabel('PostHog/example-tools', ORGS)).toBe('example-tools');
    expect(repoLabel('posthog/example-infra', ORGS)).toBe('example-infra');
    expect(repoLabel('acme/tools', ORGS)).toBe('acme/tools');
  });

  it('labels a tile from another repo once, on the tile', () => {
    expect(tileRepoLabels(['PostHog/example-infra#1', 'PostHog/example-infra#2'], 'PostHog/posthog', ORGS)).toEqual({ tile: 'example-infra', prs: [null, null] });
    expect(tileRepoLabels(['posthog/PostHog#1'], 'PostHog/posthog', ORGS)).toEqual({ tile: null, prs: [null] });
  });

  it('labels only the PR rows from another repo in a mixed set', () => {
    expect(tileRepoLabels(['PostHog/posthog#1', 'PostHog/example-infra#2', 'acme/tools#3'], 'PostHog/posthog', ORGS)).toEqual({
      tile: null,
      prs: [null, 'example-infra', 'acme/tools'],
    });
  });

  it('falls back to the base repo org without viewer teams, and labels nothing without a base', () => {
    expect(tileRepoLabels(['PostHog/example-infra#1'], 'PostHog/posthog', [])).toEqual({ tile: 'example-infra', prs: [null] });
    expect(tileRepoLabels(['PostHog/example-infra#1'], null, ORGS)).toEqual({ tile: null, prs: [null] });
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
  it('counts topics and PRs per repo, each PR once, most topics first', () => {
    const overview = repoOverview([['a/x#1', 'a/x#1', 'b/y#1'], ['b/y#2'], []], DEFAULT_REPO_SETTINGS);
    expect(overview).toEqual({
      scope: null,
      topics: 2,
      repos: [
        { repo: 'b/y', topics: 2, prs: 2, quiet: false, selected: false },
        { repo: 'a/x', topics: 1, prs: 1, quiet: false, selected: false },
      ],
    });
  });

  it('marks the chosen repo and keeps named repos without PRs', () => {
    const overview = repoOverview([['PostHog/posthog#1']], settings);
    expect(overview.repos).toEqual([
      { repo: 'PostHog/posthog', topics: 1, prs: 1, quiet: false, selected: true },
      { repo: 'PostHog/example-infra', topics: 0, prs: 0, quiet: true, selected: false },
    ]);
  });
});
