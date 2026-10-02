import type { RepoOverview, TopicRepoLine } from '@postpile/core';

/** "acme/app" -> "app". */
export function shortRepo(repo: string): string {
  const slash = repo.indexOf('/');
  return slash >= 0 ? repo.slice(slash + 1) : repo;
}

/** The menu button: "All repos", or "Only app" so a narrowed list says it hides topics. */
export function scopeLabel(overview: RepoOverview | undefined): string {
  const scope = overview?.scope ?? null;
  return scope === null ? 'All repos' : `Only ${shortRepo(scope)}`;
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

/** The hover on the topic header's repo: why an off-scope topic is listed, else where its PRs are. */
export function topicRepoTitle(line: TopicRepoLine): string {
  if (line.offScope) {
    const { pickedLabel, pickedPrs } = line.offScope;
    const prs = pickedPrs === 1 ? '1 PR is' : `${pickedPrs} PRs are`;
    return `Listed because ${prs} in ${pickedLabel}; most of its PRs are in ${line.label}`;
  }
  const [main, ...others] = line.repos;
  return others.length === 0 ? `Most of its PRs are in ${main}` : `Most of its PRs are in ${main}; also in ${others.join(', ')}`;
}
