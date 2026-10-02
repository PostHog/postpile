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

function prCount(prs: number): string {
  return `${prs} PR${prs === 1 ? '' : 's'}`;
}

/** The hover on the topic header's repo: why an off-scope topic is listed, else where its PRs are, as counts. */
export function topicRepoTitle(line: TopicRepoLine): string {
  const [main, ...others] = line.repos;
  if (main === undefined) {
    return '';
  }
  if (line.offScope) {
    const { pickedLabel, pickedPrs } = line.offScope;
    const verb = pickedPrs === 1 ? 'is' : 'are';
    const rest = others
      .filter((entry) => entry.repo !== pickedLabel && shortRepo(entry.repo) !== pickedLabel)
      .map((entry) => shortRepo(entry.repo));
    const also = rest.length > 0 ? `; also in ${rest.join(', ')}` : '';
    return `Listed because ${prCount(pickedPrs)} ${verb} in ${pickedLabel}; ${prCount(main.prs)} ${main.prs === 1 ? 'is' : 'are'} in ${line.label}${also}`;
  }
  if (others.length === 0) {
    return main.prs === 1 ? '1 PR, in ' + shortRepo(main.repo) : `${main.prs} PRs, all in ${shortRepo(main.repo)}`;
  }
  return `PRs: ${line.repos.map((entry) => `${entry.prs} in ${shortRepo(entry.repo)}`).join(', ')}`;
}
