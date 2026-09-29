import type { RepoOverview } from '@postpile/core';

/** "acme/app" -> "app". */
export function shortRepo(repo: string): string {
  const slash = repo.indexOf('/');
  return slash >= 0 ? repo.slice(slash + 1) : repo;
}

/** The menu button: "All repos" or the chosen repo's short name. */
export function scopeLabel(overview: RepoOverview | undefined): string {
  const scope = overview?.scope ?? null;
  return scope === null ? 'All repos' : shortRepo(scope);
}

/** "6 topics": a row's count in words, so it never reads as an unread badge. */
export function topicCount(topics: number): string {
  return `${topics} topic${topics === 1 ? '' : 's'}`;
}

/** "3 topics, 5 PRs" for a row's tooltip. */
export function countTitle(topics: number, prs: number | null): string {
  const topicText = topicCount(topics);
  return prs === null ? topicText : `${topicText}, ${prs} PR${prs === 1 ? '' : 's'}`;
}
