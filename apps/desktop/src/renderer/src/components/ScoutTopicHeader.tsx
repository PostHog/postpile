import type { TopicDetail } from '@postpile/core';
import { prMixTitle } from '../lib/pr-mix.ts';
import { ChevronIcon, PrStateIcon } from './icons.tsx';

/**
 * The header of a scout's pseudo-topic (DESIGN.md "Scouts"): Topics ›
 * Scouted, the scout's name, its PR count and one muted line on what this
 * is. No driver menu, role, your-move chip, dossier or "Ask the agent":
 * nothing here is the user's work until they follow it, and the scout has
 * no topic memory to talk about.
 */
export function ScoutTopicHeader(props: { detail: TopicDetail }) {
  const { topic, prRollup } = props.detail;
  const title = prMixTitle(prRollup);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-[5px] text-[11px] text-hint">
        <span>Topics</span>
        <span className="-rotate-90 text-ghost">
          <ChevronIcon size={8} />
        </span>
        <span aria-hidden="true" className="size-[5px] rounded-[1.5px] bg-ghost" />
        <span className="font-medium text-ink-2">Scouted</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-[22px] leading-[1.2] font-[650] tracking-[-0.024em] text-balance">{topic.name}</h1>
        <span className="flex h-5 items-center gap-[5px] rounded-full bg-pill-quiet px-2 text-[11px] whitespace-nowrap text-ink-2" title={title}>
          {prRollup.state && <PrStateIcon state={prRollup.state} size={11} title={title} />}
          <span className="font-mono text-[10px] font-semibold tabular-nums">{prRollup.total}</span>
          <span className="text-hint">{prRollup.total === 1 ? 'PR' : 'PRs'}</span>
        </span>
      </div>
      <p className="mt-1.5 max-w-[600px] text-[12px] leading-normal text-hint">PRs this scout pulled in from outside your GitHub inbox. Follow one to track it.</p>
      {props.detail.tiles.length === 0 && <p className="mt-4 text-xs text-hint">Nothing pulled in right now. New matches show up here after a sync.</p>}
    </div>
  );
}
