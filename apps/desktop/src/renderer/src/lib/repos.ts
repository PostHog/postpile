import type { RepoOverview } from '@postpile/core';

/** "PostHog/posthog" -> "posthog". */
export function shortRepo(repo: string): string {
  const slash = repo.indexOf('/');
  return slash >= 0 ? repo.slice(slash + 1) : repo;
}

/** The menu button: "All repos", one repo's short name, or "N repos". */
export function scopeLabel(overview: RepoOverview | undefined): string {
  const scope = overview?.scope ?? null;
  if (scope === null) {
    return 'All repos';
  }
  return scope.length === 1 ? shortRepo(scope[0]!) : `${scope.length} repos`;
}

/**
 * The scope after (un)checking one repo. From "All repos" unchecking one
 * keeps every other listed repo. Checking the last missing one, or
 * unchecking the last checked one, goes back to all (null).
 */
export function toggledScope(overview: RepoOverview, repo: string): string[] | null {
  const checked = overview.repos.filter((entry) => entry.inScope).map((entry) => entry.repo);
  const next = checked.includes(repo) ? checked.filter((entry) => entry !== repo) : [...checked, repo];
  const all = overview.repos.every((entry) => next.includes(entry.repo));
  return next.length === 0 || all ? null : next;
}
