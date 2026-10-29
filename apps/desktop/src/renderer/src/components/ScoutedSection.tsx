import type { ScoutListItem } from '@postpile/core';
import { useScouts } from '../api/scouts.ts';
import { scoutCountTitle, scoutRowTitle } from '../lib/scouts.ts';

/** The grey count of unseen tiles: the calm bubble's look, never coral and never bold, since nothing here is unread. Nothing at 0. */
function UnseenCount(props: { item: ScoutListItem }) {
  if (props.item.unseen === 0) {
    return null;
  }
  const label = scoutCountTitle(props.item);
  return (
    <span
      title={label}
      aria-label={label}
      className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-chip px-[5px] font-mono text-[10px] leading-none font-semibold text-muted tabular-nums"
    >
      {props.item.unseen}
    </span>
  );
}

function ScoutRow(props: { item: ScoutListItem; active: boolean; onSelect: () => void }) {
  const { item, active } = props;
  // Regular weight in every state: a scout row never reads as unread. An empty scout steps back.
  const name = active ? 'font-[550] text-ink' : item.tiles === 0 ? 'text-hint' : 'text-ink-read';
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-current={active ? 'true' : undefined}
      title={scoutRowTitle(item)}
      className={`flex min-w-0 items-center gap-[7px] rounded-row py-1.5 pr-2 pl-[22px] text-left ${active ? 'bg-surface shadow-active-row' : 'hover:bg-surface/55'}`}
    >
      <span className={`truncate text-[12.5px] leading-[normal] tracking-[-0.006em] ${name}`}>{item.name}</span>
      <span className="ml-auto" />
      <UnseenCount item={item} />
    </button>
  );
}

/**
 * "Scouted" at the bottom of the sidebar (DESIGN.md "Scouts"): one row per
 * scout in scouts.md order, opening its pseudo-topic like a topic row. Not a
 * topic section: no dot colour of its own, no unread look, no your-move
 * chip, and left out of the search and the queue filters (the caller hides
 * it while they narrow). Nothing at all without scouts.
 */
export function ScoutedSection(props: { activeTopicId: string | null; onSelect: (topicId: string) => void }) {
  const scouts = useScouts().data ?? [];
  if (scouts.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-px">
      <span
        title="PRs your scouts pulled in from outside your GitHub inbox. Never unread, never your move, not in any count."
        className="flex items-center pt-1.5 pr-2 pb-1 pl-3 text-[10px] leading-[normal] font-bold tracking-[0.07em] text-hint uppercase"
      >
        <span aria-hidden="true" className="mr-[5px] size-[5px] rounded-[1.5px] bg-ghost" />
        Scouted
      </span>
      {scouts.map((item) => (
        <ScoutRow key={item.id} item={item} active={item.topicId === props.activeTopicId} onSelect={() => props.onSelect(item.topicId)} />
      ))}
    </div>
  );
}
