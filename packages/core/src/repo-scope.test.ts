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
  topicRepoLine,
  viewerOrgs,
  withQuietRepo,
  type RepoSettings,
} from './repo-scope.ts';

const settings: RepoSettings = { scope: 'acme/app', quiet: ['acme/infra'] };
const ORGS = ['acme'];

describe('repo scope', () => {
  it('reads the repo from a PR key', () => {
    expect(repoOfPr('acme/app#12')).toBe('acme/app');
  });

  it('lists every topic under all repos', () => {
    expect(isTopicInScope(['any/repo#1'], DEFAULT_REPO_SETTINGS)).toBe(true);
    expect(isTopicInScope([], DEFAULT_REPO_SETTINGS)).toBe(true);
  });

  it('lists a topic when one of its PRs is in the chosen repo, ignoring case', () => {
    expect(isTopicInScope(['acme/infra#1', 'Acme/APP#2'], settings)).toBe(true);
    expect(isTopicInScope(['acme/infra#1'], settings)).toBe(false);
    expect(isTopicInScope([], settings)).toBe(false);
  });

  it('treats a blank choice as all repos', () => {
    expect(normalizeRepoScope('  ')).toBeNull();
    expect(normalizeRepoScope(' a/b ')).toBe('a/b');
  });

  it('migrates a stored multi-selection', () => {
    expect(migrateRepoScope(['acme/infra'])).toBe('acme/infra');
    expect(migrateRepoScope(['acme/infra', 'acme/app'])).toBeNull();
    expect(migrateRepoScope([])).toBeNull();
    expect(migrateRepoScope(null)).toBeNull();
    expect(migrateRepoScope(undefined)).toBeNull();
    expect(migrateRepoScope('acme/app')).toBe('acme/app');
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
    expect(viewerOrgs(['acme/team-platform', 'ACME/infra', 'Other/x'])).toEqual(['acme', 'Other']);
    expect(repoLabel('acme/tools', ORGS)).toBe('tools');
    expect(repoLabel('Acme/infra', ORGS)).toBe('infra');
    expect(repoLabel('other/tools', ORGS)).toBe('other/tools');
  });

  it('labels a tile from another repo once, on the tile', () => {
    expect(tileRepoLabels(['acme/infra#1', 'acme/infra#2'], 'acme/app', ORGS)).toEqual({ tile: 'infra', prs: [null, null] });
    expect(tileRepoLabels(['Acme/APP#1'], 'acme/app', ORGS)).toEqual({ tile: null, prs: [null] });
  });

  it('labels only the PR rows from another repo in a mixed set', () => {
    expect(tileRepoLabels(['acme/app#1', 'acme/infra#2', 'other/tools#3'], 'acme/app', ORGS)).toEqual({
      tile: null,
      prs: [null, 'infra', 'other/tools'],
    });
  });

  it('falls back to the base repo org without viewer teams, and labels nothing without a base', () => {
    expect(tileRepoLabels(['acme/infra#1'], 'acme/app', [])).toEqual({ tile: 'infra', prs: [null] });
    expect(tileRepoLabels(['acme/infra#1'], null, ORGS)).toEqual({ tile: null, prs: [null] });
  });
});

describe('topicRepoLine', () => {
  const picked = (scope: string): RepoSettings => ({ scope, quiet: [] });

  it('shows the main repo with every repo it touches', () => {
    expect(topicRepoLine(['acme/app#1', 'acme/app#2', 'acme/infra#3', 'other/tools#4'], DEFAULT_REPO_SETTINGS, ORGS)).toEqual({
      label: 'app',
      repos: ['acme/app', 'acme/infra', 'other/tools'],
      offScope: null,
    });
  });

  it('says when the picked repo holds only a few of the PRs', () => {
    const one = topicRepoLine(['acme/infra#1', 'acme/infra#2', 'acme/app#3'], picked('acme/app'), ORGS);
    expect(one).toEqual({ label: 'infra', repos: ['acme/infra', 'acme/app'], offScope: { pickedLabel: 'app', pickedPrs: 1 } });
    const two = topicRepoLine(['acme/infra#1', 'acme/infra#2', 'acme/infra#3', 'acme/app#4', 'acme/app#5'], picked('acme/app'), ORGS);
    expect(two?.offScope).toEqual({ pickedLabel: 'app', pickedPrs: 2 });
  });

  it('matches the picked repo ignoring case and lets it win a tie', () => {
    expect(topicRepoLine(['Acme/App#1', 'acme/infra#2'], picked('acme/app'), ORGS)).toEqual({
      label: 'App',
      repos: ['Acme/App', 'acme/infra'],
      offScope: null,
    });
    expect(topicRepoLine(['acme/infra#1', 'acme/app#2'], picked('ACME/APP'), ORGS)).toMatchObject({ label: 'app', offScope: null });
  });

  it('is not off scope when the topic has no PR in the picked repo', () => {
    expect(topicRepoLine(['acme/infra#1'], picked('acme/app'), ORGS)).toMatchObject({ label: 'infra', offScope: null });
  });

  it('is null for a topic without PRs', () => {
    expect(topicRepoLine([], DEFAULT_REPO_SETTINGS, ORGS)).toBeNull();
  });
});

describe('quiet repos', () => {
  it('marks PRs of a quiet repo', () => {
    expect(isPrInQuietRepo('acme/infra#3', settings)).toBe(true);
    expect(isPrInQuietRepo('acme/app#3', settings)).toBe(false);
  });

  it('calls a tile quiet only when every PR is in a quiet repo', () => {
    expect(isQuietTile(['acme/infra#1', 'aCme/Infra#2'], settings)).toBe(true);
    expect(isQuietTile(['acme/infra#1', 'acme/app#2'], settings)).toBe(false);
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
    const overview = repoOverview([['acme/app#1']], settings);
    expect(overview.repos).toEqual([
      { repo: 'acme/app', topics: 1, prs: 1, quiet: false, selected: true },
      { repo: 'acme/infra', topics: 0, prs: 0, quiet: true, selected: false },
    ]);
  });
});
