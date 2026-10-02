import type { TopicRepoLine } from '@postpile/core';
import { topicRepoTitle } from '../lib/repos.ts';
import { RepoIcon } from './icons.tsx';

/**
 * The topic's main repo on the header's owner line: plain mono text, not one
 * more pill. When a repo is picked and the topic mostly lives elsewhere it
 * turns honey and says "mostly in infra".
 */
export function TopicRepo(props: { line: TopicRepoLine }) {
  const { line } = props;
  const others = line.repos.length - 1;
  const look = line.offScope ? 'rounded bg-honey-soft px-[5px] py-px text-honey-ink' : 'text-ink-2';
  return (
    <span title={topicRepoTitle(line)} className={`inline-flex items-center gap-1 font-mono text-[10.5px] whitespace-nowrap ${look}`}>
      <RepoIcon />
      {line.offScope ? `mostly in ${line.label}` : line.label}
      {others > 0 && <span className={line.offScope ? 'opacity-70' : 'text-faint'}>+{others}</span>}
    </span>
  );
}
